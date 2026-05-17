/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';

export const ICouncilSearchFilter = createDecorator<ICouncilSearchFilter>('councilSearchFilter');

export interface SearchQuery {
	readonly text: string;
	readonly filters: SearchFilters;
	readonly sortBy: 'date' | 'confidence' | 'duration' | 'name';
	readonly sortOrder: 'asc' | 'desc';
	readonly limit: number;
	readonly offset: number;
}

export interface SearchFilters {
	readonly status?: string[];
	readonly agents?: string[];
	readonly dateRange?: { start: number; end: number };
	readonly confidenceRange?: { min: number; max: number };
	readonly tags?: string[];
}

export interface SearchResult<T> {
	readonly items: T[];
	readonly total: number;
	readonly hasMore: boolean;
	readonly query: SearchQuery;
}

export interface SearchableItem {
	readonly id: string;
	readonly searchableText: string;
	readonly tags: string[];
	readonly timestamp: number;
	readonly metadata: Record<string, unknown>;
}

export interface ICouncilSearchFilter extends IDisposable {
	readonly _serviceBrand: undefined;

	index(item: SearchableItem): void;
	remove(id: string): void;
	search<T extends SearchableItem>(query: SearchQuery): SearchResult<T>;
	getSuggestions(prefix: string, limit?: number): string[];
	getStats(): { totalIndexed: number; indexSize: number };
	clear(): void;
}

export class CouncilSearchFilter extends Disposable implements ICouncilSearchFilter {
	declare readonly _serviceBrand: undefined;

	private readonly index: Map<string, SearchableItem>;
	private readonly invertedIndex: Map<string, Set<string>>;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.index = new Map();
		this.invertedIndex = new Map();
	}

	public index(item: SearchableItem): void {
		this.index.set(item.id, item);

		const words = this.tokenize(item.searchableText);
		for (const word of words) {
			const existing = this.invertedIndex.get(word) ?? new Set();
			existing.add(item.id);
			this.invertedIndex.set(word, existing);
		}

		for (const tag of item.tags) {
			const existing = this.invertedIndex.get(`tag:${tag}`) ?? new Set();
			existing.add(item.id);
			this.invertedIndex.set(`tag:${tag}`, existing);
		}
	}

	public remove(id: string): void {
		const item = this.index.get(id);
		if (!item) return;

		this.index.delete(id);

		for (const [word, ids] of this.invertedIndex) {
			ids.delete(id);
			if (ids.size === 0) {
				this.invertedIndex.delete(word);
			}
		}
	}

	public search<T extends SearchableItem>(query: SearchQuery): SearchResult<T> {
		let candidateIds = new Set(this.index.keys());

		if (query.text) {
			const words = this.tokenize(query.text);
			const wordResults = words.map(w => this.invertedIndex.get(w) ?? new Set());
			candidateIds = wordResults.reduce((a, b) => new Set([...a].filter(x => b.has(x))));
		}

		if (query.filters.status) {
			candidateIds = this.filterByField(candidateIds, 'status', query.filters.status);
		}
		if (query.filters.agents) {
			candidateIds = this.filterByField(candidateIds, 'agent', query.filters.agents);
		}
		if (query.filters.dateRange) {
			candidateIds = this.filterByDate(candidateIds, query.filters.dateRange);
		}
		if (query.filters.confidenceRange) {
			candidateIds = this.filterByConfidence(candidateIds, query.filters.confidenceRange);
		}
		if (query.filters.tags) {
			for (const tag of query.filters.tags) {
				const tagIds = this.invertedIndex.get(`tag:${tag}`);
				if (tagIds) {
					candidateIds = new Set([...candidateIds].filter(id => tagIds.has(id)));
				} else {
					candidateIds.clear();
				}
			}
		}

		let items = Array.from(candidateIds)
			.map(id => this.index.get(id))
			.filter((item): item is T => item !== undefined);

		items = this.sortItems(items, query.sortBy, query.sortOrder);

		const total = items.length;
		items = items.slice(query.offset, query.offset + query.limit);

		return {
			items,
			total,
			hasMore: query.offset + query.limit < total,
			query
		};
	}

	public getSuggestions(prefix: string, limit: number = 10): string[] {
		const lowerPrefix = prefix.toLowerCase();
		const suggestions = new Set<string>();

		for (const word of this.invertedIndex.keys()) {
			if (word.toLowerCase().startsWith(lowerPrefix)) {
				suggestions.add(word);
				if (suggestions.size >= limit) break;
			}
		}

		return Array.from(suggestions);
	}

	public getStats(): { totalIndexed: number; indexSize: number } {
		return {
			totalIndexed: this.index.size,
			indexSize: this.invertedIndex.size
		};
	}

	public clear(): void {
		this.index.clear();
		this.invertedIndex.clear();
	}

	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^\w\s]/g, ' ')
			.split(/\s+/)
			.filter(w => w.length > 2);
	}

	private filterByField(ids: Set<string>, field: string, values: string[]): Set<string> {
		return new Set([...ids].filter(id => {
			const item = this.index.get(id);
			if (!item) return false;
			const fieldValue = String((item.metadata as any)[field] ?? '');
			return values.some(v => fieldValue.toLowerCase().includes(v.toLowerCase()));
		}));
	}

	private filterByDate(ids: Set<string>, range: { start: number; end: number }): Set<string> {
		return new Set([...ids].filter(id => {
			const item = this.index.get(id);
			return item && item.timestamp >= range.start && item.timestamp <= range.end;
		}));
	}

	private filterByConfidence(ids: Set<string>, range: { min: number; max: number }): Set<string> {
		return new Set([...ids].filter(id => {
			const item = this.index.get(id);
			if (!item) return false;
			const confidence = (item.metadata as any).confidence ?? 0;
			return confidence >= range.min && confidence <= range.max;
		}));
	}

	private sortItems(items: SearchableItem[], sortBy: SearchQuery['sortBy'], sortOrder: SearchQuery['sortOrder']): SearchableItem[] {
		const sorted = [...items].sort((a, b) => {
			switch (sortBy) {
				case 'date': return a.timestamp - b.timestamp;
				case 'confidence': return ((a.metadata as any).confidence ?? 0) - ((b.metadata as any).confidence ?? 0);
				case 'duration': return ((a.metadata as any).duration ?? 0) - ((b.metadata as any).duration ?? 0);
				case 'name': return a.searchableText.localeCompare(b.searchableText);
				default: return 0;
			}
		});

		return sortOrder === 'desc' ? sorted.reverse() : sorted;
	}
}
