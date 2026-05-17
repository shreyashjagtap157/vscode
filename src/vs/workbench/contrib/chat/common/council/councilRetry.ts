/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';

export const ICouncilRetry = createDecorator<ICouncilRetry>('councilRetry');

export interface RetryConfig {
	readonly maxAttempts: number;
	readonly initialDelayMs: number;
	readonly maxDelayMs: number;
	readonly backoffMultiplier: number;
	readonly jitterMs: number;
	readonly retryableErrors?: string[];
}

export interface RetryAttempt {
	readonly attempt: number;
	readonly delayMs: number;
	readonly error?: Error;
	readonly timestamp: number;
}

export interface RetryResult<T> {
	readonly success: boolean;
	readonly value?: T;
	readonly attempts: RetryAttempt[];
	readonly totalDelayMs: number;
	readonly totalTimeMs: number;
}

export interface ICouncilRetry extends IDisposable {
	readonly _serviceBrand: undefined;

	execute<T>(fn: () => Promise<T>, config?: Partial<RetryConfig>, token?: CancellationToken): Promise<RetryResult<T>>;
	executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number, config?: Partial<RetryConfig>, token?: CancellationToken): Promise<RetryResult<T>>;
	getDefaultConfig(): RetryConfig;
}

const DEFAULT_CONFIG: RetryConfig = {
	maxAttempts: 3,
	initialDelayMs: 1000,
	maxDelayMs: 30000,
	backoffMultiplier: 2,
	jitterMs: 500,
	retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'NETWORK_ERROR', 'RATE_LIMITED']
};

export class CouncilRetry extends Disposable implements ICouncilRetry {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public async execute<T>(
		fn: () => Promise<T>,
		config?: Partial<RetryConfig>,
		token: CancellationToken = CancellationToken.None
	): Promise<RetryResult<T>> {
		const cfg = { ...DEFAULT_CONFIG, ...config };
		const attempts: RetryAttempt[] = [];
		const startTime = Date.now();
		let totalDelay = 0;

		for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
			if (token.isCancellationRequested) {
				return {
					success: false,
					attempts,
					totalDelayMs: totalDelay,
					totalTimeMs: Date.now() - startTime
				};
			}

			try {
				const value = await fn();
				return {
					success: true,
					value,
					attempts,
					totalDelayMs: totalDelay,
					totalTimeMs: Date.now() - startTime
				};
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				const delay = this.calculateDelay(attempt, cfg);
				totalDelay += delay;

				attempts.push({
					attempt,
					delayMs: delay,
					error: err,
					timestamp: Date.now()
				});

				const isRetryable = this.isRetryableError(err, cfg);

				if (!isRetryable || attempt === cfg.maxAttempts) {
					this.logService.error(`[Council Retry] Failed after ${attempt} attempts: ${err.message}`);
					return {
						success: false,
						attempts,
						totalDelayMs: totalDelay,
						totalTimeMs: Date.now() - startTime
					};
				}

				this.logService.warn(`[Council Retry] Attempt ${attempt}/${cfg.maxAttempts} failed, retrying in ${delay}ms: ${err.message}`);

				await this.sleep(delay, token);
			}
		}

		return {
			success: false,
			attempts,
			totalDelayMs: totalDelay,
			totalTimeMs: Date.now() - startTime
		};
	}

	public async executeWithTimeout<T>(
		fn: () => Promise<T>,
		timeoutMs: number,
		config?: Partial<RetryConfig>,
		token: CancellationToken = CancellationToken.None
	): Promise<RetryResult<T>> {
		const startTime = Date.now();

		const timeoutToken = new CancellationTokenSource();
		const timeoutHandle = setTimeout(() => timeoutToken.cancel(), timeoutMs);

		const linkedToken = CancellationToken.any(token, timeoutToken.token);

		try {
			const result = await this.execute(fn, config, linkedToken);

			if (Date.now() - startTime > timeoutMs) {
				return {
					success: false,
					attempts: result.attempts,
					totalDelayMs: result.totalDelayMs,
					totalTimeMs: Date.now() - startTime
				};
			}

			return result;
		} finally {
			clearTimeout(timeoutHandle);
			timeoutToken.dispose();
		}
	}

	public getDefaultConfig(): RetryConfig {
		return { ...DEFAULT_CONFIG };
	}

	private calculateDelay(attempt: number, config: RetryConfig): number {
		const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
		const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
		const jitter = Math.random() * config.jitterMs;
		return Math.round(cappedDelay + jitter);
	}

	private isRetryableError(error: Error, config: RetryConfig): boolean {
		if (!config.retryableErrors || config.retryableErrors.length === 0) {
			return true;
		}

		const message = error.message.toUpperCase();
		const code = error.name.toUpperCase();

		return config.retryableErrors.some(retryable =>
			message.includes(retryable) || code.includes(retryable)
		);
	}

	private async sleep(ms: number, token: CancellationToken): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const handle = setTimeout(resolve, ms);

			const checkCancellation = () => {
				if (token.isCancellationRequested) {
					clearTimeout(handle);
					reject(new Error('Cancelled'));
				}
			};

			if (token.onCancellationRequested) {
				token.onCancellationRequested(checkCancellation);
			}
		});
	}
}
