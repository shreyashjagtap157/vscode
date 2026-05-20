/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ChatAgentLocation, ChatModeKind } from '../constants.js';
import { IChatAgentData, IChatAgentResult, IChatAgentService, IChatAgentImplementation, IChatAgentRequest, IChatAgentHistoryEntry } from '../participants/chatAgents.js';
import { IChatProgress } from '../chatService/chatService.js';
import { ICouncilOrchestrator, CouncilResult } from './councilOrchestrator.js';
import { IAgentProfileManager } from './agentProfileManager.js';
import { ConsensusStrategy } from './councilCoordinator.js';
import { IDebateResolver } from './debateResolver.js';
import { ICouncilTestRunner } from './councilTestRunner.js';

export const COUNCIL_PARTICIPANT_ID = 'copilot.council';
export const COUNCIL_PARTICIPANT_NAME = 'council';

const COUNCIL_EXTENSION_ID = new ExtensionIdentifier('vscode-council');

export class CouncilChatParticipant extends Disposable implements IChatAgentImplementation {

	static readonly Id = COUNCIL_PARTICIPANT_ID;

	private readonly participantRegistration: IDisposable;

	constructor(
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@ICouncilOrchestrator private readonly councilOrchestrator: ICouncilOrchestrator,
		@IAgentProfileManager private readonly profileManager: IAgentProfileManager,
		@IDebateResolver private readonly debateResolver: IDebateResolver,
		@ICouncilTestRunner private readonly testRunner: ICouncilTestRunner,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.participantRegistration = this.registerParticipant();
		this._register(this.participantRegistration);
	}

