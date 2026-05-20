/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilEnterprise, IntegrationType, IntegrationStatus } from '../councilEnterprise.js';
import { ICouncilOrchestrator, CouncilResult } from '../councilOrchestrator.js';
import { ICouncilPRReviewBoard, PRReviewResult, ReviewVerdict } from '../councilPRReview.js';
import { ICouncilGovernance, GovernanceActionType, GovernanceCheckResult } from '../councilGovernance.js';

class MockOrchestrator implements ICouncilOrchestrator {
	declare readonly _serviceBrand: undefined;
	async executeSession(request: string, selectedRoles?: string[]): Promise<CouncilResult> {
		return {
			sessionId: 'mock',
			finalResponse: 'Analysis complete',
			contributions: new Map(),
			debateRecords: [],
			confidence: 0.8,
			executionTimeMs: 3000,
			status: 'success'
		};
	}
	getSession() { return undefined; }
	getActiveSessions() { return []; }
	cancelSession() { }
	dispose() { }
}

class MockPRReviewBoard implements ICouncilPRReviewBoard {
	declare readonly _serviceBrand: undefined;
	async reviewPR(request: any, config?: any): Promise<PRReviewResult> {
		return {
			reviewId: 'mock-review',
			prNumber: request.prNumber,
			verdict: ReviewVerdict.Approve,
			score: 0.9,
			summary: 'PR looks good',
			comments: [],
			policyViolations: [],
			securityFindings: [],
			performanceIssues: [],
			testCoverageEstimate: 0.8,
			councilResult: {
				sessionId: 'mock',
				finalResponse: 'OK',
				contributions: new Map(),
				debateRecords: [],
				confidence: 0.8,
				executionTimeMs: 3000,
				status: 'success'
			},
			reviewedAt: Date.now(),
			executionTimeMs: 3000
		};
	}
	generateReviewSummary(result: PRReviewResult): string {
		return `PR #${result.prNumber} - ${result.verdict}`;
	}
	exportReviewAsMarkdown(result: PRReviewResult): string {
		return `# PR #${result.prNumber}`;
	}
	getReviewHistory(prNumber?: number) { return []; }
	getReview(reviewId: string) { return undefined; }
	cancelReview(reviewId: string) { }
	dispose() { }
	onReviewStarted = { listen: () => ({ dispose() { } }) } as any;
	onReviewCompleted = { listen: () => ({ dispose() { } }) } as any;
	onReviewFailed = { listen: () => ({ dispose() { } }) } as any;
}

class MockGovernance implements ICouncilGovernance {
	declare readonly _serviceBrand: undefined;
	recordAction(actionType: any, actor: string, target: string, details: string, metadata?: any, sessionId?: string, severity?: any) {
		return {
			entryId: 'mock-entry',
			timestamp: Date.now(),
			actionType,
			severity: severity || 'info',
			sessionId,
			actor,
			target,
			details,
			metadata: metadata || {},
			hash: 'mock-hash',
			previousHash: 'mock-prev'
		};
	}
	getAuditTrail(sessionId?: string, limit?: number) { return []; }
	getEntry(entryId: string) { return undefined; }
	verifyChain() { return true; }
	getGovernancePolicies() { return []; }
	addPolicy(policy: any) { return ''; }
	removePolicy(id: string) { }
	checkAction(actionType: GovernanceActionType, context: Record<string, unknown>): GovernanceCheckResult {
		return { allowed: true, requiresApproval: false, message: 'OK', severity: 'info' as any };
	}
	generateReport(period?: any) {
		return {
			reportId: 'mock',
			title: 'Test',
			generatedAt: Date.now(),
			period: { start: 0, end: Date.now() },
			totalSessions: 0,
			successfulSessions: 0,
			failedSessions: 0,
			cancelledSessions: 0,
			totalDecisions: 0,
			totalViolations: 0,
			totalDebates: 0,
			resolvedDebates: 0,
			averageConfidence: 0,
			averageExecutionTimeMs: 0,
			topViolations: [],
			agentActivity: [],
			entries: []
		};
	}
	exportAuditTrail(format: any) { return '[]'; }
	clearAuditTrail(maxAge?: number) { return 0; }
	dispose() { }
	onAuditEntryAdded = { listen: () => ({ dispose() { } }) } as any;
}

class MockLogService {
	info(m: string) { }
	warn(m: string) { }
	error(m: string) { }
	debug(m: string) { }
	trace(m: string) { }
}

function createEnterprise(): CouncilEnterprise {
	const orchestrator = new MockOrchestrator() as any;
	const prReviewBoard = new MockPRReviewBoard() as any;
	const governance = new MockGovernance() as any;
	const logService = new MockLogService() as any;
	return new CouncilEnterprise(orchestrator, prReviewBoard, governance, logService);
}

