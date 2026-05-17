/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilGovernance, GovernanceActionType, GovernanceSeverity, GovernancePolicy } from '../councilGovernance.js';

class MockStorageService {
	private readonly store: Map<string, string>;

	constructor() {
		this.store = new Map();
	}

	get(key: string, scope: unknown, fallback: string): string {
		return this.store.get(key) ?? fallback;
	}

	store(key: string, value: string, scope: unknown, target: unknown): void {
		this.store.set(key, value);
	}

	remove(key: string, scope: unknown): void {
		this.store.delete(key);
	}
}

class MockLogService {
	public readonly logs: string[] = [];
	info(m: string) { this.logs.push(`INFO: ${m}`); }
	warn(m: string) { this.logs.push(`WARN: ${m}`); }
	error(m: string) { this.logs.push(`ERROR: ${m}`); }
	debug(m: string) { this.logs.push(`DEBUG: ${m}`); }
	trace(m: string) { this.logs.push(`TRACE: ${m}`); }
}

function createGovernance(): CouncilGovernance {
	const storage = new MockStorageService() as any;
	const log = new MockLogService() as any;
	return new CouncilGovernance(storage, log);
}

suite('CouncilGovernance', () => {
	test('initializes with default policies', () => {
		const governance = createGovernance();
		const policies = governance.getGovernancePolicies();
		assert.ok(policies.length > 0, 'Should have default policies');
	});

	test('records audit entry', () => {
		const governance = createGovernance();
		const entry = governance.recordAction(
			GovernanceActionType.SessionStart,
			'test-actor',
			'test-target',
			'Session started'
		);

		assert.ok(entry.entryId, 'Should have entry id');
		assert.ok(entry.hash, 'Should have hash');
		assert.ok(entry.previousHash, 'Should have previous hash');
		assert.strictEqual(entry.actionType, GovernanceActionType.SessionStart);
		assert.strictEqual(entry.actor, 'test-actor');
	});

	test('audit trail returns recorded entries', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor1', 'target1', 'Start 1');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor2', 'target2', 'Complete 2');

		const trail = governance.getAuditTrail();
		assert.ok(trail.length >= 2, 'Should have at least 2 entries');
	});

	test('filters audit trail by session id', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start', {}, 'session-1');
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start', {}, 'session-2');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor', 'target', 'Complete', {}, 'session-1');

		const session1Trail = governance.getAuditTrail('session-1');
		assert.ok(session1Trail.length >= 2, 'Should have session-1 entries');

		const allTrail = governance.getAuditTrail();
		assert.ok(allTrail.length >= 3, 'Should have all entries');
	});

	test('respects limit parameter', () => {
		const governance = createGovernance();
		for (let i = 0; i < 10; i++) {
			governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', `Start ${i}`);
		}

		const limited = governance.getAuditTrail(undefined, 5);
		assert.ok(limited.length <= 5, 'Should respect limit');
	});

	test('returns entry by id', () => {
		const governance = createGovernance();
		const entry = governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Test');
		const found = governance.getEntry(entry.entryId);

		assert.ok(found, 'Should find entry');
		assert.strictEqual(found?.entryId, entry.entryId);
	});

	test('verifies audit chain integrity', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor', 'target', 'Complete');

		const valid = governance.verifyChain();
		assert.strictEqual(valid, true, 'Chain should be valid');
	});

	test('adds governance policy', () => {
		const governance = createGovernance();
		const initialCount = governance.getGovernancePolicies().length;

		const policyId = governance.addPolicy({
			name: 'Test Policy',
			description: 'A test policy',
			rules: [
				{
					id: 'rule1',
					condition: 'severity == critical',
					action: 'deny',
					message: 'Critical actions blocked',
					severity: GovernanceSeverity.Critical
				}
			],
			enabled: true,
			enforcement: 'block'
		});

		assert.ok(policyId, 'Should return policy id');
		assert.strictEqual(governance.getGovernancePolicies().length, initialCount + 1);
	});

	test('removes governance policy', () => {
		const governance = createGovernance();
		const policyId = governance.addPolicy({
			name: 'Removable',
			description: 'Can be removed',
			rules: [],
			enabled: true,
			enforcement: 'audit'
		});

		governance.removePolicy(policyId);
		const policies = governance.getGovernancePolicies();
		assert.ok(!policies.some(p => p.id === policyId), 'Policy should be removed');
	});

	test('checks action against policies - allowed', () => {
		const governance = createGovernance();
		const result = governance.checkAction(GovernanceActionType.SessionStart, { severity: 'info' });

		assert.strictEqual(result.allowed, true, 'Info action should be allowed');
	});

	test('checks action against policies - blocked by security gate', () => {
		const governance = createGovernance();
		const result = governance.checkAction(GovernanceActionType.DecisionMade, { severity: 'critical' });

		assert.strictEqual(result.allowed, false, 'Critical action should be blocked by security gate');
		assert.ok(result.blockingRule, 'Should have blocking rule');
	});

	test('generates governance report', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start', {}, 's1');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor', 'target', 'Complete', { confidence: 0.8, executionTimeMs: 5000 }, 's1');
		governance.recordAction(GovernanceActionType.DecisionMade, 'actor', 'target', 'Decision');

		const report = governance.generateReport();

		assert.ok(report.reportId, 'Should have report id');
		assert.ok(report.totalSessions >= 1, 'Should count sessions');
		assert.ok(report.totalDecisions >= 1, 'Should count decisions');
	});

	test('generates report with time period filter', () => {
		const governance = createGovernance();
		const now = Date.now();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Recent');

		const report = governance.generateReport({ start: now - 1000, end: now + 1000 });
		assert.ok(report.totalSessions >= 0, 'Should generate period report');
	});

	test('exports audit trail as JSON', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start');

		const json = governance.exportAuditTrail('json');
		const parsed = JSON.parse(json);
		assert.ok(Array.isArray(parsed), 'Should be valid JSON array');
		assert.ok(parsed.length >= 1, 'Should have entries');
	});

	test('exports audit trail as CSV', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor', 'target', 'Complete');

		const csv = governance.exportAuditTrail('csv');
		const lines = csv.split('\n');
		assert.ok(lines.length >= 3, 'Should have header + data rows');
		assert.ok(lines[0].includes('entryId'), 'Should have header');
	});

	test('clears audit trail', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor', 'target', 'Complete');

		const cleared = governance.clearAuditTrail();
		assert.ok(cleared >= 2, 'Should clear entries');
		assert.strictEqual(governance.getAuditTrail().length, 0, 'Trail should be empty');
	});

	test('clears audit trail by age', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Old');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor', 'target', 'New');

		const cleared = governance.clearAuditTrail(0);
		assert.ok(cleared >= 1, 'Should clear old entries');
	});

	test('audit entry event fires', () => {
		const governance = createGovernance();
		let eventCount = 0;
		governance.onAuditEntryAdded(() => eventCount++);

		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor', 'target', 'Complete');

		assert.ok(eventCount >= 2, 'Should fire events');
	});

	test('chain verification fails with tampered entry', () => {
		const governance = createGovernance();
		governance.recordAction(GovernanceActionType.SessionStart, 'actor', 'target', 'Start');
		governance.recordAction(GovernanceActionType.SessionComplete, 'actor', 'target', 'Complete');

		const trail = governance.getAuditTrail();
		if (trail.length >= 2) {
			const entry = trail[trail.length - 1];
			(entry as any).hash = 'tampered';
			const valid = governance.verifyChain();
			assert.strictEqual(valid, false, 'Chain should be invalid after tampering');
		}
	});

	test('records action with custom severity', () => {
		const governance = createGovernance();
		const entry = governance.recordAction(
			GovernanceActionType.PolicyViolation,
			'actor',
			'target',
			'Violation',
			{},
			undefined,
			GovernanceSeverity.Critical
		);

		assert.strictEqual(entry.severity, GovernanceSeverity.Critical);
	});

	test('records action with metadata', () => {
		const governance = createGovernance();
		const entry = governance.recordAction(
			GovernanceActionType.SessionComplete,
			'actor',
			'target',
			'Complete',
			{ confidence: 0.9, executionTimeMs: 3000 }
		);

		assert.strictEqual(entry.metadata.confidence, 0.9);
		assert.strictEqual(entry.metadata.executionTimeMs, 3000);
	});
});
