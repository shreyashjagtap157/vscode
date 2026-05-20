/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { ICouncilTelemetryService } from './councilTelemetryService.js';

export const ICouncilTokenBudget = createDecorator<ICouncilTokenBudget>('councilTokenBudget');

export interface TokenBudgetConfig {
	readonly maxTokensPerSession: number;
	readonly maxTokensPerMinute: number;
	readonly maxTokensPerHour: number;
	readonly maxCostPerSession: number;
	readonly costPerInputToken: number;
	readonly costPerOutputToken: number;
	readonly hardLimit: boolean;
}

export interface TokenUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly estimatedCost: number;
}

export interface BudgetStatus {
	readonly sessionUsage: TokenUsage;
	readonly minuteUsage: TokenUsage;
	readonly hourUsage: TokenUsage;
	readonly sessionBudgetRemaining: number;
	readonly minuteBudgetRemaining: number;
	readonly hourBudgetRemaining: number;
	readonly isExceeded: boolean;
	readonly exceededLimit?: 'session' | 'minute' | 'hour' | 'cost';
}

export interface BudgetExceededEvent {
	readonly limit: 'session' | 'minute' | 'hour' | 'cost';
	readonly current: number;
	readonly limitValue: number;
	readonly timestamp: number;
}

export interface ICouncilTokenBudget extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onBudgetExceeded: Event<BudgetExceededEvent>;

	configure(config: Partial<TokenBudgetConfig>): void;
	recordUsage(sessionId: string, inputTokens: number, outputTokens: number): void;
	checkBudget(): BudgetStatus;
	getSessionUsage(sessionId: string): TokenUsage;
	resetSession(sessionId: string): void;
	getConfig(): TokenBudgetConfig;
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
	maxTokensPerSession: 100000,
	maxTokensPerMinute: 50000,
	maxTokensPerHour: 500000,
	maxCostPerSession: 10,
	costPerInputToken: 0.00001,
	costPerOutputToken: 0.00003,
	hardLimit: false
};

interface SessionUsage {
	inputTokens: number;
	outputTokens: number;
	startTime: number;
}

export class CouncilTokenBudget extends Disposable implements ICouncilTokenBudget {
	declare readonly _serviceBrand: undefined;

	private readonly _onBudgetExceeded = this._register(new Emitter<BudgetExceededEvent>());
	readonly onBudgetExceeded = this._onBudgetExceeded.event;

