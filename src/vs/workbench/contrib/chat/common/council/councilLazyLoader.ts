/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ICouncilTelemetryService } from './councilTelemetryService.js';

export const ICouncilLazyLoader = createDecorator<ICouncilLazyLoader>('councilLazyLoader');

export type ServiceName =
	| 'smartSelector'
	| 'modelRouter'
	| 'secretDetector'
	| 'inputSanitizer'
	| 'notificationService'
	| 'costTracker'
	| 'resultCache'
	| 'incrementalReview'
	| 'streamingUI'
	| 'fixApplier'
	| 'interactiveDebate'
	| 'sessionReplay'
	| 'diffView'
	| 'learningEngine'
	| 'autoPR'
	| 'policyEngine'
	| 'prReviewBoard'
	| 'governance'
	| 'enterprise'
	| 'agentBuilder';

export interface ServiceLoaderConfig {
	readonly name: ServiceName;
	readonly priority: 'immediate' | 'on-demand' | 'background';
	readonly dependencies?: ServiceName[];
	readonly loadTimeout?: number;
}

export interface LoadMetrics {
	readonly name: ServiceName;
	readonly loadTimeMs: number;
	readonly loadedAt: number;
	readonly wasUsed: boolean;
	readonly useCount: number;
}

export interface ICouncilLazyLoader extends IDisposable {
	readonly _serviceBrand: undefined;

	register(config: ServiceLoaderConfig): void;
	isLoaded(name: ServiceName): boolean;
	isLoading(name: ServiceName): boolean;
	loadService(name: ServiceName): Promise<void>;
	loadAll(priority?: 'immediate' | 'on-demand' | 'background'): Promise<void>;
	getMetrics(): Map<ServiceName, LoadMetrics>;
	getUnloadedServices(): ServiceName[];
	recordUsage(name: ServiceName): void;
}

const DEFAULT_CONFIGS: ServiceLoaderConfig[] = [
	{ name: 'smartSelector', priority: 'immediate' },
	{ name: 'modelRouter', priority: 'immediate' },
	{ name: 'secretDetector', priority: 'immediate' },
	{ name: 'inputSanitizer', priority: 'immediate' },
	{ name: 'resultCache', priority: 'immediate' },
	{ name: 'notificationService', priority: 'on-demand' },
	{ name: 'costTracker', priority: 'on-demand' },
	{ name: 'incrementalReview', priority: 'on-demand' },
	{ name: 'streamingUI', priority: 'on-demand' },
	{ name: 'fixApplier', priority: 'on-demand' },
	{ name: 'interactiveDebate', priority: 'background' },
	{ name: 'sessionReplay', priority: 'background' },
	{ name: 'diffView', priority: 'background' },
	{ name: 'learningEngine', priority: 'background' },
	{ name: 'autoPR', priority: 'background' },
	{ name: 'policyEngine', priority: 'on-demand' },
	{ name: 'prReviewBoard', priority: 'on-demand' },
	{ name: 'governance', priority: 'on-demand' },
	{ name: 'enterprise', priority: 'background' },
	{ name: 'agentBuilder', priority: 'background' }
];

export class CouncilLazyLoader extends Disposable implements ICouncilLazyLoader {
	declare readonly _serviceBrand: undefined;

	private readonly configs: Map<ServiceName, ServiceLoaderConfig>;
	private readonly loaded: Set<ServiceName>;
	private readonly loading: Set<ServiceName>;
	private readonly metrics: Map<ServiceName, LoadMetrics>;
	private readonly loaders: Map<ServiceName, () => Promise<void>>;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICouncilTelemetryService private readonly telemetryService: ICouncilTelemetryService
	) {
		super();
		this.configs = new Map();
		this.loaded = new Set();
		this.loading = new Set();
		this.metrics = new Map();
		this.loaders = new Map();

		for (const config of DEFAULT_CONFIGS) {
			this.register(config);
		}
	}

	public register(config: ServiceLoaderConfig): void {
		this.configs.set(config.name, config);
	}

	public isLoaded(name: ServiceName): boolean {
		return this.loaded.has(name);
	}

	public isLoading(name: ServiceName): boolean {
		return this.loading.has(name);
	}

	public recordUsage(name: ServiceName): void {
		const metric = this.metrics.get(name);
		if (metric) {
			this.metrics.set(name, {
				...metric,
				wasUsed: true,
				useCount: metric.useCount + 1
			});
		}
	}

	public async loadService(name: ServiceName): Promise<void> {
		if (this.loaded.has(name)) {
			this.recordUsage(name);
			return;
		}
		if (this.loading.has(name)) return;

		const config = this.configs.get(name);
		if (!config) {
			this.logService.warn(`[Council LazyLoader] Unknown service: ${name}`);
			return;
		}

		if (config.dependencies) {
			for (const dep of config.dependencies) {
				await this.loadService(dep);
			}
		}

		this.loading.add(name);
		const startTime = Date.now();
		const timeout = config.loadTimeout ?? 30000;

		try {
			const loader = this.loaders.get(name);
			if (loader) {
				await Promise.race([
					loader(),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error(`Loading timeout for ${name}`)), timeout)
					)
				]);
			}

			this.loaded.add(name);
			this.loading.delete(name);

			const loadTime = Date.now() - startTime;
			this.metrics.set(name, {
				name,
				loadTimeMs: loadTime,
				loadedAt: Date.now(),
				wasUsed: false,
				useCount: 0
			});

			this.telemetryService.sendPerformance(`lazyLoader.${name}`, loadTime, 'ms');
			this.logService.debug(`[Council LazyLoader] Loaded ${name} in ${loadTime}ms`);
		} catch (error) {
			this.loading.delete(name);
			this.logService.error(`[Council LazyLoader] Failed to load ${name}: ${error}`);
			throw error;
		}
	}

	public async loadAll(priority?: 'immediate' | 'on-demand' | 'background'): Promise<void> {
		const services = Array.from(this.configs.values())
			.filter(c => !priority || c.priority === priority)
			.sort((a, b) => {
				const order = { immediate: 0, 'on-demand': 1, background: 2 };
				return order[a.priority] - order[b.priority];
			});

		for (const config of services) {
			await this.loadService(config.name);
		}
	}

	public getMetrics(): Map<ServiceName, LoadMetrics> {
		return new Map(this.metrics);
	}

	public getUnloadedServices(): ServiceName[] {
		return Array.from(this.configs.keys()).filter(name => !this.loaded.has(name));
	}

	public registerLoader(name: ServiceName, loader: () => Promise<void>): void {
		this.loaders.set(name, loader);
	}
}
