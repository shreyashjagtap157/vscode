/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICouncilResultCache } from './councilResultCache.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export const ICouncilDistributedCache = createDecorator<ICouncilDistributedCache>('councilDistributedCache');

export interface DistributedCacheConfig {
	readonly cacheDir: string;
	readonly maxFileSize: number;
	readonly maxTotalSize: number;
	readonly evictionPolicy: 'lru' | 'lfu' | 'fifo';
}

export interface ICouncilDistributedCache extends IDisposable {
	readonly _serviceBrand: undefined;

	configure(config: Partial<DistributedCacheConfig>): void;
	get<T>(key: string): Promise<T | undefined>;
	set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
	delete(key: string): Promise<void>;
	clear(): Promise<void>;
	getStats(): Promise<{ entries: number; totalSize: number; hitRate: number }>;
}

export class CouncilDistributedCache extends Disposable implements ICouncilDistributedCache {
	declare readonly _serviceBrand: undefined;

	private config: DistributedCacheConfig;
	private totalHits: number;
	private totalMisses: number;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@ICouncilResultCache private readonly resultCache: ICouncilResultCache
	) {
		super();
		this.config = {
			cacheDir: 'council-cache',
			maxFileSize: 10 * 1024 * 1024,
			maxTotalSize: 100 * 1024 * 1024,
			evictionPolicy: 'lru'
		};
		this.totalHits = 0;
		this.totalMisses = 0;
	}

	public configure(config: Partial<DistributedCacheConfig>): void {
		this.config = { ...this.config, ...config };
	}

	public async get<T>(key: string): Promise<T | undefined> {
		const memoryResult = this.resultCache.get(key);
		if (memoryResult !== undefined) {
			this.totalHits++;
			return memoryResult as T;
		}

		try {
			const uri = this.getFileUri(key);
			const exists = await this.fileService.exists(uri);

			if (exists) {
				const content = await this.fileService.readFile(uri);
				const entry = JSON.parse(content.value.toString()) as { value: T; expiresAt?: number };

				if (entry.expiresAt && Date.now() > entry.expiresAt) {
					await this.delete(key);
					this.totalMisses++;
					return undefined;
				}

				this.resultCache.set(key, JSON.stringify(entry.value));
				this.totalHits++;
				return entry.value;
			}
		} catch (error) {
			this.logService.debug(`[Council DistributedCache] File read failed: ${error}`);
		}

		this.totalMisses++;
		return undefined;
	}

	public async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
		this.resultCache.set(key, JSON.stringify(value));

		try {
			const uri = this.getFileUri(key);
			const entry = {
				key,
				value,
				createdAt: Date.now(),
				expiresAt: Date.now() + ttlSeconds * 1000,
				accessCount: 0
			};

			const content = VSBuffer.fromString(JSON.stringify(entry));
			await this.fileService.writeFile(uri, content);
		} catch (error) {
			this.logService.error(`[Council DistributedCache] File write failed: ${error}`);
		}
	}

	public async delete(key: string): Promise<void> {
		this.resultCache.delete(key);

		try {
			const uri = this.getFileUri(key);
			const exists = await this.fileService.exists(uri);
			if (exists) {
				await this.fileService.del(uri);
			}
		} catch (error) {
			this.logService.debug(`[Council DistributedCache] Delete failed: ${error}`);
		}
	}

	public async clear(): Promise<void> {
		this.resultCache.clear();
		this.totalHits = 0;
		this.totalMisses = 0;
	}

	public async getStats(): Promise<{ entries: number; totalSize: number; hitRate: number }> {
		const total = this.totalHits + this.totalMisses;
		return {
			entries: this.resultCache.getStats().size,
			totalSize: 0,
			hitRate: total > 0 ? this.totalHits / total : 0
		};
	}

	private getFileUri(key: string): URI {
		const sanitized = key.replace(/[^a-zA-Z0-9-_]/g, '_');
		return URI.file(`${this.config.cacheDir}/${sanitized}.json`);
	}
}
