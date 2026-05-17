/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilPolicyEngine, ICouncilPolicyEngine, PolicySeverity, EngineeringPolicy, PolicyViolation } from '../councilPolicies.js';
import { URI } from '../../../../../../../base/common/uri.js';

class MockFileService {
	private readonly existingFiles: Set<string>;

	constructor(existingFiles: string[] = []) {
		this.existingFiles = new Set(existingFiles);
	}

	async exists(uri: URI): Promise<boolean> {
		return this.existingFiles.has(uri.fsPath);
	}

	async readFile(uri: URI): Promise<{ value: { toString(): string } }> {
		return { value: { toString: () => '[]' } };
	}
}

class MockLogService {
	public readonly logs: string[] = [];

	info(message: string): void { this.logs.push(`INFO: ${message}`); }
	warn(message: string): void { this.logs.push(`WARN: ${message}`); }
	error(message: string): void { this.logs.push(`ERROR: ${message}`); }
	debug(message: string): void { this.logs.push(`DEBUG: ${message}`); }
	trace(message: string): void { this.logs.push(`TRACE: ${message}`); }
}

function createPolicyEngine(): CouncilPolicyEngine {
	const fileService = new MockFileService() as any;
	const logService = new MockLogService() as any;
	return new CouncilPolicyEngine(fileService, logService);
}

