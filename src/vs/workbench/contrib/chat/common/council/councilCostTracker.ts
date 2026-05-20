/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Event, Emitter } from '../../../../../base/common/event.js';

export const ICouncilCostTracker = createDecorator<ICouncilCostTracker>('councilCostTracker');

export interface TokenUsage {
	readonly sessionId: string;
	readonly modelId: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly cost: number;
	readonly timestamp: number;
	readonly taskType: string;
}

export interface CostSummary {
	readonly totalSessions: number;
	readonly totalTokens: number;
	readonly totalCost: number;
	readonly averageCostPerSession: number;
	readonly averageTokensPerSession: number;
	readonly modelBreakdown: Map<string, { sessions: number; tokens: number; cost: number }>;
	readonly dailyUsage: Map<string, { tokens: number; cost: number }>;
}

export interface BudgetAlert {
	readonly threshold: number;
	readonly currentCost: number;
	readonly percentageUsed: number;
	readonly isExceeded: boolean;
}

export interface ICouncilCostTracker extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onTokenUsageRecorded: Event<TokenUsage>;
	readonly onBudgetAlert: Event<BudgetAlert>;

	recordUsage(sessionId: string, modelId: string, inputTokens: number, outputTokens: number, taskType: string): void;
	getUsage(sessionId: string): TokenUsage[];
	getSummary(period?: 'day' | 'week' | 'month'): CostSummary;
	setBudget(monthlyBudget: number): void;
	getBudgetAlert(): BudgetAlert | undefined;
	getEstimatedCost(modelId: string, inputTokens: number, outputTokens: number): number;
	clearUsage(): void;
}

const MODEL_COSTS: Record<string, { inputPer1K: number; outputPer1K: number }> = {
	'gpt-4o': { inputPer1K: 0.005, outputPer1K: 0.015 },
	'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
	'gpt-4': { inputPer1K: 0.03, outputPer1K: 0.06 },
	'gpt-3.5-turbo': { inputPer1K: 0.0005, outputPer1K: 0.0015 },
	'claude-sonnet': { inputPer1K: 0.003, outputPer1K: 0.015 },
	'claude-opus': { inputPer1K: 0.015, outputPer1K: 0.075 },
	'claude-haiku': { inputPer1K: 0.00025, outputPer1K: 0.00125 },
	'gemini-pro': { inputPer1K: 0.0005, outputPer1K: 0.0015 },
	'gemini-flash': { inputPer1K: 0.000075, outputPer1K: 0.0003 },
	'llama': { inputPer1K: 0.0002, outputPer1K: 0.0002 },
	'default': { inputPer1K: 0.001, outputPer1K: 0.003 }
};

export class CouncilCostTracker extends Disposable implements ICouncilCostTracker {
	declare readonly _serviceBrand: undefined;

	private readonly _onTokenUsageRecorded = this._register(new Emitter<TokenUsage>());
	readonly onTokenUsageRecorded = this._onTokenUsageRecorded.event;

	private readonly _onBudgetAlert = this._register(new Emitter<BudgetAlert>());
	readonly onBudgetAlert = this._onBudgetAlert.event;

