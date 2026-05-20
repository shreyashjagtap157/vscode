/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { Event, Emitter } from '../../../../../base/common/event.js';

export const ICouncilRateLimiter = createDecorator<ICouncilRateLimiter>('councilRateLimiter');

export interface RateLimitConfig {
	readonly maxRequests: number;
	readonly windowMs: number;
	readonly maxTokensPerMinute?: number;
	readonly maxTokensPerHour?: number;
	readonly burstLimit?: number;
}

export interface RateLimitStatus {
	readonly remaining: number;
	readonly limit: number;
	readonly resetAt: number;
	readonly isThrottled: boolean;
	readonly retryAfter?: number;
}

export interface RateLimitEvent {
	readonly service: string;
	readonly action: string;
	readonly status: RateLimitStatus;
	readonly timestamp: number;
}

export interface ICouncilRateLimiter extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onRateLimitExceeded: Event<RateLimitEvent>;

	configure(service: string, config: RateLimitConfig): void;
	checkLimit(service: string, action: string, tokens?: number): Promise<RateLimitStatus>;
	recordRequest(service: string, action: string, tokens?: number): void;
	getStatus(service: string): RateLimitStatus;
	reset(service: string): void;
	getAllStatus(): Map<string, RateLimitStatus>;
}

interface TokenBucket {
	tokens: number;
	readonly maxTokens: number;
	readonly refillRate: number;
	lastRefill: number;
}

interface SlidingWindow {
	requests: number[];
	readonly maxRequests: number;
	readonly windowMs: number;
}

export class CouncilRateLimiter extends Disposable implements ICouncilRateLimiter {
	declare readonly _serviceBrand: undefined;

	private readonly _onRateLimitExceeded = this._register(new Emitter<RateLimitEvent>());
	readonly onRateLimitExceeded = this._onRateLimitExceeded.event;

	private readonly configs: Map<string, RateLimitConfig>;
	private readonly windows: Map<string, SlidingWindow>;
	private readonly buckets: Map<string, TokenBucket>;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.configs = new Map();
		this.windows = new Map();
		this.buckets = new Map();

		this.configure('default', {
			maxRequests: 60,
			windowMs: 60 * 1000,
			maxTokensPerMinute: 100000,
			maxTokensPerHour: 3000000,
			burstLimit: 10
		});
	}

	public configure(service: string, config: RateLimitConfig): void {
		this.configs.set(service, config);
		this.windows.set(service, {
			requests: [],
			maxRequests: config.maxRequests,
			windowMs: config.windowMs
		});
		if (config.maxTokensPerMinute) {
			this.buckets.set(service, {
				tokens: config.maxTokensPerMinute,
				maxTokens: config.maxTokensPerMinute,
				refillRate: config.maxTokensPerMinute / 60,
				lastRefill: Date.now()
			});
		}
	}

	public async checkLimit(service: string, action: string, tokens: number = 1): Promise<RateLimitStatus> {
		const config = this.configs.get(service) ?? this.configs.get('default')!;
		const window = this.windows.get(service);
		const bucket = this.buckets.get(service);
		const now = Date.now();

		if (window) {
			window.requests = window.requests.filter(t => t > now - window.windowMs);

			if (window.requests.length >= window.maxRequests) {
				const resetAt = Math.min(...window.requests) + window.windowMs;
				const status: RateLimitStatus = {
					remaining: 0,
					limit: window.maxRequests,
					resetAt,
					isThrottled: true,
					retryAfter: resetAt - now
				};

				this._onRateLimitExceeded.fire({ service, action, status, timestamp: now });
				this.logService.warn(`[Council RateLimiter] Rate limit exceeded for ${service}/${action}`);
				return status;
			}
		}

		if (bucket && tokens) {
			const elapsed = (now - bucket.lastRefill) / 1000;
			bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
			bucket.lastRefill = now;

			if (bucket.tokens < tokens) {
				const status: RateLimitStatus = {
					remaining: Math.floor(bucket.tokens),
					limit: bucket.maxTokens,
					resetAt: now + ((tokens - bucket.tokens) / bucket.refillRate) * 1000,
					isThrottled: true,
					retryAfter: ((tokens - bucket.tokens) / bucket.refillRate) * 1000
				};

				this._onRateLimitExceeded.fire({ service, action, status, timestamp: now });
				return status;
			}
		}

		return {
			remaining: window ? window.maxRequests - window.requests.length : 0,
			limit: window?.maxRequests ?? 0,
			resetAt: now + (config.windowMs ?? 60000),
			isThrottled: false
		};
	}

	public recordRequest(service: string, action: string, tokens: number = 1): void {
		const now = Date.now();
		const window = this.windows.get(service);
		const bucket = this.buckets.get(service);

		if (window) {
			window.requests.push(now);
		}

		if (bucket) {
			bucket.tokens = Math.max(0, bucket.tokens - tokens);
		}

		this.logService.debug(`[Council RateLimiter] ${service}/${action}: ${tokens} tokens`);
	}

	public getStatus(service: string): RateLimitStatus {
		const window = this.windows.get(service);
		const now = Date.now();

		if (!window) {
			return { remaining: 0, limit: 0, resetAt: now, isThrottled: false };
		}

		const validRequests = window.requests.filter(t => t > now - window.windowMs);

		return {
			remaining: window.maxRequests - validRequests.length,
			limit: window.maxRequests,
			resetAt: validRequests.length > 0 ? Math.min(...validRequests) + window.windowMs : now,
			isThrottled: validRequests.length >= window.maxRequests
		};
	}

	public reset(service: string): void {
		this.windows.delete(service);
		this.buckets.delete(service);
		const config = this.configs.get(service);
		if (config) {
			this.configure(service, config);
		}
	}

	public getAllStatus(): Map<string, RateLimitStatus> {
		const status = new Map<string, RateLimitStatus>();
		for (const service of this.configs.keys()) {
			status.set(service, this.getStatus(service));
		}
		return status;
	}
}
