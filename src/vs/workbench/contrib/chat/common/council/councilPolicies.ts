/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService, IFileStatWithMetadata } from '../../../../../../platform/files/common/files.js';
import { URI } from '../../../../../../base/common/uri.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

export const ICouncilPolicyEngine = createDecorator<ICouncilPolicyEngine>('councilPolicyEngine');

export type PolicySeverity = 'info' | 'warning' | 'error' | 'critical';

export interface PolicyRule {
	readonly id: string;
	readonly pattern: string;
	readonly message: string;
	readonly fix?: string;
	readonly category: 'security' | 'quality' | 'style' | 'architecture' | 'performance' | 'testing' | 'documentation';
}

export interface EngineeringPolicy {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly rules: PolicyRule[];
	readonly severity: PolicySeverity;
	readonly enabled: boolean;
	readonly scope: 'global' | 'language' | 'project';
	readonly languages?: string[];
	readonly lastModified: number;
	readonly author?: string;
}

export interface PolicyViolation {
	readonly violationId: string;
	readonly policyId: string;
	readonly policyName: string;
	readonly ruleId: string;
	readonly message: string;
	readonly severity: PolicySeverity;
	readonly fix?: string;
	readonly category: PolicyRule['category'];
	readonly matchedText: string;
	readonly context: string;
	readonly timestamp: number;
}

export interface PolicyEvaluation {
	readonly sessionId: string;
	readonly passed: boolean;
	readonly violations: PolicyViolation[];
	readonly score: number;
	readonly evaluatedAt: number;
	readonly policiesChecked: number;
	readonly rulesChecked: number;
}

export interface PolicyTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly rules: Omit<PolicyRule, 'id'>[];
	readonly severity: PolicySeverity;
}

export interface ICouncilPolicyEngine extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onDidChangePolicies: Event<void>;
	readonly onPolicyViolation: Event<PolicyViolation>;

	getPolicies(): EngineeringPolicy[];
	getPolicy(id: string): EngineeringPolicy | undefined;
	addPolicy(policy: Omit<EngineeringPolicy, 'id' | 'lastModified'>): string;
	updatePolicy(id: string, updates: Partial<EngineeringPolicy>): void;
	removePolicy(id: string): void;
	enablePolicy(id: string): void;
	disablePolicy(id: string): void;

	evaluateContribution(contribution: string, sessionId: string, language?: string): Promise<PolicyEvaluation>;
	evaluateCode(code: string, sessionId: string, language?: string): Promise<PolicyEvaluation>;

	getViolationHistory(sessionId?: string): PolicyViolation[];
	getPolicyScore(sessionId: string): number;

	loadPoliciesFromWorkspace(workspaceRoot: URI): Promise<void>;
	exportPolicies(): EngineeringPolicy[];
	importPolicies(policies: EngineeringPolicy[]): void;
}

