/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ICouncilOrchestrator, CouncilResult } from './councilOrchestrator.js';
import { IAgentProfileManager, CouncilAgentProfile } from './agentProfileManager.js';
import { ICouncilPolicyEngine, PolicyEvaluation, PolicyViolation } from './councilPolicies.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

export const ICouncilPRReviewBoard = createDecorator<ICouncilPRReviewBoard>('councilPRReviewBoard');

export enum PRReviewStatus {
	Pending = 'pending',
	InProgress = 'in_progress',
	Completed = 'completed',
	Failed = 'failed',
	Cancelled = 'cancelled'
}

export enum ReviewVerdict {
	Approve = 'approve',
	RequestChanges = 'request_changes',
	Comment = 'comment'
}

export interface PRFileInfo {
	readonly filename: string;
	readonly additions: number;
	readonly deletions: number;
	readonly changes: number;
	readonly status: 'added' | 'modified' | 'removed' | 'renamed';
	readonly patch?: string;
}

export interface PRReviewComment {
	readonly commentId: string;
	readonly file: string;
	readonly line?: number;
	readonly body: string;
	readonly severity: 'info' | 'warning' | 'error' | 'critical';
	readonly category: 'security' | 'quality' | 'style' | 'architecture' | 'performance' | 'testing' | 'documentation';
	readonly suggestion?: string;
	readonly roleId: string;
}

export interface PRReviewResult {
	readonly reviewId: string;
	readonly prNumber: number;
	readonly verdict: ReviewVerdict;
	readonly score: number;
	readonly summary: string;
	readonly comments: PRReviewComment[];
	readonly policyViolations: PolicyViolation[];
	readonly securityFindings: SecurityFinding[];
	readonly performanceIssues: PerformanceIssue[];
	readonly testCoverageEstimate: number;
	readonly councilResult: CouncilResult;
	readonly reviewedAt: number;
	readonly executionTimeMs: number;
}

export interface SecurityFinding {
	readonly findingId: string;
	readonly severity: 'low' | 'medium' | 'high' | 'critical';
	readonly title: string;
	readonly description: string;
	readonly file: string;
	readonly line?: number;
	readonly cweId?: string;
	readonly recommendation: string;
}

export interface PerformanceIssue {
	readonly issueId: string;
	readonly severity: 'info' | 'warning' | 'error';
	readonly title: string;
	readonly description: string;
	readonly file: string;
	readonly line?: number;
	readonly impact: 'minor' | 'moderate' | 'significant';
	readonly recommendation: string;
}

export interface PRReviewConfig {
	readonly roles: string[];
	readonly enableSecurityScan: boolean;
	readonly enablePerformanceScan: boolean;
	readonly enablePolicyCheck: boolean;
	readonly autoApproveThreshold: number;
	readonly maxCommentsPerFile: number;
	readonly ignorePatterns: string[];
}

export interface PRReviewRequest {
	readonly prNumber: number;
	readonly title: string;
	readonly description: string;
	readonly files: PRFileInfo[];
	readonly diff: string;
	readonly author: string;
	readonly baseBranch: string;
	readonly headBranch: string;
	readonly labels: string[];
}

export interface ICouncilPRReviewBoard extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onReviewStarted: Event<string>;
	readonly onReviewCompleted: Event<PRReviewResult>;
	readonly onReviewFailed: Event<{ reviewId: string; error: string }>;

	reviewPR(request: PRReviewRequest, config?: Partial<PRReviewConfig>): Promise<PRReviewResult>;
	getReviewHistory(prNumber?: number): PRReviewResult[];
	getReview(reviewId: string): PRReviewResult | undefined;
	cancelReview(reviewId: string): void;

	generateReviewSummary(result: PRReviewResult): string;
	exportReviewAsMarkdown(result: PRReviewResult): string;
}

const DEFAULT_REVIEW_CONFIG: PRReviewConfig = {
	roles: ['security', 'backend', 'qa', 'performance'],
	enableSecurityScan: true,
	enablePerformanceScan: true,
	enablePolicyCheck: true,
	autoApproveThreshold: 0.85,
	maxCommentsPerFile: 10,
	ignorePatterns: ['*.lock', '*.min.js', '*.min.css', 'vendor/**', 'node_modules/**']
};

