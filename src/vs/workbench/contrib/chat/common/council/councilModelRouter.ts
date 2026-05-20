/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';

export const ICouncilModelRouter = createDecorator<ICouncilModelRouter>('councilModelRouter');

export type ModelTier = 'fast' | 'balanced' | 'premium' | 'specialized';

export interface ModelInfo {
	readonly modelId: string;
	readonly tier: ModelTier;
	readonly maxTokens: number;
	readonly costPer1KTokens: number;
	readonly supportsTools: boolean;
	readonly supportsVision: boolean;
}

export interface RoutingDecision {
	readonly modelId: string;
	readonly tier: ModelTier;
	readonly reason: string;
	readonly estimatedCost: number;
}

export interface TaskComplexity {
	readonly estimatedTokens: number;
	readonly requiresReasoning: boolean;
	readonly requiresTools: boolean;
	readonly requiresVision: boolean;
	readonly complexity: 'simple' | 'moderate' | 'complex' | 'critical';
}

export interface ICouncilModelRouter extends IDisposable {
	readonly _serviceBrand: undefined;

	routeTask(taskDescription: string, availableModels: string[]): RoutingDecision;
	routeSession(request: string, availableModels: string[]): RoutingDecision[];
	analyzeComplexity(text: string): TaskComplexity;
	getModelsByTier(tier: ModelTier, availableModels: string[]): string[];
	getEstimatedCost(modelId: string, tokenCount: number): number;
}

const COMPLEXITY_KEYWORDS: Record<string, string[]> = {
	'simple': ['list', 'format', 'convert', 'rename', 'count', 'find', 'show', 'what is'],
	'moderate': ['explain', 'compare', 'analyze', 'review', 'suggest', 'improve', 'refactor', 'optimize'],
	'complex': ['architect', 'design', 'implement', 'build', 'create', 'develop', 'migrate', 'transform'],
	'critical': ['security', 'vulnerability', 'production', 'critical', 'emergency', 'incident', 'breach']
};

export class CouncilModelRouter extends Disposable implements ICouncilModelRouter {
	declare readonly _serviceBrand: undefined;

