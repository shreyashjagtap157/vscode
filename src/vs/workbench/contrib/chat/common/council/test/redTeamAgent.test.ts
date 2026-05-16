/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { RedTeamAgent, VulnerabilitySeverity, VulnerabilityCategory } from '../redTeamAgent.js';

suite('RedTeamAgent - Phase 4', () => {

	test('detects SQL injection vulnerabilities', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			const query = "SELECT * FROM users WHERE id = " + userId;
			db.execute(query);
		`;
		const report = await agent.runSecurityReview(proposal, 'session-1');

		const sqlVulns = report.vulnerabilities.filter(v => v.category === VulnerabilityCategory.Injection);
		assert.ok(sqlVulns.length > 0);
		assert.ok(sqlVulns.some(v => v.severity === VulnerabilitySeverity.Critical));
	});

	test('detects XSS vulnerabilities', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			element.innerHTML = userInput;
			document.write(userInput);
		`;
		const report = await agent.runSecurityReview(proposal, 'session-2');

		const xssVulns = report.vulnerabilities.filter(v => v.category === VulnerabilityCategory.XSS);
		assert.ok(xssVulns.length > 0);
	});

	test('detects authentication flaws', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			const password = "admin";
			jwt.verify(token, secret);
		`;
		const report = await agent.runSecurityReview(proposal, 'session-3');

		const authVulns = report.vulnerabilities.filter(v => v.category === VulnerabilityCategory.Authentication);
		assert.ok(authVulns.length > 0);
	});

	test('detects sensitive data exposure', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			console.log("Password: " + password);
			const apiKey = "sk-1234567890";
		`;
		const report = await agent.runSecurityReview(proposal, 'session-4');

		const exposureVulns = report.vulnerabilities.filter(v => v.category === VulnerabilityCategory.DataExposure);
		assert.ok(exposureVulns.length > 0);
	});

	test('detects misconfigurations', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			app.use(cors({ origin: '*' }));
			const DEBUG = true;
		`;
		const report = await agent.runSecurityReview(proposal, 'session-5');

		const misconfigVulns = report.vulnerabilities.filter(v => v.category === VulnerabilityCategory.Misconfiguration);
		assert.ok(misconfigVulns.length > 0);
	});

	test('detects insecure dependency sources', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			npm install http://example.com/package.tar.gz
			pip install git://github.com/user/repo.git
		`;
		const report = await agent.runSecurityReview(proposal, 'session-6');

		const depVulns = report.vulnerabilities.filter(v => v.category === VulnerabilityCategory.Dependency);
		assert.ok(depVulns.length > 0);
	});

	test('calculates risk score correctly', () => {
		const agent = createTestRedTeam();
		
		const vulnerabilities = [
			{ id: '1', title: 'Critical', description: 'Critical vuln', severity: VulnerabilitySeverity.Critical, category: VulnerabilityCategory.Injection, recommendation: 'Fix it' },
			{ id: '2', title: 'High', description: 'High vuln', severity: VulnerabilitySeverity.High, category: VulnerabilityCategory.XSS, recommendation: 'Fix it' },
			{ id: '3', title: 'Medium', description: 'Medium vuln', severity: VulnerabilitySeverity.Medium, category: VulnerabilityCategory.Misconfiguration, recommendation: 'Fix it' }
		] as any[];

		const score = agent.calculateRiskScore(vulnerabilities);
		assert.ok(score > 0);
		assert.ok(score <= 10);
	});

	test('calculates risk score as zero for no vulnerabilities', () => {
		const agent = createTestRedTeam();
		const score = agent.calculateRiskScore([]);
		assert.strictEqual(score, 0);
	});

	test('identifies attack vectors', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			const query = "SELECT * FROM users WHERE id = " + userId;
			element.innerHTML = userInput;
		`;
		const report = await agent.runSecurityReview(proposal, 'session-7');

		assert.ok(report.attackVectors.length > 0);
		assert.ok(report.attackVectors.some(v => v.toLowerCase().includes('inject')));
	});

	test('checks compliance issues', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			const query = "SELECT * FROM users WHERE id = " + userId;
			const password = "admin";
			console.log("Secret: " + secret);
		`;
		const report = await agent.runSecurityReview(proposal, 'session-8');

		assert.ok(report.complianceIssues.length > 0);
	});

	test('generates recommendations', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			const query = "SELECT * FROM users WHERE id = " + userId;
		`;
		const report = await agent.runSecurityReview(proposal, 'session-9');

		assert.ok(report.recommendations.length > 0);
		assert.ok(report.recommendations.some(r => r.toLowerCase().includes('parameterized') || r.toLowerCase().includes('prepared')));
	});

	test('simulates SQL injection attack', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			const query = "SELECT * FROM users WHERE id = " + userId;
		`;
		const simulation = await agent.simulateAttack(proposal, 'sql_injection');

		assert.strictEqual(simulation.type, 'sql_injection');
		assert.ok(simulation.success);
		assert.ok(simulation.findings.length > 0);
	});

	test('simulates XSS attack', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			element.innerHTML = userInput;
		`;
		const simulation = await agent.simulateAttack(proposal, 'xss');

		assert.strictEqual(simulation.type, 'xss');
		assert.ok(simulation.success);
	});

	test('generates security report summary', async () => {
		const agent = createTestRedTeam();
		const proposal = `
			const query = "SELECT * FROM users WHERE id = " + userId;
			element.innerHTML = userInput;
			const password = "admin";
		`;
		const report = await agent.runSecurityReview(proposal, 'session-10');

		assert.ok(report.summary);
		assert.ok(report.summary.includes('Risk Score'));
		assert.ok(report.summary.includes('vulnerabilities'));
	});
});

function createTestRedTeam(): RedTeamAgent {
	const mockLogService = {
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {}
	};

	const mockOrchestrator = {
		executeSession: () => Promise.resolve({ status: 'success' })
	};

	const mockProfileManager = {
		getProfile: () => ({ roleId: 'security' }),
		getAllProfiles: () => []
	};

	const mockEvidenceValidator = {
		scoreEvidence: () => Promise.resolve({ confidenceScore: 0.5 })
	};

	return new RedTeamAgent(
		mockLogService as any,
		mockOrchestrator as any,
		mockProfileManager as any,
		mockEvidenceValidator as any
	);
}
