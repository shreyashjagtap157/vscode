/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/council.css';
import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IAgentProfileManager, CouncilAgentProfile } from '../../common/council/agentProfileManager.js';
import { ICouncilOrchestrator, CouncilSession } from '../../common/council/councilOrchestrator.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';

export interface ICouncilWidgetOptions {
	showDebateView?: boolean;
	showProgress?: boolean;
}

export class CouncilSessionWidget extends Disposable {
	public readonly domNode: HTMLElement;
	private readonly titleNode: HTMLElement;
	private readonly statusNode: HTMLElement;
	private readonly agentsNode: HTMLElement;
	private readonly progressNode: HTMLElement;
	private readonly debateNode: HTMLElement;

	private readonly localStore = this._register(new DisposableStore());

	constructor(
		private readonly sessionId: string,
		private readonly options: ICouncilWidgetOptions = {},
		@IAgentProfileManager private readonly profileManager: IAgentProfileManager,
		@ICouncilOrchestrator private readonly orchestrator: ICouncilOrchestrator,
		@IThemeService private readonly themeService: IThemeService
	) {
		super();

		this.domNode = $('.council-session-widget');
		this.domNode.tabIndex = 0;

		this.titleNode = $('.council-session-title', {}, 'Agent Council Session');
		this.domNode.appendChild(this.titleNode);

		this.statusNode = $('.council-session-status', {}, 'Initializing...');
		this.domNode.appendChild(this.statusNode);

		this.progressNode = $('.council-session-progress', {}, '');
		if (options.showProgress !== false) {
			this.domNode.appendChild(this.progressNode);
		}

		this.agentsNode = $('.council-session-agents', {}, '');
		this.domNode.appendChild(this.agentsNode);

		this.debateNode = $('.council-session-debate', {}, '');
		if (options.showDebateView) {
			this.domNode.appendChild(this.debateNode);
		}

		this.updateSessionStatus();
	}

	private updateSessionStatus(): void {
		const session = this.orchestrator.getSession(this.sessionId);
		if (!session) {
			this.statusNode.textContent = 'Session not found';
			return;
		}

		this.statusNode.textContent = `Status: ${session.status.toUpperCase()} | Tasks: ${session.activeTaskGraph.filter(t => t.status === 'completed').length}/${session.activeTaskGraph.length}`;

		this.renderAgentList(session);
	}

	private renderAgentList(session: CouncilSession): void {
		clearNode(this.agentsNode);

		const header = $('.council-agents-header', {}, 'Active Agents');
		this.agentsNode.appendChild(header);

		for (const task of session.activeTaskGraph) {
			const agentRow = $('.council-agent-row');
			
			const statusIcon = $('.council-agent-status');
			switch (task.status) {
				case 'completed':
					statusIcon.appendChild($(ThemeIcon.asCSSSelector(Codicon.check)));
					break;
				case 'in_progress':
					statusIcon.appendChild($(ThemeIcon.asCSSSelector(Codicon.loading)));
					break;
				case 'failed':
					statusIcon.appendChild($(ThemeIcon.asCSSSelector(Codicon.error)));
					break;
				default:
					statusIcon.appendChild($(ThemeIcon.asCSSSelector(Codicon.circle)));
			}
			agentRow.appendChild(statusIcon);

			try {
				const profile = this.profileManager.getProfile(task.assignedRole);
				const agentName = $('.council-agent-name', {}, profile.displayName);
				agentRow.appendChild(agentName);

				const agentTask = $('.council-agent-task', {}, task.description.substring(0, 60) + (task.description.length > 60 ? '...' : ''));
				agentRow.appendChild(agentTask);
			} catch {
				const agentName = $('.council-agent-name', {}, task.assignedRole);
				agentRow.appendChild(agentName);
			}

			this.agentsNode.appendChild(agentRow);
		}
	}

	public update(): void {
		this.updateSessionStatus();
	}

	public renderDebateView(debates: Array<{ topic: string; positions: Array<{ roleId: string; position: string }> }>): void {
		if (!this.options.showDebateView) return;

		clearNode(this.debateNode);
		const header = $('.council-debate-header', {}, 'Agent Debates');
		this.debateNode.appendChild(header);

		for (const debate of debates) {
			const debateItem = $('.council-debate-item');
			const topicNode = $('.council-debate-topic', {}, debate.topic);
			debateItem.appendChild(topicNode);

			for (const position of debate.positions) {
				const positionNode = $('.council-debate-position');
				const roleLabel = $('.council-debate-role', {}, position.roleId);
				positionNode.appendChild(roleLabel);
				
				const contentLabel = $('.council-debate-content', {}, position.position.substring(0, 200));
				positionNode.appendChild(contentLabel);
				
				debateItem.appendChild(positionNode);
			}

			this.debateNode.appendChild(debateItem);
		}
	}
}
