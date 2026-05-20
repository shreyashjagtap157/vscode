/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { nullExtensionDescription } from '../../../services/extensions/common/extensions.js';
import {
	ChatMessageRole,
	IChatMessage,
	IChatMessageTextPart,
	IChatMessageThinkingPart,
	IChatResponseTextPart,
	ILanguageModelChatMetadataAndIdentifier,
	ILanguageModelChatProvider,
	ILanguageModelChatRequestOptions,
	ILanguageModelChatResponse
} from '../common/languageModels.js';

const LMSTUDIO_VENDOR_ID = 'lmstudio';
const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234';
const LMSTUDIO_SECRET_KEY = 'lmstudio.apiKey';
const LMSTUDIO_STORAGE_MODELS_KEY = 'lmstudio.cachedModels';
const LMSTUDIO_STORAGE_URL_KEY = 'lmstudio.baseUrl';
const LMSTUDIO_POLL_INTERVAL = 30000;

interface LMStudioModelInfo {
	id: string;
	name: string;
	displayName?: string;
	architecture?: string;
	context_length?: number;
	role?: string;
	loaded?: boolean;
	activation?: {
		engine?: string;
		device?: string;
	};
	compat?: {
		chat_template?: string;
	};
}

interface LMStudioConfig {
	baseUrl: string;
	apiKey?: string;
	timeout: number;
}

export class LMStudioLanguageModelProvider extends Disposable implements ILanguageModelChatProvider {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private _models: LMStudioModelInfo[] = [];
	private _config: LMStudioConfig;
	private _isConnected = false;
	private _hasResolved = false;
	private _pollTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		const storedUrl = this.storageService.get(LMSTUDIO_STORAGE_URL_KEY, StorageScope.APPLICATION, LMSTUDIO_DEFAULT_BASE_URL);
		const storedTimeout = parseInt(this.storageService.get('lmstudio.timeout', StorageScope.APPLICATION, '60000'), 10);

		this._config = {
			baseUrl: storedUrl,
			timeout: isNaN(storedTimeout) ? 60000 : storedTimeout
		};

