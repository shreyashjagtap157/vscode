/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

export const ICouncilGovernance = createDecorator<ICouncilGovernance>('councilGovernance');

export enum GovernanceActionType {
	SessionStart = 'session_start',
	SessionComplete = 'session_complete',
	SessionCancel = 'session_cancel',
	SessionFailure = 'session_failure',
	DecisionMade = 'decision_made',
	PolicyViolation = 'policy_violation',
	DebateRecorded = 'debate_recorded',
	DebateResolved = 'debate_resolved',
	ConsensusReached = 'consensus_reached',
	EvidenceValidated = 'evidence_validated',
	PRReviewStarted = 'pr_review_started',
	PRReviewCompleted = 'pr_review_completed',
	CIFailureResolved = 'ci_failure_resolved',
	MemoryNodeAdded = 'memory_node_added',
	ArtifactShared = 'artifact_shared',
	RedTeamFinding = 'red_team_finding',
	ConfigurationChanged = 'configuration_changed'
}

export enum GovernanceSeverity {
	Info = 'info',
	Warning = 'warning',
	Error = 'error',
	Critical = 'critical'
}

export interface GovernanceAuditEntry {
	readonly entryId: string;
	readonly timestamp: number;
	readonly actionType: GovernanceActionType;
	readonly severity: GovernanceSeverity;
	readonly sessionId?: string;
	readonly actor: string;
	readonly target: string;
	readonly details: string;
	readonly metadata: Record<string, unknown>;
	readonly hash: string;
	readonly previousHash: string;
}

export interface GovernancePolicy {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly rules: GovernanceRule[];
	readonly enabled: boolean;
	readonly enforcement: 'audit' | 'warn' | 'block';
}

export interface GovernanceRule {
	readonly id: string;
	readonly condition: string;
	readonly action: 'allow' | 'deny' | 'require_approval';
	readonly message: string;
	readonly severity: GovernanceSeverity;
}

export interface GovernanceReport {
	readonly reportId: string;
	readonly title: string;
	readonly generatedAt: number;
	readonly period: { start: number; end: number };
	readonly totalSessions: number;
	readonly successfulSessions: number;
	readonly failedSessions: number;
	readonly cancelledSessions: number;
	readonly totalDecisions: number;
	readonly totalViolations: number;
	readonly totalDebates: number;
	readonly resolvedDebates: number;
	readonly averageConfidence: number;
	readonly averageExecutionTimeMs: number;
	readonly topViolations: Array<{ message: string; count: number }>;
	readonly agentActivity: Array<{ roleId: string; sessions: number; decisions: number }>;
	readonly entries: GovernanceAuditEntry[];
}

export interface ICouncilGovernance extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onAuditEntryAdded: Event<GovernanceAuditEntry>;

	recordAction(
		actionType: GovernanceActionType,
		actor: string,
		target: string,
		details: string,
		metadata?: Record<string, unknown>,
		sessionId?: string,
		severity?: GovernanceSeverity
	): GovernanceAuditEntry;

	getAuditTrail(sessionId?: string, limit?: number): GovernanceAuditEntry[];
	getEntry(entryId: string): GovernanceAuditEntry | undefined;
	verifyChain(): boolean;

	getGovernancePolicies(): GovernancePolicy[];
	addPolicy(policy: Omit<GovernancePolicy, 'id'>): string;
	removePolicy(id: string): void;

	checkAction(actionType: GovernanceActionType, context: Record<string, unknown>): GovernanceCheckResult;

	generateReport(period?: { start: number; end: number }): GovernanceReport;
	exportAuditTrail(format: 'json' | 'csv'): string;

	clearAuditTrail(maxAge?: number): number;
}

export interface GovernanceCheckResult {
	allowed: boolean;
	requiresApproval: boolean;
	message: string;
	severity: GovernanceSeverity;
	blockingRule?: GovernanceRule;
}

