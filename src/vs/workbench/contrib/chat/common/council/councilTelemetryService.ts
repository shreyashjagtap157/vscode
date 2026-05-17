/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';

export const ICouncilTelemetryService = createDecorator<ICouncilTelemetryService>('councilTelemetryService');

export interface CouncilTelemetryEvent {
	readonly eventName: string;
	readonly timestamp: number;
	readonly sessionId?: string;
	readonly agentId?: string;
	readonly [key: string]: unknown;
}

export interface ICouncilTelemetryService extends IDisposable {
	readonly _serviceBrand: undefined;

	sendTelemetryEvent(event: CouncilTelemetryEvent): void;
	sendSessionStart(sessionId: string, agentCount: number, strategy: string): void;
	sendSessionComplete(sessionId: string, duration: number, confidence: number, agentCount: number): void;
	sendSessionFailed(sessionId: string, error: string, duration: number): void;
	sendAgentInvoked(agentId: string, roleId: string, taskId: string): void;
	sendAgentCompleted(agentId: string, roleId: string, duration: number, tokens: number): void;
	sendAgentFailed(agentId: string, roleId: string, error: string): void;
	sendConsensusResolved(sessionId: string, strategy: string, confidence: number, dissenters: number): void;
	sendDebateOpened(sessionId: string, topic: string, positions: number): void;
	sendDebateResolved(sessionId: string, topic: string, resolution: string): void;
	sendSecretDetected(sessionId: string, secretType: string, severity: string): void;
	sendInputSanitized(sessionId: string, threatType: string, action: string): void;
	sendCostTracked(sessionId: string, model: string, tokens: number, cost: number): void;
	sendBudgetExceeded(sessionId: string, budget: number, actual: number): void;
	sendCacheHit(cacheKey: string, age: number): void;
	sendCacheMiss(cacheKey: string): void;
	sendRateLimitExceeded(service: string, action: string, limit: number): void;
	sendPRCreated(sessionId: string, prNumber: number, url: string): void;
	sendFixApplied(sessionId: string, fileCount: number, successCount: number): void;
	sendError(service: string, error: string, actionable: boolean): void;
	sendUIAction(action: string, component: string, duration?: number): void;
	sendPerformance(metric: string, value: number, unit: string): void;
}

export class CouncilTelemetryService extends Disposable implements ICouncilTelemetryService {
	declare readonly _serviceBrand: undefined;

