/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilMCPIntegration, MCPArtifactType } from '../councilMCPIntegration.js';

suite('CouncilMCPIntegration - Phase 4', () => {

	test('connects and disconnects properly', async () => {
		const mcp = createTestMCP();
		assert.strictEqual(mcp.isConnected(), false);
		
		await mcp.connect();
		assert.strictEqual(mcp.isConnected(), true);
		
		await mcp.disconnect();
		assert.strictEqual(mcp.isConnected(), false);
	});

	test('stores and loads session state', async () => {
		const mcp = createTestMCP();
		const state = {
			sessionId: 'test-session',
			request: 'Test request',
			tasks: [{ taskId: 't1', description: 'Test task', assignedRole: 'architect', dependencies: [], status: 'pending' }],
			contributions: [],
			scratchpad: [],
			startTime: Date.now(),
			status: 'executing'
		};

		await mcp.storeSessionState(state);
		const loaded = await mcp.loadSessionState('test-session');

		assert.ok(loaded);
		assert.strictEqual(loaded!.sessionId, 'test-session');
		assert.strictEqual(loaded!.request, 'Test request');
	});

	test('shares and retrieves artifacts', async () => {
		const mcp = createTestMCP();
		const artifact = await mcp.createArtifact({
			type: MCPArtifactType.Code,
			title: 'Test Artifact',
			content: 'Test content',
			sessionId: 'session-1',
			createdBy: 'test-user',
			tags: ['test', 'code']
		});

		assert.ok(artifact.id);
		assert.strictEqual(artifact.title, 'Test Artifact');

		const artifacts = await mcp.getArtifactsBySession('session-1');
		assert.strictEqual(artifacts.length, 1);
		assert.strictEqual(artifacts[0].id, artifact.id);
	});

	test('searches artifacts by query', async () => {
		const mcp = createTestMCP();
		await mcp.createArtifact({
			type: MCPArtifactType.Document,
			title: 'Security Review',
			content: 'This is a security review document',
			sessionId: 'session-2',
			createdBy: 'security-agent',
			tags: ['security', 'review']
		});

		await mcp.createArtifact({
			type: MCPArtifactType.Code,
			title: 'Authentication Module',
			content: 'Authentication implementation code',
			sessionId: 'session-2',
			createdBy: 'backend-agent',
			tags: ['auth', 'code']
		});

		const securityArtifacts = await mcp.searchArtifacts('security');
		assert.strictEqual(securityArtifacts.length, 1);
		assert.strictEqual(securityArtifacts[0].title, 'Security Review');

		const allArtifacts = await mcp.searchArtifacts('session');
		assert.strictEqual(allArtifacts.length, 2);
	});

	test('filters artifacts by tag', async () => {
		const mcp = createTestMCP();
		await mcp.createArtifact({
			type: MCPArtifactType.Test,
			title: 'Unit Tests',
			content: 'Test content',
			sessionId: 'session-3',
			createdBy: 'qa-agent',
			tags: ['test', 'unit']
		});

		await mcp.createArtifact({
			type: MCPArtifactType.Test,
			title: 'Integration Tests',
			content: 'Test content',
			sessionId: 'session-3',
			createdBy: 'qa-agent',
			tags: ['test', 'integration']
		});

		const testArtifacts = await mcp.getArtifactsByTag('test');
		assert.strictEqual(testArtifacts.length, 2);

		const unitArtifacts = await mcp.getArtifactsByTag('unit');
		assert.strictEqual(unitArtifacts.length, 1);
	});

	test('manages shared scratchpad', async () => {
		const mcp = createTestMCP();
		const sessionId = 'scratchpad-session';

		let scratchpad = await mcp.getSharedScratchpad(sessionId);
		assert.strictEqual(scratchpad.length, 0);

		await mcp.updateSharedScratchpad(sessionId, ['entry1', 'entry2', 'entry3']);
		scratchpad = await mcp.getSharedScratchpad(sessionId);
		assert.strictEqual(scratchpad.length, 3);
		assert.strictEqual(scratchpad[0], 'entry1');
	});

	test('sends and retrieves agent messages', async () => {
		const mcp = createTestMCP();
		const message = {
			messageId: 'msg-1',
			from: 'architect',
			to: 'backend',
			content: 'Review this design',
			timestamp: Date.now(),
			type: 'request' as const
		};

		await mcp.sendAgentMessage(message);
		const messages = await mcp.getAgentMessages('msg-1');
		assert.strictEqual(messages.length, 1);
		assert.strictEqual(messages[0].from, 'architect');
	});

	test('gets all session states', async () => {
		const mcp = createTestMCP();
		await mcp.storeSessionState({
			sessionId: 'session-1',
			request: 'Request 1',
			tasks: [],
			contributions: [],
			scratchpad: [],
			startTime: Date.now(),
			status: 'completed'
		});

		await mcp.storeSessionState({
			sessionId: 'session-2',
			request: 'Request 2',
			tasks: [],
			contributions: [],
			scratchpad: [],
			startTime: Date.now(),
			status: 'completed'
		});

		const states = await mcp.getAllSessionStates();
		assert.strictEqual(states.length, 2);
	});
});

function createTestMCP(): CouncilMCPIntegration {
	const mockLogService = {
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {}
	};

	return new CouncilMCPIntegration(mockLogService as any);
}
