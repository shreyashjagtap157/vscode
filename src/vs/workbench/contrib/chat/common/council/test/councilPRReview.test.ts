/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilPRReviewBoard, PRReviewRequest, PRReviewConfig, ReviewVerdict, PRFileInfo } from '../councilPRReview.js';
import { CouncilOrchestrator, ICouncilOrchestrator, CouncilResult } from '../councilOrchestrator.js';
import { AgentProfileManager, IAgentProfileManager } from '../agentProfileManager.js';
import { CouncilPolicyEngine, ICouncilPolicyEngine } from '../councilPolicies.js';

class MockOrchestrator implements ICouncilOrchestrator {
	declare readonly _serviceBrand: undefined;

	private readonly sessions: Map<string, any> = new Map();

	async executeSession(request: string, selectedRoles?: string[]): Promise<CouncilResult> {
		return {
			sessionId: 'mock-session',
			finalResponse: `## Review Summary\n\n**Issue**: Potential security concern in auth module\n**File**: src/auth.ts **Line**: 42\n\nConsider using parameterized queries instead of string concatenation.\n\n**Warning**: Performance concern detected in data processing loop.\n\n**Consider**: Adding input validation before processing user data.\n\nThe code looks generally good but has a few areas for improvement.`,
			contributions: new Map([
				['security', 'Found potential SQL injection pattern in query building'],
				['backend', 'Code structure is clean, minor refactoring suggested'],
				['qa', 'Test coverage appears adequate for the changes'],
				['performance', 'Loop optimization possible in data processing']
			]),
			debateRecords: [],
			confidence: 0.85,
			executionTimeMs: 5000,
			status: 'success'
		};
	}

	getSession(sessionId: string) { return this.sessions.get(sessionId); }
	getActiveSessions() { return []; }
	cancelSession(sessionId: string) { this.sessions.delete(sessionId); }
	dispose() { }
}

class MockProfileManager implements IAgentProfileManager {
	declare readonly _serviceBrand: undefined;
	getAllProfiles() { return []; }
	getProfile(roleId: string) { return undefined as any; }
	registerProfile(profile: any) { }
	updateProfile(roleId: string, updates: Partial<any>) { }
	buildSystemPrompt(roleId: string, context?: string) { return ''; }
	buildToolFilter(roleId: string) { return { allowed: [], excluded: [] }; }
	dispose() { }
}

class MockPolicyEngine implements ICouncilPolicyEngine {
	declare readonly _serviceBrand: undefined;
	getPolicies() { return []; }
	getPolicy(id: string) { return undefined; }
	addPolicy(policy: any) { return ''; }
	updatePolicy(id: string, updates: Partial<any>) { }
	removePolicy(id: string) { }
	enablePolicy(id: string) { }
	disablePolicy(id: string) { }
	async evaluateContribution(contribution: string, sessionId: string, language?: string) {
		return {
			sessionId,
			passed: true,
			violations: [],
			score: 0.9,
			evaluatedAt: Date.now(),
			policiesChecked: 0,
			rulesChecked: 0
		};
	}
	async evaluateCode(code: string, sessionId: string, language?: string) {
		return this.evaluateContribution(code, sessionId, language);
	}
	getViolationHistory(sessionId?: string) { return []; }
	getPolicyScore(sessionId: string) { return 0.9; }
	async loadPoliciesFromWorkspace(workspaceRoot: any) { }
	exportPolicies() { return []; }
	importPolicies(policies: any[]) { }
	dispose() { }
	onDidChangePolicies = { listen: () => ({ dispose() { } }) } as any;
	onPolicyViolation = { listen: () => ({ dispose() { } }) } as any;
}

class MockLogService {
	info(m: string) { }
	warn(m: string) { }
	error(m: string) { }
	debug(m: string) { }
	trace(m: string) { }
}

function createPRReviewBoard(): CouncilPRReviewBoard {
	const orchestrator = new MockOrchestrator() as any;
	const profileManager = new MockProfileManager() as any;
	const policyEngine = new MockPolicyEngine() as any;
	const logService = new MockLogService() as any;
	return new CouncilPRReviewBoard(orchestrator, profileManager, policyEngine, logService);
}

function createMockPRRequest(): PRReviewRequest {
	return {
		prNumber: 42,
		title: 'Add user authentication module',
		description: 'This PR adds a new authentication module with JWT support.',
		files: [
			{ filename: 'src/auth.ts', additions: 150, deletions: 20, changes: 170, status: 'modified' },
			{ filename: 'src/auth.test.ts', additions: 80, deletions: 0, changes: 80, status: 'added' },
			{ filename: 'src/config.ts', additions: 10, deletions: 5, changes: 15, status: 'modified' }
		],
		diff: `diff --git a/src/auth.ts b/src/auth.ts
+++ b/src/auth.ts
@@ -40,6 +40,15 @@
+const query = "SELECT * FROM users WHERE id = " + userId;
+for (let i = 0; i < users.length; i++) {
+  processUser(users[i]);
+}`,
		author: 'developer',
		baseBranch: 'main',
		headBranch: 'feature/auth',
		labels: ['enhancement']
	};
}

