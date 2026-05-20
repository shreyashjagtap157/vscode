/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

export const IRedTeamAgent = createDecorator<IRedTeamAgent>('redTeamAgent');

export enum VulnerabilitySeverity {
	Critical = 'critical',
	High = 'high',
	Medium = 'medium',
	Low = 'low',
	Info = 'info'
}

export enum VulnerabilityCategory {
	Injection = 'injection',
	Authentication = 'authentication',
	Authorization = 'authorization',
	DataExposure = 'data_exposure',
	Misconfiguration = 'misconfiguration',
	XSS = 'xss',
	CSRF = 'csrf',
	SSRF = 'ssrf',
	RCE = 'rce',
	DoS = 'dos',
	Dependency = 'dependency',
	Logic = 'logic'
}

export interface Vulnerability {
	id: string;
	title: string;
	description: string;
	severity: VulnerabilitySeverity;
	category: VulnerabilityCategory;
	affectedCode?: string;
	reproductionSteps?: string[];
	recommendation: string;
	cweId?: string;
	cvssScore?: number;
	evidence?: string;
}

export interface RedTeamReport {
	reportId: string;
	sessionId: string;
	timestamp: number;
	vulnerabilities: Vulnerability[];
	riskScore: number;
	summary: string;
	recommendations: string[];
	attackVectors: string[];
	complianceIssues: string[];
}

export interface AttackSimulation {
	id: string;
	type: string;
	description: string;
	success: boolean;
	findings: string[];
	timestamp: number;
}

export interface IRedTeamAgent extends IDisposable {
	readonly _serviceBrand: undefined;

	runSecurityReview(proposal: string, sessionId: string, token?: CancellationToken): Promise<RedTeamReport>;
	simulateAttack(proposal: string, attackType: string, token?: CancellationToken): Promise<AttackSimulation>;
	checkOWASPTop10(proposal: string): Promise<Vulnerability[]>;
	checkDependencyRisks(proposal: string): Vulnerability[];
	calculateRiskScore(vulnerabilities: Vulnerability[]): number;
}

export class RedTeamAgent extends Disposable implements IRedTeamAgent {
	declare readonly _serviceBrand: undefined;