	private registerParticipant(): IDisposable {
		const participantData: IChatAgentData = {
			id: CouncilChatParticipant.Id,
			name: COUNCIL_PARTICIPANT_NAME,
			fullName: localize('council.fullName', 'Agent Council'),
			description: localize('council.description', 'Orchestrate multiple specialized agents to collaborate on complex tasks'),
			isDefault: false,
			locations: [ChatAgentLocation.Chat, ChatAgentLocation.EditorInline, ChatAgentLocation.Terminal],
			modes: [ChatModeKind.Ask, ChatModeKind.Agent, ChatModeKind.Edit],
			slashCommands: [
				{ name: 'plan', description: 'Plan a multi-agent workflow' },
				{ name: 'review', description: 'Review code with multiple specialists' },
				{ name: 'architect', description: 'Architecture discussion with council' },
				{ name: 'security', description: 'Security audit with council' },
				{ name: 'test', description: 'Run tests to verify claims' },
				{ name: 'debate', description: 'Show agent debates and resolutions' }
			],
			disambiguation: [],
			metadata: {
				themeIcon: Codicon.organization,
				sampleRequest: 'Review this architecture for security and performance'
			},
			extensionId: COUNCIL_EXTENSION_ID,
			extensionVersion: '1.0.0',
			extensionPublisherId: 'vscode',
			extensionDisplayName: 'VS Code Council'
		};

		const dataRegistration = this.chatAgentService.registerAgent(participantData.id, participantData);
		const implRegistration = this.chatAgentService.registerAgentImplementation(participantData.id, this);

		this.logService.info('[Council] Participant registered with ID: ' + participantData.id);
		this.logService.info('[Council] Available in locations: ' + participantData.locations.join(', '));
		this.logService.info('[Council] Available modes: ' + participantData.modes.join(', '));

		return toDisposable(() => {
			dataRegistration.dispose();
			implRegistration.dispose();
		});
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		this.logService.info(`[Council] Invoking with request: ${request.message.substring(0, 100)}...`);

		try {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString('**Agent Council** is analyzing your request...\n\n')
			}]);

			const slashCommand = this.extractSlashCommand(request.message);
			if (slashCommand) {
				return await this.handleSlashCommand(slashCommand, request, progress, token);
			}

			const selectedRoles = this.extractRolesFromRequest(request.message);
			const strategy = this.extractStrategyFromRequest(request.message);

			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(this.buildCouncilStatusMessage(selectedRoles, strategy))
			}]);

			const result = await this.councilOrchestrator.executeSession(
				request.message,
				selectedRoles,
				token
			);

			this.renderCouncilResult(result, progress);

			return {
				errorDetails: undefined
			};
		} catch (error) {
			this.logService.error(`[Council] Invocation failed: ${error}`);
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(`**Council Error:** ${error instanceof Error ? error.message : String(error)}`)
			}]);

			return {
				errorDetails: { message: error instanceof Error ? error.message : String(error) }
			};
		}
	}

	private async handleSlashCommand(command: string, request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<IChatAgentResult> {
		switch (command) {
			case 'plan':
				return this.handlePlanCommand(request, progress, token);
			case 'review':
				return this.handleReviewCommand(request, progress, token);
			case 'architect':
				return this.handleArchitectCommand(request, progress, token);
			case 'security':
				return this.handleSecurityCommand(request, progress, token);
			case 'test':
				return this.handleTestCommand(request, progress, token);
			case 'debate':
				return this.handleDebateCommand(request, progress, token);
			default:
				return this.invoke(request, progress, [], token);
		}
	}

	private async handlePlanCommand(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<IChatAgentResult> {
		progress([{
			kind: 'markdownContent',
			content: new MarkdownString('**Planning Phase** - Architect and Backend agents collaborating...\n\n')
		}]);

		const result = await this.councilOrchestrator.executeSession(
			`Create a detailed implementation plan for: ${request.message}`,
			['architect', 'backend', 'qa'],
			token
		);

		this.renderCouncilResult(result, progress);
		return { errorDetails: undefined };
	}

	private async handleReviewCommand(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<IChatAgentResult> {
		progress([{
			kind: 'markdownContent',
			content: new MarkdownString('**Code Review** - Multiple specialists reviewing...\n\n')
		}]);

		const result = await this.councilOrchestrator.executeSession(
			`Review the following code for quality, security, and performance: ${request.message}`,
			['backend', 'security', 'qa', 'performance'],
			token
		);

		this.renderCouncilResult(result, progress);
		return { errorDetails: undefined };
	}

	private async handleArchitectCommand(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<IChatAgentResult> {
		progress([{
			kind: 'markdownContent',
			content: new MarkdownString('**Architecture Discussion** - Council deliberating...\n\n')
		}]);

		const result = await this.councilOrchestrator.executeSession(
			`Discuss architecture for: ${request.message}`,
			['architect', 'backend', 'devops'],
			token
		);

		this.renderCouncilResult(result, progress);
		return { errorDetails: undefined };
	}

	private async handleSecurityCommand(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<IChatAgentResult> {
		progress([{
			kind: 'markdownContent',
			content: new MarkdownString('**Security Audit** - Security specialist analyzing...\n\n')
		}]);

		const result = await this.councilOrchestrator.executeSession(
			`Perform security audit for: ${request.message}`,
			['security', 'backend', 'architect'],
			token
		);

		this.renderCouncilResult(result, progress);
		return { errorDetails: undefined };
	}

	private async handleTestCommand(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<IChatAgentResult> {
		const commands = this.testRunner.extractTestCommands(request.message);
		
		if (commands.length === 0) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString('**Test Runner** - No test commands found in request.\n\nInclude test commands like `npm test`, `jest`, or `pytest` to verify claims.')
			}]);
			return { errorDetails: undefined };
		}

		progress([{
			kind: 'markdownContent',
			content: new MarkdownString(`**Test Runner** - Executing ${commands.length} test command(s)...\n\n`)
		}]);

		const suite = await this.testRunner.runTests(commands, token);
		
		const summary = `## Test Results\n\n- **Total:** ${suite.totalTests}\n- **Passed:** ${suite.passedTests}\n- **Failed:** ${suite.failedTests}\n- **Duration:** ${(suite.duration / 1000).toFixed(1)}s`;
		
		progress([{
			kind: 'markdownContent',
			content: new MarkdownString(summary)
		}]);

		return { errorDetails: undefined };
	}

	private async handleDebateCommand(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, token: CancellationToken): Promise<IChatAgentResult> {
		const debates = this.debateResolver.getDebateHistory();
		
		if (debates.length === 0) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString('**Debate History** - No debates recorded yet.\n\nDebates are automatically detected when agents disagree during council sessions.')
			}]);
			return { errorDetails: undefined };
		}

		let debateContent = '## Debate History\n\n';
		for (const debate of debates.slice(-5)) {
			debateContent += `### ${debate.topic}\n`;
			debateContent += `**Status:** ${debate.resolved ? 'Resolved' : 'Unresolved'}\n`;
			debateContent += `**Type:** ${debate.conflictType}\n\n`;
			
			for (const position of debate.positions) {
				debateContent += `- **${position.roleName}**: ${position.position.substring(0, 200)}...\n`;
			}
			
			if (debate.resolved) {
				debateContent += `\n**Resolution:** ${debate.resolution}\n\n`;
			}
			
			debateContent += '---\n\n';
		}

		progress([{
			kind: 'markdownContent',
			content: new MarkdownString(debateContent)
		}]);

		return { errorDetails: undefined };
	}

	private extractSlashCommand(message: string): string | undefined {
		const match = message.match(/^\/(\w+)/);
		return match ? match[1] : undefined;
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
			if (['majority', 'specialist-priority', 'evidence-weighted', 'coordinator-override', 'bayesian'].includes(strategy)) {
				return strategy as ConsensusStrategy;
			}
		}
		return 'evidence-weighted';
	}

	private buildCouncilStatusMessage(selectedRoles?: string[], strategy?: ConsensusStrategy): string {
		const roles = selectedRoles || this.profileManager.getAllProfiles().map(p => p.roleId);
		const profiles = roles.map(roleId => {
			try {
				return this.profileManager.getProfile(roleId);
			} catch {
				return { displayName: roleId };
			}
		});

		return `**Council Configuration:**\n- **Agents:** ${profiles.map(p => p.displayName).join(', ')}\n- **Strategy:** ${strategy || 'evidence-weighted'}\n\n`;
	}

	private renderCouncilResult(result: CouncilResult, progress: (parts: IChatProgress[]) => void): void {
		let response = `## Council Result (Session: ${result.sessionId})\n\n`;
		response += `**Confidence:** ${(result.confidence * 100).toFixed(0)}% | **Execution Time:** ${(result.executionTimeMs / 1000).toFixed(1)}s | **Status:** ${result.status}\n\n`;

		if ('qualityMetrics' in result) {
			const metrics = (result as any).qualityMetrics;
			if (metrics) {
				response += `**Quality Metrics:**\n- Agreement: ${(metrics.agreementLevel * 100).toFixed(0)}%\n- Evidence Consistency: ${(metrics.evidenceConsistency * 100).toFixed(0)}%\n- Strength: ${metrics.consensusStrength}\n\n`;
			}
		}

		response += '---\n\n';

		for (const [roleId, content] of result.contributions) {
			const profile = this.profileManager.getProfile(roleId);
			response += `### ${profile.displayName}\n\n`;
			response += `${content}\n\n`;
			response += '---\n\n';
		}

		if (result.debateRecords.length > 0) {
			response += '## Debates\n\n';
			for (const debate of result.debateRecords) {
				response += `**${debate.topic}**\n`;
				for (const position of debate.positions) {
					response += `- **${position.roleId}**: ${position.position.substring(0, 150)}...\n`;
				}
				response += '\n';
			}
			response += '---\n\n';
		}

		response += '## Final Synthesis\n\n';
		response += result.finalResponse;

		progress([{
			kind: 'markdownContent',
			content: new MarkdownString(response)
		}]);
	}

	async provideSuggestions(request: IChatAgentRequest, token: CancellationToken): Promise<IChatAgentResult> {
		return {
			errorDetails: undefined
		};
	}
}
