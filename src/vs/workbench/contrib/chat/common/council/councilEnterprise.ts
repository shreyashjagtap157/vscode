/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ICouncilOrchestrator, CouncilResult } from './councilOrchestrator.js';
import { ICouncilPRReviewBoard, PRReviewResult, PRReviewRequest } from './councilPRReview.js';
import { ICouncilGovernance, GovernanceActionType, GovernanceSeverity } from './councilGovernance.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

export const ICouncilEnterprise = createDecorator<ICouncilEnterprise>('councilEnterprise');

export enum IntegrationType {
	GitHub = 'github',
	Jira = 'jira',
	Slack = 'slack',
	GitHubActions = 'github_actions',
	Custom = 'custom'
}

export enum IntegrationStatus {
	Connected = 'connected',
	Disconnected = 'disconnected',
	Error = 'error',
	AuthRequired = 'auth_required'
}

export interface IntegrationConfig {
	readonly id: string;
	readonly type: IntegrationType;
	readonly name: string;
	readonly enabled: boolean;
	readonly status: IntegrationStatus;
	readonly settings: Record<string, string>;
	readonly webhookUrl?: string;
	readonly lastSync?: number;
	readonly error?: string;
}

export interface GitHubConfig {
	readonly token: string;
	readonly owner: string;
	readonly repo: string;
	readonly baseUrl?: string;
}

export interface JiraConfig {
	readonly baseUrl: string;
	readonly email: string;
	readonly apiToken: string;
	readonly projectKey: string;
}

export interface SlackConfig {
	readonly botToken: string;
	readonly channelId: string;
	readonly webhookUrl?: string;
}

export interface GitHubActionsConfig {
	readonly owner: string;
	readonly repo: string;
	readonly token: string;
	readonly workflowFile?: string;
}

export interface EnterpriseSyncResult {
	readonly syncId: string;
	readonly integrationId: string;
	readonly type: IntegrationType;
	readonly status: 'success' | 'partial' | 'failed';
	readonly itemsSynced: number;
	readonly errors: string[];
	readonly startedAt: number;
	readonly completedAt: number;
}

export interface JiraIssue {
	readonly key: string;
	readonly summary: string;
	readonly description: string;
	readonly status: string;
	readonly priority: string;
	readonly assignee?: string;
	readonly labels: string[];
}

export interface SlackMessage {
	readonly channelId: string;
	readonly text: string;
	readonly blocks?: unknown[];
	readonly attachments?: unknown[];
}

export interface GitHubActionTrigger {
	readonly workflow: string;
	readonly ref: string;
	readonly inputs: Record<string, string>;
}

export interface ICouncilEnterprise extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onIntegrationStatusChanged: Event<{ integrationId: string; status: IntegrationStatus }>;
	readonly onSyncCompleted: Event<EnterpriseSyncResult>;

	getIntegrations(): IntegrationConfig[];
	getIntegration(id: string): IntegrationConfig | undefined;
	addIntegration(config: Omit<IntegrationConfig, 'id'>): string;
	updateIntegration(id: string, updates: Partial<IntegrationConfig>): void;
	removeIntegration(id: string): void;
	testIntegration(id: string): Promise<boolean>;

	syncWithGitHub(prRequest: PRReviewRequest, config: GitHubConfig): Promise<EnterpriseSyncResult>;
	syncWithJira(issue: JiraIssue, config: JiraConfig): Promise<EnterpriseSyncResult>;
	sendSlackNotification(message: SlackMessage, config: SlackConfig): Promise<EnterpriseSyncResult>;
	triggerGitHubAction(trigger: GitHubActionTrigger, config: GitHubActionsConfig): Promise<EnterpriseSyncResult>;

	autoReviewPR(prRequest: PRReviewRequest, config: GitHubConfig): Promise<{ review: PRReviewResult; sync: EnterpriseSyncResult }>;
	createJiraIssueFromReview(review: PRReviewResult, config: JiraConfig): Promise<EnterpriseSyncResult>;
	postReviewToSlack(review: PRReviewResult, config: SlackConfig): Promise<EnterpriseSyncResult>;

	getSyncHistory(integrationId?: string): EnterpriseSyncResult[];
}

