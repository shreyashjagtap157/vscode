/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilRateLimiter } from '../councilRateLimiter.js';

suite('CouncilRateLimiter', () => {

	test('should allow requests within limit', async () => {
		const rateLimiter = new CouncilRateLimiter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);
		rateLimiter.configure('test', { maxRequests: 10, windowMs: 60000 });

		const status = await rateLimiter.checkLimit('test', 'action');
		assert.strictEqual(status.isThrottled, false);
		assert.strictEqual(status.remaining, 10);
	});

	test('should throttle when limit exceeded', async () => {
		const rateLimiter = new CouncilRateLimiter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);
		rateLimiter.configure('test', { maxRequests: 2, windowMs: 60000 });

		rateLimiter.recordRequest('test', 'action');
		rateLimiter.recordRequest('test', 'action');

		const status = await rateLimiter.checkLimit('test', 'action');
		assert.strictEqual(status.isThrottled, true);
		assert.strictEqual(status.remaining, 0);
	});

	test('should track token bucket', async () => {
		const rateLimiter = new CouncilRateLimiter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);
		rateLimiter.configure('test', { maxRequests: 100, windowMs: 60000, maxTokensPerMinute: 10 });

		rateLimiter.recordRequest('test', 'action', 5);
		rateLimiter.recordRequest('test', 'action', 5);

		const status = await rateLimiter.checkLimit('test', 'action', 1);
		assert.strictEqual(status.isThrottled, true);
	});

	test('should return correct status', () => {
		const rateLimiter = new CouncilRateLimiter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);
		rateLimiter.configure('test', { maxRequests: 5, windowMs: 60000 });

		const status = rateLimiter.getStatus('test');
		assert.strictEqual(status.limit, 5);
		assert.strictEqual(status.remaining, 5);
		assert.strictEqual(status.isThrottled, false);
	});

	test('should reset service', () => {
		const rateLimiter = new CouncilRateLimiter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);
		rateLimiter.configure('test', { maxRequests: 2, windowMs: 60000 });

		rateLimiter.recordRequest('test', 'action');
		rateLimiter.recordRequest('test', 'action');

		rateLimiter.reset('test');

		const status = rateLimiter.getStatus('test');
		assert.strictEqual(status.remaining, 2);
		assert.strictEqual(status.isThrottled, false);
	});

	test('should return all status', () => {
		const rateLimiter = new CouncilRateLimiter({ debug: () => { }, warn: () => { }, error: () => { }, info: () => { } } as any);
		rateLimiter.configure('service1', { maxRequests: 10, windowMs: 60000 });
		rateLimiter.configure('service2', { maxRequests: 20, windowMs: 60000 });

		const allStatus = rateLimiter.getAllStatus();
		assert.strictEqual(allStatus.size, 3); // service1, service2, default
	});
});