	private readonly modelCache: Map<string, ModelInfo>;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.modelCache = new Map();
	}

	public routeTask(taskDescription: string, availableModels: string[]): RoutingDecision {
		const complexity = this.analyzeComplexity(taskDescription);
		const tier = this.complexityToTier(complexity.complexity);
		const tierModels = this.getModelsByTier(tier, availableModels);

		let selectedModel: string;
		if (tierModels.length > 0) {
			selectedModel = tierModels[0];
		} else if (availableModels.length > 0) {
			selectedModel = availableModels[0];
		} else {
			selectedModel = 'unknown';
		}

		const cost = this.getEstimatedCost(selectedModel, complexity.estimatedTokens);

		const decision: RoutingDecision = {
			modelId: selectedModel,
			tier,
			reason: `Task complexity: ${complexity.complexity} (est. ${complexity.estimatedTokens} tokens)`,
			estimatedCost: cost
		};

		this.logService.debug(`[Council Model Router] ${decision.reason} → ${selectedModel} (${tier})`);
		return decision;
	}

	public routeSession(request: string, availableModels: string[]): RoutingDecision[] {
		const complexity = this.analyzeComplexity(request);
		const primaryTier = this.complexityToTier(complexity.complexity);

		const decisions: RoutingDecision[] = [];

		const primaryModels = this.getModelsByTier(primaryTier, availableModels);
		if (primaryModels.length > 0) {
			decisions.push({
				modelId: primaryModels[0],
				tier: primaryTier,
				reason: `Primary model for ${complexity.complexity} task`,
				estimatedCost: this.getEstimatedCost(primaryModels[0], complexity.estimatedTokens)
			});
		}

		if (complexity.complexity === 'complex' || complexity.complexity === 'critical') {
			const reviewModels = this.getModelsByTier('premium', availableModels);
			if (reviewModels.length > 0 && reviewModels[0] !== decisions[0]?.modelId) {
				decisions.push({
					modelId: reviewModels[0],
					tier: 'premium',
					reason: 'Secondary model for review/validation',
					estimatedCost: this.getEstimatedCost(reviewModels[0], complexity.estimatedTokens * 0.3)
				});
			}
		}

		if (decisions.length === 0 && availableModels.length > 0) {
			decisions.push({
				modelId: availableModels[0],
				tier: 'balanced',
				reason: 'Fallback to first available model',
				estimatedCost: this.getEstimatedCost(availableModels[0], complexity.estimatedTokens)
			});
		}

		return decisions;
	}

	public analyzeComplexity(text: string): TaskComplexity {
		const wordCount = text.split(/\s+/).length;
		const estimatedTokens = Math.ceil(wordCount * 1.3);

		let hasReasoning = false;
		let hasTools = false;
		let hasVision = false;

		const reasoningKeywords = ['why', 'because', 'therefore', 'analyze', 'compare', 'evaluate', 'consider', 'reason'];
		const toolKeywords = ['run', 'execute', 'file', 'search', 'edit', 'create', 'delete', 'terminal'];
		const visionKeywords = ['image', 'screenshot', 'photo', 'diagram', 'chart', 'visual', 'look at'];

		const lowerText = text.toLowerCase();
		hasReasoning = reasoningKeywords.some(kw => lowerText.includes(kw));
		hasTools = toolKeywords.some(kw => lowerText.includes(kw));
		hasVision = visionKeywords.some(kw => lowerText.includes(kw));

		let complexity: TaskComplexity['complexity'] = 'simple';

		for (const [level, keywords] of Object.entries(COMPLEXITY_KEYWORDS)) {
			for (const keyword of keywords) {
				if (lowerText.includes(keyword)) {
					complexity = level as TaskComplexity['complexity'];
					break;
				}
			}
		}

		if (estimatedTokens > 16000) {
			complexity = complexity === 'simple' ? 'moderate' : complexity;
		}
		if (estimatedTokens > 32000) {
			complexity = 'complex';
		}

		return {
			estimatedTokens,
			requiresReasoning: hasReasoning,
			requiresTools: hasTools,
			requiresVision: hasVision,
			complexity
		};
	}

	public getModelsByTier(tier: ModelTier, availableModels: string[]): string[] {
		const tierModels: string[] = [];

		for (const modelId of availableModels) {
			const modelInfo = this.getModelInfo(modelId);
			if (modelInfo && modelInfo.tier === tier) {
				tierModels.push(modelId);
			}
		}

		return tierModels;
	}

	public getEstimatedCost(modelId: string, tokenCount: number): number {
		const modelInfo = this.getModelInfo(modelId);
		if (!modelInfo) return 0;

		return (tokenCount / 1000) * modelInfo.costPer1KTokens;
	}

	private complexityToTier(complexity: TaskComplexity['complexity']): ModelTier {
		switch (complexity) {
			case 'simple': return 'fast';
			case 'moderate': return 'balanced';
			case 'complex': return 'premium';
			case 'critical': return 'premium';
			default: return 'balanced';
		}
	}

	private getModelInfo(modelId: string): ModelInfo | undefined {
		if (this.modelCache.has(modelId)) {
			return this.modelCache.get(modelId);
		}

		let tier: ModelTier = 'balanced';
		let costPer1KTokens = 0.01;
		let maxTokens = 8000;

		const lowerId = modelId.toLowerCase();

		if (lowerId.includes('fast') || lowerId.includes('turbo') || lowerId.includes('mini') || lowerId.includes('nano')) {
			tier = 'fast';
			costPer1KTokens = 0.002;
			maxTokens = 4000;
		} else if (lowerId.includes('premium') || lowerId.includes('pro') || lowerId.includes('max') || lowerId.includes('ultra') || lowerId.includes('o1') || lowerId.includes('o3')) {
			tier = 'premium';
			costPer1KTokens = 0.03;
			maxTokens = 32000;
		} else if (lowerId.includes('vision') || lowerId.includes('multimodal')) {
			tier = 'specialized';
			costPer1KTokens = 0.02;
			maxTokens = 16000;
		}

		const info: ModelInfo = {
			modelId,
			tier,
			maxTokens,
			costPer1KTokens,
			supportsTools: tier !== 'fast',
			supportsVision: tier === 'specialized'
		};

		this.modelCache.set(modelId, info);
		return info;
	}
}