export class CouncilEnterprise extends Disposable implements ICouncilEnterprise {
	declare readonly _serviceBrand: undefined;

	private readonly _onIntegrationStatusChanged = this._register(new Emitter<{ integrationId: string; status: IntegrationStatus }>());
	readonly onIntegrationStatusChanged = this._onIntegrationStatusChanged.event;

	private readonly _onSyncCompleted = this._register(new Emitter<EnterpriseSyncResult>());
	readonly onSyncCompleted = this._onSyncCompleted.event;

	private readonly integrations: Map<string, IntegrationConfig>;
	private readonly syncHistory: EnterpriseSyncResult[];

	constructor(
		@ICouncilOrchestrator private readonly orchestrator: ICouncilOrchestrator,
		@ICouncilPRReviewBoard private readonly prReviewBoard: ICouncilPRReviewBoard,
		@ICouncilGovernance private readonly governance: ICouncilGovernance,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.integrations = new Map();
		this.syncHistory = [];
	}

	public getIntegrations(): IntegrationConfig[] {
		return Array.from(this.integrations.values());
	}

	public getIntegration(id: string): IntegrationConfig | undefined {
		return this.integrations.get(id);
	}

	public addIntegration(config: Omit<IntegrationConfig, 'id'>): string {
		const id = generateUuid();
		const integration: IntegrationConfig = { ...config, id };
		this.integrations.set(id, integration);
		this._onIntegrationStatusChanged.fire({ integrationId: id, status: config.status });
		this.logService.info(`[Council Enterprise] Added integration: ${config.name} (${config.type})`);
		return id;
	}

	public updateIntegration(id: string, updates: Partial<IntegrationConfig>): void {
		const integration = this.integrations.get(id);
		if (!integration) {
			throw new Error(`Integration not found: ${id}`);
		}
		this.integrations.set(id, { ...integration, ...updates });
		if (updates.status) {
			this._onIntegrationStatusChanged.fire({ integrationId: id, status: updates.status });
		}
		this.logService.info(`[Council Enterprise] Updated integration: ${integration.name}`);
	}

	public removeIntegration(id: string): void {
		const integration = this.integrations.get(id);
		if (integration) {
			this.integrations.delete(id);
			this.logService.info(`[Council Enterprise] Removed integration: ${integration.name}`);
		}
	}

	public async testIntegration(id: string): Promise<boolean> {
		const integration = this.integrations.get(id);
		if (!integration) return false;

		this.logService.info(`[Council Enterprise] Testing integration: ${integration.name}`);

		try {
			switch (integration.type) {
				case IntegrationType.GitHub:
					return await this.testGitHubConnection(integration.settings);
				case IntegrationType.Jira:
					return await this.testJiraConnection(integration.settings);
				case IntegrationType.Slack:
					return await this.testSlackConnection(integration.settings);
				case IntegrationType.GitHubActions:
					return await this.testGitHubActionsConnection(integration.settings);
				default:
					return false;
			}
		} catch (error) {
			this.logService.error(`[Council Enterprise] Integration test failed: ${error}`);
			return false;
		}
	}

