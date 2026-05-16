/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AdvancedConsensusEngine, ConsensusStrategy } from '../advancedConsensusEngine.js';

suite('AdvancedConsensusEngine - Phase 2', () => {

	test('calculates confidence interval correctly', () => {
		const engine = createTestEngine();
		const ci = engine.calculateConfidenceInterval(0.8, 10, 0.95);

		assert.ok(ci.lower >= 0 && ci.lower <= 0.8);
		assert.ok(ci.upper >= 0.8 && ci.upper <= 1);
		assert.strictEqual(ci.confidence, 0.95);
		assert.ok(ci.marginOfError > 0);
	});

	test('calculates confidence interval with different confidence levels', () => {
		const engine = createTestEngine();
		
		const ci90 = engine.calculateConfidenceInterval(0.5, 20, 0.90);
		const ci95 = engine.calculateConfidenceInterval(0.5, 20, 0.95);
		const ci99 = engine.calculateConfidenceInterval(0.5, 20, 0.99);

		assert.ok(ci99.marginOfError > ci95.marginOfError);
		assert.ok(ci95.marginOfError > ci90.marginOfError);
	});

	test('detects outliers correctly', () => {
		const engine = createTestEngine();
		const scores = [0.8, 0.85, 0.82, 0.79, 0.1];
		const outliers = engine.detectOutliers(scores);

		assert.ok(outliers.length > 0);
		assert.ok(outliers.includes(4));
	});

	test('returns empty array for no outliers', () => {
		const engine = createTestEngine();
		const scores = [0.8, 0.82, 0.79, 0.81, 0.83];
		const outliers = engine.detectOutliers(scores);

		assert.strictEqual(outliers.length, 0);
	});

	test('performs bayesian update correctly', () => {
		const engine = createTestEngine();
		const update = engine.bayesianUpdate(0.5, 0.8, 'Strong evidence');

		assert.ok(update.posterior > update.prior);
		assert.strictEqual(update.likelihood, 0.8);
		assert.strictEqual(update.evidence, 'Strong evidence');
	});

	test('resolves consensus with evidence-weighted-ci strategy', async () => {
		const engine = createTestEngine();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use microservices architecture',
				evidenceScore: createMockEvidenceScore(0.8, 5)
			},
			{
				roleId: 'security',
				content: 'Use monolith for security [File:src/auth.ts:10]',
				evidenceScore: createMockEvidenceScore(0.9, 8)
			}
		];
		const profiles = createMockProfiles();

		const result = await engine.resolveConsensus(contributions, profiles, 'evidence-weighted-ci');

		assert.ok(result.decision);
		assert.ok(result.confidenceInterval);
		assert.strictEqual(result.strategy, 'evidence-weighted-ci');
		assert.ok(result.qualityMetrics);
	});

	test('resolves consensus with majority strategy', async () => {
		const engine = createTestEngine();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use pattern A for scalability',
				evidenceScore: createMockEvidenceScore(0.7, 3)
			},
			{
				roleId: 'backend',
				content: 'Use pattern A for performance',
				evidenceScore: createMockEvidenceScore(0.8, 4)
			},
			{
				roleId: 'security',
				content: 'Use pattern B for security',
				evidenceScore: createMockEvidenceScore(0.9, 5)
			}
		];
		const profiles = createMockProfiles();

		const result = await engine.resolveConsensus(contributions, profiles, 'majority');

		assert.ok(result.decision);
		assert.ok(result.rationale.includes('Majority') || result.rationale.includes('Evidence'));
	});

	test('resolves consensus with specialist-priority strategy', async () => {
		const engine = createTestEngine();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use JWT for authentication',
				evidenceScore: createMockEvidenceScore(0.7, 3)
			},
			{
				roleId: 'security',
				content: 'Use OAuth2 for authentication [File:src/auth.ts:10]',
				evidenceScore: createMockEvidenceScore(0.9, 5)
			}
		];
		const profiles = createMockProfiles();

		const result = await engine.resolveConsensus(contributions, profiles, 'specialist-priority');

		assert.ok(result.decision);
		assert.ok(result.rationale.includes('Specialist') || result.rationale.includes('Evidence'));
	});

	test('resolves consensus with bayesian strategy', async () => {
		const engine = createTestEngine();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use pattern A',
				evidenceScore: createMockEvidenceScore(0.7, 3)
			},
			{
				roleId: 'backend',
				content: 'Use pattern B',
				evidenceScore: createMockEvidenceScore(0.8, 4)
			}
		];
		const profiles = createMockProfiles();

		const result = await engine.resolveConsensus(contributions, profiles, 'bayesian');

		assert.ok(result.decision);
		assert.ok(result.rationale.includes('Bayesian'));
		assert.strictEqual(result.strategy, 'bayesian');
	});

	test('handles empty contributions', async () => {
		const engine = createTestEngine();
		const result = await engine.resolveConsensus([], new Map());

		assert.strictEqual(result.decision, 'No contributions available');
		assert.strictEqual(result.confidence, 0);
	});

	test('handles single contribution', async () => {
		const engine = createTestEngine();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use microservices',
				evidenceScore: createMockEvidenceScore(0.8, 5)
			}
		];
		const profiles = createMockProfiles();

		const result = await engine.resolveConsensus(contributions, profiles);

		assert.strictEqual(result.decision, 'Use microservices');
		assert.strictEqual(result.dissenters.length, 0);
	});

	test('calculates quality metrics correctly', async () => {
		const engine = createTestEngine();
		const contributions = [
			{
				roleId: 'architect',
				content: 'Use pattern A',
				evidenceScore: createMockEvidenceScore(0.8, 5)
			},
			{
				roleId: 'backend',
				content: 'Use pattern A',
				evidenceScore: createMockEvidenceScore(0.85, 6)
			}
		];
		const profiles = createMockProfiles();

		const result = await engine.resolveConsensus(contributions, profiles);

		assert.ok(result.qualityMetrics.agreementLevel > 0.8);
		assert.ok(result.qualityMetrics.evidenceConsistency > 0.8);
		assert.strictEqual(result.qualityMetrics.consensusStrength, 'strong');
	});
});

function createTestEngine(): AdvancedConsensusEngine {
	const mockLogService = {
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {}
	};

	const mockEvidenceValidator = {
		parseCitations: () => [],
		validateCitations: () => Promise.resolve([]),
		scoreEvidence: () => Promise.resolve(createMockEvidenceScore(0.5, 1)),
		generateEvidenceReport: () => Promise.resolve({} as any)
	};

	return new AdvancedConsensusEngine(
		mockLogService as any,
		mockEvidenceValidator as any
	);
}

function createMockEvidenceScore(confidence: number, citations: number): any {
	return {
		totalCitations: citations,
		validCitations: citations,
		invalidCitations: 0,
		unverifiedCitations: 0,
		confidenceScore: confidence,
		reasoningDepth: 3,
		evidenceDensity: 0.5,
		citationBreakdown: {},
		validationDetails: []
	};
}

function createMockProfiles(): Map<string, any> {
	return new Map([
		['architect', { roleId: 'architect', priorityWeight: 10, focusModes: ['architecture'] }],
		['backend', { roleId: 'backend', priorityWeight: 8, focusModes: ['implementation'] }],
		['security', { roleId: 'security', priorityWeight: 12, focusModes: ['security'] }],
		['qa', { roleId: 'qa', priorityWeight: 9, focusModes: ['testing'] }]
	]);
}
