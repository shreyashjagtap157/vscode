/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { addDisposableListener, EventType } from '../../../../../../base/browser/dom.js';
import { $, append, clearNode } from '../../../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { attachStylerCallback } from '../../../../../../platform/theme/common/themeUtils.js';
import { ICouncilOrchestrator, CouncilSession, CouncilResult } from './councilOrchestrator.js';
import { ICouncilPRReviewBoard, PRReviewResult, ReviewVerdict } from './councilPRReview.js';
import { ICouncilGovernance, GovernanceAuditEntry, GovernanceActionType, GovernanceReport } from './councilGovernance.js';
import { ICouncilPolicyEngine, EngineeringPolicy, PolicyEvaluation, PolicyViolation } from './councilPolicies.js';
import { ICouncilEnterprise, IntegrationConfig, IntegrationType, IntegrationStatus } from './councilEnterprise.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';

export interface IWarRoomPanel {
	readonly id: string;
	readonly title: string;
	readonly icon?: string;
	render(container: HTMLElement): void;
	layout(height: number, width: number): void;
	dispose(): void;
}

export interface WarRoomSessionData {
	readonly sessionId: string;
	readonly request: string;
	readonly result?: CouncilResult;
	readonly policyEvaluation?: PolicyEvaluation;
	readonly startedAt: number;
	readonly completedAt?: number;
}

export class CouncilWarRoom extends Disposable {
	readonly domNode: HTMLElement;

	private readonly header: HTMLElement;
	private readonly tabsContainer: HTMLElement;
	private readonly contentContainer: HTMLElement;
	private readonly panels: Map<string, IWarRoomPanel>;
	private activePanel: IWarRoomPanel | undefined;

	private readonly sessionData: WarRoomSessionData | undefined;
	private readonly currentWidth: number;
	private readonly currentHeight: number;

	constructor(
		container: HTMLElement,
		private readonly sessionDataOrRequest: WarRoomSessionData | string,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICouncilOrchestrator private readonly orchestrator: ICouncilOrchestrator,
		@ICouncilPRReviewBoard private readonly prReviewBoard: ICouncilPRReviewBoard,
		@ICouncilGovernance private readonly governance: ICouncilGovernance,
		@ICouncilPolicyEngine private readonly policyEngine: ICouncilPolicyEngine,
		@ICouncilEnterprise private readonly enterprise: ICouncilEnterprise,
		@IThemeService private readonly themeService: IThemeService
	) {
		super();

		if (typeof sessionDataOrRequest === 'string') {
			this.sessionData = {
				sessionId: 'live',
				request: sessionDataOrRequest,
				startedAt: Date.now()
			};
		} else {
			this.sessionData = sessionDataOrRequest;
		}

		this.currentWidth = 800;
		this.currentHeight = 600;
		this.panels = new Map();

		this.domNode = append(container, $('.council-war-room'));
		this.domNode.style.display = 'flex';
		this.domNode.style.flexDirection = 'column';
		this.domNode.style.height = '100%';

		this.header = append(this.domNode, $('.council-war-room-header'));
		this.renderHeader();

		this.tabsContainer = append(this.domNode, $('.council-war-room-tabs'));
		this.renderTabs();

		this.contentContainer = append(this.domNode, $('.council-war-room-content'));
		this.contentContainer.style.flex = '1';
		this.contentContainer.style.overflow = 'auto';

		this.initializePanels();
		this.activatePanel('overview');

		this._register(attachStylerCallback(this.themeService, {}, () => {
			this.applyTheme();
		}));
	}

	private renderHeader(): void {
		clearNode(this.header);
		this.header.classList.add('council-war-room-header');

		const title = append(this.header, $('.council-war-room-title'));
		title.textContent = 'Council War Room';

		const sessionId = append(this.header, $('.council-war-room-session-id'));
		sessionId.textContent = `Session: ${this.sessionData?.sessionId ?? 'N/A'}`;

		if (this.sessionData?.result) {
			const status = append(this.header, $('.council-war-room-status'));
			status.textContent = this.sessionData.result.status.toUpperCase();
			status.classList.add(`status-${this.sessionData.result.status}`);
		}
	}