	private readonly councilTelemetryPrefix = 'council.';

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super();
	}

	public sendTelemetryEvent(event: CouncilTelemetryEvent): void {
		const data: Record<string, unknown> = {
			timestamp: event.timestamp,
			...event
		};
		delete data.eventName;

		this.telemetryService.publicLog2<Record<string, unknown>>(
			`${this.councilTelemetryPrefix}${event.eventName}`,
			data
		);
	}

	public sendSessionStart(sessionId: string, agentCount: number, strategy: string): void {
		this.telemetryService.publicLog2<{ sessionId: string; agentCount: number; strategy: string }>(
			`${this.councilTelemetryPrefix}session.start`,
			{ sessionId, agentCount, strategy }
		);
	}

	public sendSessionComplete(sessionId: string, duration: number, confidence: number, agentCount: number): void {
		this.telemetryService.publicLog2<{ sessionId: string; duration: number; confidence: number; agentCount: number }>(
			`${this.councilTelemetryPrefix}session.complete`,
			{ sessionId, duration, confidence, agentCount }
		);
	}

	public sendSessionFailed(sessionId: string, error: string, duration: number): void {
		this.telemetryService.publicLog2<{ sessionId: string; error: string; duration: number }>(
			`${this.councilTelemetryPrefix}session.failed`,
			{ sessionId, error: this.sanitizeError(error), duration }
		);
	}

	public sendAgentInvoked(agentId: string, roleId: string, taskId: string): void {
		this.telemetryService.publicLog2<{ agentId: string; roleId: string; taskId: string }>(
			`${this.councilTelemetryPrefix}agent.invoked`,
			{ agentId, roleId, taskId }
		);
	}

	public sendAgentCompleted(agentId: string, roleId: string, duration: number, tokens: number): void {
		this.telemetryService.publicLog2<{ agentId: string; roleId: string; duration: number; tokens: number }>(
			`${this.councilTelemetryPrefix}agent.completed`,
			{ agentId, roleId, duration, tokens }
		);
	}

	public sendAgentFailed(agentId: string, roleId: string, error: string): void {
		this.telemetryService.publicLog2<{ agentId: string; roleId: string; error: string }>(
			`${this.councilTelemetryPrefix}agent.failed`,
			{ agentId, roleId, error: this.sanitizeError(error) }
		);
	}

	public sendConsensusResolved(sessionId: string, strategy: string, confidence: number, dissenters: number): void {
		this.telemetryService.publicLog2<{ sessionId: string; strategy: string; confidence: number; dissenters: number }>(
			`${this.councilTelemetryPrefix}consensus.resolved`,
			{ sessionId, strategy, confidence, dissenters }
		);
	}

	public sendDebateOpened(sessionId: string, topic: string, positions: number): void {
		this.telemetryService.publicLog2<{ sessionId: string; topic: string; positions: number }>(
			`${this.councilTelemetryPrefix}debate.opened`,
			{ sessionId, topic, positions }
		);
	}

	public sendDebateResolved(sessionId: string, topic: string, resolution: string): void {
		this.telemetryService.publicLog2<{ sessionId: string; topic: string; resolution: string }>(
			`${this.councilTelemetryPrefix}debate.resolved`,
			{ sessionId, topic, resolution }
		);
	}

	public sendSecretDetected(sessionId: string, secretType: string, severity: string): void {
		this.telemetryService.publicLog2<{ sessionId: string; secretType: string; severity: string }>(
			`${this.councilTelemetryPrefix}security.secret.detected`,
			{ sessionId, secretType, severity }
		);
	}

	public sendInputSanitized(sessionId: string, threatType: string, action: string): void {
		this.telemetryService.publicLog2<{ sessionId: string; threatType: string; action: string }>(
			`${this.councilTelemetryPrefix}security.input.sanitized`,
			{ sessionId, threatType, action }
		);
	}

	public sendCostTracked(sessionId: string, model: string, tokens: number, cost: number): void {
		this.telemetryService.publicLog2<{ sessionId: string; model: string; tokens: number; cost: number }>(
			`${this.councilTelemetryPrefix}cost.tracked`,
			{ sessionId, model, tokens, cost }
		);
	}

	public sendBudgetExceeded(sessionId: string, budget: number, actual: number): void {
		this.telemetryService.publicLog2<{ sessionId: string; budget: number; actual: number }>(
			`${this.councilTelemetryPrefix}cost.budget.exceeded`,
			{ sessionId, budget, actual }
		);
	}

	public sendCacheHit(cacheKey: string, age: number): void {
		this.telemetryService.publicLog2<{ cacheKey: string; age: number }>(
			`${this.councilTelemetryPrefix}cache.hit`,
			{ cacheKey, age }
		);
	}

	public sendCacheMiss(cacheKey: string): void {
		this.telemetryService.publicLog2<{ cacheKey: string }>(
			`${this.councilTelemetryPrefix}cache.miss`,
			{ cacheKey }
		);
	}

	public sendRateLimitExceeded(service: string, action: string, limit: number): void {
		this.telemetryService.publicLog2<{ service: string; action: string; limit: number }>(
			`${this.councilTelemetryPrefix}rate.limit.exceeded`,
			{ service, action, limit }
		);
	}

	public sendPRCreated(sessionId: string, prNumber: number, url: string): void {
		this.telemetryService.publicLog2<{ sessionId: string; prNumber: number; url: string }>(
			`${this.councilTelemetryPrefix}pr.created`,
			{ sessionId, prNumber, url }
		);
	}

	public sendFixApplied(sessionId: string, fileCount: number, successCount: number): void {
		this.telemetryService.publicLog2<{ sessionId: string; fileCount: number; successCount: number }>(
			`${this.councilTelemetryPrefix}fix.applied`,
			{ sessionId, fileCount, successCount }
		);
	}

	public sendError(service: string, error: string, actionable: boolean): void {
		this.telemetryService.publicLog2<{ service: string; error: string; actionable: boolean }>(
			`${this.councilTelemetryPrefix}error`,
			{ service, error: this.sanitizeError(error), actionable }
		);
	}

	public sendUIAction(action: string, component: string, duration?: number): void {
		const data: { action: string; component: string; duration?: number } = { action, component };
		if (duration !== undefined) {
			data.duration = duration;
		}
		this.telemetryService.publicLog2<{ action: string; component: string; duration?: number }>(
			`${this.councilTelemetryPrefix}ui.action`,
			data
		);
	}

	public sendPerformance(metric: string, value: number, unit: string): void {
		this.telemetryService.publicLog2<{ metric: string; value: number; unit: string }>(
			`${this.councilTelemetryPrefix}performance`,
			{ metric, value, unit }
		);
	}

	private sanitizeError(error: string): string {
		return error
			.replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, '[REDACTED_AWS_KEY]')
			.replace(/ghp_[A-Za-z0-9_]{36}/g, '[REDACTED_GITHUB_TOKEN]')
			.replace(/xox[basr]-[A-Za-z0-9-]+/g, '[REDACTED_SLACK_TOKEN]')
			.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
			.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '[REDACTED_EMAIL]')
			.substring(0, 500);
	}
}
