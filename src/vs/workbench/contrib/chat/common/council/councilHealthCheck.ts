/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICouncilCircuitBreaker } from './councilCircuitBreaker.js';
import { ICouncilSessionEviction } from './councilSessionEviction.js';
import { ICouncilModelCache } from './councilModelCache.js';
import { ICouncilConnectionPool } from './councilConnectionPool.js';
import { ICouncilTokenBudget } from './councilTokenBudget.js';
import { ICouncilRequestDedup } from './councilRequestDedup.js';

export const ICouncilHealthCheck = createDecorator<ICouncilHealthCheck>('councilHealthCheck');

export interface ServiceHealth {
	readonly name: string;
	readonly status: 'healthy' | 'degraded' | 'unhealthy';
	readonly latency?: number;
	readonly message?: string;
	readonly lastChecked: number;
}

export interface SystemHealth {
	readonly overall: 'healthy' | 'degraded' | 'unhealthy';
	readonly services: ServiceHealth[];
	readonly timestamp: number;
	readonly uptime: number;
	readonly memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
}

export interface ICouncilHealthCheck extends IDisposable {
	readonly _serviceBrand: undefined;

	checkHealth(): Promise<SystemHealth>;
	getServiceHealth(name: string): ServiceHealth;
	registerService(name: string, checkFn: () => Promise<ServiceHealth>): void;
	getUptime(): number;
}

export class CouncilHealthCheck extends Disposable implements ICouncilHealthCheck {
	declare readonly _serviceBrand: undefined;

	private readonly services: Map<string, () => Promise<ServiceHealth>>;
	private readonly serviceHealthCache: Map<string, ServiceHealth>;
	private readonly startTime: number;

	constructor(
		@ICouncilCircuitBreaker private readonly circuitBreaker: ICouncilCircuitBreaker,
		@ICouncilSessionEviction private readonly sessionEviction: ICouncilSessionEviction,
		@ICouncilModelCache private readonly modelCache: ICouncilModelCache,
		@ICouncilConnectionPool private readonly connectionPool: ICouncilConnectionPool,
		@ICouncilTokenBudget private readonly tokenBudget: ICouncilTokenBudget,
		@ICouncilRequestDedup private readonly requestDedup: ICouncilRequestDedup
	) {
		super();
		this.services = new Map();
		this.serviceHealthCache = new Map();
		this.startTime = Date.now();

		this.registerDefaultServices();
	}

	public registerService(name: string, checkFn: () => Promise<ServiceHealth>): void {
		this.services.set(name, checkFn);
	}

	public async checkHealth(): Promise<SystemHealth> {
		const serviceChecks: Promise<ServiceHealth>[] = [];

		for (const [name, checkFn] of this.services) {
			serviceChecks.push(
				checkFn().catch(error => ({
					name,
					status: 'unhealthy' as const,
					message: error.message,
					lastChecked: Date.now()
				}))
			);
		}

		const results = await Promise.all(serviceChecks);

		for (const result of results) {
			this.serviceHealthCache.set(result.name, result);
		}

		const overall = this.calculateOverallHealth(results);
		const memoryUsage = process.memoryUsage();

		return {
			overall,
			services: results,
			timestamp: Date.now(),
			uptime: Date.now() - this.startTime,
			memoryUsage: {
				rss: memoryUsage.rss,
				heapUsed: memoryUsage.heapUsed,
				heapTotal: memoryUsage.heapTotal
			}
		};
	}

	public getServiceHealth(name: string): ServiceHealth {
		return this.serviceHealthCache.get(name) ?? {
			name,
			status: 'unhealthy',
			message: 'Not checked yet',
			lastChecked: 0
		};
	}

	public getUptime(): number {
		return Date.now() - this.startTime;
	}

	private registerDefaultServices(): void {
		this.registerService('circuitBreaker', async () => {
			const stats = this.circuitBreaker.getAllStats();
			const openCircuits = Array.from(stats.values()).filter(s => s.state === 'open').length;

			return {
				name: 'circuitBreaker',
				status: openCircuits === 0 ? 'healthy' : openCircuits <= 2 ? 'degraded' : 'unhealthy',
				message: `${stats.size} services monitored, ${openCircuits} circuits open`,
				lastChecked: Date.now()
			};
		});

		this.registerService('sessionEviction', async () => {
			const stats = this.sessionEviction.getStats();
			return {
				name: 'sessionEviction',
				status: stats.totalSessions < 100 ? 'healthy' : stats.totalSessions < 150 ? 'degraded' : 'unhealthy',
				message: `${stats.totalSessions} sessions, ${stats.totalSizeBytes} bytes`,
				lastChecked: Date.now()
			};
		});

		this.registerService('modelCache', async () => {
			const stats = this.modelCache.getStats();
			return {
				name: 'modelCache',
				status: stats.totalModels > 0 ? 'healthy' : 'degraded',
				message: `${stats.totalModels} models cached, last refreshed ${stats.cacheAge}ms ago`,
				lastChecked: Date.now()
			};
		});

		this.registerService('connectionPool', async () => {
			const stats = this.connectionPool.getStats();
			return {
				name: 'connectionPool',
				status: stats.queuedRequests === 0 ? 'healthy' : stats.queuedRequests < 10 ? 'degraded' : 'unhealthy',
				message: `${stats.activeRequests} active, ${stats.queuedRequests} queued`,
				lastChecked: Date.now()
			};
		});

		this.registerService('tokenBudget', async () => {
			const status = this.tokenBudget.checkBudget();
			return {
				name: 'tokenBudget',
				status: status.isExceeded ? 'unhealthy' : status.sessionBudgetRemaining < 10000 ? 'degraded' : 'healthy',
				message: `Session: ${status.sessionBudgetRemaining} tokens remaining`,
				lastChecked: Date.now()
			};
		});

		this.registerService('requestDedup', async () => {
			const stats = this.requestDedup.getStats();
			return {
				name: 'requestDedup',
				status: stats.hitRate > 0.5 ? 'healthy' : stats.hitRate > 0.2 ? 'degraded' : 'unhealthy',
				message: `${stats.totalEntries} entries, ${Math.round(stats.hitRate * 100)}% hit rate`,
				lastChecked: Date.now()
			};
		});
	}

	private calculateOverallHealth(services: ServiceHealth[]): SystemHealth['overall'] {
		const unhealthy = services.filter(s => s.status === 'unhealthy').length;
		const degraded = services.filter(s => s.status === 'degraded').length;

		if (unhealthy > 2) return 'unhealthy';
		if (unhealthy > 0 || degraded > 2) return 'degraded';
		return 'healthy';
	}
}