export class CouncilPRReviewBoard extends Disposable implements ICouncilPRReviewBoard {
	declare readonly _serviceBrand: undefined;

	private readonly _onReviewStarted = this._register(new Emitter<string>());
	readonly onReviewStarted = this._onReviewStarted.event;

	private readonly _onReviewCompleted = this._register(new Emitter<PRReviewResult>());
	readonly onReviewCompleted = this._onReviewCompleted.event;

	private readonly _onReviewFailed = this._register(new Emitter<{ reviewId: string; error: string }>());
	readonly onReviewFailed = this._onReviewFailed.event;

	private readonly reviewHistory: PRReviewResult[];
	private readonly activeReviews: Map<string, boolean>;

	constructor(
		@ICouncilOrchestrator private readonly orchestrator: ICouncilOrchestrator,
		@IAgentProfileManager private readonly profileManager: IAgentProfileManager,
		@ICouncilPolicyEngine private readonly policyEngine: ICouncilPolicyEngine,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.reviewHistory = [];
		this.activeReviews = new Map();
	}

	public async reviewPR(
		request: PRReviewRequest,
		config?: Partial<PRReviewConfig>
	): Promise<PRReviewResult> {
		const reviewId = generateUuid();
		const finalConfig = { ...DEFAULT_REVIEW_CONFIG, ...config };
		const startTime = Date.now();

		this._onReviewStarted.fire(reviewId);
		this.activeReviews.set(reviewId, true);

		this.logService.info(`[Council PR Review] Starting review #${request.prNumber} (review: ${reviewId})`);

		try {
			const filteredFiles = this.filterFiles(request.files, finalConfig.ignorePatterns);
			const filteredDiff = this.buildFilteredDiff(request.diff, filteredFiles);

			const reviewPrompt = this.buildReviewPrompt(request, filteredFiles);

			const councilResult = await this.orchestrator.executeSession(
				reviewPrompt,
				finalConfig.roles
			);

			const comments = this.parseReviewComments(councilResult, filteredFiles, finalConfig);
			const securityFindings = finalConfig.enableSecurityScan
				? this.analyzeSecurity(filteredDiff, filteredFiles)
				: [];
			const performanceIssues = finalConfig.enablePerformanceScan
				? this.analyzePerformance(filteredDiff, filteredFiles)
				: [];

			let policyViolations: PolicyViolation[] = [];
			if (finalConfig.enablePolicyCheck) {
				const policyEval = await this.policyEngine.evaluateContribution(filteredDiff, reviewId);
				policyViolations = policyEval.violations;
			}

			const verdict = this.calculateVerdict(comments, securityFindings, policyViolations, councilResult.confidence, finalConfig);
			const score = this.calculateScore(comments, securityFindings, policyViolations, councilResult.confidence);

			const result: PRReviewResult = {
				reviewId,
				prNumber: request.prNumber,
				verdict,
				score,
				summary: this.generateSummary(verdict, comments, securityFindings, performanceIssues, policyViolations),
				comments,
				policyViolations,
				securityFindings,
				performanceIssues,
				testCoverageEstimate: this.estimateTestCoverage(request.diff),
				councilResult,
				reviewedAt: Date.now(),
				executionTimeMs: Date.now() - startTime
			};

			this.reviewHistory.push(result);
			this.activeReviews.delete(reviewId);
			this._onReviewCompleted.fire(result);

			this.logService.info(`[Council PR Review] Review completed: ${verdict} (score: ${score.toFixed(2)})`);
			return result;
		} catch (error) {
			this.activeReviews.delete(reviewId);
			const errorMessage = error instanceof Error ? error.message : String(error);
			this._onReviewFailed.fire({ reviewId, error: errorMessage });
			this.logService.error(`[Council PR Review] Review failed: ${errorMessage}`);
			throw error;
		}
	}

	public getReviewHistory(prNumber?: number): PRReviewResult[] {
		if (prNumber !== undefined) {
			return this.reviewHistory.filter(r => r.prNumber === prNumber);
		}
		return [...this.reviewHistory];
	}

	public getReview(reviewId: string): PRReviewResult | undefined {
		return this.reviewHistory.find(r => r.reviewId === reviewId);
	}

	public cancelReview(reviewId: string): void {
		this.activeReviews.delete(reviewId);
		this.logService.info(`[Council PR Review] Review cancelled: ${reviewId}`);
	}

