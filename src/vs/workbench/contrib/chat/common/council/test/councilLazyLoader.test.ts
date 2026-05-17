/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilLazyLoader } from '../../councilLazyLoader.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

suite('CouncilLazyLoader', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should register and track services', () => {
		const loader = new CouncilLazyLoader({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		const unloaded = loader.getUnloadedServices();
		assert.ok(unloaded.length > 0);
	});

	test('should load service', async () => {
		const loader = new CouncilLazyLoader({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		let loaded = false;
		loader.registerLoader('smartSelector', async () => {
			loaded = true;
		});

		await loader.loadService('smartSelector');
		assert.strictEqual(loaded, true);
		assert.strictEqual(loader.isLoaded('smartSelector'), true);
	});

	test('should not reload already loaded service', async () => {
		const loader = new CouncilLazyLoader({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		let loadCount = 0;
		loader.registerLoader('modelRouter', async () => {
			loadCount++;
		});

		await loader.loadService('modelRouter');
		await loader.loadService('modelRouter');

		assert.strictEqual(loadCount, 1);
	});

	test('should load dependencies first', async () => {
		const loader = new CouncilLazyLoader({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		const loadOrder: string[] = [];
		loader.registerLoader('dep', async () => { loadOrder.push('dep'); });
		loader.registerLoader('main', async () => { loadOrder.push('main'); });
		loader.register({ name: 'main', priority: 'immediate', dependencies: ['dep'] });

		await loader.loadService('main');

		assert.deepStrictEqual(loadOrder, ['dep', 'main']);
	});

	test('should load all by priority', async () => {
		const loader = new CouncilLazyLoader({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		let immediateLoaded = false;
		loader.registerLoader('smartSelector', async () => { immediateLoaded = true; });

		await loader.loadAll('immediate');

		assert.strictEqual(immediateLoaded, true);
		assert.strictEqual(loader.isLoaded('smartSelector'), true);
	});

	test('should track metrics', async () => {
		const loader = new CouncilLazyLoader({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);

		loader.registerLoader('secretDetector', async () => { });

		await loader.loadService('secretDetector');

		const metrics = loader.getMetrics();
		const metric = metrics.get('secretDetector');
		assert.ok(metric !== undefined);
		assert.ok(metric!.loadTimeMs >= 0);
		assert.ok(metric!.loadedAt > 0);
	});
});
