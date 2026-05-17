/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';

export const ICouncilCircuitBreaker = createDecorator<ICouncilCircuitBreaker>('councilCircuitBreaker');

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
	readonly failureThreshold: number;
	readonly recoveryTimeoutMs: number;
	readonly halfOpenMaxAttempts: number;
}

export interface CircuitBreakerStats {
	readonly state: CircuitState;
	readonly totalRequests: number;
	readonly totalFailures: number;
	readonly totalSuccesses: number;
	readonly lastFailureAt?: number;
	readonly lastStateChangeAt: number;
}

export interface CircuitBreakerEvent {
	readonly service: string;
	readonly state: CircuitState;
	readonly previousState: CircuitState;
	readonly timestamp: number;
}

export interface ICouncilCircuitBreaker extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onStateChange: Event<CircuitBreakerEvent>;

	configure(service: string, config: CircuitBreakerConfig): void;
	canExecute(service: string): boolean;
	recordSuccess(service: string): void;
	recordFailure(service: string, error?: Error): void;
	getStats(service: string): CircuitBreakerStats;
	getAllStats(): Map<string, CircuitBreakerStats>;
	reset(service: string): void;
	resetAll(): void;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 5,
	recoveryTimeoutMs: 60000,
	halfOpenMaxAttempts: 3
};

interface CircuitStateEntry {
	state: CircuitState;
	failureCount: number;
	successCount: number;
	halfOpenAttempts: number;
	totalRequests: number;
	totalFailures: number;
	totalSuccesses: number;
	lastFailureAt?: number;
	lastStateChangeAt: number;
}

export class CouncilCircuitBreaker extends Disposable implements ICouncilCircuitBreaker {
	declare readonly _serviceBrand: undefined;

	private readonly _onStateChange = this._register(new Emitter<CircuitBreakerEvent>());
	readonly onStateChange = this._onStateChange.event;

	private readonly configs: Map<string, CircuitBreakerConfig>;
	private readonly states: Map<string, CircuitStateEntry>;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.configs = new Map();
		this.states = new Map();

		this.configure('default', DEFAULT_CONFIG);
		this.configure('llm', DEFAULT_CONFIG);
		this.configure('fileSystem', DEFAULT_CONFIG);
		this.configure('network', DEFAULT_CONFIG);
	}

	public configure(service: string, config: CircuitBreakerConfig): void {
		this.configs.set(service, config);
		if (!this.states.has(service)) {
			this.states.set(service, {
				state: 'closed',
				failureCount: 0,
				successCount: 0,
				halfOpenAttempts: 0,
				totalRequests: 0,
				totalFailures: 0,
				totalSuccesses: 0,
				lastStateChangeAt: Date.now()
			});
		}
	}

	public canExecute(service: string): boolean {
		const config = this.configs.get(service) ?? this.configs.get('default')!;
		const entry = this.states.get(service);

		if (!entry) return true;

		entry.totalRequests++;

		switch (entry.state) {
			case 'closed':
				return true;
			case 'open': {
				const elapsed = Date.now() - entry.lastStateChangeAt;
				if (elapsed >= config.recoveryTimeoutMs) {
					this.transitionState(service, 'half-open');
					return true;
				}
				return false;
			}
			case 'half-open':
				return entry.halfOpenAttempts < config.halfOpenMaxAttempts;
			default:
				return true;
		}
	}

	public recordSuccess(service: string): void {
		const entry = this.states.get(service);
		if (!entry) return;

		entry.totalSuccesses++;
		entry.successCount++;

		if (entry.state === 'half-open') {
			entry.halfOpenAttempts++;
			if (entry.successCount >= 2) {
				this.transitionState(service, 'closed');
				entry.failureCount = 0;
				entry.successCount = 0;
			}
		} else if (entry.state === 'closed') {
			entry.failureCount = Math.max(0, entry.failureCount - 1);
		}

		this.logService.debug(`[Council CircuitBreaker] ${service}: success (state: ${entry.state})`);
	}

	public recordFailure(service: string, error?: Error): void {
		const config = this.configs.get(service) ?? this.configs.get('default')!;
		const entry = this.states.get(service);
		if (!entry) return;

		entry.totalFailures++;
		entry.failureCount++;
		entry.lastFailureAt = Date.now();
		entry.successCount = 0;

		if (entry.state === 'half-open') {
			this.transitionState(service, 'open');
		} else if (entry.state === 'closed' && entry.failureCount >= config.failureThreshold) {
			this.transitionState(service, 'open');
		}

		this.logService.warn(`[Council CircuitBreaker] ${service}: failure (state: ${entry.state}, error: ${error?.message})`);
	}

	public getStats(service: string): CircuitBreakerStats {
		const entry = this.states.get(service);
		if (!entry) {
			return {
				state: 'closed',
				totalRequests: 0,
				totalFailures: 0,
				totalSuccesses: 0,
				lastStateChangeAt: Date.now()
			};
		}

		return {
			state: entry.state,
			totalRequests: entry.totalRequests,
			totalFailures: entry.totalFailures,
			totalSuccesses: entry.totalSuccesses,
			lastFailureAt: entry.lastFailureAt,
			lastStateChangeAt: entry.lastStateChangeAt
		};
	}

	public getAllStats(): Map<string, CircuitBreakerStats> {
		const stats = new Map<string, CircuitBreakerStats>();
		for (const service of this.states.keys()) {
			stats.set(service, this.getStats(service));
		}
		return stats;
	}

	public reset(service: string): void {
		const entry = this.states.get(service);
		if (entry) {
			this.transitionState(service, 'closed');
			entry.failureCount = 0;
			entry.successCount = 0;
			entry.halfOpenAttempts = 0;
		}
	}

	public resetAll(): void {
		for (const service of this.states.keys()) {
			this.reset(service);
		}
	}

	private transitionState(service: string, newState: CircuitState): void {
		const entry = this.states.get(service);
		if (!entry) return;

		const previousState = entry.state;
		if (previousState === newState) return;

		entry.state = newState;
		entry.lastStateChangeAt = Date.now();

		if (newState === 'closed') {
			entry.failureCount = 0;
			entry.successCount = 0;
			entry.halfOpenAttempts = 0;
		} else if (newState === 'half-open') {
			entry.halfOpenAttempts = 0;
			entry.successCount = 0;
		}

		this._onStateChange.fire({
			service,
			state: newState,
			previousState,
			timestamp: Date.now()
		});

		this.logService.info(`[Council CircuitBreaker] ${service}: ${previousState} -> ${newState}`);
	}
}
