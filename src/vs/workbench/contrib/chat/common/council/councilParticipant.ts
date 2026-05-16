/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../nls.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ChatAgentLocation } from '../constants.js';
import { IChatAgentData, IChatAgentResult, IChatAgentService, IChatAgentImplementation, IChatAgentRequest, IChatProgress, IChatProgressMessage, ChatMessageType } from '../participants/chatAgents.js';
import { ICouncilOrchestrator, CouncilResult } from './councilOrchestrator.js';
import { IAgentProfileManager } from './agentProfileManager.js';
import { IConsensusManager, ConsensusStrategy } from './councilCoordinator.js';

export const COUNCIL_PARTICIPANT_ID = 'copilot.council';
export const COUNCIL_PARTICIPANT_NAME = 'council';

export class CouncilChatParticipant extends Disposable implements IChatAgentImplementation {

	static readonly Id = COUNCIL_PARTICIPANT_ID;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@ICouncilOrchestrator private readonly councilOrchestrator: ICouncilOrchestrator,
		@IAgentProfileManager private readonly profileManager: IAgentProfileManager,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.registerParticipant();
	}

	private registerParticipant(): void {
		const participantData: IChatAgentData = {
			id: CouncilChatParticipant.Id,
			name: COUNCIL_PARTICIPANT_NAME,
			fullName: localize('council.fullName', 'Agent Council'),
			description: localize('council.description', 'Orchestrate multiple specialized agents to collaborate on complex tasks'),
			isDefault: false,
			isCoreParticipant: false,
			locations: [ChatAgentLocation.Panel, ChatAgentLocation.Editor],
			slashCommands: [
				{ name: 'plan', description: 'Plan a multi-agent workflow' },
				{ name: 'review', description: 'Review code with multiple specialists' },
				{ name: 'architect', description: 'Architecture discussion with council' },
				{ name: 'security', description: 'Security audit with council' }
			],
			metadata: {
				themeIcon: { id: 'organization' }
			}
		};

		this._register(this.chatAgentService.registerAgent(participantData));
		this.logService.info('[Council] Participant registered');
	}

	async invoke(request: IChatAgentRequest, progress: (part: IChatProgress) => void, token: CancellationToken): Promise<IChatAgentResult> {
		this.logService.info(`[Council] Invoking with request: ${request.message.substring(0, 100)}...`);

		try {
			progress({
				kind: ChatMessageType.MarkdownContent,
				content: new MarkdownString('**Agent Council** is analyzing your request...\n\n')
			});

			const selectedRoles = this.extractRolesFromRequest(request.message);
			const strategy = this.extractStrategyFromRequest(request.message);

			const result = await this.councilOrchestrator.executeSession(
				request.message,
				selectedRoles,
				token
			);

			this.renderCouncilResult(result, progress);

			return {
				errorDetails: undefined,
				errorCode: undefined
			};
		} catch (error) {
			this.logService.error(`[Council] Invocation failed: ${error}`);
			progress({
				kind: ChatMessageType.MarkdownContent,
				content: new MarkdownString(`**Council Error:** ${error instanceof Error ? error.message : String(error)}`)
			});

			return {
				errorDetails: { message: error instanceof Error ? error.message : String(error) },
				errorCode: 'council_invocation_failed'
			};
		}
	}

	private extractRolesFromRequest(message: string): string[] | undefined {
		const roleMatch = message.match(/--roles?\s+([\w,-]+)/i);
		if (roleMatch) {
			return roleMatch[1].split(',').map(r => r.trim());
		}
		return undefined;
	}

	private extractStrategyFromRequest(message: string): ConsensusStrategy {
		const strategyMatch = message.match(/--strategy\s+(\w+)/i);
		if (strategyMatch) {
			const strategy = strategyMatch[1].toLowerCase();
			if (['majority', 'specialist-priority', 'evidence-weighted', 'coordinator-override'].includes(strategy)) {
				return strategy as ConsensusStrategy;
			}
		}
		return 'evidence-weighted';
	}

	private renderCouncilResult(result: CouncilResult, progress: (part: IChatProgress) => void): void {
		let response = `## Council Result (Session: ${result.sessionId})\n\n`;
		response += `**Confidence:** ${(result.confidence * 100).toFixed(0)}% | **Execution Time:** ${(result.executionTimeMs / 1000).toFixed(1)}s | **Status:** ${result.status}\n\n`;

		response += `---\n\n`;

		for (const [roleId, content] of result.contributions) {
			const profile = this.profileManager.getProfile(roleId);
			response += `### ${profile.displayName}\n\n`;
			response += `${content}\n\n`;
			response += `---\n\n`;
		}

		if (result.debateRecords.length > 0) {
			response += `## Debates\n\n`;
			for (const debate of result.debateRecords) {
				response += `**${debate.topic}**\n`;
				for (const position of debate.positions) {
					response += `- **${position.roleId}**: ${position.position.substring(0, 150)}...\n`;
				}
				response += `\n`;
			}
			response += `---\n\n`;
		}

		response += `## Final Synthesis\n\n`;
		response += result.finalResponse;

		progress({
			kind: ChatMessageType.MarkdownContent,
			content: new MarkdownString(response)
		});
	}

	async provideSuggestions(request: IChatAgentRequest, token: CancellationToken): Promise<IChatAgentResult> {
		const profiles = this.profileManager.getAllProfiles();
		const suggestions = profiles.map(p => ({
			role: p.roleId,
			displayName: p.displayName,
			focusModes: p.focusModes
		}));

		return {
			errorDetails: undefined,
			errorCode: undefined
		};
	}
}