const DEFAULT_POLICY_TEMPLATES: PolicyTemplate[] = [
	{
		id: 'security-injection',
		name: 'Injection Prevention',
		description: 'Prevent SQL, command, and script injection vulnerabilities',
		severity: 'critical',
		rules: [
			{
				pattern: 'exec\\s*\\(\\s*["\'].*\\+',
				message: 'Potential command injection: string concatenation in exec()',
				fix: 'Use parameterized commands or input validation',
				category: 'security'
			},
			{
				pattern: 'eval\\s*\\(',
				message: 'Dangerous use of eval(): consider safer alternatives',
				fix: 'Replace eval() with JSON.parse() or Function constructor with validation',
				category: 'security'
			},
			{
				pattern: 'innerHTML\\s*=',
				message: 'Potential XSS vulnerability: setting innerHTML directly',
				fix: 'Use textContent or DOM sanitization',
				category: 'security'
			},
			{
				pattern: 'document\\.write\\s*\\(',
				message: 'Potential XSS vulnerability: document.write()',
				fix: 'Use DOM manipulation methods instead',
				category: 'security'
			}
		]
	},
	{
		id: 'quality-error-handling',
		name: 'Error Handling Standards',
		description: 'Ensure proper error handling patterns',
		severity: 'warning',
		rules: [
			{
				pattern: 'catch\\s*\\(\\s*\\)\\s*\\{\\s*\\}',
				message: 'Empty catch block: errors are silently swallowed',
				fix: 'Add logging or error handling in catch block',
				category: 'quality'
			},
			{
				pattern: 'catch\\s*\\(\\s*\\w+\\s*\\)\\s*\\{\\s*console\\.log',
				message: 'Minimal error handling: consider proper error propagation',
				fix: 'Use structured error handling with custom error types',
				category: 'quality'
			},
			{
				pattern: 'throw\\s+new\\s+Error\\s*\\(\\s*["\'][^"\']*["\']\\s*\\)',
				message: 'Generic Error thrown: use custom error types for better handling',
				fix: 'Create specific error classes (ValidationError, NetworkError, etc.)',
				category: 'quality'
			}
		]
	},
	{
		id: 'performance-loops',
		name: 'Performance Anti-patterns',
		description: 'Detect common performance anti-patterns',
		severity: 'warning',
		rules: [
			{
				pattern: 'for\\s*\\([^)]+\\.length[^)]*\\)',
				message: 'Array length accessed in loop condition: cache length for better performance',
				fix: 'Cache array.length in a variable before the loop',
				category: 'performance'
			},
			{
				pattern: 'JSON\\.parse\\s*\\(\\s*JSON\\.stringify',
				message: 'Deep clone via JSON: consider structuredClone() for better performance',
				fix: 'Use structuredClone() or immutable data patterns',
				category: 'performance'
			}
		]
	},
	{
		id: 'testing-assertions',
		name: 'Testing Standards',
		description: 'Ensure tests follow best practices',
		severity: 'info',
		rules: [
			{
				pattern: 'it\\s*\\([^)]+\\)\\s*=>\\s*\\{\\s*\\}',
				message: 'Empty test body: test should contain assertions',
				fix: 'Add assertions to verify expected behavior',
				category: 'testing'
			},
			{
				pattern: 'expect\\s*\\([^)]+\\)\\.toBeTruthy\\s*\\(\\)',
				message: 'Using toBeTruthy(): prefer more specific assertions',
				fix: 'Use toBeTrue(), toBeDefined(), or toEqual() for clarity',
				category: 'testing'
			}
		]
	},
	{
		id: 'architecture-coupling',
		name: 'Architecture Coupling',
		description: 'Detect tight coupling and architectural violations',
		severity: 'warning',
		rules: [
			{
				pattern: 'import.*from.*\\.\\.\\/.*\\.\\.\\/.*\\.\\.\\/',
				message: 'Deep relative import: consider path aliases or restructuring',
				fix: 'Use path aliases or reorganize module structure',
				category: 'architecture'
			},
			{
				pattern: 'import.*from.*node_modules',
				message: 'Direct node_modules import: use package name instead',
				fix: 'Import using package name, not node_modules path',
				category: 'architecture'
			}
		]
	}
];

export class CouncilPolicyEngine extends Disposable implements ICouncilPolicyEngine {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePolicies = this._register(new Emitter<void>());
	readonly onDidChangePolicies = this._onDidChangePolicies.event;

	private readonly _onPolicyViolation = this._register(new Emitter<PolicyViolation>());
	readonly onPolicyViolation = this._onPolicyViolation.event;

