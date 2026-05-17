/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';

export const ICouncilConnectionPool = createDecorator<ICouncilConnectionPool>('councilConnectionPool');

export interface PoolConfig {
	readonly maxConcurrent: number;
	readonly queueTimeoutMs: number;
	readonly enableFairness: boolean;
}

export interface PoolStats {
	readonly activeRequests: number;
	readonly queuedRequests: number;
	readonly completedRequests: number;
	readonly failedRequests: number;
	readonly averageWaitTimeMs: number;
	readonly averageExecutionTimeMs: number;
}

export interface ICouncilConnectionPool extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onPoolDrained: Event<void>;

	configure(config: Partial<PoolConfig>): void;
	execute<T>(fn: () => Promise<T>, priority?: number): Promise<T>;
	getStats(): PoolStats;
	drain(): Promise<void>;
}

const DEFAULT_CONFIG: PoolConfig = {
	maxConcurrent: 5,
	queueTimeoutMs: 30000,
	enableFairness: true
};

interface QueuedRequest<T> {
	readonly fn: () => Promise<T>;
	readonly priority: number;
	readonly enqueuedAt: number;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
}

export class CouncilConnectionPool extends Disposable implements ICouncilConnectionPool {
	declare readonly _serviceBrand: undefined;

	private readonly _onPoolDrained = this._register(new Emitter<void>());
	readonly onPoolDrained = this._onPoolDrained.event;

	private readonly queue: QueuedRequest<unknown>[];
	private activeCount: number;
	private config: PoolConfig;
	private completedCount: number;
	private failedCount: number;
	private totalWaitTime: number;
	private totalExecutionTime: number;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.queue = [];
		this.activeCount = 0;
		this.completedCount = 0;
		this.failedCount = 0;
		this.totalWaitTime = 0;
		this.totalExecutionTime = 0;
		this.config = { ...DEFAULT_CONFIG };
	}

	public configure(config: Partial<PoolConfig>): void {
		this.config = { ...this.config, ...config };
	}

	public async execute<T>(fn: () => Promise<T>, priority: number = 0): Promise<T> {
		if (this.activeCount < this.config.maxConcurrent && this.queue.length === 0) {
			return this.runRequest(fn);
		}

		return new Promise<T>((resolve, reject) => {
			const request: QueuedRequest<T> = {
				fn,
				priority,
				enqueuedAt: Date.now(),
				resolve: resolve as (value: unknown) => void,
				reject: reject as (error: Error) => void
			};

			this.queue.push(request as QueuedRequest<unknown>);
			this.queue.sort((a, b) => b.priority - a.priority);

			this.checkTimeouts();
			this.processQueue();
		});
	}

	public getStats(): PoolStats {
		const totalCompleted = this.completedCount + this.failedCount;
		return {
			activeRequests: this.activeCount,
			queuedRequests: this.queue.length,
			completedRequests: this.completedCount,
			failedRequests: this.failedCount,
			averageWaitTimeMs: totalCompleted > 0 ? this.totalWaitTime / totalCompleted : 0,
			averageExecutionTimeMs: totalCompleted > 0 ? this.totalExecutionTime / totalCompleted : 0
		};
	}

	public async drain(): Promise<void> {
		while (this.activeCount > 0 || this.queue.length > 0) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		this._onPoolDrained.fire();
	}

	private async runRequest<T>(fn: () => Promise<T>): Promise<T> {
		this.activeCount++;
		const startTime = Date.now();

		try {
			const result = await fn();
			this.completedCount++;
			this.totalExecutionTime += Date.now() - startTime;
			return result;
		} catch (error) {
			this.failedCount++;
			throw error;
		} finally {
			this.activeCount--;
			this.processQueue();
		}
	}

	private processQueue(): void {
		while (this.activeCount < this.config.maxConcurrent && this.queue.length > 0) {
			const request = this.queue.shift()!;
			const waitTime = Date.now() - request.enqueuedAt;
			this.totalWaitTime += waitTime;

			this.runRequest(request.fn)
				.then(request.resolve)
				.catch(request.reject);
		}
	}

	private checkTimeouts(): void {
		const now = Date.now();
		const timedOut: QueuedRequest<unknown>[] = [];

		for (const request of this.queue) {
			if (now - request.enqueuedAt > this.config.queueTimeoutMs) {
				timedOut.push(request);
			}
		}

		for (const request of timedOut) {
			const index = this.queue.indexOf(request);
			if (index !== -1) {
				this.queue.splice(index, 1);
				request.reject(new Error('Request timed out in queue'));
			}
		}
	}
}