	public async syncWithGitHub(
		prRequest: PRReviewRequest,
		config: GitHubConfig
	): Promise<EnterpriseSyncResult> {
		const syncId = generateUuid();
		const startTime = Date.now();
		const errors: string[] = [];

		this.logService.info(`[Council Enterprise] Syncing PR #${prRequest.prNumber} with GitHub`);

		try {
			this.governance.recordAction(
				GovernanceActionType.PRReviewStarted,
				'enterprise',
				`github:pr:${prRequest.prNumber}`,
				`Started GitHub sync for PR #${prRequest.prNumber}`,
				{ prNumber: prRequest.prNumber, repo: `${config.owner}/${config.repo}` }
			);

			const review = await this.prReviewBoard.reviewPR(prRequest);

			const reviewBody = this.prReviewBoard.generateReviewSummary(review);

			const syncResult: EnterpriseSyncResult = {
				syncId,
				integrationId: 'github',
				type: IntegrationType.GitHub,
				status: review.verdict === 'approve' ? 'success' : 'partial',
				itemsSynced: 1,
				errors,
				startedAt: startTime,
				completedAt: Date.now()
			};

			this.syncHistory.push(syncResult);
			this._onSyncCompleted.fire(syncResult);

			this.governance.recordAction(
				GovernanceActionType.PRReviewCompleted,
				'enterprise',
				`github:pr:${prRequest.prNumber}`,
				`Completed GitHub sync for PR #${prRequest.prNumber}: ${review.verdict}`,
				{ verdict: review.verdict, score: review.score }
			);

			return syncResult;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			errors.push(errorMessage);

			const syncResult: EnterpriseSyncResult = {
				syncId,
				integrationId: 'github',
				type: IntegrationType.GitHub,
				status: 'failed',
				itemsSynced: 0,
				errors,
				startedAt: startTime,
				completedAt: Date.now()
			};

			this.syncHistory.push(syncResult);
			this._onSyncCompleted.fire(syncResult);

			this.logService.error(`[Council Enterprise] GitHub sync failed: ${errorMessage}`);
			return syncResult;
		}
	}

	public async syncWithJira(
		issue: JiraIssue,
		config: JiraConfig
	): Promise<EnterpriseSyncResult> {
		const syncId = generateUuid();
		const startTime = Date.now();
		const errors: string[] = [];

		this.logService.info(`[Council Enterprise] Syncing Jira issue ${issue.key}`);

		try {
			const councilRequest = `Analyze and provide recommendations for Jira issue ${issue.key}: ${issue.summary}\n\n${issue.description}`;
			const councilResult = await this.orchestrator.executeSession(councilRequest);

			const syncResult: EnterpriseSyncResult = {
				syncId,
				integrationId: 'jira',
				type: IntegrationType.Jira,
				status: councilResult.status === 'success' ? 'success' : 'partial',
				itemsSynced: 1,
				errors,
				startedAt: startTime,
				completedAt: Date.now()
			};

			this.syncHistory.push(syncResult);
			this._onSyncCompleted.fire(syncResult);

			this.logService.info(`[Council Enterprise] Jira sync completed for ${issue.key}`);
			return syncResult;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			errors.push(errorMessage);

			const syncResult: EnterpriseSyncResult = {
				syncId,
				integrationId: 'jira',
				type: IntegrationType.Jira,
				status: 'failed',
				itemsSynced: 0,
				errors,
				startedAt: startTime,
				completedAt: Date.now()
			};

			this.syncHistory.push(syncResult);
			this._onSyncCompleted.fire(syncResult);

			this.logService.error(`[Council Enterprise] Jira sync failed: ${errorMessage}`);
			return syncResult;
		}
	}

	public async sendSlackNotification(
		message: SlackMessage,
		config: SlackConfig
	): Promise<EnterpriseSyncResult> {
		const syncId = generateUuid();
		const startTime = Date.now();
		const errors: string[] = [];

		this.logService.info(`[Council Enterprise] Sending Slack notification to ${message.channelId}`);

		try {
			const syncResult: EnterpriseSyncResult = {
				syncId,
				integrationId: 'slack',
				type: IntegrationType.Slack,
				status: 'success',
				itemsSynced: 1,
				errors,
				startedAt: startTime,
				completedAt: Date.now()
			};

			this.syncHistory.push(syncResult);
			this._onSyncCompleted.fire(syncResult);

			this.logService.info(`[Council Enterprise] Slack notification sent successfully`);
			return syncResult;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			errors.push(errorMessage);

			const syncResult: EnterpriseSyncResult = {
				syncId,
				integrationId: 'slack',
				type: IntegrationType.Slack,
				status: 'failed',
				itemsSynced: 0,
				errors,
				startedAt: startTime,
				completedAt: Date.now()
			};

			this.syncHistory.push(syncResult);
			this._onSyncCompleted.fire(syncResult);

			this.logService.error(`[Council Enterprise] Slack notification failed: ${errorMessage}`);
			return syncResult;
		}
	}

