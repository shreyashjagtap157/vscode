/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { URI } from '../../../../../../base/common/uri.js';

export const IAgentProfileManager = createDecorator<IAgentProfileManager>('agentProfileManager');

export interface CouncilAgentProfile {
	readonly roleId: string;
	readonly displayName: string;
	readonly iconPath?: URI;
	readonly baseSystemPrompt: string;
	readonly reasoningStyle: 'critical' | 'pragmatic' | 'optimistic' | 'adversarial';
	readonly priorityWeight: number;
	readonly preferredTools: string[];
	readonly excludedTools?: string[];
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly focusModes: string[];
	readonly modelOverride?: string;
}

export interface ProfileValidationError {
	field: string;
	message: string;
}

export class ProfileValidationError extends Error {
	constructor(public readonly errors: ProfileValidationError[]) {
		super(`Profile validation failed: ${errors.map(e => `${e.field}: ${e.message}`).join(', ')}`);
		this.name = 'ProfileValidationError';
	}
}

export const COUNCIL_PROTOCOL = `## Council Protocol
1. You are part of a multi-agent council. Collaborate with other agents to produce the best outcome.
2. Always provide evidence-backed reasoning. Cite files as [File:path:line] and logs as [Log:identifier].
3. If you disagree with another agent's proposal, explain why with specific evidence.
4. Start every response with <role_id>YOUR_ROLE_ID</role_id> to maintain identity.
5. Do not make assumptions without stating them explicitly.
6. If you lack sufficient information, request it from the Coordinator rather than guessing.`;

export const DEFAULT_COUNCIL_PROFILES: Record<string, CouncilAgentProfile> = {
	'architect': {
		roleId: 'architect',
		displayName: 'Systems Architect',
		baseSystemPrompt: 'You are a Systems Architect. Focus on high-level design, scalability, modularity, and long-term maintainability. Ensure the solution follows established design patterns and avoids technical debt.',
		reasoningStyle: 'pragmatic',
		priorityWeight: 10,
		preferredTools: ['editFileTool', 'manageTodoListTool'],
		focusModes: ['architecture', 'design', 'maintainability']
	},
	'backend': {
		roleId: 'backend',
		displayName: 'Backend Engineer',
		baseSystemPrompt: 'You are a Senior Backend Engineer. Focus on efficient data processing, API integrity, concurrency, and performance. Ensure logic is robust and handles edge cases.',
		reasoningStyle: 'pragmatic',
		priorityWeight: 8,
		preferredTools: ['editFileTool', 'runSubagentTool'],
		focusModes: ['implementation', 'performance', 'reliability']
	},
	'security': {
		roleId: 'security',
		displayName: 'Security Engineer',
		baseSystemPrompt: 'You are a Security Specialist. Your primary goal is to find vulnerabilities, attack vectors, and compliance issues. Be highly critical and skeptical of proposed implementations.',
		reasoningStyle: 'critical',
		priorityWeight: 12,
		preferredTools: ['runSubagentTool'],
		focusModes: ['security', 'compliance', 'vulnerability']
	},
	'qa': {
		roleId: 'qa',
		displayName: 'QA Engineer',
		baseSystemPrompt: 'You are a QA Automation Engineer. Focus on testability, edge cases, regression risk, and verification. Ensure there is a clear path to verify every claim made by other agents.',
		reasoningStyle: 'critical',
		priorityWeight: 9,
		preferredTools: ['runSubagentTool'],
		focusModes: ['testing', 'verification', 'regression']
	},
	'devops': {
		roleId: 'devops',
		displayName: 'DevOps/SRE Engineer',
		baseSystemPrompt: 'You are a DevOps/SRE Engineer. Focus on deployment pipelines, infrastructure, observability, and production readiness. Ensure the solution is deployable and monitorable.',
		reasoningStyle: 'pragmatic',
		priorityWeight: 9,
		preferredTools: ['runSubagentTool'],
		focusModes: ['deployment', 'infrastructure', 'observability']
	},
	'performance': {
		roleId: 'performance',
		displayName: 'Performance Engineer',
		baseSystemPrompt: 'You are a Performance Engineer. Focus on runtime efficiency, memory usage, algorithmic complexity, and scalability. Identify bottlenecks and optimization opportunities.',
		reasoningStyle: 'optimistic',
		priorityWeight: 8,
		preferredTools: ['runSubagentTool'],
		focusModes: ['performance', 'optimization', 'scalability']
	}
};

export interface IAgentProfileManager extends IDisposable {
	readonly _serviceBrand: undefined;
	readonly onDidChangeProfiles: Event<void>;

	getProfile(roleId: string): CouncilAgentProfile;
	getAllProfiles(): CouncilAgentProfile[];
	registerProfile(profile: CouncilAgentProfile): void;
	unregisterProfile(roleId: string): void;
	buildSystemPrompt(roleId: string, context: string, customProtocol?: string): string;
	buildToolFilter(roleId: string): { allowed: string[]; excluded: string[] };
}

export class AgentProfileManager extends Disposable implements IAgentProfileManager {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProfiles = this._register(new Emitter<void>());
	readonly onDidChangeProfiles: Event<void> = this._onDidChangeProfiles.event;