	public generateReviewSummary(result: PRReviewResult): string {
		const lines: string[] = [];
		lines.push(`## PR #${result.prNumber} Review Summary`);
		lines.push('');
		lines.push(`**Verdict**: ${result.verdict}`);
		lines.push(`**Score**: ${(result.score * 100).toFixed(1)}%`);
		lines.push(`**Review Time**: ${(result.executionTimeMs / 1000).toFixed(1)}s`);
		lines.push('');

		if (result.comments.length > 0) {
			lines.push(`### Comments (${result.comments.length})`);
			lines.push('');
			const bySeverity = this.groupBySeverity(result.comments);
			for (const [severity, comments] of Object.entries(bySeverity)) {
				lines.push(`**${severity.toUpperCase()}** (${comments.length})`);
				for (const comment of comments.slice(0, 5)) {
					lines.push(`- ${comment.file}${comment.line ? `:${comment.line}` : ''}: ${comment.body}`);
				}
				if (comments.length > 5) {
					lines.push(`- ... and ${comments.length - 5} more`);
				}
			}
			lines.push('');
		}

		if (result.securityFindings.length > 0) {
			lines.push(`### Security Findings (${result.securityFindings.length})`);
			lines.push('');
			for (const finding of result.securityFindings) {
				lines.push(`- **${finding.severity.toUpperCase()}**: ${finding.title} in ${finding.file}`);
			}
			lines.push('');
		}

		if (result.policyViolations.length > 0) {
			lines.push(`### Policy Violations (${result.policyViolations.length})`);
			lines.push('');
			for (const violation of result.policyViolations.slice(0, 5)) {
				lines.push(`- ${violation.policyName}: ${violation.message}`);
			}
			lines.push('');
		}

		lines.push(`**Estimated Test Coverage**: ${(result.testCoverageEstimate * 100).toFixed(1)}%`);
		lines.push('');
		lines.push(result.summary);

		return lines.join('\n');
	}

	public exportReviewAsMarkdown(result: PRReviewResult): string {
		const lines: string[] = [];
		lines.push(`# PR #${result.prNumber} - Council Review Report`);
		lines.push('');
		lines.push(`| Metric | Value |`);
		lines.push(`|--------|-------|`);
		lines.push(`| Verdict | ${result.verdict} |`);
		lines.push(`| Score | ${(result.score * 100).toFixed(1)}% |`);
		lines.push(`| Comments | ${result.comments.length} |`);
		lines.push(`| Security Findings | ${result.securityFindings.length} |`);
		lines.push(`| Policy Violations | ${result.policyViolations.length} |`);
		lines.push(`| Performance Issues | ${result.performanceIssues.length} |`);
		lines.push(`| Test Coverage (est.) | ${(result.testCoverageEstimate * 100).toFixed(1)}% |`);
		lines.push(`| Review Time | ${(result.executionTimeMs / 1000).toFixed(1)}s |`);
		lines.push('');

		lines.push('## Summary');
		lines.push('');
		lines.push(result.summary);
		lines.push('');

		if (result.comments.length > 0) {
			lines.push('## Detailed Comments');
			lines.push('');
			const byFile = this.groupByFile(result.comments);
			for (const [file, comments] of Object.entries(byFile)) {
				lines.push(`### ${file}`);
				lines.push('');
				for (const comment of comments) {
					lines.push(`#### ${comment.severity.toUpperCase()} - Line ${comment.line ?? 'N/A'}`);
					lines.push('');
					lines.push(comment.body);
					if (comment.suggestion) {
						lines.push('');
						lines.push(`**Suggestion**: ${comment.suggestion}`);
					}
					lines.push('');
				}
			}
		}

		if (result.securityFindings.length > 0) {
			lines.push('## Security Findings');
			lines.push('');
			for (const finding of result.securityFindings) {
				lines.push(`### ${finding.severity.toUpperCase()}: ${finding.title}`);
				lines.push('');
				lines.push(`**File**: ${finding.file}${finding.line ? ` (line ${finding.line})` : ''}`);
				if (finding.cweId) lines.push(`**CWE**: ${finding.cweId}`);
				lines.push('');
				lines.push(finding.description);
				lines.push('');
				lines.push(`**Recommendation**: ${finding.recommendation}`);
				lines.push('');
			}
		}

		return lines.join('\n');
	}