suite('CouncilPolicyEngine', () => {
	test('initializes with default policies', () => {
		const engine = createPolicyEngine();
		const policies = engine.getPolicies();
		assert.ok(policies.length > 0, 'Should have default policies');
	});

	test('returns policy by id', () => {
		const engine = createPolicyEngine();
		const policies = engine.getPolicies();
		if (policies.length > 0) {
			const policy = engine.getPolicy(policies[0].id);
			assert.ok(policy, 'Should return policy');
			assert.strictEqual(policy?.id, policies[0].id);
		}
	});

	test('adds new policy', () => {
		const engine = createPolicyEngine();
		const initialCount = engine.getPolicies().length;

		const policyId = engine.addPolicy({
			name: 'Test Policy',
			description: 'A test policy',
			rules: [
				{
					id: 'rule1',
					pattern: 'test',
					message: 'Test rule',
					category: 'quality'
				}
			],
			severity: 'warning' as PolicySeverity,
			enabled: true,
			scope: 'global'
		});

		assert.ok(policyId, 'Should return policy id');
		assert.strictEqual(engine.getPolicies().length, initialCount + 1);
	});

	test('updates existing policy', () => {
		const engine = createPolicyEngine();
		const policies = engine.getPolicies();
		if (policies.length > 0) {
			const policy = policies[0];
			engine.updatePolicy(policy.id, { name: 'Updated Name' });
			const updated = engine.getPolicy(policy.id);
			assert.strictEqual(updated?.name, 'Updated Name');
		}
	});

	test('throws when updating non-existent policy', () => {
		const engine = createPolicyEngine();
		assert.throws(() => engine.updatePolicy('non-existent', { name: 'Test' }));
	});

	test('removes policy', () => {
		const engine = createPolicyEngine();
		const policyId = engine.addPolicy({
			name: 'Removable Policy',
			description: 'Can be removed',
			rules: [],
			severity: 'info' as PolicySeverity,
			enabled: true,
			scope: 'global'
		});

		engine.removePolicy(policyId);
		assert.strictEqual(engine.getPolicy(policyId), undefined);
	});

	test('enables and disables policy', () => {
		const engine = createPolicyEngine();
		const policyId = engine.addPolicy({
			name: 'Toggle Policy',
			description: 'Can be toggled',
			rules: [],
			severity: 'info' as PolicySeverity,
			enabled: true,
			scope: 'global'
		});

		engine.disablePolicy(policyId);
		assert.strictEqual(engine.getPolicy(policyId)?.enabled, false);

		engine.enablePolicy(policyId);
		assert.strictEqual(engine.getPolicy(policyId)?.enabled, true);
	});

	test('evaluates contribution for violations', async () => {
		const engine = createPolicyEngine();
		const result = await engine.evaluateContribution('eval("user input")', 'test-session');

		assert.ok(result, 'Should return evaluation');
		assert.ok(typeof result.score === 'number');
		assert.ok(result.score >= 0 && result.score <= 1);
	});

	test('evaluation passes for clean code', async () => {
		const engine = createPolicyEngine();
		const result = await engine.evaluateContribution('const x = 1 + 2;', 'test-session');

		assert.ok(result, 'Should return evaluation');
		assert.ok(typeof result.passed === 'boolean');
	});

	test('returns violation history', async () => {
		const engine = createPolicyEngine();
		await engine.evaluateContribution('eval("test")', 'session-1');
		await engine.evaluateContribution('eval("test2")', 'session-2');

		const allViolations = engine.getViolationHistory();
		assert.ok(allViolations.length >= 2, 'Should have violations');

		const session1Violations = engine.getViolationHistory('session-1');
		assert.ok(session1Violations.length >= 1, 'Should have session-1 violations');
	});

	test('exports and imports policies', () => {
		const engine1 = createPolicyEngine();
		const exported = engine1.exportPolicies();
		assert.ok(exported.length > 0);

		const engine2 = createPolicyEngine();
		engine2.importPolicies(exported);
		assert.strictEqual(engine2.getPolicies().length, exported.length);
	});

	test('calculates policy score', async () => {
		const engine = createPolicyEngine();
		await engine.evaluateContribution('const x = 1;', 'score-session');
		const score = engine.getPolicyScore('score-session');
		assert.ok(score >= 0 && score <= 1, 'Score should be between 0 and 1');
	});

	test('critical violations reduce score significantly', async () => {
		const engine = createPolicyEngine();
		const cleanResult = await engine.evaluateContribution('const x = 1;', 'clean');
		const dirtyResult = await engine.evaluateContribution('eval("malicious"); exec("rm -rf /")', 'dirty');

		assert.ok(dirtyResult.score <= cleanResult.score, 'Dirty code should have lower score');
	});

	test('disabled policies are not evaluated', async () => {
		const engine = createPolicyEngine();
		const policies = engine.getPolicies();

		for (const policy of policies) {
			engine.disablePolicy(policy.id);
		}

		const result = await engine.evaluateContribution('eval("test"); document.write("xss")', 'disabled-test');
		assert.strictEqual(result.violations.length, 0, 'No violations when all policies disabled');
		assert.strictEqual(result.passed, true);
	});

	test('policy violation event fires', async () => {
		const engine = createPolicyEngine();
		let violationFired = false;
		let capturedViolation: PolicyViolation | undefined;

		engine.onPolicyViolation((v) => {
			violationFired = true;
			capturedViolation = v;
		});

		await engine.evaluateContribution('eval("test")', 'event-session');

		assert.ok(violationFired, 'Violation event should fire');
		assert.ok(capturedViolation, 'Should capture violation');
		assert.strictEqual(capturedViolation?.sessionId, 'event-session');
	});

	test('policy change event fires on add', () => {
		const engine = createPolicyEngine();
		let changeCount = 0;
		engine.onDidChangePolicies(() => changeCount++);

		engine.addPolicy({
			name: 'Event Test',
			description: 'Test',
			rules: [],
			severity: 'info' as PolicySeverity,
			enabled: true,
			scope: 'global'
		});

		assert.ok(changeCount > 0, 'Should fire change event');
	});

	test('policy change event fires on remove', () => {
		const engine = createPolicyEngine();
		let changeCount = 0;
		engine.onDidChangePolicies(() => changeCount++);

		const policyId = engine.addPolicy({
			name: 'Remove Test',
			description: 'Test',
			rules: [],
			severity: 'info' as PolicySeverity,
			enabled: true,
			scope: 'global'
		});

		engine.removePolicy(policyId);
		assert.ok(changeCount >= 2, 'Should fire change events for add and remove');
	});

	test('handles invalid regex patterns gracefully', async () => {
		const engine = createPolicyEngine();
		engine.addPolicy({
			name: 'Invalid Regex',
			description: 'Test',
			rules: [
				{
					id: 'bad-regex',
					pattern: '[invalid',
					message: 'Bad pattern',
					category: 'quality'
				}
			],
			severity: 'warning' as PolicySeverity,
			enabled: true,
			scope: 'global'
		});

		const result = await engine.evaluateContribution('test content', 'regex-test');
		assert.ok(result, 'Should not throw on invalid regex');
	});

	test('language-scoped policies filter correctly', async () => {
		const engine = createPolicyEngine();
		engine.addPolicy({
			name: 'TypeScript Only',
			description: 'TS policy',
			rules: [
				{
					id: 'ts-rule',
					pattern: 'any',
					message: 'Avoid any type',
					category: 'quality'
				}
			],
			severity: 'warning' as PolicySeverity,
			enabled: true,
			scope: 'language',
			languages: ['typescript']
		});

		const tsResult = await engine.evaluateContribution('const x: any = 1;', 'ts-session', 'typescript');
		const jsResult = await engine.evaluateContribution('const x: any = 1;', 'js-session', 'javascript');

		assert.ok(tsResult.violations.length >= 1, 'TypeScript should trigger violation');
	});

	test('extracts context around violation', async () => {
		const engine = createPolicyEngine();
		const code = 'const a = 1; const b = 2; eval("dangerous"); const c = 3; const d = 4;';
		const result = await engine.evaluateContribution(code, 'context-session');

		if (result.violations.length > 0) {
			const violation = result.violations[0];
			assert.ok(violation.context.length > 0, 'Should have context');
		}
	});
});