	private profiles: Map<string, CouncilAgentProfile>;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
		this.profiles = new Map();
		this.loadDefaultProfiles();
		this.loadUserProfiles().catch(err => {
			this.logService.warn(`Failed to load user council profiles: ${err.message}`);
		});
	}

	private loadDefaultProfiles(): void {
		Object.entries(DEFAULT_COUNCIL_PROFILES).forEach(([id, profile]) => {
			this.profiles.set(id, profile);
		});
		this.logService.info(`Loaded ${this.profiles.size} default council agent profiles`);
	}

	private async loadUserProfiles(): Promise<void> {
		try {
			const configPath = URI.file(process.env.HOME || process.env.USERPROFILE || '').with({ path: '/.vscode/council-profiles.json' });
			if (await this.fileService.exists(configPath)) {
				const content = await this.fileService.readFile(configPath);
				const userProfiles = JSON.parse(content.value.toString()) as Record<string, CouncilAgentProfile>;
				
				for (const [id, profile] of Object.entries(userProfiles)) {
					this.validateProfile(profile);
					this.profiles.set(id, profile);
					this.logService.info(`Loaded user council profile: ${id}`);
				}
				this._onDidChangeProfiles.fire();
			}
		} catch (error) {
			this.logService.warn(`Error loading user council profiles: ${error}`);
		}
	}

	public getProfile(roleId: string): CouncilAgentProfile {
		const profile = this.profiles.get(roleId);
		if (!profile) {
			throw new Error(`Agent profile not found for role: ${roleId}. Available: ${Array.from(this.profiles.keys()).join(', ')}`);
		}
		return profile;
	}

	public getAllProfiles(): CouncilAgentProfile[] {
		return Array.from(this.profiles.values());
	}

	public registerProfile(profile: CouncilAgentProfile): void {
		this.validateProfile(profile);
		this.profiles.set(profile.roleId, profile);
		this._onDidChangeProfiles.fire();
		this.logService.info(`Registered council profile: ${profile.roleId}`);
	}

	public unregisterProfile(roleId: string): void {
		if (DEFAULT_COUNCIL_PROFILES[roleId]) {
			throw new Error(`Cannot unregister default profile: ${roleId}`);
		}
		this.profiles.delete(roleId);
		this._onDidChangeProfiles.fire();
	}

	public buildSystemPrompt(roleId: string, context: string, customProtocol?: string): string {
		const profile = this.getProfile(roleId);
		const protocol = customProtocol || COUNCIL_PROTOCOL;
		const toolRestrictions = this.buildToolRestrictionsText(profile);
		const modelHint = profile.modelOverride ? `\n## Model Preference: Use ${profile.modelOverride} if available.` : '';

		return [
			`## Identity\n${profile.baseSystemPrompt}`,
			`## Role ID: <role_id>${profile.roleId}</role_id>`,
			`## Reasoning Style: ${profile.reasoningStyle}`,
			`## Focus Modes: ${profile.focusModes.join(', ')}`,
			protocol,
			`## Context\n${context}`,
			toolRestrictions,
			modelHint,
			`## Output Format: Always start with <role_id>${profile.roleId}</role_id>`
		].join('\n\n');
	}

	public buildToolFilter(roleId: string): { allowed: string[]; excluded: string[] } {
		const profile = this.getProfile(roleId);
		return {
			allowed: profile.preferredTools,
			excluded: profile.excludedTools || []
		};
	}

	private buildToolRestrictionsText(profile: CouncilAgentProfile): string {
		if (profile.preferredTools.length === 0 && !profile.excludedTools?.length) {
			return '';
		}

		let text = '## Tool Restrictions\n';
		if (profile.preferredTools.length > 0) {
			text += `- Preferred tools: ${profile.preferredTools.join(', ')}\n`;
		}
		if (profile.excludedTools?.length) {
			text += `- Excluded tools: ${profile.excludedTools.join(', ')}\n`;
		}
		return text;
	}

	private validateProfile(profile: CouncilAgentProfile): void {
		const errors: ProfileValidationError[] = [];

		if (!profile.roleId || profile.roleId.trim().length === 0) {
			errors.push({ field: 'roleId', message: 'roleId is required and cannot be empty' });
		}

		if (!profile.displayName || profile.displayName.trim().length === 0) {
			errors.push({ field: 'displayName', message: 'displayName is required and cannot be empty' });
		}

		if (!profile.baseSystemPrompt || profile.baseSystemPrompt.trim().length === 0) {
			errors.push({ field: 'baseSystemPrompt', message: 'baseSystemPrompt is required and cannot be empty' });
		}

		if (!['critical', 'pragmatic', 'optimistic', 'adversarial'].includes(profile.reasoningStyle)) {
			errors.push({ field: 'reasoningStyle', message: 'reasoningStyle must be one of: critical, pragmatic, optimistic, adversarial' });
		}

		if (typeof profile.priorityWeight !== 'number' || profile.priorityWeight < 1 || profile.priorityWeight > 20) {
			errors.push({ field: 'priorityWeight', message: 'priorityWeight must be a number between 1 and 20' });
		}

		if (!Array.isArray(profile.preferredTools)) {
			errors.push({ field: 'preferredTools', message: 'preferredTools must be an array' });
		}

		if (!Array.isArray(profile.focusModes)) {
			errors.push({ field: 'focusModes', message: 'focusModes must be an array' });
		}

		if (errors.length > 0) {
			throw new ProfileValidationError(errors);
		}
	}
}