	private filterFiles(files: PRFileInfo[], ignorePatterns: string[]): PRFileInfo[] {
		return files.filter(f => {
			return !ignorePatterns.some(pattern => {
				const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
				return regex.test(f.filename);
			});
		});
	}

	private buildFilteredDiff(diff: string, files: PRFileInfo[]): string {
		return diff.split('\n').filter(line => {
			for (const file of files) {
				if (line.includes(file.filename)) return true;
			}
			return true;
		}).join('\n');
	}

	private buildReviewPrompt(request: PRReviewRequest, files: PRFileInfo[]): string {
		const fileList = files.map(f => `- ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n');

		return `You are a PR Review Board. Review the following pull request thoroughly.

PR #${request.prNumber}: ${request.title}
Author: ${request.author}
Base Branch: ${request.baseBranch}
Head Branch: ${request.headBranch}

Description:
${request.description}

Files Changed (${files.length}):
${fileList}

Review Criteria:
1. **Security**: Check for vulnerabilities (injection, XSS, CSRF, auth bypass, data exposure)
2. **Code Quality**: Check for clean code principles, error handling, and maintainability
3. **Architecture**: Check for proper separation of concerns, coupling, and design patterns
4. **Performance**: Check for performance anti-patterns, memory leaks, and inefficient algorithms
5. **Testing**: Check for adequate test coverage and test quality
6. **Documentation**: Check for adequate comments and documentation

Provide your review with specific file references, line numbers where possible, and actionable suggestions.

Format your response with:
- A summary verdict (approve/request changes/comment)
- Specific comments organized by severity
- Security findings if any
- Performance recommendations if any`;
	}

	private parseReviewComments(
		result: CouncilResult,
		files: PRFileInfo[],
		config: PRReviewConfig
	): PRReviewComment[] {
		const comments: PRReviewComment[] = [];
		const content = result.finalResponse;

		const commentPatterns = [
			/\*\*(?:Issue|Problem|Bug|Concern|Warning|Error)\*\*[:\s]+([^\n]+)/gi,
			/(?:Consider|Should|Must|Need to)\s+([^\n.]+)/gi,
			/\*\*File:\*\*\s*([^\n]+)\s*\*\*Line:\*\*\s*(\d+)/gi
		];

		for (const pattern of commentPatterns) {
			let match;
			while ((match = pattern.exec(content)) !== null) {
				const file = this.findRelevantFile(match[0], files);
				const lineMatch = match[0].match(/line\s*(\d+)/i);
				const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

				comments.push({
					commentId: generateUuid(),
					file: file?.filename ?? 'general',
					line,
					body: match[1] || match[0],
					severity: this.inferSeverity(match[0]),
					category: this.inferCategory(match[0]),
					suggestion: this.extractSuggestion(content, match.index),
					roleId: 'reviewer'
				});

				if (comments.length >= config.maxCommentsPerFile * files.length) break;
			}
		}

		return comments.slice(0, 50);
	}

	private analyzeSecurity(diff: string, files: PRFileInfo[]): SecurityFinding[] {
		const findings: SecurityFinding[] = [];

		const securityPatterns: Array<{ pattern: RegExp; title: string; severity: SecurityFinding['severity']; cweId?: string; recommendation: string }> = [
			{
				pattern: /\bexec\s*\(/g,
				title: 'Potential command injection',
				severity: 'critical',
				cweId: 'CWE-78',
				recommendation: 'Use parameterized commands or validate/sanitize input before execution'
			},
			{
				pattern: /\beval\s*\(/g,
				title: 'Use of eval() function',
				severity: 'high',
				cweId: 'CWE-95',
				recommendation: 'Replace eval() with safer alternatives like JSON.parse() or Function constructor with validation'
			},
			{
				pattern: /innerHTML\s*=/g,
				title: 'Potential XSS via innerHTML',
				severity: 'high',
				cweId: 'CWE-79',
				recommendation: 'Use textContent or sanitize HTML content before assignment'
			},
			{
				pattern: /password|secret|token|api_key|apikey/gi,
				title: 'Potential hardcoded secret',
				severity: 'critical',
				cweId: 'CWE-798',
				recommendation: 'Use environment variables or a secrets manager instead of hardcoding credentials'
			},
			{
				pattern: /SQL\s*(?:query|statement|command)|SELECT.*FROM.*WHERE/gi,
				title: 'Potential SQL injection',
				severity: 'critical',
				cweId: 'CWE-89',
				recommendation: 'Use parameterized queries or an ORM with proper input validation'
			}
		];

		for (const { pattern, title, severity, cweId, recommendation } of securityPatterns) {
			let match;
			while ((match = pattern.exec(diff)) !== null) {
				const file = this.findFileForMatch(diff, match.index);
				findings.push({
					findingId: generateUuid(),
					severity,
					title,
					description: `Security pattern detected: ${title}`,
					file: file ?? 'unknown',
					cweId,
					recommendation
				});
			}
		}

		return findings;
	}

	private analyzePerformance(diff: string, files: PRFileInfo[]): PerformanceIssue[] {
		const issues: PerformanceIssue[] = [];

		const perfPatterns: Array<{ pattern: RegExp; title: string; severity: PerformanceIssue['severity']; impact: PerformanceIssue['impact']; recommendation: string }> = [
			{
				pattern: /for\s*\([^)]*\.length[^)]*\)/g,
				title: 'Array length in loop condition',
				severity: 'warning',
				impact: 'minor',
				recommendation: 'Cache array.length before the loop to avoid repeated property access'
			},
			{
				pattern: /JSON\.parse\s*\(\s*JSON\.stringify/g,
				title: 'Deep clone via JSON serialization',
				severity: 'warning',
				impact: 'moderate',
				recommendation: 'Use structuredClone() for better performance and correctness'
			},
			{
				pattern: /new\s+Array\s*\(\s*\d+\s*\)\.fill/g,
				title: 'Large array initialization',
				severity: 'info',
				impact: 'minor',
				recommendation: 'Consider lazy initialization or typed arrays for large collections'
			}
		];

		for (const { pattern, title, severity, impact, recommendation } of perfPatterns) {
			let match;
			while ((match = pattern.exec(diff)) !== null) {
				const file = this.findFileForMatch(diff, match.index);
				issues.push({
					issueId: generateUuid(),
					severity,
					title,
					description: `Performance pattern detected: ${title}`,
					file: file ?? 'unknown',
					impact,
					recommendation
				});
			}
		}

		return issues;
	}

	private calculateVerdict(
		comments: PRReviewComment[],
		securityFindings: SecurityFinding[],
		policyViolations: PolicyViolation[],
		confidence: number,
		config: PRReviewConfig
	): ReviewVerdict {
		const criticalIssues = comments.filter(c => c.severity === 'critical').length
			+ securityFindings.filter(f => f.severity === 'critical').length
			+ policyViolations.filter(v => v.severity === 'critical').length;

		const highIssues = comments.filter(c => c.severity === 'error').length
			+ securityFindings.filter(f => f.severity === 'high').length;

		if (criticalIssues > 0) return ReviewVerdict.RequestChanges;
		if (highIssues > 2) return ReviewVerdict.RequestChanges;

		const score = this.calculateScore(comments, securityFindings, policyViolations, confidence);
		if (score >= config.autoApproveThreshold) return ReviewVerdict.Approve;
		if (score < 0.5) return ReviewVerdict.RequestChanges;

		return ReviewVerdict.Comment;
	}

	private calculateScore(
		comments: PRReviewComment[],
		securityFindings: SecurityFinding[],
		policyViolations: PolicyViolation[],
		confidence: number
	): number {
		let score = 1.0;

		const severityPenalties: Record<string, number> = {
			critical: 0.15,
			error: 0.1,
			warning: 0.05,
			info: 0.02
		};

		for (const comment of comments) {
			score -= severityPenalties[comment.severity] ?? 0.02;
		}
		for (const finding of securityFindings) {
			score -= severityPenalties[finding.severity] ?? 0.02;
		}
		for (const violation of policyViolations) {
			score -= severityPenalties[violation.severity] ?? 0.02;
		}

		return Math.max(0, Math.min(1, score * confidence));
	}

	private generateSummary(
		verdict: ReviewVerdict,
		comments: PRReviewComment[],
		securityFindings: SecurityFinding[],
		performanceIssues: PerformanceIssue[],
		policyViolations: PolicyViolation[]
	): string {
		const parts: string[] = [];

		if (verdict === ReviewVerdict.Approve) {
			parts.push('This PR meets the council\'s quality standards and is approved.');
		} else if (verdict === ReviewVerdict.RequestChanges) {
			parts.push('This PR requires changes before it can be approved.');
		} else {
			parts.push('This PR has some concerns that should be addressed.');
		}

		if (securityFindings.length > 0) {
			parts.push(`Found ${securityFindings.length} security finding(s) that need attention.`);
		}
		if (policyViolations.length > 0) {
			parts.push(`Detected ${policyViolations.length} policy violation(s).`);
		}
		if (performanceIssues.length > 0) {
			parts.push(`Identified ${performanceIssues.length} performance concern(s).`);
		}
		if (comments.length > 0) {
			parts.push(`Made ${comments.length} review comment(s) across the changed files.`);
		}

		return parts.join(' ');
	}

	private estimateTestCoverage(diff: string): number {
		const testKeywords = ['test', 'spec', 'describe', 'it(', 'expect(', 'assert', 'should', 'verify'];
		const lines = diff.split('\n');
		const codeLines = lines.filter(l => !l.startsWith('+') && !l.startsWith('-') && l.trim().length > 0);
		const testLines = lines.filter(l => testKeywords.some(kw => l.toLowerCase().includes(kw)));

		if (codeLines.length === 0) return 0;
		return Math.min(testLines.length / codeLines.length, 1.0);
	}

	private findRelevantFile(text: string, files: PRFileInfo[]): PRFileInfo | undefined {
		for (const file of files) {
			if (text.includes(file.filename)) return file;
		}
		return undefined;
	}

	private findFileForMatch(diff: string, matchIndex: number): string | undefined {
		const beforeMatch = diff.substring(0, matchIndex);
		const fileMatch = beforeMatch.match(/\+\+\+\s+b\/([^\n]+)/g);
		if (fileMatch && fileMatch.length > 0) {
			return fileMatch[fileMatch.length - 1].replace('+++ b/', '');
		}
		return undefined;
	}

	private inferSeverity(text: string): PRReviewComment['severity'] {
		const lower = text.toLowerCase();
		if (lower.includes('critical') || lower.includes('vulnerability') || lower.includes('security')) return 'critical';
		if (lower.includes('error') || lower.includes('bug') || lower.includes('break')) return 'error';
		if (lower.includes('warning') || lower.includes('concern') || lower.includes('risk')) return 'warning';
		return 'info';
	}

	private inferCategory(text: string): PRReviewComment['category'] {
		const lower = text.toLowerCase();
		if (lower.includes('security') || lower.includes('vulnerability') || lower.includes('xss') || lower.includes('injection')) return 'security';
		if (lower.includes('performance') || lower.includes('slow') || lower.includes('memory')) return 'performance';
		if (lower.includes('test') || lower.includes('coverage') || lower.includes('assert')) return 'testing';
		if (lower.includes('architecture') || lower.includes('design') || lower.includes('pattern')) return 'architecture';
		if (lower.includes('style') || lower.includes('format') || lower.includes('naming')) return 'style';
		if (lower.includes('doc') || lower.includes('comment')) return 'documentation';
		return 'quality';
	}

	private extractSuggestion(content: string, matchIndex: number): string | undefined {
		const afterMatch = content.substring(matchIndex, matchIndex + 500);
		const suggestionMatch = afterMatch.match(/(?:suggestion|recommend|fix|should be|consider)[:\s]+([^\n.]+)/i);
		return suggestionMatch ? suggestionMatch[1].trim() : undefined;
	}

	private groupBySeverity(comments: PRReviewComment[]): Record<string, PRReviewComment[]> {
		const groups: Record<string, PRReviewComment[]> = {};
		for (const comment of comments) {
			if (!groups[comment.severity]) groups[comment.severity] = [];
			groups[comment.severity].push(comment);
		}
		return groups;
	}

	private groupByFile(comments: PRReviewComment[]): Record<string, PRReviewComment[]> {
		const groups: Record<string, PRReviewComment[]> = {};
		for (const comment of comments) {
			if (!groups[comment.file]) groups[comment.file] = [];
			groups[comment.file].push(comment);
		}
		return groups;
	}
}