	private renderTabs(): void {
		clearNode(this.tabsContainer);
		this.tabsContainer.classList.add('council-war-room-tabs');

		const tabs = [
			{ id: 'overview', title: 'Overview', icon: '📊' },
			{ id: 'agents', title: 'Agents', icon: '🤖' },
			{ id: 'policies', title: 'Policies', icon: '📋' },
			{ id: 'governance', title: 'Governance', icon: '⚖️' },
			{ id: 'integrations', title: 'Integrations', icon: '🔗' },
			{ id: 'timeline', title: 'Timeline', icon: '📅' }
		];

		for (const tab of tabs) {
			const tabElement = append(this.tabsContainer, $('.council-war-room-tab'));
			tabElement.dataset.tabId = tab.id;

			const icon = append(tabElement, $('.council-war-room-tab-icon'));
			icon.textContent = tab.icon ?? '';

			const label = append(tabElement, $('.council-war-room-tab-label'));
			label.textContent = tab.title;

			this._register(addDisposableListener(tabElement, EventType.CLICK, () => {
				this.activatePanel(tab.id);
			}));
		}
	}

	private initializePanels(): void {
		this.panels.set('overview', new WarRoomOverviewPanel(this.sessionData, this.orchestrator, this.policyEngine, this.instantiationService));
		this.panels.set('agents', new WarRoomAgentsPanel(this.sessionData, this.orchestrator, this.instantiationService));
		this.panels.set('policies', new WarRoomPoliciesPanel(this.policyEngine, this.instantiationService));
		this.panels.set('governance', new WarRoomGovernancePanel(this.governance, this.instantiationService));
		this.panels.set('integrations', new WarRoomIntegrationsPanel(this.enterprise, this.instantiationService));
		this.panels.set('timeline', new WarRoomTimelinePanel(this.governance, this.instantiationService));
	}

	private activatePanel(panelId: string): void {
		const tabs = this.tabsContainer.querySelectorAll('.council-war-room-tab');
		tabs.forEach(tab => {
			tab.classList.toggle('active', tab.dataset.tabId === panelId);
		});

		if (this.activePanel) {
			this.activePanel.dispose();
		}

		clearNode(this.contentContainer);

		const panel = this.panels.get(panelId);
		if (panel) {
			this.activePanel = panel;
			panel.render(this.contentContainer);
			panel.layout(this.currentHeight - 100, this.currentWidth);
		}
	}

	private applyTheme(): void {
		const theme = this.themeService.getColorTheme();
		this.domNode.style.backgroundColor = theme.getColor('editor.background')?.toString() ?? '';
	}

	public layout(height: number, width: number): void {
		this.currentHeight = height;
		this.currentWidth = width;
		if (this.activePanel) {
			this.activePanel.layout(height - 100, width);
		}
	}
}

class WarRoomOverviewPanel extends Disposable implements IWarRoomPanel {
	readonly id = 'overview';
	readonly title = 'Overview';

