/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/council.css';
import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IAgentProfileManager, CouncilAgentProfile } from '../../common/council/agentProfileManager.js';
import { ICouncilOrchestrator, CouncilSession } from '../../common/council/councilOrchestrator.js';
import { ICouncilSessionManager, CouncilSessionRecord } from '../../common/council/councilSessionManager.js';
import { IDebateResolver, DebateRecord } from '../../common/council/debateResolver.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IViewPaneOptions, ViewPane } from '../../../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, IContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';

export const COUNCIL_DASHBOARD_VIEW_ID = 'workbench.view.councilDashboard';

export class CouncilDashboardView extends ViewPane {
	static readonly ID = COUNCIL_DASHBOARD_VIEW_ID;
	static readonly TITLE = 'Agent Council Dashboard';

	private readonly localStore = this._register(new DisposableStore());
	private readonly sessionsContainer: HTMLElement;
	private readonly statsContainer: HTMLElement;
	private readonly agentsContainer: HTMLElement;
	private readonly debatesContainer: HTMLElement;

	private contextKey: IContextKey<boolean>;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICouncilOrchestrator private readonly orchestrator: ICouncilOrchestrator,
		@IAgentProfileManager private readonly profileManager: IAgentProfileManager,
		@ICouncilSessionManager private readonly sessionManager: ICouncilSessionManager,
		@IDebateResolver private readonly debateResolver: IDebateResolver,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewsService viewsService: IViewsService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService
	) {
		super({ ...options, titleMenuId: { id: 'councilDashboard' } }, keybindingService, contextMenuService, configurationService, contextKeyService, viewsService, telemetryService, themeService);
		
		this.contextKey = contextKeyService.createKey<boolean>('councilDashboardVisible', true);
		
		this.sessionsContainer = $('.council-sessions-container');
		this.statsContainer = $('.council-stats-container');
		this.agentsContainer = $('.council-agents-container');
		this.debatesContainer = $('.council-debates-container');

		this.localStore.add(this.sessionManager.onSessionCompleted(() => this.refresh()));
		this.localStore.add(this.debateResolver.onDebateResolved(() => this.refresh()));
	}

	protected override renderBody(container: HTMLElement): void {
		container.classList.add('council-dashboard');

		const header = $('.council-dashboard-header');
		const title = $('.council-dashboard-title', {}, 'Agent Council Dashboard');
		const description = $('.council-dashboard-description', {}, 'Monitor and manage multi-agent council sessions');
		header.appendChild(title);
		header.appendChild(description);
		container.appendChild(header);

		const tabs = $('.council-dashboard-tabs');
		const tabButtons = [
			{ id: 'sessions', label: 'Sessions', icon: Codicon.listTree },
			{ id: 'stats', label: 'Statistics', icon: Codicon.graph },
			{ id: 'agents', label: 'Agents', icon: Codicon.organization },
			{ id: 'debates', label: 'Debates', icon: Codicon.commentDiscussion }
		];

		let activeTab = 'sessions';

		for (const tab of tabButtons) {
			const btn = $('.council-tab-btn', { 'data-tab': tab.id });
			btn.appendChild($(ThemeIcon.asCSSSelector(tab.icon)));
			btn.appendChild($('.council-tab-label', {}, tab.label));
			
			if (tab.id === activeTab) {
				btn.classList.add('active');
			}

			this.localStore.add(addDisposableListener(btn, 'click', () => {
				activeTab = tab.id;
				tabButtons.forEach(t => {
					const existing = tabs.querySelector(`[data-tab="${t.id}"]`);
					existing?.classList.remove('active');
				});
				btn.classList.add('active');
				this.showTab(tab.id);
			}));

			tabs.appendChild(btn);
		}

		container.appendChild(tabs);

		const content = $('.council-dashboard-content');
		content.appendChild(this.sessionsContainer);
		content.appendChild(this.statsContainer);
		content.appendChild(this.agentsContainer);
		content.appendChild(this.debatesContainer);
		container.appendChild(content);

		this.showTab('sessions');
		this.refresh();
	}

	private showTab(tabId: string): void {
		this.sessionsContainer.style.display = tabId === 'sessions' ? 'block' : 'none';
		this.statsContainer.style.display = tabId === 'stats' ? 'block' : 'none';
		this.agentsContainer.style.display = tabId === 'agents' ? 'block' : 'none';
		this.debatesContainer.style.display = tabId === 'debates' ? 'block' : 'none';

		if (tabId === 'sessions') this.renderSessions();
		if (tabId === 'stats') this.renderStats();
		if (tabId === 'agents') this.renderAgents();
		if (tabId === 'debates') this.renderDebates();
	}

	private refresh(): void {
		const activeTab = this.getActiveTab();
		if (activeTab === 'sessions') this.renderSessions();
		if (activeTab === 'stats') this.renderStats();
		if (activeTab === 'agents') this.renderAgents();
		if (activeTab === 'debates') this.renderDebates();
	}

	private getActiveTab(): string {
		const activeBtn = this.bodyContainer?.querySelector('.council-tab-btn.active');
		return activeBtn?.getAttribute('data-tab') || 'sessions';
	}

	private renderSessions(): void {
		clearNode(this.sessionsContainer);

		const header = $('.council-section-header', {}, 'Recent Sessions');
		this.sessionsContainer.appendChild(header);

		const sessions = this.sessionManager.getRecentSessions(20);

		if (sessions.length === 0) {
			this.sessionsContainer.appendChild($('.council-empty-state', {}, 'No sessions yet. Start a council session from the chat panel.'));
			return;
		}

		const list = $('.council-session-list');
		
		for (const session of sessions) {
			const item = this.createSessionItem(session);
			list.appendChild(item);
		}

		this.sessionsContainer.appendChild(list);
	}

	private createSessionItem(session: CouncilSessionRecord): HTMLElement {
		const item = $('.council-session-item');
		
		const statusIcon = $('.council-session-status-icon');
		switch (session.status) {
			case 'success':
				statusIcon.appendChild($(ThemeIcon.asCSSSelector(Codicon.check)));
				statusIcon.classList.add('success');
				break;
			case 'partial':
				statusIcon.appendChild($(ThemeIcon.asCSSSelector(Codicon.warning)));
				statusIcon.classList.add('warning');
				break;
			case 'failed':
				statusIcon.appendChild($(ThemeIcon.asCSSSelector(Codicon.error)));
				statusIcon.classList.add('error');
				break;
		}
		item.appendChild(statusIcon);

		const content = $('.council-session-content');
		
		const requestPreview = session.request.length > 80 ? session.request.substring(0, 80) + '...' : session.request;
		content.appendChild($('.council-session-request', {}, requestPreview));

		const meta = $('.council-session-meta');
		meta.appendChild($('.council-session-confidence', {}, `Confidence: ${(session.confidence * 100).toFixed(0)}%`));
		meta.appendChild($('.council-session-duration', {}, `Duration: ${(session.executionTimeMs / 1000).toFixed(1)}s`));
		meta.appendChild($('.council-session-time', {}, new Date(session.timestamp).toLocaleString()));
		
		content.appendChild(meta);
		item.appendChild(content);

		return item;
	}

	private renderStats(): void {
		clearNode(this.statsContainer);

		const header = $('.council-section-header', {}, 'Session Statistics');
		this.statsContainer.appendChild(header);

		const stats = this.sessionManager.getSessionStats();

		const statsGrid = $('.council-stats-grid');
		
		const statCards = [
			{ label: 'Total Sessions', value: stats.total.toString(), icon: Codicon.listTree },
			{ label: 'Avg Confidence', value: `${(stats.avgConfidence * 100).toFixed(0)}%`, icon: Codicon.check },
			{ label: 'Avg Duration', value: `${(stats.avgDuration / 1000).toFixed(1)}s`, icon: Codicon.clock },
			{ label: 'Success Rate', value: `${(stats.successRate * 100).toFixed(0)}%`, icon: Codicon.pass }
		];

		for (const stat of statCards) {
			const card = $('.council-stat-card');
			card.appendChild($(ThemeIcon.asCSSSelector(stat.icon)));
			card.appendChild($('.council-stat-value', {}, stat.value));
			card.appendChild($('.council-stat-label', {}, stat.label));
			statsGrid.appendChild(card);
		}

		this.statsContainer.appendChild(statsGrid);

		const rolesBreakdown = $('.council-roles-breakdown');
		rolesBreakdown.appendChild($('.council-section-subheader', {}, 'Agent Usage'));

		const profiles = this.profileManager.getAllProfiles();
		for (const profile of profiles) {
			const sessions = this.sessionManager.getSessionsByRole(profile.roleId);
			const row = $('.council-role-row');
			row.appendChild($('.council-role-name', {}, profile.displayName));
			row.appendChild($('.council-role-count', {}, `${sessions.length} sessions`));
			rolesBreakdown.appendChild(row);
		}

		this.statsContainer.appendChild(rolesBreakdown);
	}

	private renderAgents(): void {
		clearNode(this.agentsContainer);

		const header = $('.council-section-header', {}, 'Agent Profiles');
		this.agentsContainer.appendChild(header);

		const profiles = this.profileManager.getAllProfiles();
		const grid = $('.council-agents-grid');

		for (const profile of profiles) {
			const card = this.createAgentCard(profile);
			grid.appendChild(card);
		}

		this.agentsContainer.appendChild(grid);
	}

	private createAgentCard(profile: CouncilAgentProfile): HTMLElement {
		const card = $('.council-agent-card');
		
		const icon = $('.council-agent-icon');
		icon.appendChild($(ThemeIcon.asCSSSelector(Codicon.person)));
		card.appendChild(icon);

		card.appendChild($('.council-agent-name', {}, profile.displayName));
		card.appendChild($('.council-agent-role', {}, profile.roleId));
		
		const details = $('.council-agent-details');
		details.appendChild($('.council-agent-detail', {}, `Style: ${profile.reasoningStyle}`));
		details.appendChild($('.council-agent-detail', {}, `Priority: ${profile.priorityWeight}`));
		details.appendChild($('.council-agent-detail', {}, `Focus: ${profile.focusModes.join(', ')}`));
		card.appendChild(details);

		return card;
	}

	private renderDebates(): void {
		clearNode(this.debatesContainer);

		const header = $('.council-section-header', {}, 'Debate History');
		this.debatesContainer.appendChild(header);

		const debates = this.debateResolver.getDebateHistory();

		if (debates.length === 0) {
			this.debatesContainer.appendChild($('.council-empty-state', {}, 'No debates recorded. Debates appear when agents disagree.'));
			return;
		}

		const list = $('.council-debate-list');
		
		for (const debate of debates.slice(-10)) {
			const item = this.createDebateItem(debate);
			list.appendChild(item);
		}

		this.debatesContainer.appendChild(list);
	}

	private createDebateItem(debate: DebateRecord): HTMLElement {
		const item = $('.council-debate-item');
		
		const statusBadge = $('.council-debate-status-badge');
		if (debate.resolved) {
			statusBadge.textContent = 'Resolved';
			statusBadge.classList.add('resolved');
		} else {
			statusBadge.textContent = 'Unresolved';
			statusBadge.classList.add('unresolved');
		}
		item.appendChild(statusBadge);

		item.appendChild($('.council-debate-topic', {}, debate.topic));
		item.appendChild($('.council-debate-type', {}, `Type: ${debate.conflictType}`));

		const positions = $('.council-debate-positions');
		for (const position of debate.positions) {
			const posItem = $('.council-debate-position');
			posItem.appendChild($('.council-debate-role', {}, position.roleName));
			posItem.appendChild($('.council-debate-position-text', {}, position.position.substring(0, 100) + '...'));
			positions.appendChild(posItem);
		}
		item.appendChild(positions);

		if (debate.resolved && debate.resolution) {
			item.appendChild($('.council-debate-resolution', {}, `Resolution: ${debate.resolution.substring(0, 150)}...`));
		}

		return item;
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