const DEFAULT_GOVERNANCE_POLICIES: GovernancePolicy[] = [
	{
		id: 'session-limits',
		name: 'Session Execution Limits',
		description: 'Enforce limits on council session execution',
		enabled: true,
		enforcement: 'warn',
		rules: [
			{
				id: 'max-concurrent-sessions',
				condition: 'concurrent_sessions > 5',
				action: 'deny',
				message: 'Maximum concurrent sessions (5) exceeded',
				severity: GovernanceSeverity.Warning
			},
			{
				id: 'session-timeout',
				condition: 'session_duration > 300000',
				action: 'require_approval',
				message: 'Session exceeds 5 minute duration, requires approval',
				severity: GovernanceSeverity.Info
			}
		]
	},
	{
		id: 'security-gate',
		name: 'Security Gate',
		description: 'Block actions with critical security violations',
		enabled: true,
		enforcement: 'block',
		rules: [
			{
				id: 'no-critical-violations',
				condition: 'severity == critical',
				action: 'deny',
				message: 'Action blocked due to critical security violation',
				severity: GovernanceSeverity.Critical
			}
		]
	},
	{
		id: 'consensus-requirement',
		name: 'Consensus Requirement',
		description: 'Require consensus for high-impact decisions',
		enabled: true,
		enforcement: 'audit',
		rules: [
			{
				id: 'high-impact-consensus',
				condition: 'impact == high && !consensus',
				action: 'require_approval',
				message: 'High-impact decision requires council consensus',
				severity: GovernanceSeverity.Warning
			}
		]
	}
];

export class CouncilGovernance extends Disposable implements ICouncilGovernance {
	declare readonly _serviceBrand: undefined;

	private readonly _onAuditEntryAdded = this._register(new Emitter<GovernanceAuditEntry>());
	readonly onAuditEntryAdded = this._onAuditEntryAdded.event;

	private readonly auditTrail: GovernanceAuditEntry[];
	private readonly policies: Map<string, GovernancePolicy>;
	private lastHash: string;

