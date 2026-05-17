/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilSearchFilter } from '../../councilSearchFilter.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

suite('CouncilSearchFilter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should index and search items', () => {
		const filter = new CouncilSearchFilter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		filter.index({
			id: '1',
			searchableText: 'fix bug in login page',
			tags: ['bug', 'frontend'],
			timestamp: Date.now(),
			metadata: { status: 'completed', confidence: 0.9 }
		});

		const result = filter.search({
			text: 'bug login',
			filters: {},
			sortBy: 'date',
			sortOrder: 'desc',
			limit: 10,
			offset: 0
		});

		assert.strictEqual(result.total, 1);
		assert.strictEqual(result.items.length, 1);
	});

	test('should filter by tags', () => {
		const filter = new CouncilSearchFilter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		filter.index({
			id: '1',
			searchableText: 'add feature',
			tags: ['feature'],
			timestamp: Date.now(),
			metadata: {}
		});

		filter.index({
			id: '2',
			searchableText: 'fix bug',
			tags: ['bug'],
			timestamp: Date.now(),
			metadata: {}
		});

		const result = filter.search({
			text: '',
			filters: { tags: ['bug'] },
			sortBy: 'date',
			sortOrder: 'desc',
			limit: 10,
			offset: 0
		});

		assert.strictEqual(result.total, 1);
		assert.strictEqual(result.items[0].id, '2');
	});

	test('should filter by date range', () => {
		const filter = new CouncilSearchFilter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);
		const now = Date.now();

		filter.index({
			id: '1',
			searchableText: 'old item',
			tags: [],
			timestamp: now - 100000,
			metadata: {}
		});

		filter.index({
			id: '2',
			searchableText: 'new item',
			tags: [],
			timestamp: now,
			metadata: {}
		});

		const result = filter.search({
			text: '',
			filters: { dateRange: { start: now - 50000, end: now + 50000 } },
			sortBy: 'date',
			sortOrder: 'desc',
			limit: 10,
			offset: 0
		});

		assert.strictEqual(result.total, 1);
		assert.strictEqual(result.items[0].id, '2');
	});

	test('should return suggestions', () => {
		const filter = new CouncilSearchFilter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		filter.index({
			id: '1',
			searchableText: 'authentication service',
			tags: ['auth'],
			timestamp: Date.now(),
			metadata: {}
		});

		const suggestions = filter.getSuggestions('auth', 5);
		assert.ok(suggestions.length > 0);
	});

	test('should remove items', () => {
		const filter = new CouncilSearchFilter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		filter.index({
			id: '1',
			searchableText: 'test item',
			tags: ['test'],
			timestamp: Date.now(),
			metadata: {}
		});

		filter.remove('1');

		const result = filter.search({
			text: 'test',
			filters: {},
			sortBy: 'date',
			sortOrder: 'desc',
			limit: 10,
			offset: 0
		});

		assert.strictEqual(result.total, 0);
	});

	test('should clear all', () => {
		const filter = new CouncilSearchFilter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		filter.index({
			id: '1',
			searchableText: 'item one',
			tags: [],
			timestamp: Date.now(),
			metadata: {}
		});

		filter.clear();

		const stats = filter.getStats();
		assert.strictEqual(stats.totalIndexed, 0);
		assert.strictEqual(stats.indexSize, 0);
	});

	test('should sort by confidence', () => {
		const filter = new CouncilSearchFilter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		filter.index({
			id: '1',
			searchableText: 'low confidence',
			tags: [],
			timestamp: Date.now(),
			metadata: { confidence: 0.3 }
		});

		filter.index({
			id: '2',
			searchableText: 'high confidence',
			tags: [],
			timestamp: Date.now(),
			metadata: { confidence: 0.9 }
		});

		const result = filter.search({
			text: '',
			filters: {},
			sortBy: 'confidence',
			sortOrder: 'desc',
			limit: 10,
			offset: 0
		});

		assert.strictEqual(result.items[0].id, '2');
	});
});
