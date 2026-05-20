/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICouncilResultCache } from './councilResultCache.js';

export const ICouncilRequestDedup = createDecorator<ICouncilRequestDedup>('councilRequestDedup');

export interface DedupEntry {
	readonly hash: string;
	readonly request: string;
	readonly result: unknown;
	readonly createdAt: number;
	accessCount: number;
}

export interface ICouncilRequestDedup extends IDisposable {
	readonly _serviceBrand: undefined;

	getOrExecute<T>(request: string, fn: () => Promise<T>, ttlMs?: number): Promise<T>;
	getCachedResult<T>(request: string): T | undefined;
	clear(): void;
	getStats(): { totalEntries: number; hitRate: number; totalHits: number; totalMisses: number };
}

export class CouncilRequestDedup extends Disposable implements ICouncilRequestDedup {
	declare readonly _serviceBrand: undefined;

	private readonly entries: Map<string, DedupEntry>;
	private totalHits: number;
	private totalMisses: number;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICouncilResultCache private readonly resultCache: ICouncilResultCache
	) {
		super();
		this.entries = new Map();
		this.totalHits = 0;
		this.totalMisses = 0;
	}

	public async getOrExecute<T>(request: string, fn: () => Promise<T>, ttlMs: number = 300000): Promise<T> {
		const hash = this.hashRequest(request);

		const existing = this.entries.get(hash);
		if (existing && Date.now() - existing.createdAt < ttlMs) {
			this.totalHits++;
			existing.accessCount++;
			this.logService.debug(`[Council Dedup] Cache hit for request hash: ${hash.substring(0, 8)}`);
			return existing.result as T;
		}

		this.totalMisses++;
		const result = await fn();

		this.entries.set(hash, {
			hash,
			request,
			result,
			createdAt: Date.now(),
			accessCount: 1
		});

		this.resultCache.set(hash, String(result), { ttl: ttlMs / 1000 });

		this.logService.debug(`[Council Dedup] Executed and cached request hash: ${hash.substring(0, 8)}`);

		return result;
	}

	public getCachedResult<T>(request: string): T | undefined {
		const hash = this.hashRequest(request);
		const entry = this.entries.get(hash);
		return entry ? entry.result as T : undefined;
	}

	public clear(): void {
		this.entries.clear();
		this.resultCache.clear();
		this.totalHits = 0;
		this.totalMisses = 0;
	}

	public getStats(): { totalEntries: number; hitRate: number; totalHits: number; totalMisses: number } {
		const total = this.totalHits + this.totalMisses;
		return {
			totalEntries: this.entries.size,
			hitRate: total > 0 ? this.totalHits / total : 0,
			totalHits: this.totalHits,
			totalMisses: this.totalMisses
		};
	}

	private hashRequest(request: string): string {
		let hash = 0;
		for (let i = 0; i < request.length; i++) {
			const char = request.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return Math.abs(hash).toString(16).padStart(8, '0');
	}
}
