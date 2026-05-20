/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ConsensusManager, IterationGuard } from '../councilCoordinator.js';
import { CouncilAgentProfile } from '../agentProfileManager.js';

suite('ConsensusManager', () => {

	test('calculates evidence score correctly', async () => {
		const manager = new ConsensusManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		const text = 'Issue in [File:src/auth.ts:45] and [Log:ci-error]';
		const score = await manager.scoreEvidence(text);
		
		assert.strictEqual(score.totalCitations, 2);
		assert.strictEqual(score.validCitations, 1);
		assert.strictEqual(score.invalidCitations, 1);
		assert.strictEqual(score.confidenceScore, 0.5);
	});

	test('resolves conflict using priority weight', async () => {
		const manager = new ConsensusManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		const contributions = [
			{ roleId: 'architect', content: 'Use pattern A', timestamp: Date.now() },
			{ roleId: 'security', content: 'Pattern A has vulnerability [File:auth.ts:12]', timestamp: Date.now() }
		];
		const profiles = new Map<string, CouncilAgentProfile>([
			['architect', { roleId: 'architect', displayName: 'Architect', baseSystemPrompt: '', reasoningStyle: 'pragmatic', priorityWeight: 10, preferredTools: [], focusModes: ['architecture'] }],
			['security', { roleId: 'security', displayName: 'Security', baseSystemPrompt: '', reasoningStyle: 'critical', priorityWeight: 12, preferredTools: [], focusModes: ['security'] }]
		]);

		const result = await manager.resolveConsensus(contributions, profiles, 'evidence-weighted');
		assert.ok(result.decision.includes('vulnerability'));
		assert.strictEqual(result.strategy, 'evidence-weighted');
	});

	test('iteration guard prevents infinite loops', () => {
		const guard = new IterationGuard(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any
		);
		const sessionId = 'test';

		assert.ok(guard.incrementAndCheck(sessionId, 'complex'));
		assert.ok(guard.incrementAndCheck(sessionId, 'complex'));
		assert.ok(guard.incrementAndCheck(sessionId, 'complex'));
		assert.ok(!guard.incrementAndCheck(sessionId, 'complex'));
	});

	test('iteration guard respects complexity levels', () => {
		const guard = new IterationGuard(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any
		);

		assert.strictEqual(guard.calculateMaxIterations('simple'), 1);
		assert.strictEqual(guard.calculateMaxIterations('moderate'), 2);
		assert.strictEqual(guard.calculateMaxIterations('complex'), 3);
		assert.strictEqual(guard.calculateMaxIterations('critical'), 4);
	});

	test('iteration guard tracks remaining iterations', () => {
		const guard = new IterationGuard(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any
		);
		const sessionId = 'test-remaining';

		assert.strictEqual(guard.getRemainingIterations(sessionId, 'complex'), 3);
		guard.incrementAndCheck(sessionId, 'complex');
		assert.strictEqual(guard.getRemainingIterations(sessionId, 'complex'), 2);
	});

	test('iteration guard can be reset', () => {
		const guard = new IterationGuard(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any
		);
		const sessionId = 'test-reset';

		guard.incrementAndCheck(sessionId, 'simple');
		assert.strictEqual(guard.getCurrentIteration(sessionId), 1);
		guard.reset(sessionId);
		assert.strictEqual(guard.getCurrentIteration(sessionId), 0);
	});

	test('records and resolves debates', () => {
		const manager = new ConsensusManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		const debate = manager.recordDebate('Auth Pattern', [
			{ roleId: 'architect', position: 'Use JWT', evidence: { totalCitations: 1, validCitations: 1, invalidCitations: 0, confidenceScore: 1, reasoningDepth: 2 } },
			{ roleId: 'security', position: 'Use OAuth2', evidence: { totalCitations: 3, validCitations: 3, invalidCitations: 0, confidenceScore: 1, reasoningDepth: 5 } }
		]);

		assert.strictEqual(debate.topic, 'Auth Pattern');
		assert.strictEqual(debate.positions.length, 2);
		assert.strictEqual(debate.resolved, false);

		manager.resolveDebate(debate.debateId, 'Use OAuth2', 'Security specialist priority');
		
		const history = manager.getDebateHistory();
		assert.strictEqual(history[0].resolved, true);
		assert.strictEqual(history[0].resolution, 'Use OAuth2');
	});

	test('handles empty contributions gracefully', async () => {
		const manager = new ConsensusManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		const result = await manager.resolveConsensus([], new Map());
		assert.strictEqual(result.decision, 'No contributions available');
		assert.strictEqual(result.confidence, 0);
	});

	test('single contribution returns immediately', async () => {
		const manager = new ConsensusManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		const contributions = [
			{ roleId: 'architect', content: 'Use microservices', timestamp: Date.now() }
		];

		const result = await manager.resolveConsensus(contributions, new Map());
		assert.strictEqual(result.decision, 'Use microservices');
		assert.strictEqual(result.dissenters.length, 0);
	});
});
