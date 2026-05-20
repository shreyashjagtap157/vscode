/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IAgentProfileManager, CouncilAgentProfile } from './agentProfileManager.js';
import { ILanguageModelsService, ChatMessageRole, IChatMessage } from '../languageModels.js';
import { ILanguageModelToolsService } from '../tools/languageModelToolsService.js';
import { IChatService } from '../chatService/chatService.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ICouncilCircuitBreaker } from './councilCircuitBreaker.js';
import { ICouncilRetry } from './councilRetry.js';
import { CouncilReadWriteLock } from './councilMutex.js';
import { ICouncilContextWindow, ContextWindowResult } from './councilContextWindow.js';
import { ICouncilModelCache } from './councilModelCache.js';
import { ICouncilConnectionPool } from './councilConnectionPool.js';
import { ICouncilTokenBudget } from './councilTokenBudget.js';
import { ICouncilRequestDedup } from './councilRequestDedup.js';
import { ICouncilSessionEviction } from './councilSessionEviction.js';
import { ICouncilTelemetryService } from './councilTelemetryService.js';
import { ICouncilTelemetrySampling } from './councilTelemetrySampling.js';
import { ICouncilInputSanitizer } from './councilInputSanitizer.js';
import { CouncilSession, CouncilResult, DebateRecord, CouncilTask } from './councilOrchestrator.js';

export const ICouncilEnhancedOrchestrator = createDecorator<ICouncilEnhancedOrchestrator>('councilEnhancedOrchestrator');

export interface EnhancedCouncilResult extends CouncilResult {
	readonly circuitBreakerStats: Map<string, import('./councilCircuitBreaker.js').CircuitBreakerStats>;
	readonly retryAttempts: number;
	readonly cacheHit: boolean;
	readonly tokenUsage: import('./councilTokenBudget.js').TokenUsage;
	readonly contextOptimization: ContextWindowResult;
}

export interface ICouncilEnhancedOrchestrator extends IDisposable {
	readonly _serviceBrand: undefined;

	executeSessionEnhanced(request: string, selectedRoles?: string[], token?: CancellationToken): Promise<EnhancedCouncilResult>;
	getSession(sessionId: string): Promise<CouncilSession | undefined>;
	getActiveSessions(): Promise<CouncilSession[]>;
	cancelSession(sessionId: string): void;
}

export class CouncilEnhancedOrchestrator extends Disposable implements ICouncilEnhancedOrchestrator {
	declare readonly _serviceBrand: undefined;

	private readonly sessions: Map<string, CouncilSession>;
	private readonly cancellationTokens: Map<string, CancellationTokenSource>;
	private readonly stateLock: CouncilReadWriteLock;

	constructor(
		@IAgentProfileManager private readonly profileManager: IAgentProfileManager,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILanguageModelToolsService _languageModelToolsService: ILanguageModelToolsService,
		@IChatService _chatService: IChatService,
		@ILogService private readonly logService: ILogService,
		@ICouncilCircuitBreaker private readonly circuitBreaker: ICouncilCircuitBreaker,
		@ICouncilRetry private readonly retry: ICouncilRetry,
		@ICouncilContextWindow private readonly contextWindow: ICouncilContextWindow,
		@ICouncilModelCache private readonly modelCache: ICouncilModelCache,
		@ICouncilConnectionPool private readonly connectionPool: ICouncilConnectionPool,
		@ICouncilTokenBudget private readonly tokenBudget: ICouncilTokenBudget,
		@ICouncilRequestDedup private readonly requestDedup: ICouncilRequestDedup,
		@ICouncilSessionEviction private readonly sessionEviction: ICouncilSessionEviction,
		@ICouncilTelemetryService private readonly telemetryService: ICouncilTelemetryService,
		@ICouncilTelemetrySampling _telemetrySampling: ICouncilTelemetrySampling,
		@ICouncilInputSanitizer private readonly inputSanitizer: ICouncilInputSanitizer
	) {
		super();
		this.sessions = new Map();
		this.cancellationTokens = new Map();
		this.stateLock = new CouncilReadWriteLock();
	}