	constructor(
		private readonly sessionData: WarRoomSessionData | undefined,
		private readonly orchestrator: ICouncilOrchestrator,
		private readonly policyEngine: ICouncilPolicyEngine,
		private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	render(container: HTMLElement): void {
		clearNode(container);
		container.classList.add('council-war-room-panel');

		const content = append(container, $('.council-war-room-panel-content'));

		if (this.sessionData) {
			append(content, this.createSection('Session Information', this.renderSessionInfo()));
			append(content, this.createSection('Council Result', this.renderResult()));
			append(content, this.createSection('Policy Compliance', this.renderPolicyCompliance()));
			append(content, this.createSection('Quick Actions', this.renderQuickActions()));
		}
	}

	layout(height: number, width: number): void { }

	private createSection(title: string, content: HTMLElement): HTMLElement {
		const section = $('.council-war-room-section');
		const header = append(section, $('.council-war-room-section-header'));
		header.textContent = title;
		append(section, content);
		return section;
	}

	private renderSessionInfo(): HTMLElement {
		const container = $('.council-war-room-info-grid');

		const items = [
			{ label: 'Session ID', value: this.sessionData?.sessionId ?? 'N/A' },
			{ label: 'Started', value: this.sessionData ? new Date(this.sessionData.startedAt).toLocaleString() : 'N/A' },
			{ label: 'Duration', value: this.sessionData?.completedAt ? `${((this.sessionData.completedAt - this.sessionData.startedAt) / 1000).toFixed(1)}s` : 'In Progress' },
			{ label: 'Status', value: this.sessionData?.result?.status ?? 'pending' }
		];

		for (const item of items) {
			const row = append(container, $('.council-war-room-info-row'));
			append(row, $('.council-war-room-info-label', {}, item.label));
			append(row, $('.council-war-room-info-value', {}, item.value));
		}

		return container;
	}

	private renderResult(): HTMLElement {
		const container = $('.council-war-room-result');

		if (this.sessionData?.result) {
			const result = this.sessionData.result;

			const confidence = append(container, $('.council-war-room-confidence'));
			const confidenceBar = append(confidence, $('.council-war-room-confidence-bar'));
			const confidenceFill = append(confidenceBar, $('.council-war-room-confidence-fill'));
			confidenceFill.style.width = `${result.confidence * 100}%`;
			append(confidence, $('.council-war-room-confidence-text', {}, `${(result.confidence * 100).toFixed(1)}%`));

			const stats = append(container, $('.council-war-room-stats'));
			append(stats, $('.council-war-room-stat', {}, `Tasks: ${result.contributions.size}`));
			append(stats, $('.council-war-room-stat', {}, `Debates: ${result.debateRecords.length}`));
			append(stats, $('.council-war-room-stat', {}, `Time: ${(result.executionTimeMs / 1000).toFixed(1)}s`));
		} else {
			append(container, $('.council-war-room-empty', {}, 'No result available yet'));
		}

		return container;
	}

	private renderPolicyCompliance(): HTMLElement {
		const container = $('.council-war-room-policy');

		if (this.sessionData?.policyEvaluation) {
			const eval_ = this.sessionData.policyEvaluation;
			append(container, $('.council-war-room-policy-score', {}, `Score: ${(eval_.score * 100).toFixed(1)}%`));
			append(container, $('.council-war-room-policy-status', {}, eval_.passed ? 'PASSED' : 'VIOLATIONS FOUND'));

			if (eval_.violations.length > 0) {
				const violations = append(container, $('.council-war-room-violations'));
				for (const violation of eval_.violations.slice(0, 5)) {
					append(violations, $('.council-war-room-violation', {}, `${violation.severity}: ${violation.message}`));
				}
			}
		} else {
			append(container, $('.council-war-room-empty', {}, 'No policy evaluation available'));
		}

		return container;
	}

	private renderQuickActions(): HTMLElement {
		const container = $('.council-war-room-actions');

		const actions = [
			{ label: 'Re-run Council', action: 'rerun' },
			{ label: 'Export Report', action: 'export' },
			{ label: 'Create PR Review', action: 'pr-review' },
			{ label: 'View Audit Trail', action: 'audit' }
		];

		for (const action of actions) {
			const btn = append(container, $('.council-war-room-action-btn', {}, action.label));
			this._register(addDisposableListener(btn, EventType.CLICK, () => {
				// Action handlers would be wired up here
			}));
		}

		return container;
	}
}

class WarRoomAgentsPanel extends Disposable implements IWarRoomPanel {
	readonly id = 'agents';
	readonly title = 'Agents';

	constructor(
		private readonly sessionData: WarRoomSessionData | undefined,
		private readonly orchestrator: ICouncilOrchestrator,
		private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	render(container: HTMLElement): void {
		clearNode(container);
		container.classList.add('council-war-room-panel');

		const content = append(container, $('.council-war-room-panel-content'));

		if (this.sessionData?.result) {
			const contributions = Array.from(this.sessionData.result.contributions.entries());
			for (const [roleId, content_] of contributions) {
				const card = append(content, $('.council-war-room-agent-card'));
				append(card, $('.council-war-room-agent-name', {}, roleId));
				append(card, $('.council-war-room-agent-content', {}, content_.substring(0, 500) + (content_.length > 500 ? '...' : '')));
			}
		} else {
			append(content, $('.council-war-room-empty', {}, 'No agent contributions available'));
		}
	}

	layout(height: number, width: number): void { }
}

class WarRoomPoliciesPanel extends Disposable implements IWarRoomPanel {
	readonly id = 'policies';
	readonly title = 'Policies';

	constructor(
		private readonly policyEngine: ICouncilPolicyEngine,
		private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	render(container: HTMLElement): void {
		clearNode(container);
		container.classList.add('council-war-room-panel');

		const content = append(container, $('.council-war-room-panel-content'));

		const policies = this.policyEngine.getPolicies();
		for (const policy of policies) {
			const card = append(content, $('.council-war-room-policy-card'));
			const header = append(card, $('.council-war-room-policy-card-header'));
			append(header, $('.council-war-room-policy-name', {}, policy.name));
			append(header, $('.council-war-room-policy-status', { class: policy.enabled ? 'enabled' : 'disabled' }, policy.enabled ? 'Enabled' : 'Disabled'));

			append(card, $('.council-war-room-policy-description', {}, policy.description));
			append(card, $('.council-war-room-policy-rules', {}, `${policy.rules.length} rules`));
		}
	}

	layout(height: number, width: number): void { }
}

class WarRoomGovernancePanel extends Disposable implements IWarRoomPanel {
	readonly id = 'governance';
	readonly title = 'Governance';

