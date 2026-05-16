/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IAgentProfileManager, CouncilAgentProfile } from '../../common/council/agentProfileManager.js';
import { SelectBox } from '../../../../../base/browser/ui/selectBox/selectBox.js';
import { Toggle } from '../../../../../base/browser/ui/toggle/toggle.js';
import { localize } from '../../../../../nls.js';

export class CouncilConfigurationPanel extends Disposable {
	public readonly domNode: HTMLElement;
	private readonly localStore = this._register(new DisposableStore());

	private selectedRoles: Set<string> = new Set();
	private selectedStrategy: string = 'evidence-weighted';
	private enableDebateView: boolean = true;

	constructor(
		@IAgentProfileManager private readonly profileManager: IAgentProfileManager,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		this.domNode = $('.council-config-panel');

		this.renderHeader();
		this.renderAgentSelector();
		this.renderStrategySelector();
		this.renderOptions();
	}

	private renderHeader(): void {
		const header = $('.council-config-header');
		const title = $('.council-config-title', {}, localize('council.config.title', 'Agent Council Configuration'));
		const description = $('.council-config-description', {}, 
			localize('council.config.description', 'Configure which agents participate in the council and how they reach consensus.')
		);
		header.appendChild(title);
		header.appendChild(description);
		this.domNode.appendChild(header);
	}

	private renderAgentSelector(): void {
		const section = $('.council-config-section');
		const sectionTitle = $('.council-config-section-title', {}, localize('council.config.agents', 'Agent Selection'));
		section.appendChild(sectionTitle);

		const agentList = $('.council-agent-list');
		const profiles = this.profileManager.getAllProfiles();

		for (const profile of profiles) {
			const agentItem = this.createAgentItem(profile);
			agentList.appendChild(agentItem);
		}

		section.appendChild(agentList);
		this.domNode.appendChild(section);
	}

	private createAgentItem(profile: CouncilAgentProfile): HTMLElement {
		const item = $('.council-agent-item');
		
		const checkbox = new Toggle({
			isChecked: this.selectedRoles.has(profile.roleId) || this.selectedRoles.size === 0,
			title: profile.displayName,
			icon: undefined
		});

		if (this.selectedRoles.size === 0) {
			this.selectedRoles.add(profile.roleId);
		}

		this.localStore.add(checkbox.onChange(() => {
			if (checkbox.checked) {
				this.selectedRoles.add(profile.roleId);
			} else {
				this.selectedRoles.delete(profile.roleId);
			}
		}));

		const label = $('.council-agent-label');
		const name = $('.council-agent-name', {}, profile.displayName);
		const description = $('.council-agent-description', {}, 
			`${profile.reasoningStyle} • Priority: ${profile.priorityWeight} • Focus: ${profile.focusModes.join(', ')}`
		);
		label.appendChild(name);
		label.appendChild(description);

		item.appendChild(checkbox.domNode);
		item.appendChild(label);

		return item;
	}

	private renderStrategySelector(): void {
		const section = $('.council-config-section');
		const sectionTitle = $('.council-config-section-title', {}, localize('council.config.strategy', 'Consensus Strategy'));
		section.appendChild(sectionTitle);

		const strategies = [
			{ value: 'evidence-weighted', label: localize('council.strategy.evidence', 'Evidence-Weighted') },
			{ value: 'majority', label: localize('council.strategy.majority', 'Majority Vote') },
			{ value: 'specialist-priority', label: localize('council.strategy.specialist', 'Specialist Priority') },
			{ value: 'coordinator-override', label: localize('council.strategy.coordinator', 'Coordinator Override') }
		];

		const selectBox = this.localStore.add(new SelectBox(
			strategies.map(s => s.label),
			0,
			{
				contextViewProvider: undefined
			}
		));

		selectBox.setDetailsElement($('div', { class: 'select-box-details' }));

		this.localStore.add(selectBox.onDidSelect(e => {
			this.selectedStrategy = strategies[e.index].value;
		}));

		const strategyDescription = $('.council-config-description', {},
			localize('council.strategy.description', 'Determines how the council resolves disagreements between agents.')
		);

		section.appendChild(selectBox.domNode);
		section.appendChild(strategyDescription);
		this.domNode.appendChild(section);
	}

	private renderOptions(): void {
		const section = $('.council-config-section');
		const sectionTitle = $('.council-config-section-title', {}, localize('council.config.options', 'Options'));
		section.appendChild(sectionTitle);

		const debateToggle = new Toggle({
			isChecked: this.enableDebateView,
			title: localize('council.option.debate', 'Enable Debate View'),
			icon: undefined
		});

		this.localStore.add(debateToggle.onChange(() => {
			this.enableDebateView = debateToggle.checked;
		}));

		const debateLabel = $('.council-agent-label');
		const debateTitle = $('.council-agent-name', {}, localize('council.option.debate.title', 'Show Agent Debates'));
		const debateDesc = $('.council-agent-description', {}, 
			localize('council.option.debate.description', 'Display disagreements and resolutions between agents.')
		);
		debateLabel.appendChild(debateTitle);
		debateLabel.appendChild(debateDesc);

		const debateRow = $('.council-agent-item');
		debateRow.appendChild(debateToggle.domNode);
		debateRow.appendChild(debateLabel);

		section.appendChild(debateRow);
		this.domNode.appendChild(section);
	}

	public getConfiguration(): { roles: string[]; strategy: string; debateView: boolean } {
		return {
			roles: this.selectedRoles.size > 0 ? Array.from(this.selectedRoles) : this.profileManager.getAllProfiles().map(p => p.roleId),
			strategy: this.selectedStrategy,
			debateView: this.enableDebateView
		};
	}
}