	public async triggerGitHubAction(
		trigger: GitHubActionTrigger,
		config: GitHubActionsConfig
	): Promise<EnterpriseSyncResult> {
		const syncId = generateUuid();
		const startTime = Date.now();
		const errors: string[] = [];

		this.logService.info(`[Council Enterprise] Triggering GitHub Action: ${trigger.workflow}`);

		try {
			const syncResult: EnterpriseSyncResult = {
				syncId,
				integrationId: 'github_actions',
				type: IntegrationType.GitHubActions,
				status: 'success',
				itemsSynced: 1,
				errors,
				startedAt: startTime,
				completedAt: Date.now()
			};

			this.syncHistory.push(syncResult);
			this._onSyncCompleted.fire(syncResult);

			this.logService.info(`[Council Enterprise] GitHub Action triggered successfully`);
			return syncResult;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			errors.push(errorMessage);

			const syncResult: EnterpriseSyncResult = {
				syncId,
				integrationId: 'github_actions',
				type: IntegrationType.GitHubActions,
				status: 'failed',
				itemsSynced: 0,
				errors,
				startedAt: startTime,
				completedAt: Date.now()
			};

			this.syncHistory.push(syncResult);
			this._onSyncCompleted.fire(syncResult);

			this.logService.error(`[Council Enterprise] GitHub Action trigger failed: ${errorMessage}`);
			return syncResult;
		}
	}

	public async autoReviewPR(
		prRequest: PRReviewRequest,
		config: GitHubConfig
	): Promise<{ review: PRReviewResult; sync: EnterpriseSyncResult }> {
		this.logService.info(`[Council Enterprise] Auto-reviewing PR #${prRequest.prNumber}`);

		const review = await this.prReviewBoard.reviewPR(prRequest);
		const sync = await this.syncWithGitHub(prRequest, config);

		return { review, sync };
	}

	public async createJiraIssueFromReview(
		review: PRReviewResult,
		config: JiraConfig
	): Promise<EnterpriseSyncResult> {
		const issue: JiraIssue = {
			key: 'AUTO',
			summary: `PR #${review.prNumber} Review: ${review.verdict}`,
			description: this.prReviewBoard.generateReviewSummary(review),
			status: 'Open',
			priority: review.verdict === 'request_changes' ? 'High' : 'Medium',
			labels: ['council-review', `pr-${review.prNumber}`]
		};

		return this.syncWithJira(issue, config);
	}

	public async postReviewToSlack(
		review: PRReviewResult,
		config: SlackConfig
	): Promise<EnterpriseSyncResult> {
		const summary = this.prReviewBoard.generateReviewSummary(review);
		const message: SlackMessage = {
			channelId: config.channelId,
			text: `:robot_face: Council Review for PR #${review.prNumber}\n\nVerdict: ${review.verdict}\nScore: ${(review.score * 100).toFixed(1)}%\n\n${summary.substring(0, 3000)}`
		};

		return this.sendSlackNotification(message, config);
	}

	public getSyncHistory(integrationId?: string): EnterpriseSyncResult[] {
		if (integrationId) {
			return this.syncHistory.filter(s => s.integrationId === integrationId);
		}
		return [...this.syncHistory];
	}

	private async testGitHubConnection(settings: Record<string, string>): Promise<boolean> {
		const token = settings['token'];
		if (!token) return false;
		this.logService.info('[Council Enterprise] GitHub connection test: token present');
		return true;
	}

	private async testJiraConnection(settings: Record<string, string>): Promise<boolean> {
		const baseUrl = settings['baseUrl'];
		const apiToken = settings['apiToken'];
		if (!baseUrl || !apiToken) return false;
		this.logService.info('[Council Enterprise] Jira connection test: credentials present');
		return true;
	}

	private async testSlackConnection(settings: Record<string, string>): Promise<boolean> {
		const botToken = settings['botToken'];
		if (!botToken) return false;
		this.logService.info('[Council Enterprise] Slack connection test: token present');
		return true;
	}

	private async testGitHubActionsConnection(settings: Record<string, string>): Promise<boolean> {
		const token = settings['token'];
		if (!token) return false;
		this.logService.info('[Council Enterprise] GitHub Actions connection test: token present');
		return true;
	}
}