	private readonly sessionUsage: Map<string, SessionUsage>;
	private readonly minuteUsage: { inputTokens: number; outputTokens: number; resetAt: number };
	private readonly hourUsage: { inputTokens: number; outputTokens: number; resetAt: number };
	private config: TokenBudgetConfig;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICouncilTelemetryService private readonly telemetryService: ICouncilTelemetryService
	) {
		super();
		this.sessionUsage = new Map();
		this.minuteUsage = { inputTokens: 0, outputTokens: 0, resetAt: Date.now() + 60000 };
		this.hourUsage = { inputTokens: 0, outputTokens: 0, resetAt: Date.now() + 3600000 };
		this.config = { ...DEFAULT_CONFIG };
	}

	public configure(config: Partial<TokenBudgetConfig>): void {
		this.config = { ...this.config, ...config };
	}

	public recordUsage(sessionId: string, inputTokens: number, outputTokens: number): void {
		const now = Date.now();

		if (this.minuteUsage.resetAt <= now) {
			this.minuteUsage.inputTokens = 0;
			this.minuteUsage.outputTokens = 0;
			this.minuteUsage.resetAt = now + 60000;
		}

		if (this.hourUsage.resetAt <= now) {
			this.hourUsage.inputTokens = 0;
			this.hourUsage.outputTokens = 0;
			this.hourUsage.resetAt = now + 3600000;
		}

		this.minuteUsage.inputTokens += inputTokens;
		this.minuteUsage.outputTokens += outputTokens;
		this.hourUsage.inputTokens += inputTokens;
		this.hourUsage.outputTokens += outputTokens;

		let session = this.sessionUsage.get(sessionId);
		if (!session) {
			session = { inputTokens: 0, outputTokens: 0, startTime: now };
			this.sessionUsage.set(sessionId, session);
		}
		session.inputTokens += inputTokens;
		session.outputTokens += outputTokens;

		const status = this.checkBudget();
		if (status.isExceeded) {
			this._onBudgetExceeded.fire({
				limit: status.exceededLimit!,
				current: status.sessionUsage.totalTokens,
				limitValue: this.config.maxTokensPerSession,
				timestamp: now
			});

			this.telemetryService.sendBudgetExceeded(sessionId, this.config.maxTokensPerSession, status.sessionUsage.totalTokens);

			this.logService.warn(`[Council TokenBudget] Budget exceeded: ${status.exceededLimit}`);
		}
	}

	public checkBudget(): BudgetStatus {
		const sessionTotals = this.getSessionTotals();

		const sessionRemaining = Math.max(0, this.config.maxTokensPerSession - sessionTotals.totalTokens);
		const minuteRemaining = Math.max(0, this.config.maxTokensPerMinute - (this.minuteUsage.inputTokens + this.minuteUsage.outputTokens));
		const hourRemaining = Math.max(0, this.config.maxTokensPerHour - (this.hourUsage.inputTokens + this.hourUsage.outputTokens));

		let isExceeded = false;
		let exceededLimit: BudgetStatus['exceededLimit'];

		if (sessionTotals.totalTokens > this.config.maxTokensPerSession) {
			isExceeded = true;
			exceededLimit = 'session';
		} else if (this.minuteUsage.inputTokens + this.minuteUsage.outputTokens > this.config.maxTokensPerMinute) {
			isExceeded = true;
			exceededLimit = 'minute';
		} else if (this.hourUsage.inputTokens + this.hourUsage.outputTokens > this.config.maxTokensPerHour) {
			isExceeded = true;
			exceededLimit = 'hour';
		} else if (sessionTotals.estimatedCost > this.config.maxCostPerSession) {
			isExceeded = true;
			exceededLimit = 'cost';
		}

		return {
			sessionUsage: sessionTotals,
			minuteUsage: {
				inputTokens: this.minuteUsage.inputTokens,
				outputTokens: this.minuteUsage.outputTokens,
				totalTokens: this.minuteUsage.inputTokens + this.minuteUsage.outputTokens,
				estimatedCost: 0
			},
			hourUsage: {
				inputTokens: this.hourUsage.inputTokens,
				outputTokens: this.hourUsage.outputTokens,
				totalTokens: this.hourUsage.inputTokens + this.hourUsage.outputTokens,
				estimatedCost: 0
			},
			sessionBudgetRemaining: sessionRemaining,
			minuteBudgetRemaining: minuteRemaining,
			hourBudgetRemaining: hourRemaining,
			isExceeded,
			exceededLimit
		};
	}

	public getSessionUsage(sessionId: string): TokenUsage {
		const session = this.sessionUsage.get(sessionId);
		if (!session) {
			return { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 };
		}

		return {
			inputTokens: session.inputTokens,
			outputTokens: session.outputTokens,
			totalTokens: session.inputTokens + session.outputTokens,
			estimatedCost: session.inputTokens * this.config.costPerInputToken + session.outputTokens * this.config.costPerOutputToken
		};
	}

	public resetSession(sessionId: string): void {
		this.sessionUsage.delete(sessionId);
	}

	public getConfig(): TokenBudgetConfig {
		return { ...this.config };
	}

	private getSessionTotals(): TokenUsage {
		let inputTokens = 0;
		let outputTokens = 0;

		for (const session of this.sessionUsage.values()) {
			inputTokens += session.inputTokens;
			outputTokens += session.outputTokens;
		}

		return {
			inputTokens,
			outputTokens,
			totalTokens: inputTokens + outputTokens,
			estimatedCost: inputTokens * this.config.costPerInputToken + outputTokens * this.config.costPerOutputToken
		};
	}
}
