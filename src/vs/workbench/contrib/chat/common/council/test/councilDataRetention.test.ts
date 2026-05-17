/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilDataRetention } from '../../councilDataRetention.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

suite('CouncilDataRetention', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should return default policy', () => {
		const retention = new CouncilDataRetention(
			{ get: () => undefined, store: () => { }, remove: () => { }, keys: () => [] } as any,
			{ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any
		);

		const policy = retention.getPolicy();
		assert.ok(policy.sessionsMaxAge > 0);
		assert.ok(policy.autoCleanup === true);
	});

	test('should update policy', () => {
		const retention = new CouncilDataRetention(
			{ get: () => undefined, store: () => { }, remove: () => { }, keys: () => [] } as any,
			{ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any
		);

		retention.setPolicy({ sessionsMaxAge: 1000 });

		const policy = retention.getPolicy();
		assert.strictEqual(policy.sessionsMaxAge, 1000);
	});

	test('should execute cleanup', async () => {
		const retention = new CouncilDataRetention(
			{ get: () => undefined, store: () => { }, remove: () => { }, keys: () => [] } as any,
			{ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any
		);

		const result = await retention.executeCleanup();
		assert.ok(result.executedAt > 0);
		assert.strictEqual(result.sessionsDeleted, 0);
	});

	test('should schedule and stop cleanup', () => {
		const retention = new CouncilDataRetention(
			{ get: () => undefined, store: () => { }, remove: () => { }, keys: () => [] } as any,
			{ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any
		);

		retention.scheduleCleanup();
		retention.stopCleanup();
	});

	test('should disable auto cleanup', () => {
		const retention = new CouncilDataRetention(
			{ get: () => undefined, store: () => { }, remove: () => { }, keys: () => [] } as any,
			{ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any
		);

		retention.setPolicy({ autoCleanup: false });

		const policy = retention.getPolicy();
		assert.strictEqual(policy.autoCleanup, false);
	});
});
