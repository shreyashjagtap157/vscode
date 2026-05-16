/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DebateResolver } from '../debateResolver.js';

suite('DebateResolver - Phase 2', () => {

	test('detects contradiction conflicts', () => {
		const resolver = createTestResolver();
		const contributions = [
			{
				roleId: 'architect',
				content: 'We should use microservices. This is the correct approach.',
				profile: createMockProfile('architect', 'Systems Architect', 'pragmatic')
			},
			{
				roleId: 'security',
				content: 'Microservices is incorrect and flawed for this use case. We must use monolith.',
				profile: createMockProfile('security', 'Security Engineer', 'critical')
			}
		];

		const debates = resolver.detectConflicts(contributions, 'session-1');
		assert.ok(debates.length > 0);
		assert.strictEqual(debates[0].conflictType, 'contradiction');
	});

	test('detects tradeoff conflicts', () => {
		const resolver = createTestResolver();
		const contributions = [
			{
				roleId: 'performance',
				content: 'We need to prioritize performance over security for this feature.',
				profile: createMockProfile('performance', 'Performance Engineer', 'optimistic')
			},
			{
				roleId: 'security',
				content: 'Security must be the priority. We cannot compromise on security.',
				profile: createMockProfile('security', 'Security Engineer', 'critical')
			}
		];

		const debates = resolver.detectConflicts(contributions, 'session-2');
		assert.ok(debates.length > 0);
	});

	test('detects priority conflicts', () => {
		const resolver = createTestResolver();
		const contributions = [
			{
				roleId: 'backend',
				content: 'The primary focus should be on API design.',
				profile: createMockProfile('backend', 'Backend Engineer', 'pragmatic')
			},
			{
				roleId: 'qa',
				content: 'Testing is the most important aspect we need to focus on first.',
				profile: createMockProfile('qa', 'QA Engineer', 'critical')
			}
		];

		const debates = resolver.detectConflicts(contributions, 'session-3');
		assert.ok(debates.length > 0);
	});

	test('does not detect conflict for agreeing positions', () => {
		const resolver = createTestResolver();
		const contributions = [
			{
				roleId: 'architect',
				content: 'We should use TypeScript for better type safety.',
				profile: createMockProfile('architect', 'Systems Architect', 'pragmatic')
			},
			{
				roleId: 'backend',
				content: 'Agreed, TypeScript is the best choice for this project.',
				profile: createMockProfile('backend', 'Backend Engineer', 'pragmatic')
			}
		];

		const debates = resolver.detectConflicts(contributions, 'session-4');
		assert.strictEqual(debates.length, 0);
	});

	test('records debate resolution', () => {
		const resolver = createTestResolver();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use microservices',
				profile: createMockProfile('architect', 'Systems Architect', 'pragmatic')
			},
			{
				roleId: 'security',
				content: 'Use monolith for security',
				profile: createMockProfile('security', 'Security Engineer', 'critical')
			}
		];

		const debates = resolver.detectConflicts(contributions, 'session-5');
		assert.ok(debates.length > 0);

		const unresolved = resolver.getUnresolvedDebates('session-5');
		assert.strictEqual(unresolved.length, debates.length);
	});

	test('getDebateHistory returns all debates', () => {
		const resolver = createTestResolver();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use pattern A',
				profile: createMockProfile('architect', 'Systems Architect', 'pragmatic')
			},
			{
				roleId: 'backend',
				content: 'Pattern A is wrong, use pattern B',
				profile: createMockProfile('backend', 'Backend Engineer', 'pragmatic')
			}
		];

		resolver.detectConflicts(contributions, 'session-6');
		const history = resolver.getDebateHistory();
		assert.ok(history.length > 0);
	});

	test('getDebateHistory filters by session', () => {
		const resolver = createTestResolver();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use pattern A',
				profile: createMockProfile('architect', 'Systems Architect', 'pragmatic')
			},
			{
				roleId: 'backend',
				content: 'Pattern A is incorrect',
				profile: createMockProfile('backend', 'Backend Engineer', 'pragmatic')
			}
		];

		resolver.detectConflicts(contributions, 'session-7');
		const history = resolver.getDebateHistory('session-7');
		assert.ok(history.length > 0);

		const otherHistory = resolver.getDebateHistory('nonexistent-session');
		assert.strictEqual(otherHistory.length, 0);
	});

	test('fallback resolution when LLM unavailable', async () => {
		const resolver = createTestResolver();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use microservices',
				profile: createMockProfile('architect', 'Systems Architect', 'pragmatic')
			},
			{
				roleId: 'security',
				content: 'Use monolith',
				profile: createMockProfile('security', 'Security Engineer', 'critical')
			}
		];

		const debates = resolver.detectConflicts(contributions, 'session-8');
		assert.ok(debates.length > 0);

		const resolution = await resolver.resolveDebate(debates[0]);
		assert.ok(resolution.resolution);
		assert.ok(resolution.rationale);
		assert.ok(resolution.confidence > 0);
	});
});

function createTestResolver(): DebateResolver {
	const mockLogService = {
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {}
	};

	const mockLanguageModelsService = {
		getLanguageModelIds: () => Promise.resolve([]),
		sendChatRequest: () => Promise.reject(new Error('No models available'))
	};

	return new DebateResolver(
		mockLogService as any,
		mockLanguageModelsService as any
	);
}

function createMockProfile(roleId: string, displayName: string, reasoningStyle: string): any {
	return {
		roleId,
		displayName,
		reasoningStyle,
		priorityWeight: 10,
		focusModes: ['general']
	};
}
