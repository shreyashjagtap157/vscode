/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ILanguageModelsService } from '../languageModels.js';

export const ICouncilModelCache = createDecorator<ICouncilModelCache>('councilModelCache');

export interface ModelInfo {
	readonly id: string;
	readonly name: string;
	readonly vendor: string;
	readonly maxTokens: number;
	readonly costPerToken: number;
	readonly capabilities: string[];
	readonly lastRefreshed: number;
}

export interface ICouncilModelCache extends IDisposable {
	readonly _serviceBrand: undefined;

	refreshModels(): Promise<void>;
	getAvailableModels(): ModelInfo[];
	getModelById(id: string): ModelInfo | undefined;
	getBestModelForTask(taskType: string): ModelInfo | undefined;
	getCheapestModel(): ModelInfo | undefined;
	getFastestModel(): ModelInfo | undefined;
	getStats(): { totalModels: number; lastRefreshed: number; cacheAge: number };
}

export class CouncilModelCache extends Disposable implements ICouncilModelCache {
	declare readonly _serviceBrand: undefined;

	private readonly models: Map<string, ModelInfo>;
	private lastRefreshed: number;
	private readonly refreshIntervalMs: number;

	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.models = new Map();
		this.lastRefreshed = 0;
		this.refreshIntervalMs = 5 * 60 * 1000;
	}

	public async refreshModels(): Promise<void> {
		try {
			const modelIds = await this.languageModelsService.getLanguageModelIds();
			this.models.clear();

			for (const id of modelIds) {
				this.models.set(id, {
					id,
					name: id,
					vendor: 'unknown',
					maxTokens: 128000,
					costPerToken: 0.00001,
					capabilities: ['text'],
					lastRefreshed: Date.now()
				});
			}

			this.lastRefreshed = Date.now();
			this.logService.info(`[Council ModelCache] Refreshed ${modelIds.length} models`);
		} catch (error) {
			this.logService.error(`[Council ModelCache] Failed to refresh: ${error}`);
		}
	}

	public getAvailableModels(): ModelInfo[] {
		if (Date.now() - this.lastRefreshed > this.refreshIntervalMs) {
			this.refreshModels();
		}
		return Array.from(this.models.values());
	}

	public getModelById(id: string): ModelInfo | undefined {
		return this.models.get(id);
	}

	public getBestModelForTask(taskType: string): ModelInfo | undefined {
		const models = this.getAvailableModels();
		if (models.length === 0) return undefined;

		switch (taskType.toLowerCase()) {
			case 'complex-reasoning':
			case 'architecture':
				return models.find(m => m.maxTokens > 100000) ?? models[0];
			case 'code-generation':
				return models.find(m => m.capabilities.includes('code')) ?? models[0];
			case 'quick-answer':
				return models.find(m => m.costPerToken < 0.00001) ?? models[0];
			default:
				return models[0];
		}
	}

	public getCheapestModel(): ModelInfo | undefined {
		const models = this.getAvailableModels();
		if (models.length === 0) return undefined;
		return models.reduce((cheapest, model) =>
			model.costPerToken < cheapest.costPerToken ? model : cheapest
		);
	}

	public getFastestModel(): ModelInfo | undefined {
		const models = this.getAvailableModels();
		return models.length > 0 ? models[0] : undefined;
	}

	public getStats(): { totalModels: number; lastRefreshed: number; cacheAge: number } {
		return {
			totalModels: this.models.size,
			lastRefreshed: this.lastRefreshed,
			cacheAge: Date.now() - this.lastRefreshed
		};
	}
}