	public async executeSessionEnhanced(
		request: string,
		selectedRoles?: string[],
		token: CancellationToken = CancellationToken.None
	): Promise<EnhancedCouncilResult> {
		const sanitizedRequest = this.inputSanitizer.sanitizeInput(request).sanitizedText;

		const cacheResult = await this.requestDedup.getOrExecute(
			sanitizedRequest,
			() => this.executeInternal(sanitizedRequest, selectedRoles, token),
			300000
		);

		return cacheResult;
	}

	private async executeInternal(
		request: string,
		selectedRoles: string[] | undefined,
		token: CancellationToken
	): Promise<EnhancedCouncilResult> {
		const sessionId = generateUuid();
		const cts = new CancellationTokenSource();
		const parentListener = token.onCancellationRequested(() => cts.cancel());
		this.cancellationTokens.set(sessionId, cts);

		const linkedToken = cts.token;
		let retryAttempts = 0;
		let cacheHit = false;

		try {
			this.logService.info(`[Council Enhanced] Starting session ${sessionId}`);
			this.telemetryService.sendSessionStart(sessionId, selectedRoles?.length ?? 3, 'enhanced');

			const budgetStatus = this.tokenBudget.checkBudget();
			if (budgetStatus.isExceeded) {
				throw new Error(`Token budget exceeded: ${budgetStatus.exceededLimit}`);
			}

			await this.modelCache.refreshModels();

			const decomposition = await this.retry.execute(
				() => this.decomposeRequest(request, selectedRoles, linkedToken),
				{ maxAttempts: 3 }
			);
			retryAttempts = decomposition.attempts.length;

			if (!decomposition.success) {
				throw new Error(`Task decomposition failed after ${decomposition.attempts.length} attempts`);
			}

			const session = this.createSession(sessionId, request, decomposition.value!);
			await this.stateLock.runWrite(async () => {
				this.sessions.set(sessionId, session);
			});

			this.sessionEviction.registerSession(sessionId, 1024, session.status);

			const executionLevels = this.getExecutionLevels(decomposition.value!.tasks);

			for (let levelIndex = 0; levelIndex < executionLevels.length; levelIndex++) {
				if (linkedToken.isCancellationRequested) {
					session.status = 'cancelled';
					throw new Error('Session cancelled');
				}

				const budgetCheck = this.tokenBudget.checkBudget();
				if (budgetCheck.isExceeded && this.tokenBudget.getConfig().hardLimit) {
					throw new Error(`Hard token budget limit exceeded: ${budgetCheck.exceededLimit}`);
				}

				const level = executionLevels[levelIndex];
				const results = await Promise.allSettled(
					level.map(task =>
						this.connectionPool.execute(() => this.executeTask(session, task, linkedToken))
					)
				);

				await this.stateLock.runWrite(async () => {
					this.processTaskResults(session, results);
				});
			}

			session.status = 'reviewing';
			const result = await this.synthesizeResult(session);
			session.status = 'completed';
			session.endTime = Date.now();

			const tokenUsage = this.tokenBudget.getSessionUsage(sessionId);

			const enhancedResult: EnhancedCouncilResult = {
				...result,
				circuitBreakerStats: this.circuitBreaker.getAllStats(),
				retryAttempts,
				cacheHit,
				tokenUsage,
				contextOptimization: this.contextWindow.getOptimizedContext()
			};

			this.telemetryService.sendSessionComplete(sessionId, result.executionTimeMs, result.confidence, session.activeTaskGraph.length);

			this.logService.info(`[Council Enhanced] Session ${sessionId} completed in ${session.endTime - session.startTime}ms`);

			return enhancedResult;
		} catch (error) {
			const session = await this.stateLock.runRead(async () => this.sessions.get(sessionId));
			if (session) {
				session.status = 'failed';
				session.endTime = Date.now();
			}

			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.error(`[Council Enhanced] Session ${sessionId} failed: ${errorMessage}`);
			this.telemetryService.sendSessionFailed(sessionId, errorMessage, Date.now() - (session?.startTime ?? Date.now()));

			throw error;
		} finally {
			parentListener.dispose();
			this.cancellationTokens.delete(sessionId);
		}
	}

