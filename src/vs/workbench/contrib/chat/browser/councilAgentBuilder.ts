/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { addDisposableListener, EventType } from '../../../../../../base/browser/dom.js';
import { $, append, clearNode } from '../../../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IAgentProfileManager, CouncilAgentProfile } from './agentProfileManager.js';
import { ICouncilSmartAgentSelector } from './councilSmartAgentSelector.js';
import { ICouncilLearningEngine } from './councilLearningEngine.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';

export interface AgentBuilderState {
	readonly roleId: string;
	readonly displayName: string;
	readonly baseSystemPrompt: string;
	readonly reasoningStyle: 'critical' | 'pragmatic' | 'optimistic' | 'adversarial';
	readonly priorityWeight: number;
	readonly focusModes: string[];
	readonly preferredTools: string[];
	readonly excludedTools: string[];
	readonly maxTokens: number;
	readonly temperature: number;
	readonly modelOverride?: string;
}

export interface AgentTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly basePrompt: string;
	readonly reasoningStyle: AgentBuilderState['reasoningStyle'];
	readonly defaultFocusModes: string[];
	readonly suggestedWeight: number;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
	{
		id: 'security-auditor',
		name: 'Security Auditor',
		description: 'Focused on finding vulnerabilities and security issues',
		basePrompt: 'You are a Security Auditor specializing in identifying vulnerabilities, security anti-patterns, and compliance issues in code.',
		reasoningStyle: 'critical',
		defaultFocusModes: ['security', 'compliance', 'vulnerability'],
		suggestedWeight: 12
	},
	{
		id: 'performance-engineer',
		name: 'Performance Engineer',
		description: 'Optimizes code for speed, memory, and scalability',
		basePrompt: 'You are a Performance Engineer focused on identifying bottlenecks, optimizing algorithms, and improving resource utilization.',
		reasoningStyle: 'pragmatic',
		defaultFocusModes: ['performance', 'optimization', 'scalability'],
		suggestedWeight: 8
	},
	{
		id: 'test-architect',
		name: 'Test Architect',
		description: 'Designs comprehensive testing strategies',
		basePrompt: 'You are a Test Architect who designs testing strategies, identifies edge cases, and ensures comprehensive test coverage.',
		reasoningStyle: 'critical',
		defaultFocusModes: ['testing', 'coverage', 'regression'],
		suggestedWeight: 9
	},
	{
		id: 'ux-specialist',
		name: 'UX Specialist',
		description: 'Reviews user experience and accessibility',
		basePrompt: 'You are a UX Specialist focused on user experience, accessibility, and interface design quality.',
		reasoningStyle: 'optimistic',
		defaultFocusModes: ['ux', 'accessibility', 'design'],
		suggestedWeight: 7
	},
	{
		id: 'data-engineer',
		name: 'Data Engineer',
		description: 'Reviews data pipelines and database queries',
		basePrompt: 'You are a Data Engineer specializing in data pipelines, database optimization, and data quality.',
		reasoningStyle: 'pragmatic',
		defaultFocusModes: ['data', 'database', 'pipeline'],
		suggestedWeight: 8
	},
	{
		id: 'devops-specialist',
		name: 'DevOps Specialist',
		description: 'Reviews CI/CD, infrastructure, and deployment',
		basePrompt: 'You are a DevOps Specialist focused on CI/CD pipelines, infrastructure as code, and deployment strategies.',
		reasoningStyle: 'pragmatic',
		defaultFocusModes: ['deployment', 'infrastructure', 'monitoring'],
		suggestedWeight: 9
	}
];

export class CouncilAgentBuilder extends Disposable {
	readonly domNode: HTMLElement;

	private readonly _onAgentCreated = this._register(new Emitter<CouncilAgentProfile>());
	readonly onAgentCreated = this._onAgentCreated.event;

	private state: AgentBuilderState;
	private selectedTemplate: AgentTemplate | undefined;

	constructor(
		container: HTMLElement,
		private readonly profileManager: IAgentProfileManager,
		private readonly smartSelector: ICouncilSmartAgentSelector,
		private readonly learningEngine: ICouncilLearningEngine,
		private readonly instantiationService: IInstantiationService
	) {
		super();

		this.state = this.getInitialState();

		this.domNode = append(container, $('.council-agent-builder'));
		this.render();
	}