	constructor(
		private readonly governance: ICouncilGovernance,
		private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	render(container: HTMLElement): void {
		clearNode(container);
		container.classList.add('council-war-room-panel');

		const content = append(container, $('.council-war-room-panel-content'));

		const report = this.governance.generateReport();

		append(content, this.createStatGrid([
			{ label: 'Total Sessions', value: report.totalSessions.toString() },
			{ label: 'Successful', value: report.successfulSessions.toString() },
			{ label: 'Failed', value: report.failedSessions.toString() },
			{ label: 'Avg Confidence', value: `${(report.averageConfidence * 100).toFixed(1)}%` },
			{ label: 'Avg Time', value: `${(report.averageExecutionTimeMs / 1000).toFixed(1)}s` },
			{ label: 'Violations', value: report.totalViolations.toString() }
		]));

		const chainStatus = append(content, $('.council-war-room-chain-status'));
		const valid = this.governance.verifyChain();
		append(chainStatus, $('.council-war-room-chain-label', {}, 'Audit Chain'));
		append(chainStatus, $('.council-war-room-chain-value', { class: valid ? 'valid' : 'invalid' }, valid ? 'Valid' : 'Invalid'));
	}

	layout(height: number, width: number): void { }

	private createStatGrid(stats: Array<{ label: string; value: string }>): HTMLElement {
		const grid = $('.council-war-room-stat-grid');
		for (const stat of stats) {
			const item = append(grid, $('.council-war-room-stat-item'));
			append(item, $('.council-war-room-stat-label', {}, stat.label));
			append(item, $('.council-war-room-stat-value', {}, stat.value));
		}
		return grid;
	}
}

class WarRoomIntegrationsPanel extends Disposable implements IWarRoomPanel {
	readonly id = 'integrations';
	readonly title = 'Integrations';

	constructor(
		private readonly enterprise: ICouncilEnterprise,
		private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	render(container: HTMLElement): void {
		clearNode(container);
		container.classList.add('council-war-room-panel');

		const content = append(container, $('.council-war-room-panel-content'));

		const integrations = this.enterprise.getIntegrations();
		if (integrations.length === 0) {
			append(content, $('.council-war-room-empty', {}, 'No integrations configured. Add GitHub, Jira, or Slack connections.'));
			return;
		}

		for (const integration of integrations) {
			const card = append(content, $('.council-war-room-integration-card'));
			const header = append(card, $('.council-war-room-integration-header'));
			append(header, $('.council-war-room-integration-icon', {}, this.getIntegrationIcon(integration.type)));
			append(header, $('.council-war-room-integration-name', {}, integration.name));
			append(header, $('.council-war-room-integration-status', { class: integration.status }, integration.status));

			append(card, $('.council-war-room-integration-type', {}, integration.type));
		}
	}

	layout(height: number, width: number): void { }

	private getIntegrationIcon(type: IntegrationType): string {
		switch (type) {
			case IntegrationType.GitHub: return '🐙';
			case IntegrationType.Jira: return '📋';
			case IntegrationType.Slack: return '💬';
			case IntegrationType.GitHubActions: return '⚡';
			default: return '🔗';
		}
	}
}

class WarRoomTimelinePanel extends Disposable implements IWarRoomPanel {
	readonly id = 'timeline';
	readonly title = 'Timeline';

	constructor(
		private readonly governance: ICouncilGovernance,
		private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	render(container: HTMLElement): void {
		clearNode(container);
		container.classList.add('council-war-room-panel');

		const content = append(container, $('.council-war-room-panel-content'));

		const entries = this.governance.getAuditTrail(undefined, 50);
		for (const entry of entries) {
			const item = append(content, $('.council-war-room-timeline-item'));
			const time = append(item, $('.council-war-room-timeline-time', {}, new Date(entry.timestamp).toLocaleTimeString()));
			const action = append(item, $('.council-war-room-timeline-action', {}, entry.actionType));
			const details = append(item, $('.council-war-room-timeline-details', {}, entry.details));

			action.classList.add(`severity-${entry.severity}`);
		}
	}

	layout(height: number, width: number): void { }
}