	private async decomposeRequest(
		request: string,
		selectedRoles?: string[],
		token: CancellationToken = CancellationToken.None
	): Promise<import('./councilOrchestrator.js').TaskDecomposition> {
		if (!this.circuitBreaker.canExecute('llm')) {
			this.logService.warn('[Council Enhanced] Circuit breaker open, using default decomposition');
			return this.getDefaultDecomposition(request, selectedRoles);
		}

		try {
			const models = this.modelCache.getAvailableModels();
			if (models.length === 0) {
				return this.getDefaultDecomposition(request, selectedRoles);
			}

			const response = await this.languageModelsService.sendChatRequest(
				models[0].id,
				undefined,
				[{ role: ChatMessageRole.User, content: [{ type: 'text', value: `Decompose: ${request}` }] }],
				{},
				token
			);

			let responseText = '';
			for await (const chunk of response.stream) {
				if (Array.isArray(chunk)) {
					for (const part of chunk) {
						if (part.type === 'text') {
							responseText += part.value;
						}
					}
				} else if (chunk.type === 'text') {
					responseText += chunk.value;
				}
			}

			this.circuitBreaker.recordSuccess('llm');

			return {
				tasks: [{
					taskId: 't1',
					description: request,
					assignedRole: 'architect',
					dependencies: [],
					status: 'pending'
				}],
				summary: 'LLM decomposition'
			};
		} catch (error) {
			this.circuitBreaker.recordFailure('llm', error instanceof Error ? error : undefined);
			return this.getDefaultDecomposition(request, selectedRoles);
		}
	}

	private getDefaultDecomposition(request: string, selectedRoles?: string[]): import('./councilOrchestrator.js').TaskDecomposition {
		const profiles = selectedRoles
			? selectedRoles.map(r => this.profileManager.getProfile(r)).filter(Boolean)
			: this.profileManager.getAllProfiles().slice(0, 3);

		return {
			summary: 'Default decomposition',
			tasks: profiles.map((p, i) => ({
				taskId: `t${i + 1}`,
				description: request.substring(0, 200),
				assignedRole: p.roleId,
				dependencies: i === 0 ? [] : [`t${i}`],
				status: 'pending'
			}))
		};
	}

	private createSession(sessionId: string, request: string, decomposition: import('./councilOrchestrator.js').TaskDecomposition): CouncilSession {
		return {
			sessionId,
			originalRequest: request,
			activeTaskGraph: decomposition.tasks,
			contributions: new Map(),
			sharedScratchpad: [],
			startTime: Date.now(),
			status: 'planning'
		};
	}

	private getExecutionLevels(tasks: CouncilTask[]): CouncilTask[][] {
		const levels: CouncilTask[][] = [];
		const completed = new Set<string>();
		const remaining = new Set(tasks.map(t => t.taskId));

		while (remaining.size > 0) {
			const ready = tasks.filter(t =>
				remaining.has(t.taskId) && t.dependencies.every(dep => completed.has(dep))
			);

			if (ready.length === 0) break;

			levels.push(ready);
			ready.forEach(t => {
				completed.add(t.taskId);
				remaining.delete(t.taskId);
			});
		}

		return levels;
	}

	private async executeTask(session: CouncilSession, task: CouncilTask, token: CancellationToken): Promise<void> {
		task.status = 'in_progress';
		task.startTime = Date.now();

		try {
			const profile = this.profileManager.getProfile(task.assignedRole);
			const context = this.buildAgentContext(session, task);

			const result = await this.invokeSubAgent(profile, context, task.description, token);

			task.result = result;
			task.status = 'completed';
			task.endTime = Date.now();

			await this.stateLock.runWrite(async () => {
				session.contributions.set(task.assignedRole, result);
				session.sharedScratchpad.push(`[${profile.displayName}]: ${result.substring(0, 500)}...`);
			});

			const estimatedTokens = this.contextWindow.estimateTokenCount(result);
			this.tokenBudget.recordUsage(session.sessionId, estimatedTokens / 2, estimatedTokens / 2);

		} catch (error) {
			task.status = 'failed';
			task.error = error instanceof Error ? error.message : String(error);
			task.endTime = Date.now();
		}
	}