	private readonly usage: TokenUsage[];
	private monthlyBudget: number | undefined;
	private readonly storageKey = 'council.costTracker.usage';
	private readonly budgetKey = 'council.costTracker.budget';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.usage = [];
		this.loadFromStorage();
	}

	public recordUsage(
		sessionId: string,
		modelId: string,
		inputTokens: number,
		outputTokens: number,
		taskType: string
	): void {
		const cost = this.getEstimatedCost(modelId, inputTokens, outputTokens);

		const tokenUsage: TokenUsage = {
			sessionId,
			modelId,
			inputTokens,
			outputTokens,
			totalTokens: inputTokens + outputTokens,
			cost,
			timestamp: Date.now(),
			taskType
		};

		this.usage.push(tokenUsage);
		this._onTokenUsageRecorded.fire(tokenUsage);
		this.saveToStorage();

		this.logService.debug(`[Council Cost] ${modelId}: ${tokenUsage.totalTokens} tokens, $${cost.toFixed(4)}`);

		if (this.monthlyBudget) {
			const alert = this.getBudgetAlert();
			if (alert && (alert.isExceeded || alert.percentageUsed >= 80)) {
				this._onBudgetAlert.fire(alert);
			}
		}
	}

	public getUsage(sessionId: string): TokenUsage[] {
		return this.usage.filter(u => u.sessionId === sessionId);
	}

	public getSummary(period: 'day' | 'week' | 'month' = 'month'): CostSummary {
		const now = Date.now();
		let cutoff: number;

		switch (period) {
			case 'day': cutoff = now - 24 * 60 * 60 * 1000; break;
			case 'week': cutoff = now - 7 * 24 * 60 * 60 * 1000; break;
			case 'month': cutoff = now - 30 * 24 * 60 * 60 * 1000; break;
			default: cutoff = now - 30 * 24 * 60 * 60 * 1000;
		}

		const filtered = this.usage.filter(u => u.timestamp >= cutoff);

		const modelBreakdown = new Map<string, { sessions: number; tokens: number; cost: number }>();
		const dailyUsage = new Map<string, { tokens: number; cost: number }>();

		for (const u of filtered) {
			const model = modelBreakdown.get(u.modelId) ?? { sessions: 0, tokens: 0, cost: 0 };
			model.sessions++;
			model.tokens += u.totalTokens;
			model.cost += u.cost;
			modelBreakdown.set(u.modelId, model);

			const dayKey = new Date(u.timestamp).toISOString().split('T')[0];
			const day = dailyUsage.get(dayKey) ?? { tokens: 0, cost: 0 };
			day.tokens += u.totalTokens;
			day.cost += u.cost;
			dailyUsage.set(dayKey, day);
		}

		const totalTokens = filtered.reduce((sum, u) => sum + u.totalTokens, 0);
		const totalCost = filtered.reduce((sum, u) => sum + u.cost, 0);
		const uniqueSessions = new Set(filtered.map(u => u.sessionId)).size;

		return {
			totalSessions: uniqueSessions,
			totalTokens,
			totalCost,
			averageCostPerSession: uniqueSessions > 0 ? totalCost / uniqueSessions : 0,
			averageTokensPerSession: uniqueSessions > 0 ? totalTokens / uniqueSessions : 0,
			modelBreakdown,
			dailyUsage
		};
	}

	public setBudget(monthlyBudget: number): void {
		this.monthlyBudget = monthlyBudget;
		this.storageService.store(
			this.budgetKey,
			String(monthlyBudget),
			StorageScope.WORKSPACE,
			StorageTarget.USER
		);
		this.logService.info(`[Council Cost] Monthly budget set to $${monthlyBudget}`);
	}

	public getBudgetAlert(): BudgetAlert | undefined {
		if (!this.monthlyBudget) return undefined;

		const now = Date.now();
		const monthStart = now - 30 * 24 * 60 * 60 * 1000;
		const monthlyUsage = this.usage.filter(u => u.timestamp >= monthStart);
		const currentCost = monthlyUsage.reduce((sum, u) => sum + u.cost, 0);

		return {
			threshold: this.monthlyBudget,
			currentCost,
			percentageUsed: (currentCost / this.monthlyBudget) * 100,
			isExceeded: currentCost > this.monthlyBudget
		};
	}

	public getEstimatedCost(modelId: string, inputTokens: number, outputTokens: number): number {
		const costs = this.getModelCosts(modelId);
		return (inputTokens / 1000) * costs.inputPer1K + (outputTokens / 1000) * costs.outputPer1K;
	}

	public clearUsage(): void {
		this.usage.length = 0;
		this.saveToStorage();
		this.logService.info('[Council Cost] Usage cleared');
	}

	private getModelCosts(modelId: string): { inputPer1K: number; outputPer1K: number } {
		const lowerId = modelId.toLowerCase();

		for (const [key, costs] of Object.entries(MODEL_COSTS)) {
			if (lowerId.includes(key)) {
				return costs;
			}
		}

		return MODEL_COSTS['default'];
	}

	private loadFromStorage(): void {
		try {
			const storedUsage = this.storageService.get(this.storageKey, StorageScope.WORKSPACE, '[]');
			const parsed = JSON.parse(storedUsage) as TokenUsage[];
			const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
			this.usage.push(...parsed.filter(u => u.timestamp >= monthAgo));

			const storedBudget = this.storageService.get(this.budgetKey, StorageScope.WORKSPACE);
			if (storedBudget) {
				this.monthlyBudget = parseFloat(storedBudget);
			}
		} catch (error) {
			this.logService.warn(`[Council Cost] Failed to load from storage: ${error}`);
		}
	}

	private saveToStorage(): void {
		try {
			const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
			const recent = this.usage.filter(u => u.timestamp >= monthAgo);
			this.storageService.store(
				this.storageKey,
				JSON.stringify(recent),
				StorageScope.WORKSPACE,
				StorageTarget.USER
			);
		} catch (error) {
			this.logService.warn(`[Council Cost] Failed to save to storage: ${error}`);
		}
	}
}
