/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

export const ICouncilLearningEngine = createDecorator<ICouncilLearningEngine>('councilLearningEngine');

export interface ReviewOutcome {
	readonly reviewId: string;
	readonly prNumber: number;
	readonly verdict: string;
	readonly score: number;
	readonly wasMerged: boolean;
	readonly hadPostMergeIssues: boolean;
	readonly feedbackScore?: number;
	readonly timestamp: number;
}

export interface AgentPerformance {
	readonly roleId: string;
	readonly totalReviews: number;
	readonly accuratePredictions: number;
	readonly accuracyScore: number;
	readonly averageConfidence: number;
	readonly strengthAreas: string[];
	readonly weaknessAreas: string[];
}

export interface PatternInsight {
	readonly patternId: string;
	readonly description: string;
	readonly category: string;
	readonly frequency: number;
	readonly confidence: number;
	readonly recommendation: string;
	readonly firstSeen: number;
	readonly lastSeen: number;
}

export interface ICouncilLearningEngine extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onInsightGenerated: Event<PatternInsight>;

	recordOutcome(outcome: ReviewOutcome): void;
	recordFeedback(reviewId: string, score: number): void;
	getAgentPerformance(roleId: string): AgentPerformance;
	getAllAgentPerformance(): AgentPerformance[];
	getInsights(category?: string, limit?: number): PatternInsight[];
	generateInsights(): PatternInsight[];
	getRecommendations(roleId: string): string[];
	shouldIncludeAgent(roleId: string, context: string): boolean;
	getConfidenceAdjustment(roleId: string): number;
}

export class CouncilLearningEngine extends Disposable implements ICouncilLearningEngine {
	declare readonly _serviceBrand: undefined;

	private readonly _onInsightGenerated = this._register(new Emitter<PatternInsight>());
	readonly onInsightGenerated = this._onInsightGenerated.event;

	private readonly outcomes: ReviewOutcome[];
	private readonly agentStats: Map<string, { reviews: number; accurate: number; totalConfidence: number; strengths: Map<string, number>; weaknesses: Map<string, number> }>;
	private readonly insights: PatternInsight[];