	private readonly storageKey = 'council.governance.auditTrail';
	private readonly policyStorageKey = 'council.governance.policies';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.auditTrail = [];
		this.policies = new Map();
		this.lastHash = '0000000000000000000000000000000000000000000000000000000000000000';
		this.initializeDefaultPolicies();
		this.loadFromStorage();
	}

	private initializeDefaultPolicies(): void {
		for (const policy of DEFAULT_GOVERNANCE_POLICIES) {
			this.policies.set(policy.id, policy);
		}
		this.logService.info(`[Council Governance] Initialized ${this.policies.size} default policies`);
	}

	private loadFromStorage(): void {
		try {
			const storedTrail = this.storageService.get(this.storageKey, StorageScope.WORKSPACE, '[]');
			const parsed = JSON.parse(storedTrail) as GovernanceAuditEntry[];
			if (parsed.length > 0) {
				this.auditTrail.push(...parsed.slice(-1000));
				this.lastHash = parsed[parsed.length - 1]?.hash ?? this.lastHash;
				this.logService.info(`[Council Governance] Loaded ${parsed.length} audit entries from storage`);
			}

			const storedPolicies = this.storageService.get(this.policyStorageKey, StorageScope.WORKSPACE, '{}');
			const policyData = JSON.parse(storedPolicies) as Record<string, GovernancePolicy>;
			for (const [id, policy] of Object.entries(policyData)) {
				this.policies.set(id, policy);
			}
		} catch (error) {
			this.logService.warn(`[Council Governance] Failed to load from storage: ${error}`);
		}
	}

	private saveToStorage(): void {
		try {
			const recentEntries = this.auditTrail.slice(-1000);
			this.storageService.store(
				this.storageKey,
				JSON.stringify(recentEntries),
				StorageScope.WORKSPACE,
				StorageTarget.USER
			);

			const policyObj: Record<string, GovernancePolicy> = {};
			for (const [id, policy] of this.policies) {
				policyObj[id] = policy;
			}
			this.storageService.store(
				this.policyStorageKey,
				JSON.stringify(policyObj),
				StorageScope.WORKSPACE,
				StorageTarget.USER
			);
		} catch (error) {
			this.logService.warn(`[Council Governance] Failed to save to storage: ${error}`);
		}
	}

	public recordAction(
		actionType: GovernanceActionType,
		actor: string,
		target: string,
		details: string,
		metadata: Record<string, unknown> = {},
		sessionId?: string,
		severity: GovernanceSeverity = GovernanceSeverity.Info
	): GovernanceAuditEntry {
		const entry: GovernanceAuditEntry = {
			entryId: generateUuid(),
			timestamp: Date.now(),
			actionType,
			severity,
			sessionId,
			actor,
			target,
			details,
			metadata,
			hash: '',
			previousHash: this.lastHash
		};

		entry.hash = this.computeHash(entry);
		this.auditTrail.push(entry);
		this.lastHash = entry.hash;

		this._onAuditEntryAdded.fire(entry);
		this.saveToStorage();

		this.logService.debug(`[Council Governance] ${actionType}: ${details}`);
		return entry;
	}

	public getAuditTrail(sessionId?: string, limit: number = 100): GovernanceAuditEntry[] {
		let entries = [...this.auditTrail];
		if (sessionId) {
			entries = entries.filter(e => e.sessionId === sessionId);
		}
		return entries.slice(-limit);
	}

	public getEntry(entryId: string): GovernanceAuditEntry | undefined {
		return this.auditTrail.find(e => e.entryId === entryId);
	}

	public verifyChain(): boolean {
		for (let i = 0; i < this.auditTrail.length; i++) {
			const entry = this.auditTrail[i];
			const expectedPrevious = i === 0
				? '0000000000000000000000000000000000000000000000000000000000000000'
				: this.auditTrail[i - 1].hash;

			if (entry.previousHash !== expectedPrevious) {
				this.logService.error(`[Council Governance] Chain verification failed at entry ${entry.entryId}`);
				return false;
			}

			const expectedHash = this.computeHash(entry);
			if (entry.hash !== expectedHash) {
				this.logService.error(`[Council Governance] Hash mismatch at entry ${entry.entryId}`);
				return false;
			}
		}
		return true;
	}

	public getGovernancePolicies(): GovernancePolicy[] {
		return Array.from(this.policies.values());
	}

	public addPolicy(policy: Omit<GovernancePolicy, 'id'>): string {
		const id = generateUuid();
		this.policies.set(id, { ...policy, id });
		this.saveToStorage();
		this.recordAction(
			GovernanceActionType.ConfigurationChanged,
			'governance',
			`policy:${id}`,
			`Added governance policy: ${policy.name}`
		);
		return id;
	}

	public removePolicy(id: string): void {
		const policy = this.policies.get(id);
		if (policy) {
			this.policies.delete(id);
			this.saveToStorage();
			this.recordAction(
				GovernanceActionType.ConfigurationChanged,
				'governance',
				`policy:${id}`,
				`Removed governance policy: ${policy.name}`
			);
		}
	}

	public checkAction(
		actionType: GovernanceActionType,
		context: Record<string, unknown>
	): GovernanceCheckResult {
		for (const policy of this.policies.values()) {
			if (!policy.enabled) continue;

			for (const rule of policy.rules) {
				if (this.evaluateCondition(rule.condition, context)) {
					const result: GovernanceCheckResult = {
						allowed: rule.action !== 'deny',
						requiresApproval: rule.action === 'require_approval',
						message: rule.message,
						severity: rule.severity,
						blockingRule: rule.action === 'deny' ? rule : undefined
					};

					this.logService.info(`[Council Governance] Policy check: ${rule.message} (${policy.enforcement})`);
					return result;
				}
			}
		}

		return {
			allowed: true,
			requiresApproval: false,
			message: 'Action allowed by all policies',
			severity: GovernanceSeverity.Info
		};
	}

	public generateReport(period?: { start: number; end: number }): GovernanceReport {
		let entries = [...this.auditTrail];
		if (period) {
			entries = entries.filter(e => e.timestamp >= period.start && e.timestamp <= period.end);
		}

		const sessions = entries.filter(e => e.actionType === GovernanceActionType.SessionComplete || e.actionType === GovernanceActionType.SessionFailure || e.actionType === GovernanceActionType.SessionCancel);
		const decisions = entries.filter(e => e.actionType === GovernanceActionType.DecisionMade);
		const violations = entries.filter(e => e.actionType === GovernanceActionType.PolicyViolation);
		const debates = entries.filter(e => e.actionType === GovernanceActionType.DebateRecorded);
		const resolvedDebates = entries.filter(e => e.actionType === GovernanceActionType.DebateResolved);

		const sessionEntries = entries.filter(e => e.sessionId && e.metadata?.executionTimeMs);
		const avgConfidence = sessionEntries.length > 0
			? sessionEntries.reduce((sum, e) => sum + (e.metadata?.confidence as number ?? 0), 0) / sessionEntries.length
			: 0;
		const avgExecutionTime = sessionEntries.length > 0
			? sessionEntries.reduce((sum, e) => sum + (e.metadata?.executionTimeMs as number ?? 0), 0) / sessionEntries.length
			: 0;

		const violationCounts = new Map<string, number>();
		for (const v of violations) {
			violationCounts.set(v.details, (violationCounts.get(v.details) ?? 0) + 1);
		}
		const topViolations = Array.from(violationCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([message, count]) => ({ message, count }));

		const agentActivity = new Map<string, { roleId: string; sessions: number; decisions: number }>();
		for (const entry of entries) {
			const roleId = entry.actor;
			if (!agentActivity.has(roleId)) {
				agentActivity.set(roleId, { roleId, sessions: 0, decisions: 0 });
			}
			const activity = agentActivity.get(roleId)!;
			if (entry.actionType === GovernanceActionType.SessionComplete || entry.actionType === GovernanceActionType.SessionStart) {
				activity.sessions++;
			}
			if (entry.actionType === GovernanceActionType.DecisionMade) {
				activity.decisions++;
			}
		}

		return {
			reportId: generateUuid(),
			title: 'Council Governance Report',
			generatedAt: Date.now(),
			period: period ?? { start: entries[0]?.timestamp ?? Date.now(), end: Date.now() },
			totalSessions: sessions.length,
			successfulSessions: entries.filter(e => e.actionType === GovernanceActionType.SessionComplete).length,
			failedSessions: entries.filter(e => e.actionType === GovernanceActionType.SessionFailure).length,
			cancelledSessions: entries.filter(e => e.actionType === GovernanceActionType.SessionCancel).length,
			totalDecisions: decisions.length,
			totalViolations: violations.length,
			totalDebates: debates.length,
			resolvedDebates: resolvedDebates.length,
			averageConfidence: avgConfidence,
			averageExecutionTimeMs: avgExecutionTime,
			topViolations,
			agentActivity: Array.from(agentActivity.values()),
			entries
		};
	}

	public exportAuditTrail(format: 'json' | 'csv'): string {
		if (format === 'json') {
			return JSON.stringify(this.auditTrail, null, 2);
		}

		const headers = ['entryId', 'timestamp', 'actionType', 'severity', 'sessionId', 'actor', 'target', 'details'];
		const lines = [headers.join(',')];

		for (const entry of this.auditTrail) {
			const values = headers.map(h => {
				const value = entry[h as keyof GovernanceAuditEntry];
				if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
				return String(value ?? '');
			});
			lines.push(values.join(','));
		}

		return lines.join('\n');
	}

	public clearAuditTrail(maxAge?: number): number {
		if (maxAge) {
			const cutoff = Date.now() - maxAge;
			const before = this.auditTrail.length;
			const removed = this.auditTrail.splice(0, this.auditTrail.filter(e => e.timestamp < cutoff).length);
			this.saveToStorage();
			this.logService.info(`[Council Governance] Cleared ${removed.length} audit entries older than ${maxAge}ms`);
			return removed.length;
		}

		const count = this.auditTrail.length;
		this.auditTrail.length = 0;
		this.lastHash = '0000000000000000000000000000000000000000000000000000000000000000';
		this.saveToStorage();
		this.logService.info(`[Council Governance] Cleared all ${count} audit entries`);
		return count;
	}

	private computeHash(entry: GovernanceAuditEntry): string {
		const data = `${entry.entryId}${entry.timestamp}${entry.actionType}${entry.actor}${entry.target}${entry.details}${entry.previousHash}`;
		let hash = 0;
		for (let i = 0; i < data.length; i++) {
			const char = data.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return Math.abs(hash).toString(16).padStart(16, '0').repeat(4).substring(0, 64);
	}

	private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
		try {
			const normalized = condition
				.replace(/(\w+)\s*==\s*(\w+)/g, '($1 === $2)')
				.replace(/(\w+)\s*>\s*(\d+)/g, '($1 > $2)')
				.replace(/(\w+)\s*<\s*(\d+)/g, '($1 < $2)')
				.replace(/(\w+)\s*>=\s*(\d+)/g, '($1 >= $2)')
				.replace(/(\w+)\s*<=\s*(\d+)/g, '($1 <= $2)')
				.replace(/&&/g, ' && ')
				.replace(/\|\|/g, ' || ')
				.replace(/!/g, '!');

			const evalContext = { ...context };
			const func = new Function('ctx', `with(ctx) { return ${normalized}; }`);
			return !!func(evalContext);
		} catch {
			return false;
		}
	}
}