	private readonly policies: Map<string, EngineeringPolicy>;
	private readonly violationHistory: PolicyViolation[];

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.policies = new Map();
		this.violationHistory = [];
		this.initializeDefaultPolicies();
	}

	private initializeDefaultPolicies(): void {
		for (const template of DEFAULT_POLICY_TEMPLATES) {
			const policy: EngineeringPolicy = {
				id: generateUuid(),
				name: template.name,
				description: template.description,
				rules: template.rules.map(r => ({ ...r, id: generateUuid() })),
				severity: template.severity,
				enabled: true,
				scope: 'global',
				lastModified: Date.now()
			};
			this.policies.set(policy.id, policy);
		}
		this.logService.info(`[Council Policy] Initialized ${this.policies.size} default policies`);
	}

	public getPolicies(): EngineeringPolicy[] {
		return Array.from(this.policies.values());
	}

	public getPolicy(id: string): EngineeringPolicy | undefined {
		return this.policies.get(id);
	}

	public addPolicy(policy: Omit<EngineeringPolicy, 'id' | 'lastModified'>): string {
		const id = generateUuid();
		const newPolicy: EngineeringPolicy = {
			...policy,
			id,
			lastModified: Date.now()
		};
		this.policies.set(id, newPolicy);
		this._onDidChangePolicies.fire();
		this.logService.info(`[Council Policy] Added policy: ${policy.name}`);
		return id;
	}

	public updatePolicy(id: string, updates: Partial<EngineeringPolicy>): void {
		const policy = this.policies.get(id);
		if (!policy) {
			throw new Error(`Policy not found: ${id}`);
		}
		this.policies.set(id, {
			...policy,
			...updates,
			lastModified: Date.now()
		});
		this._onDidChangePolicies.fire();
		this.logService.info(`[Council Policy] Updated policy: ${policy.name}`);
	}

	public removePolicy(id: string): void {
		const policy = this.policies.get(id);
		if (!policy) {
			throw new Error(`Policy not found: ${id}`);
		}
		this.policies.delete(id);
		this._onDidChangePolicies.fire();
		this.logService.info(`[Council Policy] Removed policy: ${policy.name}`);
	}

	public enablePolicy(id: string): void {
		this.updatePolicy(id, { enabled: true });
	}

	public disablePolicy(id: string): void {
		this.updatePolicy(id, { enabled: false });
	}

	public async evaluateContribution(
		contribution: string,
		sessionId: string,
		language?: string
	): Promise<PolicyEvaluation> {
		const violations: PolicyViolation[] = [];
		let rulesChecked = 0;

		for (const policy of this.policies.values()) {
			if (!policy.enabled) continue;
			if (policy.scope === 'language' && policy.languages && language && !policy.languages.includes(language)) continue;

			for (const rule of policy.rules) {
				rulesChecked++;
				try {
					const regex = new RegExp(rule.pattern, 'gi');
					let match;
					while ((match = regex.exec(contribution)) !== null) {
						const violation: PolicyViolation = {
							violationId: generateUuid(),
							policyId: policy.id,
							policyName: policy.name,
							ruleId: rule.id,
							message: rule.message,
							severity: policy.severity,
							fix: rule.fix,
							category: rule.category,
							matchedText: match[0],
							context: this.extractContext(contribution, match.index, 100),
							timestamp: Date.now()
						};
						violations.push(violation);
						this.violationHistory.push(violation);
						this._onPolicyViolation.fire(violation);
					}
				} catch (error) {
					this.logService.warn(`[Council Policy] Invalid regex pattern "${rule.pattern}": ${error}`);
				}
			}
		}

		const evaluation: PolicyEvaluation = {
			sessionId,
			passed: violations.length === 0,
			violations,
			score: this.calculatePolicyScore(violations),
			evaluatedAt: Date.now(),
			policiesChecked: this.policies.size,
			rulesChecked
		};

		this.logService.info(`[Council Policy] Evaluation complete: ${violations.length} violations found (score: ${evaluation.score.toFixed(2)})`);
		return evaluation;
	}

	public async evaluateCode(
		code: string,
		sessionId: string,
		language?: string
	): Promise<PolicyEvaluation> {
		return this.evaluateContribution(code, sessionId, language);
	}

	public getViolationHistory(sessionId?: string): PolicyViolation[] {
		if (sessionId) {
			return this.violationHistory.filter(v => v.sessionId === sessionId);
		}
		return [...this.violationHistory];
	}

	public getPolicyScore(sessionId: string): number {
		const violations = this.violationHistory.filter(v => v.sessionId === sessionId);
		return this.calculatePolicyScore(violations);
	}

	public async loadPoliciesFromWorkspace(workspaceRoot: URI): Promise<void> {
		const policyPath = URI.joinPath(workspaceRoot, '.vscode', 'council-policies.json');
		try {
			if (await this.fileService.exists(policyPath)) {
				const content = await this.fileService.readFile(policyPath);
				const policies = JSON.parse(content.value.toString()) as EngineeringPolicy[];
				this.importPolicies(policies);
				this.logService.info(`[Council Policy] Loaded ${policies.length} policies from workspace`);
			}
		} catch (error) {
			this.logService.warn(`[Council Policy] Failed to load policies from workspace: ${error}`);
		}
	}

	public exportPolicies(): EngineeringPolicy[] {
		return Array.from(this.policies.values());
	}

	public importPolicies(policies: EngineeringPolicy[]): void {
		for (const policy of policies) {
			this.policies.set(policy.id, policy);
		}
		this._onDidChangePolicies.fire();
		this.logService.info(`[Council Policy] Imported ${policies.length} policies`);
	}

	private calculatePolicyScore(violations: PolicyViolation[]): number {
		if (violations.length === 0) return 1.0;

		const severityWeights: Record<PolicySeverity, number> = {
			info: 0.02,
			warning: 0.05,
			error: 0.1,
			critical: 0.2
		};

		const totalPenalty = violations.reduce(
			(sum, v) => sum + severityWeights[v.severity],
			0
		);

		return Math.max(0, Math.min(1, 1 - totalPenalty));
	}

	private extractContext(text: string, matchIndex: number, contextLength: number): string {
		const start = Math.max(0, matchIndex - contextLength / 2);
		const end = Math.min(text.length, matchIndex + matchIndex + contextLength / 2);
		const snippet = text.substring(start, end);
		return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
	}
}