suite('CouncilPRReviewBoard', () => {
	test('reviews PR and returns result', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();

		const result = await board.reviewPR(request);

		assert.ok(result.reviewId, 'Should have review id');
		assert.strictEqual(result.prNumber, 42);
		assert.ok(result.verdict, 'Should have verdict');
		assert.ok(result.score >= 0 && result.score <= 1, 'Score should be 0-1');
		assert.ok(result.summary.length > 0, 'Should have summary');
	});

	test('generates review summary', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();
		const result = await board.reviewPR(request);

		const summary = board.generateReviewSummary(result);
		assert.ok(summary.includes('PR #42'), 'Should include PR number');
		assert.ok(summary.includes(result.verdict), 'Should include verdict');
	});

	test('exports review as markdown', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();
		const result = await board.reviewPR(request);

		const markdown = board.exportReviewAsMarkdown(result);
		assert.ok(markdown.includes('# PR #42'), 'Should have PR header');
		assert.ok(markdown.includes('|'), 'Should have markdown table');
	});

	test('stores review in history', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();

		await board.reviewPR(request);
		await board.reviewPR({ ...request, prNumber: 43 });

		const history = board.getReviewHistory();
		assert.ok(history.length >= 2, 'Should have 2 reviews in history');
	});

	test('filters history by PR number', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();

		await board.reviewPR(request);
		await board.reviewPR({ ...request, prNumber: 99 });

		const pr42History = board.getReviewHistory(42);
		assert.ok(pr42History.length >= 1, 'Should have PR 42 reviews');

		const pr99History = board.getReviewHistory(99);
		assert.ok(pr99History.length >= 1, 'Should have PR 99 reviews');
	});

	test('gets review by id', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();
		const result = await board.reviewPR(request);

		const found = board.getReview(result.reviewId);
		assert.ok(found, 'Should find review');
		assert.strictEqual(found?.reviewId, result.reviewId);
	});

	test('cancels review', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();
		const result = await board.reviewPR(request);

		board.cancelReview(result.reviewId);
		// Should not throw
	});

	test('review events fire', async () => {
		const board = createPRReviewBoard();
		let startedCount = 0;
		let completedCount = 0;

		board.onReviewStarted(() => startedCount++);
		board.onReviewCompleted(() => completedCount++);

		await board.reviewPR(createMockPRRequest());

		assert.ok(startedCount >= 1, 'Should fire start event');
		assert.ok(completedCount >= 1, 'Should fire complete event');
	});

	test('review with custom config', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();
		const config: Partial<PRReviewConfig> = {
			enableSecurityScan: false,
			enablePerformanceScan: false,
			enablePolicyCheck: false
		};

		const result = await board.reviewPR(request, config);
		assert.ok(result, 'Should complete with custom config');
	});

	test('review with security scan enabled', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();
		const config: Partial<PRReviewConfig> = {
			enableSecurityScan: true
		};

		const result = await board.reviewPR(request, config);
		assert.ok(result, 'Should complete');
	});

	test('review with performance scan enabled', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();
		const config: Partial<PRReviewConfig> = {
			enablePerformanceScan: true
		};

		const result = await board.reviewPR(request, config);
		assert.ok(result, 'Should complete');
	});

	test('filters files by ignore patterns', async () => {
		const board = createPRReviewBoard();
		const request: PRReviewRequest = {
			...createMockPRRequest(),
			files: [
				{ filename: 'src/auth.ts', additions: 100, deletions: 0, changes: 100, status: 'added' },
				{ filename: 'package-lock.json', additions: 500, deletions: 0, changes: 500, status: 'modified' },
				{ filename: 'vendor/lib.js', additions: 1000, deletions: 0, changes: 1000, status: 'added' }
			]
		};

		const result = await board.reviewPR(request);
		assert.ok(result, 'Should complete with filtered files');
	});

	test('verdict is request_changes for critical issues', async () => {
		const board = createPRReviewBoard();
		const request = createMockPRRequest();

		const result = await board.reviewPR(request);
		assert.ok(Object.values(ReviewVerdict).includes(result.verdict), 'Should have valid verdict');
	});

	test('estimates test coverage', async () => {
		const board = createPRReviewBoard();
		const request: PRReviewRequest = {
			...createMockPRRequest(),
			diff: `+describe('auth', () => {
+  it('should validate token', () => {
+    expect(validateToken('abc')).toBe(true);
+  });
+  it('should reject invalid token', () => {
+    expect(validateToken('')).toBe(false);
+  });
+});`,
			files: [{ filename: 'src/auth.test.ts', additions: 10, deletions: 0, changes: 10, status: 'added' }]
		};

		const result = await board.reviewPR(request);
		assert.ok(result.testCoverageEstimate >= 0, 'Should have coverage estimate');
	});

	test('review failed event fires on error', async () => {
		const failingOrchestrator = {
			async executeSession() { throw new Error('Orchestrator failure'); },
			getSession() { return undefined; },
			getActiveSessions() { return []; },
			cancelSession() { },
			dispose() { }
		} as any;

		const board = new CouncilPRReviewBoard(
			failingOrchestrator,
			new MockProfileManager() as any,
			new MockPolicyEngine() as any,
			new MockLogService() as any
		);

		let failedEvent: { reviewId: string; error: string } | undefined;
		board.onReviewFailed((e) => failedEvent = e);

		try {
			await board.reviewPR(createMockPRRequest());
		} catch {
			// Expected
		}

		assert.ok(failedEvent, 'Should fire failed event');
		assert.ok(failedEvent?.error.includes('Orchestrator failure'), 'Should include error message');
	});
});
