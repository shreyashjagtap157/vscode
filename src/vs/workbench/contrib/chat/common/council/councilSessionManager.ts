/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CouncilResult } from './councilOrchestrator.js';
import { Emitter, Event } from '../../../../../base/common/event.js';

export const ICouncilSessionManager = createDecorator<ICouncilSessionManager>('councilSessionManager');

export interface CouncilSessionRecord extends CouncilResult {
	request: string;
	timestamp: number;
	roles: string[];
	strategy: string;
}

export interface ICouncilSessionManager extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onSessionStarted: Event<string>;
	readonly onSessionCompleted: Event<CouncilSessionRecord>;
	readonly onSessionFailed: Event<{ sessionId: string; error: string }>;

	getSession(sessionId: string): CouncilSessionRecord | undefined;
	getAllSessions(): CouncilSessionRecord[];
	getRecentSessions(limit?: number): CouncilSessionRecord[];
	getSessionsByRole(roleId: string): CouncilSessionRecord[];
	clearHistory(): void;
}

export class CouncilSessionManager extends Disposable implements ICouncilSessionManager {
	declare readonly _serviceBrand: undefined;

	private readonly _onSessionStarted = this._register(new Emitter<string>());
	readonly onSessionStarted: Event<string> = this._onSessionStarted.event;

	private readonly _onSessionCompleted = this._register(new Emitter<CouncilSessionRecord>());
	readonly onSessionCompleted: Event<CouncilSessionRecord> = this._onSessionCompleted.event;

	private readonly _onSessionFailed = this._register(new Emitter<{ sessionId: string; error: string }>());
	readonly onSessionFailed: Event<{ sessionId: string; error: string }> = this._onSessionFailed.event;

	private readonly sessions: Map<string, CouncilSessionRecord> = new Map();
	private readonly sessionOrder: string[] = [];

	private readonly MAX_HISTORY = 100;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.logService.info('[CouncilSessionManager] Initialized');
	}

	public recordSessionStart(sessionId: string): void {
		this._onSessionStarted.fire(sessionId);
	}

	public recordSessionComplete(result: CouncilSessionRecord): void {
		this.sessions.set(result.sessionId, result);
		this.sessionOrder.unshift(result.sessionId);

		if (this.sessions.size > this.MAX_HISTORY) {
			const oldest = this.sessionOrder.pop();
			if (oldest) {
				this.sessions.delete(oldest);
			}
		}

		this._onSessionCompleted.fire(result);
		this.logService.info(`[CouncilSessionManager] Session ${result.sessionId} completed with confidence ${(result.confidence * 100).toFixed(0)}%`);
	}

	public recordSessionFailure(sessionId: string, error: string): void {
		this._onSessionFailed.fire({ sessionId, error });
		this.logService.error(`[CouncilSessionManager] Session ${sessionId} failed: ${error}`);
	}

	public getSession(sessionId: string): CouncilSessionRecord | undefined {
		return this.sessions.get(sessionId);
	}

	public getAllSessions(): CouncilSessionRecord[] {
		return this.sessionOrder.map(id => this.sessions.get(id)!).filter(Boolean);
	}

	public getRecentSessions(limit: number = 10): CouncilSessionRecord[] {
		return this.sessionOrder.slice(0, limit).map(id => this.sessions.get(id)!).filter(Boolean);
	}

	public getSessionsByRole(roleId: string): CouncilSessionRecord[] {
		return this.getAllSessions().filter(s => s.roles.includes(roleId));
	}

	public clearHistory(): void {
		this.sessions.clear();
		this.sessionOrder.length = 0;
		this.logService.info('[CouncilSessionManager] History cleared');
	}

	public getSessionStats(): { total: number; avgConfidence: number; avgDuration: number; successRate: number } {
		const sessions = this.getAllSessions();
		if (sessions.length === 0) {
			return { total: 0, avgConfidence: 0, avgDuration: 0, successRate: 0 };
		}

		const totalConfidence = sessions.reduce((sum, s) => sum + s.confidence, 0);
		const totalDuration = sessions.reduce((sum, s) => sum + s.executionTimeMs, 0);
		const successCount = sessions.filter(s => s.status === 'success').length;

		return {
			total: sessions.length,
			avgConfidence: totalConfidence / sessions.length,
			avgDuration: totalDuration / sessions.length,
			successRate: successCount / sessions.length
		};
	}
}
