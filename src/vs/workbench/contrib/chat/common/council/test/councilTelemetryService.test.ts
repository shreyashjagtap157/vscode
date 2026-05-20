/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilTelemetryService } from '../councilTelemetryService.js';

class MockTelemetryService {
	public events: Array<{ name: string; data: Record<string, unknown> }> = [];

	public publicLog2<T>(name: string, data: T): void {
		this.events.push({ name, data: data as Record<string, unknown> });
	}
}

suite('CouncilTelemetryService', () => {

	let mockTelemetry: MockTelemetryService;
	let telemetryService: CouncilTelemetryService;

	setup(() => {
		mockTelemetry = new MockTelemetryService();
		telemetryService = new CouncilTelemetryService(mockTelemetry as any);
	});

	test('should send session start event', () => {
		telemetryService.sendSessionStart('session-1', 3, 'evidence-weighted');

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.session.start');
		assert.strictEqual(mockTelemetry.events[0].data.sessionId, 'session-1');
		assert.strictEqual(mockTelemetry.events[0].data.agentCount, 3);
	});

	test('should send session complete event', () => {
		telemetryService.sendSessionComplete('session-1', 5000, 0.85, 3);

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.session.complete');
		assert.strictEqual(mockTelemetry.events[0].data.duration, 5000);
		assert.strictEqual(mockTelemetry.events[0].data.confidence, 0.85);
	});

	test('should send session failed event', () => {
		telemetryService.sendSessionFailed('session-1', 'Test error', 2000);

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.session.failed');
		assert.strictEqual(mockTelemetry.events[0].data.error, 'Test error');
	});

	test('should sanitize sensitive data in errors', () => {
		telemetryService.sendSessionFailed('session-1', 'Error with AKIA1234567890ABCDEF key', 1000);

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.ok(!(mockTelemetry.events[0].data as any).error.includes('AKIA1234567890ABCDEF'));
		assert.ok((mockTelemetry.events[0].data as any).error.includes('[REDACTED_AWS_KEY]'));
	});

	test('should send agent invoked event', () => {
		telemetryService.sendAgentInvoked('agent-1', 'architect', 'task-1');

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.agent.invoked');
	});

	test('should send consensus resolved event', () => {
		telemetryService.sendConsensusResolved('session-1', 'evidence-weighted', 0.9, 2);

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.consensus.resolved');
	});

	test('should send secret detected event', () => {
		telemetryService.sendSecretDetected('session-1', 'aws_key', 'critical');

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.security.secret.detected');
	});

	test('should send cost tracked event', () => {
		telemetryService.sendCostTracked('session-1', 'gpt-4', 1000, 0.05);

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.cost.tracked');
	});

	test('should send cache hit event', () => {
		telemetryService.sendCacheHit('test-key', 120);

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.cache.hit');
	});

	test('should send performance event', () => {
		telemetryService.sendPerformance('loadTime', 150, 'ms');

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.performance');
		assert.strictEqual(mockTelemetry.events[0].data.metric, 'loadTime');
		assert.strictEqual(mockTelemetry.events[0].data.value, 150);
	});

	test('should send UI action event', () => {
		telemetryService.sendUIAction('click', 'dashboard', 50);

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.ui.action');
		assert.strictEqual(mockTelemetry.events[0].data.action, 'click');
		assert.strictEqual(mockTelemetry.events[0].data.duration, 50);
	});

	test('should send error event', () => {
		telemetryService.sendError('testService', 'Test error', true);

		assert.strictEqual(mockTelemetry.events.length, 1);
		assert.strictEqual(mockTelemetry.events[0].name, 'council.error');
		assert.strictEqual(mockTelemetry.events[0].data.service, 'testService');
		assert.strictEqual(mockTelemetry.events[0].data.actionable, true);
	});
});
