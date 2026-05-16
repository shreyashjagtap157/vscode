/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AgentProfileManager, DEFAULT_COUNCIL_PROFILES, ProfileValidationError, COUNCIL_PROTOCOL } from './agentProfileManager.js';

suite('AgentProfileManager', () => {

	test('loads default profiles', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		assert.strictEqual(manager.getProfile('architect').roleId, 'architect');
		assert.strictEqual(manager.getProfile('security').priorityWeight, 12);
		assert.strictEqual(manager.getProfile('qa').reasoningStyle, 'critical');
		assert.strictEqual(manager.getAllProfiles().length, Object.keys(DEFAULT_COUNCIL_PROFILES).length);
	});

	test('builds system prompt with context', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		const prompt = manager.buildSystemPrompt('security', 'Test context');
		assert.ok(prompt.includes('Security Specialist'));
		assert.ok(prompt.includes('Test context'));
		assert.ok(prompt.includes('[File:path:line]'));
		assert.ok(prompt.includes(COUNCIL_PROTOCOL));
	});

	test('throws on missing profile', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		assert.throws(() => manager.getProfile('nonexistent'), /Agent profile not found/);
	});

	test('validates user profiles - empty roleId', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		assert.throws(() => manager.registerProfile({
			roleId: '',
			displayName: 'Test',
			baseSystemPrompt: 'Test prompt',
			reasoningStyle: 'critical',
			priorityWeight: 5,
			preferredTools: [],
			focusModes: []
		}), ProfileValidationError);
	});

	test('validates user profiles - invalid reasoningStyle', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		assert.throws(() => manager.registerProfile({
			roleId: 'test',
			displayName: 'Test',
			baseSystemPrompt: 'Test prompt',
			reasoningStyle: 'invalid' as any,
			priorityWeight: 5,
			preferredTools: [],
			focusModes: []
		}), ProfileValidationError);
	});

	test('validates user profiles - priorityWeight out of range', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		assert.throws(() => manager.registerProfile({
			roleId: 'test',
			displayName: 'Test',
			baseSystemPrompt: 'Test prompt',
			reasoningStyle: 'pragmatic',
			priorityWeight: 25,
			preferredTools: [],
			focusModes: []
		}), ProfileValidationError);
	});

	test('registers valid custom profile', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		manager.registerProfile({
			roleId: 'custom-role',
			displayName: 'Custom Role',
			baseSystemPrompt: 'Custom prompt',
			reasoningStyle: 'optimistic',
			priorityWeight: 7,
			preferredTools: ['tool1'],
			focusModes: ['focus1']
		});

		const profile = manager.getProfile('custom-role');
		assert.strictEqual(profile.roleId, 'custom-role');
		assert.strictEqual(manager.getAllProfiles().length, Object.keys(DEFAULT_COUNCIL_PROFILES).length + 1);
	});

	test('builds tool filter correctly', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		const filter = manager.buildToolFilter('security');
		assert.deepStrictEqual(filter.allowed, ['runSubagentTool']);
		assert.deepStrictEqual(filter.excluded, []);
	});

	test('cannot unregister default profile', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		assert.throws(() => manager.unregisterProfile('architect'), /Cannot unregister default profile/);
	});

	test('can unregister custom profile', () => {
		const manager = new AgentProfileManager(
			{ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as any,
			{ exists: () => Promise.resolve(false) } as any
		);

		manager.registerProfile({
			roleId: 'temp-role',
			displayName: 'Temp',
			baseSystemPrompt: 'Temp prompt',
			reasoningStyle: 'pragmatic',
			priorityWeight: 5,
			preferredTools: [],
			focusModes: []
		});

		assert.strictEqual(manager.getAllProfiles().length, Object.keys(DEFAULT_COUNCIL_PROFILES).length + 1);
		manager.unregisterProfile('temp-role');
		assert.strictEqual(manager.getAllProfiles().length, Object.keys(DEFAULT_COUNCIL_PROFILES).length);
	});
});
