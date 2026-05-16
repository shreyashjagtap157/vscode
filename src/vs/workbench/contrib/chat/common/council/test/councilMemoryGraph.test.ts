/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilMemoryGraph, MemoryNodeType, MemoryEdgeType } from '../councilMemoryGraph.js';

suite('CouncilMemoryGraph - Phase 4', () => {

	test('adds and retrieves nodes', () => {
		const graph = createTestGraph();
		const node = graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Use TypeScript',
			content: 'Decided to use TypeScript for type safety',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: ['typescript', 'language'],
			confidence: 0.9,
			metadata: {}
		});

		assert.ok(node.id);
		assert.strictEqual(node.title, 'Use TypeScript');

		const retrieved = graph.getNode(node.id);
		assert.ok(retrieved);
		assert.strictEqual(retrieved!.id, node.id);
	});

	test('adds and retrieves edges', () => {
		const graph = createTestGraph();
		const node1 = graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Use TypeScript',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.9,
			metadata: {}
		});

		const node2 = graph.addNode({
			type: MemoryNodeType.Lesson,
			title: 'Type Safety Benefits',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.8,
			metadata: {}
		});

		const edge = graph.addEdge({
			from: node1.id,
			to: node2.id,
			type: MemoryEdgeType.RelatedTo,
			weight: 1.0,
			description: 'TypeScript enables type safety'
		});

		assert.ok(edge.id);
		assert.strictEqual(edge.from, node1.id);
		assert.strictEqual(edge.to, node2.id);

		const retrieved = graph.getEdge(edge.id);
		assert.ok(retrieved);
	});

	test('queries memory by type', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.9,
			metadata: {}
		});

		graph.addNode({
			type: MemoryNodeType.Bug,
			title: 'Bug 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'qa',
			tags: [],
			confidence: 1.0,
			metadata: {}
		});

		const decisions = graph.queryMemory({ nodeTypes: [MemoryNodeType.Decision] });
		assert.strictEqual(decisions.length, 1);
		assert.strictEqual(decisions[0].type, MemoryNodeType.Decision);
	});

	test('queries memory by tags', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: ['typescript', 'language'],
			confidence: 0.9,
			metadata: {}
		});

		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 2',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: ['python'],
			confidence: 0.8,
			metadata: {}
		});

		const tsNodes = graph.queryMemory({ tags: ['typescript'] });
		assert.strictEqual(tsNodes.length, 1);
	});

	test('queries memory by session', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.9,
			metadata: {}
		});

		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 2',
			content: 'Content',
			sessionId: 'session-2',
			createdBy: 'architect',
			tags: [],
			confidence: 0.8,
			metadata: {}
		});

		const session1Nodes = graph.getNodesBySession('session-1');
		assert.strictEqual(session1Nodes.length, 1);
	});

	test('gets related nodes', () => {
		const graph = createTestGraph();
		const node1 = graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.9,
			metadata: {}
		});

		const node2 = graph.addNode({
			type: MemoryNodeType.Lesson,
			title: 'Lesson 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.8,
			metadata: {}
		});

		graph.addEdge({
			from: node1.id,
			to: node2.id,
			type: MemoryEdgeType.RelatedTo,
			weight: 1.0
		});

		const related = graph.getRelatedNodes(node1.id);
		assert.strictEqual(related.length, 1);
		assert.strictEqual(related[0].id, node2.id);
	});

	test('calculates graph statistics', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: ['typescript'],
			confidence: 0.9,
			metadata: {}
		});

		graph.addNode({
			type: MemoryNodeType.Bug,
			title: 'Bug 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'qa',
			tags: ['auth'],
			confidence: 1.0,
			metadata: {}
		});

		const stats = graph.getStats();
		assert.strictEqual(stats.totalNodes, 2);
		assert.strictEqual(stats.nodeTypeDistribution[MemoryNodeType.Decision], 1);
		assert.strictEqual(stats.nodeTypeDistribution[MemoryNodeType.Bug], 1);
		assert.ok(stats.mostCommonTags.length > 0);
	});

	test('gets recent nodes', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Old Decision',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.9,
			metadata: {}
		});

		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'New Decision',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.8,
			metadata: {}
		});

		const recent = graph.getRecentNodes(1);
		assert.strictEqual(recent.length, 1);
		assert.strictEqual(recent[0].title, 'New Decision');
	});

	test('gets nodes by tag', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: ['typescript'],
			confidence: 0.9,
			metadata: {}
		});

		const tsNodes = graph.getNodesByTag('typescript');
		assert.strictEqual(tsNodes.length, 1);
	});

	test('gets nodes by type', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.9,
			metadata: {}
		});

		graph.addNode({
			type: MemoryNodeType.Bug,
			title: 'Bug 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'qa',
			tags: [],
			confidence: 1.0,
			metadata: {}
		});

		const decisions = graph.getNodesByType(MemoryNodeType.Decision);
		assert.strictEqual(decisions.length, 1);
	});

	test('exports and imports graph', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.9,
			metadata: {}
		});

		const exported = graph.exportGraph();
		assert.strictEqual(exported.nodes.length, 1);

		const newGraph = createTestGraph();
		newGraph.importGraph(exported);
		assert.strictEqual(newGraph.getStats().totalNodes, 1);
	});

	test('clears graph', () => {
		const graph = createTestGraph();
		graph.addNode({
			type: MemoryNodeType.Decision,
			title: 'Decision 1',
			content: 'Content',
			sessionId: 'session-1',
			createdBy: 'architect',
			tags: [],
			confidence: 0.9,
			metadata: {}
		});

		assert.strictEqual(graph.getStats().totalNodes, 1);
		graph.clearGraph();
		assert.strictEqual(graph.getStats().totalNodes, 0);
	});

	test('adds decision using helper method', () => {
		const graph = createTestGraph();
		const node = graph.addDecision('session-1', 'Use TypeScript', 'Type safety', ['typescript'], 0.9, 'architect');

		assert.strictEqual(node.type, MemoryNodeType.Decision);
		assert.strictEqual(node.title, 'Use TypeScript');
	});

	test('adds bug using helper method', () => {
		const graph = createTestGraph();
		const node = graph.addBug('session-1', 'Auth Bypass', 'Security issue', ['security'], 'redteam');

		assert.strictEqual(node.type, MemoryNodeType.Bug);
		assert.strictEqual(node.confidence, 1.0);
	});

	test('adds lesson using helper method', () => {
		const graph = createTestGraph();
		const node = graph.addLesson('session-1', 'Always validate input', 'Security lesson', ['security'], 0.95, 'security');

		assert.strictEqual(node.type, MemoryNodeType.Lesson);
		assert.strictEqual(node.confidence, 0.95);
	});
});

function createTestGraph(): CouncilMemoryGraph {
	const mockLogService = {
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {}
	};

	const mockStorageService = {
		get: () => '{}',
		store: () => {}
	};

	return new CouncilMemoryGraph(
		mockLogService as any,
		mockStorageService as any
	);
}