	private buildAgentContext(session: CouncilSession, task: CouncilTask): string {
		const dependencyResults = task.dependencies
			.map(depId => {
				const depTask = session.activeTaskGraph.find(t => t.taskId === depId);
				return depTask?.result ? `## ${depTask.assignedRole}\n${depTask.result}` : '';
			})
			.filter(Boolean)
			.join('\n\n');

		return `## Request\n${session.originalRequest}\n\n${dependencyResults}`;
	}

	private async invokeSubAgent(
		profile: CouncilAgentProfile,
		context: string,
		taskDescription: string,
		token: CancellationToken
	): Promise<string> {
		const models = this.modelCache.getAvailableModels();
		const modelId = profile.modelOverride && models.some(m => m.id === profile.modelOverride)
			? profile.modelOverride
			: models[0]?.id;

		if (!modelId) throw new Error('No model available');

		const messages: IChatMessage[] = [
			{ role: ChatMessageRole.System, content: [{ type: 'text', value: this.profileManager.buildSystemPrompt(profile.roleId, context) }] },
			{ role: ChatMessageRole.User, content: [{ type: 'text', value: taskDescription }] }
		];

		const response = await this.languageModelsService.sendChatRequest(
			modelId,
			undefined,
			messages,
			{ max_tokens: profile.maxTokens || 4000, temperature: profile.temperature ?? 0.7 },
			token
		);

		let result = '';
		for await (const chunk of response.stream) {
			if (token.isCancellationRequested) break;
			if (Array.isArray(chunk)) {
				for (const part of chunk) {
					if (part.type === 'text') {
						result += part.value;
					}
				}
			} else if (chunk.type === 'text') {
				result += chunk.value;
			}
		}

		return result || `[${profile.displayName}] Completed`;
	}

	private processTaskResults(session: CouncilSession, results: PromiseSettledResult<void>[]): void {
		for (const result of results) {
			if (result.status === 'rejected') {
				this.logService.warn(`[Council Enhanced] Task rejected: ${result.reason}`);
			}
		}
	}

	private async synthesizeResult(session: CouncilSession): Promise<CouncilResult> {
		const contributions = Array.from(session.contributions.entries());
		const failedTasks = session.activeTaskGraph.filter(t => t.status === 'failed');

		const confidence = this.calculateConfidence(session);
		const executionTime = (session.endTime || Date.now()) - session.startTime;

		return {
			sessionId: session.sessionId,
			finalResponse: `Synthesized from ${contributions.length} contributions`,
			contributions: new Map(contributions),
			debateRecords: this.detectDebates(session),
			confidence,
			executionTimeMs: executionTime,
			status: failedTasks.length === 0 ? 'success' : failedTasks.length < session.activeTaskGraph.length / 2 ? 'partial' : 'failed'
		};
	}

	private calculateConfidence(session: CouncilSession): number {
		const total = session.activeTaskGraph.length;
		const completed = session.activeTaskGraph.filter(t => t.status === 'completed').length;
		return total > 0 ? completed / total : 0;
	}

	private detectDebates(session: CouncilSession): DebateRecord[] {
		return [];
	}

	public async getSession(sessionId: string): Promise<CouncilSession | undefined> {
		return this.stateLock.runRead(async () => this.sessions.get(sessionId));
	}

	public async getActiveSessions(): Promise<CouncilSession[]> {
		return this.stateLock.runRead(async () =>
			Array.from(this.sessions.values()).filter(s => s.status === 'executing' || s.status === 'planning')
		);
	}

	public cancelSession(sessionId: string): void {
		const cts = this.cancellationTokens.get(sessionId);
		if (cts) {
			cts.cancel();
			this.logService.info(`[Council Enhanced] Session ${sessionId} cancelled`);
		}
	}
}