	private getInitialState(): AgentBuilderState {
		return {
			roleId: '',
			displayName: '',
			baseSystemPrompt: '',
			reasoningStyle: 'pragmatic',
			priorityWeight: 5,
			focusModes: [],
			preferredTools: [],
			excludedTools: [],
			maxTokens: 4000,
			temperature: 0.7
		};
	}

	private render(): void {
		clearNode(this.domNode);

		const header = append(this.domNode, $('.council-agent-builder-header'));
		append(header, $('.council-agent-builder-title', {}, 'Custom Agent Builder'));
		append(header, $('.council-agent-builder-subtitle', {}, 'Create specialized council agents'));

		const content = append(this.domNode, $('.council-agent-builder-content'));

		this.renderTemplateSelector(content);
		this.renderBasicFields(content);
		this.renderPromptEditor(content);
		this.renderConfiguration(content);
		this.renderPreview(content);
		this.renderActions(content);
	}

	private renderTemplateSelector(container: HTMLElement): void {
		const section = append(container, $('.council-agent-builder-section'));
		append(section, $('.council-agent-builder-section-title', {}, 'Start from Template'));

		const grid = append(section, $('.council-agent-builder-template-grid'));

		for (const template of AGENT_TEMPLATES) {
			const card = append(grid, $('.council-agent-builder-template-card'));
			append(card, $('.council-agent-builder-template-name', {}, template.name));
			append(card, $('.council-agent-builder-template-desc', {}, template.description));

			this._register(addDisposableListener(card, EventType.CLICK, () => {
				this.selectedTemplate = template;
				this.applyTemplate(template);
				this.render();
			}));
		}
	}

	private renderBasicFields(container: HTMLElement): void {
		const section = append(container, $('.council-agent-builder-section'));
		append(section, $('.council-agent-builder-section-title', {}, 'Basic Information'));

		const fields = [
			{ label: 'Role ID', key: 'roleId' as const, type: 'text', placeholder: 'e.g., security-auditor' },
			{ label: 'Display Name', key: 'displayName' as const, type: 'text', placeholder: 'e.g., Security Auditor' }
		];

		for (const field of fields) {
			const row = append(section, $('.council-agent-builder-field'));
			append(row, $('.council-agent-builder-field-label', {}, field.label));

			const input = append(row, $('input.council-agent-builder-input', {
				type: field.type,
				placeholder: field.placeholder,
				value: this.state[field.key]
			})) as HTMLInputElement;

			this._register(addDisposableListener(input, EventType.INPUT, () => {
				this.state = { ...this.state, [field.key]: input.value };
			}));
		}
	}

	private renderPromptEditor(container: HTMLElement): void {
		const section = append(container, $('.council-agent-builder-section'));
		append(section, $('.council-agent-builder-section-title', {}, 'System Prompt'));

		const textarea = append(section, $('textarea.council-agent-builder-textarea', {
			placeholder: 'Describe the agent\'s role, expertise, and responsibilities...',
			rows: '6'
		})) as HTMLTextAreaElement;
		textarea.value = this.state.baseSystemPrompt;

		this._register(addDisposableListener(textarea, EventType.INPUT, () => {
			this.state = { ...this.state, baseSystemPrompt: textarea.value };
		}));
	}