suite('CouncilEnterprise', () => {
	test('starts with no integrations', () => {
		const enterprise = createEnterprise();
		const integrations = enterprise.getIntegrations();
		assert.strictEqual(integrations.length, 0, 'Should start empty');
	});

	test('adds integration', () => {
		const enterprise = createEnterprise();
		const id = enterprise.addIntegration({
			type: IntegrationType.GitHub,
			name: 'My GitHub',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: { token: 'test-token' }
		});

		assert.ok(id, 'Should return integration id');
		assert.strictEqual(enterprise.getIntegrations().length, 1);
	});

	test('gets integration by id', () => {
		const enterprise = createEnterprise();
		const id = enterprise.addIntegration({
			type: IntegrationType.Slack,
			name: 'My Slack',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: { botToken: 'test' }
		});

		const integration = enterprise.getIntegration(id);
		assert.ok(integration, 'Should find integration');
		assert.strictEqual(integration?.name, 'My Slack');
	});

	test('updates integration', () => {
		const enterprise = createEnterprise();
		const id = enterprise.addIntegration({
			type: IntegrationType.Jira,
			name: 'My Jira',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: { baseUrl: 'https://jira.example.com' }
		});

		enterprise.updateIntegration(id, { name: 'Updated Jira' });
		const updated = enterprise.getIntegration(id);
		assert.strictEqual(updated?.name, 'Updated Jira');
	});

	test('throws when updating non-existent integration', () => {
		const enterprise = createEnterprise();
		assert.throws(() => enterprise.updateIntegration('non-existent', { name: 'Test' }));
	});

	test('removes integration', () => {
		const enterprise = createEnterprise();
		const id = enterprise.addIntegration({
			type: IntegrationType.GitHubActions,
			name: 'CI',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: { token: 'test' }
		});

		enterprise.removeIntegration(id);
		assert.strictEqual(enterprise.getIntegration(id), undefined);
	});

	test('integration status change event fires', () => {
		const enterprise = createEnterprise();
		let eventCount = 0;
		enterprise.onIntegrationStatusChanged(() => eventCount++);

		enterprise.addIntegration({
			type: IntegrationType.GitHub,
			name: 'GitHub',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: {}
		});

		assert.ok(eventCount >= 1, 'Should fire status change event');
	});

	test('tests GitHub integration', async () => {
		const enterprise = createEnterprise();
		const id = enterprise.addIntegration({
			type: IntegrationType.GitHub,
			name: 'GitHub',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: { token: 'test-token' }
		});

		const result = await enterprise.testIntegration(id);
		assert.strictEqual(result, true, 'Should pass with token');
	});

	test('tests GitHub integration without token', async () => {
		const enterprise = createEnterprise();
		const id = enterprise.addIntegration({
			type: IntegrationType.GitHub,
			name: 'GitHub',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: {}
		});

		const result = await enterprise.testIntegration(id);
		assert.strictEqual(result, false, 'Should fail without token');
	});

	test('tests Jira integration', async () => {
		const enterprise = createEnterprise();
		const id = enterprise.addIntegration({
			type: IntegrationType.Jira,
			name: 'Jira',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: { baseUrl: 'https://jira.example.com', apiToken: 'test' }
		});

		const result = await enterprise.testIntegration(id);
		assert.strictEqual(result, true, 'Should pass with credentials');
	});

	test('tests Slack integration', async () => {
		const enterprise = createEnterprise();
		const id = enterprise.addIntegration({
			type: IntegrationType.Slack,
			name: 'Slack',
			enabled: true,
			status: IntegrationStatus.Connected,
			settings: { botToken: 'test-token' }
		});

		const result = await enterprise.testIntegration(id);
		assert.strictEqual(result, true, 'Should pass with token');
	});

	test('syncs with GitHub', async () => {
		const enterprise = createEnterprise();
		const syncResult = await enterprise.syncWithGitHub({
			prNumber: 42,
			title: 'Test PR',
			description: 'Test description',
			files: [],
			diff: 'test diff',
			author: 'dev',
			baseBranch: 'main',
			headBranch: 'feature',
			labels: []
		}, {
			token: 'test',
			owner: 'test-owner',
			repo: 'test-repo'
		});

		assert.ok(syncResult.syncId, 'Should have sync id');
		assert.ok(['success', 'partial', 'failed'].includes(syncResult.status), 'Should have valid status');
	});

	test('syncs with Jira', async () => {
		const enterprise = createEnterprise();
		const syncResult = await enterprise.syncWithJira({
			key: 'PROJ-123',
			summary: 'Test issue',
			description: 'Test description',
			status: 'Open',
			priority: 'High',
			labels: ['test']
		}, {
			baseUrl: 'https://jira.example.com',
			email: 'test@example.com',
			apiToken: 'test',
			projectKey: 'PROJ'
		});

		assert.ok(syncResult.syncId, 'Should have sync id');
	});

	test('sends Slack notification', async () => {
		const enterprise = createEnterprise();
		const syncResult = await enterprise.sendSlackNotification({
			channelId: 'C123',
			text: 'Test notification'
		}, {
			botToken: 'test',
			channelId: 'C123'
		});

		assert.ok(syncResult.syncId, 'Should have sync id');
	});

	test('triggers GitHub Action', async () => {
		const enterprise = createEnterprise();
		const syncResult = await enterprise.triggerGitHubAction({
			workflow: 'ci.yml',
			ref: 'main',
			inputs: {}
		}, {
			owner: 'test',
			repo: 'test',
			token: 'test'
		});

		assert.ok(syncResult.syncId, 'Should have sync id');
	});

	test('auto reviews PR', async () => {
		const enterprise = createEnterprise();
		const result = await enterprise.autoReviewPR({
			prNumber: 42,
			title: 'Test PR',
			description: 'Test',
			files: [],
			diff: 'test',
			author: 'dev',
			baseBranch: 'main',
			headBranch: 'feature',
			labels: []
		}, {
			token: 'test',
			owner: 'test',
			repo: 'test'
		});

		assert.ok(result.review, 'Should have review');
		assert.ok(result.sync, 'Should have sync');
	});

	test('creates Jira issue from review', async () => {
		const enterprise = createEnterprise();
		const syncResult = await enterprise.createJiraIssueFromReview({
			reviewId: 'test',
			prNumber: 42,
			verdict: ReviewVerdict.RequestChanges,
			score: 0.6,
			summary: 'Needs changes',
			comments: [],
			policyViolations: [],
			securityFindings: [],
			performanceIssues: [],
			testCoverageEstimate: 0.5,
			councilResult: {
				sessionId: 'mock',
				finalResponse: 'OK',
				contributions: new Map(),
				debateRecords: [],
				confidence: 0.8,
				executionTimeMs: 3000,
				status: 'success'
			},
			reviewedAt: Date.now(),
			executionTimeMs: 3000
		}, {
			baseUrl: 'https://jira.example.com',
			email: 'test@example.com',
			apiToken: 'test',
			projectKey: 'PROJ'
		});

		assert.ok(syncResult.syncId, 'Should have sync id');
	});

	test('posts review to Slack', async () => {
		const enterprise = createEnterprise();
		const syncResult = await enterprise.postReviewToSlack({
			reviewId: 'test',
			prNumber: 42,
			verdict: ReviewVerdict.Approve,
			score: 0.9,
			summary: 'Looks good',
			comments: [],
			policyViolations: [],
			securityFindings: [],
			performanceIssues: [],
			testCoverageEstimate: 0.8,
			councilResult: {
				sessionId: 'mock',
				finalResponse: 'OK',
				contributions: new Map(),
				debateRecords: [],
				confidence: 0.8,
				executionTimeMs: 3000,
				status: 'success'
			},
			reviewedAt: Date.now(),
			executionTimeMs: 3000
		}, {
			botToken: 'test',
			channelId: 'C123'
		});

		assert.ok(syncResult.syncId, 'Should have sync id');
	});

	test('tracks sync history', async () => {
		const enterprise = createEnterprise();
		await enterprise.syncWithGitHub({
			prNumber: 42,
			title: 'Test',
			description: 'Test',
			files: [],
			diff: 'test',
			author: 'dev',
			baseBranch: 'main',
			headBranch: 'feature',
			labels: []
		}, { token: 'test', owner: 'test', repo: 'test' });

		await enterprise.syncWithJira({
			key: 'PROJ-1',
			summary: 'Test',
			description: 'Test',
			status: 'Open',
			priority: 'High',
			labels: []
		}, { baseUrl: 'https://jira.example.com', email: 'test@test.com', apiToken: 'test', projectKey: 'PROJ' });

		const allHistory = enterprise.getSyncHistory();
		assert.ok(allHistory.length >= 2, 'Should have sync history');

		const githubHistory = enterprise.getSyncHistory('github');
		assert.ok(githubHistory.length >= 1, 'Should have GitHub sync history');
	});

	test('sync completed event fires', async () => {
		const enterprise = createEnterprise();
		let eventCount = 0;
		enterprise.onSyncCompleted(() => eventCount++);

		await enterprise.syncWithGitHub({
			prNumber: 42,
			title: 'Test',
			description: 'Test',
			files: [],
			diff: 'test',
			author: 'dev',
			baseBranch: 'main',
			headBranch: 'feature',
			labels: []
		}, { token: 'test', owner: 'test', repo: 'test' });

		assert.ok(eventCount >= 1, 'Should fire sync completed event');
	});
});