		this._loadCachedModels();
		this._startPolling();
	}

	override dispose(): void {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = undefined;
		}
		super.dispose();
	}

	private _loadCachedModels(): void {
		const cached = this.storageService.get(LMSTUDIO_STORAGE_MODELS_KEY, StorageScope.APPLICATION, '');
		if (cached) {
			try {
				this._models = JSON.parse(cached);
			} catch {
				this._models = [];
			}
		}
	}

	private _saveCachedModels(): void {
		this.storageService.store(LMSTUDIO_STORAGE_MODELS_KEY, JSON.stringify(this._models), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	private _startPolling(): void {
		this._pollTimer = setInterval(() => {
			this._checkConnection().catch(() => { /* silent */ });
		}, LMSTUDIO_POLL_INTERVAL);

		this._checkConnection().catch(() => { /* silent */ });
	}

	private async _checkConnection(): Promise<void> {
		const wasConnected = this._isConnected;
		try {
			const models = await this._fetchModels();
			const wasEmpty = this._models.length === 0;
			this._models = models;
			this._isConnected = true;
			this._hasResolved = true;
			this._saveCachedModels();

			if (!wasConnected || wasEmpty) {
				this.logService.info(`[LM Studio] Connected to ${this._config.baseUrl}, found ${models.length} model(s)`);
				this._onDidChange.fire();
			}
		} catch (err) {
			if (this._isConnected) {
				this.logService.warn(`[LM Studio] Connection lost: ${err}`);
			}
			this._isConnected = false;

			if (wasConnected) {
				this._onDidChange.fire();
			}
		}
	}

	get isConnected(): boolean {
		return this._isConnected;
	}

	get hasResolved(): boolean {
		return this._hasResolved;
	}

	get config(): LMStudioConfig {
		return { ...this._config };
	}

	async updateConfig(config: Partial<LMStudioConfig>): Promise<void> {
		if (config.baseUrl !== undefined) {
			this._config.baseUrl = config.baseUrl;
			this.storageService.store(LMSTUDIO_STORAGE_URL_KEY, config.baseUrl, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		if (config.apiKey !== undefined) {
			this._config.apiKey = config.apiKey;
			if (config.apiKey) {
				await this.secretStorageService.set(LMSTUDIO_SECRET_KEY, config.apiKey);
			} else {
				await this.secretStorageService.delete(LMSTUDIO_SECRET_KEY);
			}
		}
		if (config.timeout !== undefined) {
			this._config.timeout = config.timeout;
			this.storageService.store('lmstudio.timeout', config.timeout.toString(), StorageScope.APPLICATION, StorageTarget.MACHINE);
		}

		await this.refreshModels();
	}

	async refreshModels(): Promise<void> {
		await this._checkConnection();
	}

	private async _fetchModels(): Promise<LMStudioModelInfo[]> {
		const url = `${this._config.baseUrl}/v1/models`;

		const response = await fetch(url, {
			method: 'GET',
			headers: this._getHeaders(),
			signal: AbortSignal.timeout(this._config.timeout)
		});

		if (!response.ok) {
			throw new Error(`LM Studio returned ${response.status}: ${response.statusText}`);
		}

		const body = await response.json();

		if (body.data && Array.isArray(body.data)) {
			return body.data.map((model: Record<string, unknown>) => ({
				id: model.id as string,
				name: (model.name as string) || (model.id as string),
				displayName: model.display_name as string | undefined,
				architecture: (model.architecture as string) || this._extractArchitecture(model.id as string),
				context_length: model.context_length as number | undefined,
				role: model.role as string | undefined,
				loaded: model.loaded as boolean | undefined,
				activation: model.activation as LMStudioModelInfo['activation'],
				compat: model.compat as LMStudioModelInfo['compat'],
			}));
		}

		return [];
	}

	private _extractArchitecture(modelId: string): string | undefined {
		const patterns = [
			/(llama-\d)/i,
			/(mistral)/i,
			/(gemma)/i,
			/(qwen)/i,
			/(phi-\d)/i,
			/(codestral)/i,
			/(deepseek)/i,
			/(mixtral)/i,
			/(yi-\d)/i,
			/(internlm)/i,
		];

		for (const pattern of patterns) {
			const match = modelId.match(pattern);
			if (match) {
				return match[1];
			}
		}
		return undefined;
	}

	private _getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (this._config.apiKey) {
			headers['Authorization'] = `Bearer ${this._config.apiKey}`;
		}
		return headers;
	}

	async provideLanguageModelChatInfo(_options: unknown, _token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]> {
		const models = this._models.length > 0 ? this._models : [];

		return models.map(model => {
			const contextLength = model.context_length ?? this._estimateContextLength(model);
			const family = this._extractFamily(model);
			const isLoaded = model.loaded === true;

			const detail = this._buildModelDetail(model, contextLength);
			const tooltip = this._buildModelTooltip(model, contextLength, isLoaded);

			return {
				identifier: `${LMSTUDIO_VENDOR_ID}:${model.id}`,
				metadata: {
					extension: nullExtensionDescription.identifier,
					name: model.displayName || model.name,
					id: model.id,
					vendor: LMSTUDIO_VENDOR_ID,
					version: '1.0',
					family,
					detail,
					tooltip,
					maxInputTokens: contextLength,
					maxOutputTokens: Math.floor(contextLength * 0.2),
					isDefaultForLocation: {},
					isUserSelectable: this._isConnected,
					capabilities: {
						vision: this._supportsVision(model),
						toolCalling: this._supportsToolCalling(model),
						agentMode: this._supportsToolCalling(model),
					},
					configurationSchema: {
						type: 'object',
						properties: {
							temperature: {
								type: 'number',
								title: 'Temperature',
								description: 'Controls randomness in output. Lower values are more deterministic, higher values more creative.',
								default: 0.7,
								minimum: 0,
								maximum: 2,
								group: 'navigation'
							},
							maxTokens: {
								type: 'number',
								title: 'Max Output Tokens',
								description: `Maximum tokens to generate. Model context window: ${contextLength.toLocaleString()} tokens.`,
								default: Math.floor(contextLength * 0.2),
								minimum: 1,
								maximum: Math.floor(contextLength * 0.8)
							},
							topP: {
								type: 'number',
								title: 'Top P (Nucleus Sampling)',
								description: 'Controls diversity via nucleus sampling. 1.0 disables nucleus sampling.',
								default: 1,
								minimum: 0,
								maximum: 1
							},
							topK: {
								type: 'number',
								title: 'Top K',
								description: 'Limits the number of tokens considered for generation. 0 disables top_k filtering.',
								default: 40,
								minimum: 0,
								maximum: 1000
							},
							repeatPenalty: {
								type: 'number',
								title: 'Repeat Penalty',
								description: 'Penalizes repeated tokens. Higher values reduce repetition.',
								default: 1.1,
								minimum: 0,
								maximum: 2
							}
						}
					}
				}
			};
		});
	}

	private _estimateContextLength(model: LMStudioModelInfo): number {
		const id = model.id.toLowerCase();
		if (id.includes('128k') || id.includes('131k')) return 128000;
		if (id.includes('64k')) return 64000;
		if (id.includes('32k')) return 32000;
		if (id.includes('16k')) return 16000;
		if (id.includes('8k')) return 8192;
		if (id.includes('4k')) return 4096;

		const arch = (model.architecture || '').toLowerCase();
		if (arch.includes('llama-3') || arch.includes('llama3')) return 8192;
		if (arch.includes('llama-2') || arch.includes('llama2')) return 4096;
		if (arch.includes('mistral')) return 32000;
		if (arch.includes('gemma')) return 8192;
		if (arch.includes('qwen')) return 32000;
		if (arch.includes('phi-3') || arch.includes('phi3')) return 128000;
		if (arch.includes('phi-2') || arch.includes('phi2')) return 2048;
		if (arch.includes('deepseek')) return 32000;
		if (arch.includes('mixtral')) return 32000;

		return 8192;
	}

	private _extractFamily(model: LMStudioModelInfo): string {
		const arch = (model.architecture || '').toLowerCase();
		const id = model.id.toLowerCase();

		const familyMap: [RegExp, string][] = [
			[/llama/i, 'Llama'],
			[/mistral/i, 'Mistral'],
			[/gemma/i, 'Gemma'],
			[/qwen/i, 'Qwen'],
			[/phi/i, 'Phi'],
			[/codestral/i, 'Codestral'],
			[/deepseek/i, 'DeepSeek'],
			[/mixtral/i, 'Mixtral'],
			[/yi-/i, 'Yi'],
			[/internlm/i, 'InternLM'],
			[/llava/i, 'LLaVA'],
		];

		for (const [pattern, family] of familyMap) {
			if (pattern.test(arch) || pattern.test(id)) {
				return family;
			}
		}

		return 'LM Studio';
	}

	private _buildModelDetail(model: LMStudioModelInfo, contextLength: number): string {
		const parts: string[] = [];

		if (model.loaded) {
			parts.push('Loaded');
		}

		if (model.activation?.device) {
			const deviceLabel = model.activation.device === 'gpu' ? 'GPU' :
				model.activation.device === 'cpu' ? 'CPU' :
					model.activation.device;
			parts.push(deviceLabel);
		}

		parts.push(`${contextLength.toLocaleString()} context`);

		return parts.join(' · ');
	}

	private _buildModelTooltip(model: LMStudioModelInfo, contextLength: number, isLoaded: boolean): string {
		const lines: string[] = [];

		lines.push(`Model: ${model.displayName || model.name}`);
		lines.push(`ID: ${model.id}`);

		if (model.architecture) {
			lines.push(`Architecture: ${model.architecture}`);
		}

		lines.push(`Context Window: ${contextLength.toLocaleString()} tokens`);
		lines.push(`Max Output: ${Math.floor(contextLength * 0.2).toLocaleString()} tokens`);

		if (isLoaded) {
			lines.push('Status: Loaded and ready');
			if (model.activation?.engine) {
				lines.push(`Engine: ${model.activation.engine}`);
			}
			if (model.activation?.device) {
				lines.push(`Device: ${model.activation.device.toUpperCase()}`);
			}
		} else {
			lines.push('Status: Not loaded');
		}

		const capabilities: string[] = [];
		if (this._supportsVision(model)) capabilities.push('Vision');
		if (this._supportsToolCalling(model)) capabilities.push('Tool Calling');
		if (capabilities.length > 0) {
			lines.push(`Capabilities: ${capabilities.join(', ')}`);
		}

		return lines.join('\n');
	}

	private _supportsVision(model: LMStudioModelInfo): boolean {
		const arch = model.architecture?.toLowerCase() ?? '';
		const id = model.id.toLowerCase();
		return /vision|llava|idefics|vl/i.test(arch) || /vision|llava|vl-/i.test(id);
	}

	private _supportsToolCalling(model: LMStudioModelInfo): boolean {
		const arch = model.architecture?.toLowerCase() ?? '';
		const id = model.id.toLowerCase();

		const unsupported = /instruct-|chat-|base$/i;
		if (unsupported.test(arch) || unsupported.test(id)) {
			return false;
		}

		return true;
	}

	async sendChatRequest(
		modelId: string,
		messages: IChatMessage[],
		_from: unknown,
		options: ILanguageModelChatRequestOptions,
		token: CancellationToken
	): Promise<ILanguageModelChatResponse> {
		if (!this._isConnected) {
			throw new Error('LM Studio is not connected. Please start LM Studio and load a model.');
		}

		const model = this._models.find(m => m.id === modelId);
		if (!model) {
			throw new Error(`Model ${modelId} not found in LM Studio`);
		}

		const formattedMessages = messages.map(msg => this._formatMessage(msg));
		const modelOptions = options.modelOptions || {};
		const contextLength = model.context_length ?? this._estimateContextLength(model);

		const body: Record<string, unknown> = {
			model: modelId,
			messages: formattedMessages,
			stream: true,
			temperature: (modelOptions.temperature as number) ?? 0.7,
			max_tokens: (modelOptions.maxTokens as number) ?? Math.floor(contextLength * 0.2),
			top_p: (modelOptions.topP as number) ?? 1,
			top_k: (modelOptions.topK as number) ?? 40,
			repeat_penalty: (modelOptions.repeatPenalty as number) ?? 1.1,
		};

		const url = `${this._config.baseUrl}/v1/chat/completions`;

		this.logService.debug(`[LM Studio] Request: ${url} model=${modelId}`);

		const response = await fetch(url, {
			method: 'POST',
			headers: this._getHeaders(),
			body: JSON.stringify(body),
			signal: token.isCancellationRequested ? AbortSignal.abort() : undefined
		});

		token.onCancellationRequested(() => {
			// Abort signal will be handled by the stream reader
		});

		return this._handleStreamingResponse(response, token);
	}

	private _formatMessage(message: IChatMessage): Record<string, unknown> {
		const roleMap: Record<number, string> = {
			[ChatMessageRole.System]: 'system',
			[ChatMessageRole.User]: 'user',
			[ChatMessageRole.Assistant]: 'assistant'
		};

		const textParts = message.content
			.filter((p): p is IChatMessageTextPart => p.type === 'text')
			.map(p => p.value)
			.join('\n');

		const thinkingParts = message.content
			.filter((p): p is IChatMessageThinkingPart => p.type === 'thinking')
			.map(p => typeof p.value === 'string' ? p.value : p.value.join('\n'))
			.join('\n');

		let content = textParts;
		if (thinkingParts) {
			content = content ? `${content}\n\n<thinking>\n${thinkingParts}\n</thinking>` : `<thinking>\n${thinkingParts}\n</thinking>`;
		}

		return {
			role: roleMap[message.role] ?? 'user',
			content,
			...(message.name ? { name: message.name } : {})
		};
	}

	private async _handleStreamingResponse(
		response: Response,
		token: CancellationToken
	): Promise<ILanguageModelChatResponse> {
		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`LM Studio error ${response.status}: ${errorText}`);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let fullContent = '';

		const asyncStream: AsyncIterable<IChatResponseTextPart> = {
			[Symbol.asyncIterator]: async function* () {
				try {
					while (!token.isCancellationRequested) {
						const { done, value } = await reader.read();
						if (done) break;

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() ?? '';

						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed || trimmed === 'data: [DONE]') continue;

							if (trimmed.startsWith('data: ')) {
								try {
									const data = JSON.parse(trimmed.slice(6));
									const delta = data.choices?.[0]?.delta;
									if (delta?.content) {
										fullContent += delta.content;
										yield { type: 'text', value: delta.content };
									}
									if (delta?.reasoning_content || delta?.thinking) {
										const thinking = delta.reasoning_content || delta.thinking;
										yield { type: 'text', value: `<thinking>${thinking}</thinking>` };
									}
								} catch {
									// Ignore parse errors for incomplete chunks
								}
							}
						}
					}
				} finally {
					reader.releaseLock();
				}
			}
		};

		return {
			stream: asyncStream,
			result: Promise.resolve({
				finished: true,
				finishReason: 'stop',
				content: fullContent
			})
		};
	}

	async provideTokenCount(modelId: string, message: string | IChatMessage, _token: CancellationToken): Promise<number> {
		const text = typeof message === 'string' ? message : message.content
			.filter((p): p is IChatMessageTextPart => p.type === 'text')
			.map(p => p.value)
			.join(' ');

		const model = this._models.find(m => m.id === modelId);
		const arch = (model?.architecture || '').toLowerCase();

		if (arch.includes('llama') || arch.includes('codestral')) {
			return Math.ceil(text.length / 3.5);
		}
		if (arch.includes('mistral') || arch.includes('mixtral')) {
			return Math.ceil(text.length / 3.8);
		}
		if (arch.includes('qwen')) {
			return Math.ceil(text.length / 1.5);
		}

		return Math.ceil(text.length / 4);
	}

	async testConnection(): Promise<boolean> {
		try {
			await this._fetchModels();
			return true;
		} catch {
			return false;
		}
	}
}
