/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity, NotificationPriority, INotificationActions } from '../../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { Action } from '../../../../../base/common/actions.js';

export const ICouncilNotificationService = createDecorator<ICouncilNotificationService>('councilNotificationService');

export type CouncilNotificationType = 'session_complete' | 'session_failed' | 'review_ready' | 'security_finding' | 'policy_violation' | 'debate_resolved' | 'ci_resolved' | 'sync_complete';

export interface CouncilNotification {
	readonly id: string;
	readonly type: CouncilNotificationType;
	readonly title: string;
	readonly message: string;
	readonly severity: Severity;
	readonly timestamp: number;
	readonly sessionId?: string;
	readonly actions?: CouncilNotificationAction[];
}

export interface CouncilNotificationAction {
	readonly label: string;
	readonly run: () => void;
}

export interface ICouncilNotificationService extends IDisposable {
	readonly _serviceBrand: undefined;

	notify(notification: Omit<CouncilNotification, 'id' | 'timestamp'>): string;
	notifySessionComplete(sessionId: string, confidence: number, executionTimeMs: number): void;
	notifySessionFailed(sessionId: string, error: string): void;
	notifyReviewReady(prNumber: number, verdict: string, score: number): void;
	notifySecurityFinding(file: string, severity: string, description: string): void;
	notifySyncComplete(type: string, status: string): void;
	getNotifications(limit?: number): CouncilNotification[];
	clearNotifications(): void;
}

export class CouncilNotificationService extends Disposable implements ICouncilNotificationService {
	declare readonly _serviceBrand: undefined;

	private readonly notifications: CouncilNotification[];
	private notificationCounter = 0;

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.notifications = [];
	}

	public notify(notification: Omit<CouncilNotification, 'id' | 'timestamp'>): string {
		this.notificationCounter++;
		const fullNotification: CouncilNotification = {
			...notification,
			id: `council-notif-${this.notificationCounter}`,
			timestamp: Date.now()
		};

		this.notifications.push(fullNotification);

		const actions: INotificationActions | undefined = notification.actions?.length
			? { primary: notification.actions.map(a => new Action(a.label, a.label, undefined, true, a.run)) }
			: undefined;

		this.notificationService.notify({
			severity: notification.severity,
			message: `${notification.title}: ${notification.message}`,
			priority: NotificationPriority.DEFAULT,
			actions
		});

		this.logService.info(`[Council Notification] ${notification.title}: ${notification.message}`);
		return fullNotification.id;
	}

	public notifySessionComplete(sessionId: string, confidence: number, executionTimeMs: number): void {
		this.notify({
			type: 'session_complete',
			title: 'Council Session Complete',
			message: `Session completed with ${(confidence * 100).toFixed(0)}% confidence in ${(executionTimeMs / 1000).toFixed(1)}s`,
			severity: Severity.Info,
			sessionId,
			actions: [
				{
					label: 'View Results',
					run: () => this.logService.info(`[Council] Opening results for session ${sessionId}`)
				}
			]
		});
	}

	public notifySessionFailed(sessionId: string, error: string): void {
		this.notify({
			type: 'session_failed',
			title: 'Council Session Failed',
			message: error.substring(0, 200),
			severity: Severity.Error,
			sessionId
		});
	}

	public notifyReviewReady(prNumber: number, verdict: string, score: number): void {
		const severity = verdict === 'request_changes' ? Severity.Warning : Severity.Info;
		this.notify({
			type: 'review_ready',
			title: `PR #${prNumber} Review Ready`,
			message: `Verdict: ${verdict} (Score: ${(score * 100).toFixed(0)}%)`,
			severity,
			actions: [
				{
					label: 'View Review',
					run: () => this.logService.info(`[Council] Opening review for PR #${prNumber}`)
				}
			]
		});
	}

	public notifySecurityFinding(file: string, severity: string, description: string): void {
		const sev = severity === 'critical' ? Severity.Error : Severity.Warning;
		this.notify({
			type: 'security_finding',
			title: 'Security Finding',
			message: `${file}: ${description}`,
			severity: sev
		});
	}

	public notifySyncComplete(type: string, status: string): void {
		const sev = status === 'failed' ? Severity.Error : Severity.Info;
		this.notify({
			type: 'sync_complete',
			title: `${type} Sync Complete`,
			message: `Status: ${status}`,
			severity: sev
		});
	}

	public getNotifications(limit: number = 50): CouncilNotification[] {
		return [...this.notifications].reverse().slice(0, limit);
	}

	public clearNotifications(): void {
		this.notifications.length = 0;
	}
}