	private renderConfiguration(container: HTMLElement): void {
		const section = append(container, $('.council-agent-builder-section'));
		append(section, $('.council-agent-builder-section-title', {}, 'Configuration'));

		const configs = [
			{ label: 'Reasoning Style', key: 'reasoningStyle' as const, options: ['critical', 'pragmatic', 'optimistic', 'adversarial'] },
			{ label: 'Priority Weight (1-20)', key: 'priorityWeight' as const, type: 'range', min: 1, max: 20 },
			{ label: 'Max Tokens', key: 'maxTokens' as const, type: 'number', min: 1000, max: 32000 },
			{ label: 'Temperature (0-1)', key: 'temperature' as const, type: 'range', min: 0, max: 1, step: 0.1 }
		];

		for (const config of configs) {
			const row = append(section, $('.council-agent-builder-field'));
			append(row, $('.council-agent-builder-field-label', {}, config.label));

			if (config.type === 'range') {
				const input = append(row, $('input.council-agent-builder-range', {
					type: 'range',
					min: String(config.min),
					max: String(config.max),
					step: String(config.step ?? 1),
					value: String(this.state[config.key as keyof AgentBuilderState])
				})) as HTMLInputElement;

				const valueLabel = append(row, $('.council-agent-builder-field-value', {}, String(this.state[config.key as keyof AgentBuilderState])));

				this._register(addDisposableListener(input, EventType.INPUT, () => {
					const numValue = parseFloat(input.value);
					this.state = { ...this.state, [config.key]: numValue };
					valueLabel.textContent = input.value;
				}));
			} else if (config.type === 'number') {
				const input = append(row, $('input.council-agent-builder-input', {
					type: 'number',
					min: String(config.min),
					max: String(config.max),
					value: String(this.state[config.key as keyof AgentBuilderState])
				})) as HTMLInputElement;

				this._register(addDisposableListener(input, EventType.INPUT, () => {
					this.state = { ...this.state, [config.key]: parseInt(input.value, 10) };
				}));
			} else if (config.options) {
				const select = append(row, $('select.council-agent-builder-select')) as HTMLSelectElement;
				for (const option of config.options) {
					const opt = append(select, $('option', { value: option }, option));
					if (this.state[config.key as keyof AgentBuilderState] === option) {
						opt.selected = true;
					}
				}

				this._register(addDisposableListener(select, EventType.CHANGE, () => {
					this.state = { ...this.state, [config.key]: select.value };
				}));
			}
		}
	}

	private renderPreview(container: HTMLElement): void {
		const section = append(container, $('.council-agent-builder-section'));
		append(section, $('.council-agent-builder-section-title', {}, 'Preview'));

		const preview = append(section, $('.council-agent-builder-preview'));
		append(preview, $('.council-agent-builder-preview-role', {}, `Role: ${this.state.roleId || 'Not set'}`));
		append(preview, $('.council-agent-builder-preview-name', {}, `Name: ${this.state.displayName || 'Not set'}`));
		append(preview, $('.council-agent-builder-preview-style', {}, `Style: ${this.state.reasoningStyle}`));
		append(preview, $('.council-agent-builder-preview-weight', {}, `Weight: ${this.state.priorityWeight}`));
	}

	private renderActions(container: HTMLElement): void {
		const actions = append(container, $('.council-agent-builder-actions'));

		const createBtn = append(actions, $('.council-agent-builder-btn.council-agent-builder-btn-primary', {}, 'Create Agent'));
		this._register(addDisposableListener(createBtn, EventType.CLICK, () => {
			this.createAgent();
		}));

		const resetBtn = append(actions, $('.council-agent-builder-btn', {}, 'Reset'));
		this._register(addDisposableListener(resetBtn, EventType.CLICK, () => {
			this.state = this.getInitialState();
			this.selectedTemplate = undefined;
			this.render();
		}));
	}

	private applyTemplate(template: AgentTemplate): void {
		this.state = {
			...this.state,
			roleId: template.id,
			displayName: template.name,
			baseSystemPrompt: template.basePrompt,
			reasoningStyle: template.reasoningStyle,
			priorityWeight: template.suggestedWeight,
			focusModes: [...template.defaultFocusModes]
		};
	}

	private createAgent(): void {
		if (!this.state.roleId || !this.state.displayName || !this.state.baseSystemPrompt) {
			return;
		}

		const profile: CouncilAgentProfile = {
			roleId: this.state.roleId,
			displayName: this.state.displayName,
			baseSystemPrompt: this.state.baseSystemPrompt,
			reasoningStyle: this.state.reasoningStyle,
			priorityWeight: this.state.priorityWeight,
			focusModes: this.state.focusModes,
			preferredTools: this.state.preferredTools,
			excludedTools: this.state.excludedTools,
			maxTokens: this.state.maxTokens,
			temperature: this.state.temperature,
			modelOverride: this.state.modelOverride
		};

		this.profileManager.registerProfile(profile);
		this._onAgentCreated.fire(profile);
	}
}
