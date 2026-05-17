/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

export const ICouncilResultCache = createDecorator<ICouncilResultCache>('councilResultCache');

export interface CacheEntry {
	readonly key: string;
	readonly result: string;
	readonly metadata: Record<string, unknown>;
	readonly createdAt: number;
	readonly lastAccessed: number;
	readonly accessCount: number;
	readonly ttl: number;
}

export interface CacheStats {
	readonly size: number;
	readonly hits: number;
	readonly misses: number;
	readonly hitRate: number;
	readonly totalSizeBytes: number;
	readonly oldestEntry: number;
	readonly newestEntry: number;
}

export interface ICouncilResultCache extends IDisposable {
	readonly _serviceBrand: undefined;

	get(key: string): CacheEntry | undefined;
	set(key: string, result: string, metadata?: Record<string, unknown>, ttl?: number): void;
	has(key: string): boolean;
	delete(key: string): boolean;
	clear(): void;
	getStats(): CacheStats;
	evictExpired(): number;
	evictLeastUsed(count: number): number;
}

const DEFAULT_TTL = 24 * 60 * 60 * 1000;
const MAX_CACHE_SIZE = 1000;
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

export class CouncilResultCache extends Disposable implements ICouncilResultCache {
	declare readonly _serviceBrand: undefined;

	private readonly entries: Map<string, CacheEntry>;
	private hits = 0;
	private misses = 0;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.entries = new Map();
	}

	public get(key: string): CacheEntry | undefined {
		const entry = this.entries.get(key);

		if (!entry) {
			this.misses++;
			return undefined;
		}

		if (this.isExpired(entry)) {
			this.entries.delete(key);
			this.misses++;
			return undefined;
		}

		entry.lastAccessed = Date.now();
		entry.accessCount++;
		this.hits++;

		return entry;
	}

	public set(key: string, result: string, metadata: Record<string, unknown> = {}, ttl: number = DEFAULT_TTL): void {
		if (this.entries.size >= MAX_CACHE_SIZE) {
			this.evictLeastUsed(10);
		}

		const entry: CacheEntry = {
			key,
			result,
			metadata,
			createdAt: Date.now(),
			lastAccessed: Date.now(),
			accessCount: 0,
			ttl
		};

		this.entries.set(key, entry);
		this.logService.debug(`[Council Cache] Stored entry: ${key.substring(0, 50)}...`);
	}

	public has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	public delete(key: string): boolean {
		return this.entries.delete(key);
	}

	public clear(): void {
		this.entries.clear();
		this.hits = 0;
		this.misses = 0;
		this.logService.info('[Council Cache] Cleared');
	}

	public getStats(): CacheStats {
		const total = this.hits + this.misses;
		const sizes = Array.from(this.entries.values()).map(e => this.estimateSize(e));
		const timestamps = Array.from(this.entries.values()).map(e => e.createdAt);

		return {
			size: this.entries.size,
			hits: this.hits,
			misses: this.misses,
			hitRate: total > 0 ? this.hits / total : 0,
			totalSizeBytes: sizes.reduce((a, b) => a + b, 0),
			oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : 0,
			newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : 0
		};
	}

	public evictExpired(): number {
		let evicted = 0;
		for (const [key, entry] of this.entries) {
			if (this.isExpired(entry)) {
				this.entries.delete(key);
				evicted++;
			}
		}
		if (evicted > 0) {
			this.logService.info(`[Council Cache] Evicted ${evicted} expired entries`);
		}
		return evicted;
	}

	public evictLeastUsed(count: number): number {
		const sorted = Array.from(this.entries.entries())
			.sort((a, b) => a[1].accessCount - b[1].accessCount || a[1].lastAccessed - b[1].lastAccessed);

		let evicted = 0;
		for (let i = 0; i < Math.min(count, sorted.length); i++) {
			this.entries.delete(sorted[i][0]);
			evicted++;
		}

		return evicted;
	}

	public static generateKey(roleId: string, taskDescription: string, context?: string): string {
		const content = `${roleId}:${taskDescription}:${context ?? ''}`;
		return generateUuid();
	}

	private isExpired(entry: CacheEntry): boolean {
		return Date.now() - entry.createdAt > entry.ttl;
	}

	private estimateSize(entry: CacheEntry): number {
		return entry.key.length + entry.result.length + JSON.stringify(entry.metadata).length;
	}
}