	private readonly severityScores: Record<VulnerabilitySeverity, number> = {
		[VulnerabilitySeverity.Critical]: 10,
		[VulnerabilitySeverity.High]: 7,
		[VulnerabilitySeverity.Medium]: 4,
		[VulnerabilitySeverity.Low]: 2,
		[VulnerabilitySeverity.Info]: 1
	};

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.logService.info('[RedTeamAgent] Initialized');
	}

	public async runSecurityReview(
		proposal: string,
		sessionId: string,
		token: CancellationToken = CancellationToken.None
	): Promise<RedTeamReport> {
		this.logService.info('[RedTeamAgent] Starting security review');

		const vulnerabilities: Vulnerability[] = [];

		vulnerabilities.push(...await this.checkOWASPTop10(proposal));
		vulnerabilities.push(...this.checkDependencyRisks(proposal));
		vulnerabilities.push(...this.checkAuthenticationFlaws(proposal));
		vulnerabilities.push(...this.checkAuthorizationIssues(proposal));
		vulnerabilities.push(...this.checkDataExposure(proposal));
		vulnerabilities.push(...this.checkInjectionVectors(proposal));
		vulnerabilities.push(...this.checkMisconfigurations(proposal));

		const riskScore = this.calculateRiskScore(vulnerabilities);
		const attackVectors = this.identifyAttackVectors(vulnerabilities);
		const complianceIssues = this.checkCompliance(vulnerabilities);
		const recommendations = this.generateRecommendations(vulnerabilities);

		const report: RedTeamReport = {
			reportId: generateUuid(),
			sessionId,
			timestamp: Date.now(),
			vulnerabilities,
			riskScore,
			summary: this.generateSummary(vulnerabilities, riskScore),
			recommendations,
			attackVectors,
			complianceIssues
		};

		this.logService.info(`[RedTeamAgent] Review complete: ${vulnerabilities.length} vulnerabilities found, risk score: ${riskScore}`);

		return report;
	}

	public async simulateAttack(
		proposal: string,
		attackType: string,
		token: CancellationToken = CancellationToken.None
	): Promise<AttackSimulation> {
		const findings: string[] = [];
		let success = false;

		switch (attackType.toLowerCase()) {
			case 'sql_injection':
				const sqlVulns = this.checkSQLInjection(proposal);
				if (sqlVulns.length > 0) {
					success = true;
					findings.push('SQL injection vulnerability detected');
					findings.push(...sqlVulns.map(v => v.description));
				}
				break;

			case 'xss':
				const xssVulns = this.checkXSS(proposal);
				if (xssVulns.length > 0) {
					success = true;
					findings.push('Cross-site scripting vulnerability detected');
					findings.push(...xssVulns.map(v => v.description));
				}
				break;

			case 'auth_bypass':
				const authVulns = this.checkAuthenticationFlaws(proposal);
				if (authVulns.length > 0) {
					success = true;
					findings.push('Authentication bypass possible');
					findings.push(...authVulns.map(v => v.description));
				}
				break;

			case 'privilege_escalation':
				const privVulns = this.checkAuthorizationIssues(proposal);
				if (privVulns.length > 0) {
					success = true;
					findings.push('Privilege escalation detected');
					findings.push(...privVulns.map(v => v.description));
				}
				break;
		}

		return {
			id: generateUuid(),
			type: attackType,
			description: `Simulated ${attackType} attack`,
			success,
			findings,
			timestamp: Date.now()
		};
	}

	public async checkOWASPTop10(proposal: string): Promise<Vulnerability[]> {
		const vulnerabilities: Vulnerability[] = [];

		vulnerabilities.push(...this.checkBrokenAccessControl(proposal));
		vulnerabilities.push(...this.checkCryptographicFailures(proposal));
		vulnerabilities.push(...this.checkInjection(proposal));
		vulnerabilities.push(...this.checkInsecureDesign(proposal));
		vulnerabilities.push(...this.checkSecurityMisconfiguration(proposal));
		vulnerabilities.push(...this.checkVulnerableComponents(proposal));
		vulnerabilities.push(...this.checkAuthenticationFailures(proposal));
		vulnerabilities.push(...this.checkDataIntegrity(proposal));
		vulnerabilities.push(...this.checkLoggingMonitoring(proposal));
		vulnerabilities.push(...this.checkSSRF(proposal));

		return vulnerabilities;
	}

	public checkDependencyRisks(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];

		const dependencyPatterns = [
			{ pattern: /npm\s+install\s+([^\s]+)/gi, type: 'npm' },
			{ pattern: /pip\s+install\s+([^\s]+)/gi, type: 'pip' },
			{ pattern: /gem\s+install\s+([^\s]+)/gi, type: 'gem' },
			{ pattern: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gi, type: 'require' }
		];

		const dependencies: string[] = [];
		for (const { pattern } of dependencyPatterns) {
			let match;
			while ((match = pattern.exec(proposal)) !== null) {
				dependencies.push(match[1]);
			}
		}

		for (const dep of dependencies) {
			if (dep.includes('http://') || dep.includes('git://')) {
				vulnerabilities.push({
					id: generateUuid(),
					title: 'Insecure Dependency Source',
					description: `Dependency '${dep}' is fetched from an insecure source (HTTP/Git). Use HTTPS or verified package registries.`,
					severity: VulnerabilitySeverity.High,
					category: VulnerabilityCategory.Dependency,
					recommendation: 'Use HTTPS sources or verified package registries for dependencies.',
					evidence: dep
				});
			}
		}

		return vulnerabilities;
	}

	public calculateRiskScore(vulnerabilities: Vulnerability[]): number {
		if (vulnerabilities.length === 0) {
			return 0;
		}

		let totalScore = 0;
		for (const vuln of vulnerabilities) {
			totalScore += this.severityScores[vuln.severity];
		}

		const rawScore = totalScore / vulnerabilities.length;
		return Math.min(Math.round(rawScore * 10) / 10, 10);
	}

	private checkSQLInjection(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];
		const sqlPatterns = [
			{ pattern: /SELECT\s+.*\s+FROM\s+.*\s+WHERE\s+.*\+\s*/gi, desc: 'String concatenation in SQL query' },
			{ pattern: /INSERT\s+INTO\s+.*\s+VALUES\s*\(\s*.*\+\s*/gi, desc: 'String concatenation in SQL insert' },
			{ pattern: /UPDATE\s+.*\s+SET\s+.*\s+WHERE\s+.*\+\s*/gi, desc: 'String concatenation in SQL update' },
			{ pattern: /DELETE\s+FROM\s+.*\s+WHERE\s+.*\+\s*/gi, desc: 'String concatenation in SQL delete' },
			{ pattern: /execute\s*\(\s*['"`].*SELECT/gi, desc: 'Dynamic SQL execution' },
			{ pattern: /exec\s*\(\s*['"`].*SELECT/gi, desc: 'Dynamic SQL execution via exec' }
		];

		for (const { pattern, desc } of sqlPatterns) {
			if (pattern.test(proposal)) {
				vulnerabilities.push({
					id: generateUuid(),
					title: 'SQL Injection Vulnerability',
					description: desc,
					severity: VulnerabilitySeverity.Critical,
					category: VulnerabilityCategory.Injection,
					recommendation: 'Use parameterized queries or prepared statements instead of string concatenation.',
					cweId: 'CWE-89',
					cvssScore: 9.8
				});
			}
		}

		return vulnerabilities;
	}

	private checkXSS(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];
		const xssPatterns = [
			{ pattern: /innerHTML\s*=/gi, desc: 'Direct innerHTML assignment' },
			{ pattern: /document\.write\s*\(/gi, desc: 'document.write usage' },
			{ pattern: /eval\s*\(/gi, desc: 'eval() usage' },
			{ pattern: /setTimeout\s*\(\s*['"`]/gi, desc: 'setTimeout with string argument' },
			{ pattern: /setInterval\s*\(\s*['"`]/gi, desc: 'setInterval with string argument' }
		];

		for (const { pattern, desc } of xssPatterns) {
			if (pattern.test(proposal)) {
				vulnerabilities.push({
					id: generateUuid(),
					title: 'Cross-Site Scripting (XSS) Risk',
					description: desc,
					severity: VulnerabilitySeverity.High,
					category: VulnerabilityCategory.XSS,
					recommendation: 'Use safe DOM manipulation methods and sanitize user input.',
					cweId: 'CWE-79',
					cvssScore: 7.5
				});
			}
		}

		return vulnerabilities;
	}

	private checkAuthenticationFlaws(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];

		if (/password\s*=\s*['"][^'"]{1,7}['"]/gi.test(proposal)) {
			vulnerabilities.push({
				id: generateUuid(),
				title: 'Weak Password Policy',
				description: 'Password policy appears to allow weak passwords (less than 8 characters).',
				severity: VulnerabilitySeverity.High,
				category: VulnerabilityCategory.Authentication,
				recommendation: 'Enforce strong password policies with minimum length, complexity, and rotation requirements.',
				cweId: 'CWE-521'
			});
		}

		if (/jwt.*verify|verify.*jwt/gi.test(proposal) && !/algorithm|alg/gi.test(proposal)) {
			vulnerabilities.push({
				id: generateUuid(),
				title: 'JWT Algorithm Confusion',
				description: 'JWT verification does not explicitly specify allowed algorithms.',
				severity: VulnerabilitySeverity.Critical,
				category: VulnerabilityCategory.Authentication,
				recommendation: 'Explicitly specify allowed JWT algorithms during verification.',
				cweId: 'CWE-345',
				cvssScore: 9.1
			});
		}

		return vulnerabilities;
	}

	private checkAuthorizationIssues(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];

		if (/admin|root|superuser/gi.test(proposal) && !/role.*check|authorize|permission/gi.test(proposal)) {
			vulnerabilities.push({
				id: generateUuid(),
				title: 'Missing Authorization Check',
				description: 'Admin/root functionality detected without explicit authorization checks.',
				severity: VulnerabilitySeverity.High,
				category: VulnerabilityCategory.Authorization,
				recommendation: 'Implement role-based access control (RBAC) for all privileged operations.',
				cweId: 'CWE-285'
			});
		}

		return vulnerabilities;
	}

	private checkDataExposure(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];

		const sensitivePatterns = [
			{ pattern: /console\.log\s*\(.*password|console\.log\s*\(.*secret|console\.log\s*\(.*token/gi, desc: 'Sensitive data logged to console' },
			{ pattern: /api[_-]?key|secret[_-]?key|access[_-]?token/gi, desc: 'Hardcoded API keys or secrets' }
		];

		for (const { pattern, desc } of sensitivePatterns) {
			if (pattern.test(proposal)) {
				vulnerabilities.push({
					id: generateUuid(),
					title: 'Sensitive Data Exposure',
					description: desc,
					severity: VulnerabilitySeverity.High,
					category: VulnerabilityCategory.DataExposure,
					recommendation: 'Never log or hardcode sensitive data. Use environment variables and secret management.',
					cweId: 'CWE-200'
				});
			}
		}

		return vulnerabilities;
	}

	private checkInjectionVectors(proposal: string): Vulnerability[] {
		return [...this.checkSQLInjection(proposal)];
	}

	private checkMisconfigurations(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];

		if (/cors.*\*|Access-Control-Allow-Origin:\s*\*/gi.test(proposal)) {
			vulnerabilities.push({
				id: generateUuid(),
				title: 'Overly Permissive CORS',
				description: 'CORS policy allows all origins (wildcard *).',
				severity: VulnerabilitySeverity.Medium,
				category: VulnerabilityCategory.Misconfiguration,
				recommendation: 'Restrict CORS to specific trusted origins.',
				cweId: 'CWE-942'
			});
		}

		if (/debug\s*[:=]\s*true|DEBUG\s*=\s*true/gi.test(proposal)) {
			vulnerabilities.push({
				id: generateUuid(),
				title: 'Debug Mode Enabled',
				description: 'Debug mode is enabled in configuration.',
				severity: VulnerabilitySeverity.Medium,
				category: VulnerabilityCategory.Misconfiguration,
				recommendation: 'Disable debug mode in production environments.',
				cweId: 'CWE-489'
			});
		}

		return vulnerabilities;
	}

	private checkBrokenAccessControl(proposal: string): Vulnerability[] {
		return this.checkAuthorizationIssues(proposal);
	}

	private checkCryptographicFailures(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];

		if (/md5|sha1(?!256|384|512)|des(?!ede)|rc4/gi.test(proposal)) {
			vulnerabilities.push({
				id: generateUuid(),
				title: 'Weak Cryptographic Algorithm',
				description: 'Use of deprecated or weak cryptographic algorithm detected.',
				severity: VulnerabilitySeverity.High,
				category: VulnerabilityCategory.Authentication,
				recommendation: 'Use strong cryptographic algorithms (AES-256, SHA-256+, RSA-2048+).',
				cweId: 'CWE-327'
			});
		}

		return vulnerabilities;
	}

	private checkInjection(proposal: string): Vulnerability[] {
		return [...this.checkSQLInjection(proposal), ...this.checkXSS(proposal)];
	}

	private checkInsecureDesign(proposal: string): Vulnerability[] {
		return [];
	}

	private checkSecurityMisconfiguration(proposal: string): Vulnerability[] {
		return this.checkMisconfigurations(proposal);
	}

	private checkVulnerableComponents(proposal: string): Vulnerability[] {
		return this.checkDependencyRisks(proposal);
	}

	private checkAuthenticationFailures(proposal: string): Vulnerability[] {
		return this.checkAuthenticationFlaws(proposal);
	}

	private checkDataIntegrity(proposal: string): Vulnerability[] {
		return [];
	}

	private checkLoggingMonitoring(proposal: string): Vulnerability[] {
		return this.checkDataExposure(proposal);
	}

	private checkSSRF(proposal: string): Vulnerability[] {
		const vulnerabilities: Vulnerability[] = [];

		if (/fetch\s*\(\s*req|http\.get\s*\(\s*req|axios\.get\s*\(\s*req/gi.test(proposal)) {
			if (!/whitelist|allowlist|validate.*url|sanitize.*url/gi.test(proposal)) {
				vulnerabilities.push({
					id: generateUuid(),
					title: 'Server-Side Request Forgery (SSRF) Risk',
					description: 'External URL fetch without validation or allowlisting.',
					severity: VulnerabilitySeverity.High,
					category: VulnerabilityCategory.SSRF,
					recommendation: 'Validate and allowlist URLs before making external requests.',
					cweId: 'CWE-918',
					cvssScore: 8.6
				});
			}
		}

		return vulnerabilities;
	}

	private identifyAttackVectors(vulnerabilities: Vulnerability[]): string[] {
		const vectors: string[] = [];

		const categories = new Set(vulnerabilities.map(v => v.category));
		for (const category of categories) {
			switch (category) {
				case VulnerabilityCategory.Injection:
					vectors.push('Inject malicious SQL/OS commands through user input');
					break;
				case VulnerabilityCategory.Authentication:
					vectors.push('Bypass authentication using weak credentials or token manipulation');
					break;
				case VulnerabilityCategory.Authorization:
					vectors.push('Escalate privileges by manipulating role/permission checks');
					break;
				case VulnerabilityCategory.DataExposure:
					vectors.push('Extract sensitive data from logs or hardcoded values');
					break;
				case VulnerabilityCategory.XSS:
					vectors.push('Execute malicious scripts in user browsers');
					break;
				case VulnerabilityCategory.SSRF:
					vectors.push('Force server to make requests to internal resources');
					break;
			}
		}

		return vectors;
	}

	private checkCompliance(vulnerabilities: Vulnerability[]): string[] {
		const issues: string[] = [];

		const criticalCount = vulnerabilities.filter(v => v.severity === VulnerabilitySeverity.Critical).length;
		const highCount = vulnerabilities.filter(v => v.severity === VulnerabilitySeverity.High).length;

		if (criticalCount > 0) {
			issues.push(`Fails security compliance: ${criticalCount} critical vulnerabilities found`);
		}
		if (highCount > 3) {
			issues.push(`Fails security compliance: ${highCount} high-severity vulnerabilities found`);
		}

		const hasAuthIssues = vulnerabilities.some(v =>
			v.category === VulnerabilityCategory.Authentication ||
			v.category === VulnerabilityCategory.Authorization
		);
		if (hasAuthIssues) {
			issues.push('Fails authentication compliance: Auth/authorization vulnerabilities detected');
		}

		const hasDataIssues = vulnerabilities.some(v =>
			v.category === VulnerabilityCategory.DataExposure
		);
		if (hasDataIssues) {
			issues.push('Fails data protection compliance: Sensitive data exposure detected');
		}

		return issues;
	}

	private generateRecommendations(vulnerabilities: Vulnerability[]): string[] {
		const recommendations = new Set<string>();

		for (const vuln of vulnerabilities) {
			recommendations.add(vuln.recommendation);
		}

		if (vulnerabilities.some(v => v.severity === VulnerabilitySeverity.Critical)) {
			recommendations.add('URGENT: Address all critical vulnerabilities before deployment');
		}

		recommendations.add('Implement automated security scanning in CI/CD pipeline');
		recommendations.add('Conduct regular security audits and penetration testing');

		return Array.from(recommendations);
	}

	private generateSummary(vulnerabilities: Vulnerability[], riskScore: number): string {
		const critical = vulnerabilities.filter(v => v.severity === VulnerabilitySeverity.Critical).length;
		const high = vulnerabilities.filter(v => v.severity === VulnerabilitySeverity.High).length;
		const medium = vulnerabilities.filter(v => v.severity === VulnerabilitySeverity.Medium).length;
		const low = vulnerabilities.filter(v => v.severity === VulnerabilitySeverity.Low).length;

		return `Security review completed. Risk Score: ${riskScore}/10. Found ${vulnerabilities.length} vulnerabilities: ${critical} critical, ${high} high, ${medium} medium, ${low} low.`;
	}
}