	private readonly storageKey = 'council.learning.data';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.outcomes = [];
		this.agentStats = new Map();
		this.insights = [];
		this.loadFromStorage();
	}

	public recordOutcome(outcome: ReviewOutcome): void {
		this.outcomes.push(outcome);

		const stats = this.agentStats.get(outcome.reviewId) ?? {
			reviews: 0,
			accurate: 0,
			totalConfidence: 0,
			strengths: new Map(),
			weaknesses: new Map()
		};
		stats.reviews++;

		if (outcome.verdict === 'approve' && outcome.wasMerged && !outcome.hadPostMergeIssues) {
			stats.accurate++;
		} else if (outcome.verdict === 'request_changes' && !outcome.wasMerged) {
			stats.accurate++;
		}

		this.saveToStorage();
		this.logService.debug(`[Council Learning] Recorded outcome for PR #${outcome.prNumber}`);
	}

	public recordFeedback(reviewId: string, score: number): void {
		const outcome = this.outcomes.find(o => o.reviewId === reviewId);
		if (outcome) {
			outcome.feedbackScore = score;
			this.saveToStorage();
		}
	}

	public getAgentPerformance(roleId: string): AgentPerformance {
		const stats = this.agentStats.get(roleId);
		if (!stats || stats.reviews === 0) {
			return {
				roleId,
				totalReviews: 0,
				accuratePredictions: 0,
				accuracyScore: 0,
				averageConfidence: 0,
				strengthAreas: [],
				weaknessAreas: []
			};
		}

		const strengths = Array.from(stats.strengths.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([area]) => area);

		const weaknesses = Array.from(stats.weaknesses.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([area]) => area);

		return {
			roleId,
			totalReviews: stats.reviews,
			accuratePredictions: stats.accurate,
			accuracyScore: stats.reviews > 0 ? stats.accurate / stats.reviews : 0,
			averageConfidence: stats.reviews > 0 ? stats.totalConfidence / stats.reviews : 0,
			strengthAreas: strengths,
			weaknessAreas: weaknesses
		};
	}

	public getAllAgentPerformance(): AgentPerformance[] {
		const roleIds = new Set(this.outcomes.map(o => o.reviewId));
		return Array.from(roleIds).map(id => this.getAgentPerformance(id));
	}

	public getInsights(category?: string, limit: number = 10): PatternInsight[] {
		let filtered = [...this.insights];
		if (category) {
			filtered = filtered.filter(i => i.category === category);
		}
		return filtered.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
	}

	public generateInsights(): PatternInsight[] {
		const newInsights: PatternInsight[] = [];

		const mergeRate = this.outcomes.filter(o => o.wasMerged).length / Math.max(this.outcomes.length, 1);

		if (mergeRate < 0.5 && this.outcomes.length > 5) {
			newInsights.push({
				patternId: generateUuid(),
				description: 'Low PR merge rate detected',
				category: 'process',
				frequency: this.outcomes.length - this.outcomes.filter(o => o.wasMerged).length,
				confidence: 0.8,
				recommendation: 'Consider adjusting review criteria or improving PR quality guidelines',
				firstSeen: this.outcomes[0]?.timestamp ?? Date.now(),
				lastSeen: Date.now()
			});
		}

		const postMergeIssues = this.outcomes.filter(o => o.wasMerged && o.hadPostMergeIssues);
		if (postMergeIssues.length > this.outcomes.length * 0.2 && this.outcomes.length > 5) {
			newInsights.push({
				patternId: generateUuid(),
				description: 'High post-merge issue rate',
				category: 'quality',
				frequency: postMergeIssues.length,
				confidence: 0.75,
				recommendation: 'Strengthen review criteria, add more automated testing',
				firstSeen: postMergeIssues[0]?.timestamp ?? Date.now(),
				lastSeen: Date.now()
			});
		}

		for (const insight of newInsights) {
			this.insights.push(insight);
			this._onInsightGenerated.fire(insight);
		}

		this.saveToStorage();
		return newInsights;
	}

	public getRecommendations(roleId: string): string[] {
		const performance = this.getAgentPerformance(roleId);
		const recommendations: string[] = [];

		if (performance.accuracyScore < 0.6 && performance.totalReviews > 3) {
			recommendations.push('Consider adjusting confidence thresholds for this agent');
		}

		if (performance.weaknessAreas.length > 0) {
			recommendations.push(`Focus improvement on: ${performance.weaknessAreas.join(', ')}`);
		}

		if (performance.accuracyScore > 0.8 && performance.totalReviews > 10) {
			recommendations.push('This agent shows high accuracy - consider increasing priority weight');
		}

		return recommendations;
	}

	public shouldIncludeAgent(roleId: string, context: string): boolean {
		const performance = this.getAgentPerformance(roleId);

		if (performance.totalReviews < 2) return true;

		const lowerContext = context.toLowerCase();
		for (const weakness of performance.weaknessAreas) {
			if (lowerContext.includes(weakness.toLowerCase()) && performance.accuracyScore < 0.5) {
				return false;
			}
		}

		return true;
	}

	public getConfidenceAdjustment(roleId: string): number {
		const performance = this.getAgentPerformance(roleId);

		if (performance.totalReviews < 5) return 0;

		if (performance.accuracyScore > 0.8) return 0.1;
		if (performance.accuracyScore < 0.5) return -0.1;

		return 0;
	}

	private loadFromStorage(): void {
		try {
			const stored = this.storageService.get(this.storageKey, StorageScope.WORKSPACE, '{}');
			const data = JSON.parse(stored);
			if (data.outcomes) {
				this.outcomes.push(...data.outcomes);
			}
			if (data.insights) {
				this.insights.push(...data.insights);
			}
		} catch {
			// Ignore
		}
	}

	private saveToStorage(): void {
		try {
			const data = {
				outcomes: this.outcomes.slice(-500),
				insights: this.insights.slice(-100)
			};
			this.storageService.store(
				this.storageKey,
				JSON.stringify(data),
				StorageScope.WORKSPACE,
				StorageTarget.USER
			);
		} catch (error) {
			this.logService.warn(`[Council Learning] Failed to save: ${error}`);
		}
	}
}
