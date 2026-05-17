/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';

export const ICouncilSessionEviction = createDecorator<ICouncilSessionEviction>('councilSessionEviction');

export interface SessionEvictionConfig {
	readonly maxSessions: number;
	readonly maxAgeMs: number;
	readonly evictionIntervalMs: number;
	readonly autoEvict: boolean;
}

export interface SessionInfo {
	readonly sessionId: string;
	readonly createdAt: number;
	readonly lastAccessedAt: number;
	readonly size: number;
	readonly status: string;
}

export interface EvictionResult {
	readonly evictedSessions: string[];
	readonly freedBytes: number;
	readonly executedAt: number;
}

export interface ICouncilSessionEviction extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onEvictionExecuted: Event<EvictionResult>;

	configure(config: Partial<SessionEvictionConfig>): void;
	registerSession(sessionId: string, size: number, status: string): void;
	updateSessionAccess(sessionId: string): void;
	removeSession(sessionId: string): void;
	executeEviction(): EvictionResult;
	getSessionInfo(sessionId: string): SessionInfo | undefined;
	getAllSessionInfo(): SessionInfo[];
	getStats(): { totalSessions: number; totalSizeBytes: number; oldestSessionAge: number };
}

const DEFAULT_CONFIG: SessionEvictionConfig = {
	maxSessions: 100,
	maxAgeMs: 60 * 60 * 1000,
	evictionIntervalMs: 5 * 60 * 1000,
	autoEvict: true
};

export class CouncilSessionEviction extends Disposable implements ICouncilSessionEviction {
	declare readonly _serviceBrand: undefined;

	private readonly _onEvictionExecuted = this._register(new Emitter<EvictionResult>());
	readonly onEvictionExecuted = this._onEvictionExecuted.event;

	private readonly sessions: Map<string, SessionInfo>;
	private config: SessionEvictionConfig;
	private evictionInterval: any;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.sessions = new Map();
		this.config = { ...DEFAULT_CONFIG };

		if (this.config.autoEvict) {
			this.startAutoEviction();
		}
	}

	public configure(config: Partial<SessionEvictionConfig>): void {
		this.config = { ...this.config, ...config };
		if (this.config.autoEvict) {
			this.startAutoEviction();
		} else {
			this.stopAutoEviction();
		}
	}

	public registerSession(sessionId: string, size: number, status: string): void {
		const now = Date.now();
		this.sessions.set(sessionId, {
			sessionId,
			createdAt: now,
			lastAccessedAt: now,
			size,
			status
		});
	}

	public updateSessionAccess(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			this.sessions.set(sessionId, { ...session, lastAccessedAt: Date.now() });
		}
	}

	public removeSession(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	public executeEviction(): EvictionResult {
		const now = Date.now();
		const evictedSessions: string[] = [];
		let freedBytes = 0;

		const toEvict: string[] = [];

		if (this.sessions.size > this.config.maxSessions) {
			const sorted = Array.from(this.sessions.values())
				.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

			const excess = this.sessions.size - this.config.maxSessions;
			toEvict.push(...sorted.slice(0, excess).map(s => s.sessionId));
		}

		for (const [id, session] of this.sessions) {
			if (toEvict.includes(id)) continue;

			const age = now - session.createdAt;
			if (age > this.config.maxAgeMs && session.status !== 'executing') {
				toEvict.push(id);
			}
		}

		for (const id of toEvict) {
			const session = this.sessions.get(id);
			if (session) {
				freedBytes += session.size;
				evictedSessions.push(id);
				this.sessions.delete(id);
			}
		}

		const result: EvictionResult = {
			evictedSessions,
			freedBytes,
			executedAt: now
		};

		this._onEvictionExecuted.fire(result);

		if (evictedSessions.length > 0) {
			this.logService.info(`[Council Eviction] Evicted ${evictedSessions.length} sessions, freed ${freedBytes} bytes`);
		}

		return result;
	}

	public getSessionInfo(sessionId: string): SessionInfo | undefined {
		return this.sessions.get(sessionId);
	}

	public getAllSessionInfo(): SessionInfo[] {
		return Array.from(this.sessions.values());
	}

	public getStats(): { totalSessions: number; totalSizeBytes: number; oldestSessionAge: number } {
		const now = Date.now();
		let totalSize = 0;
		let oldestAge = 0;

		for (const session of this.sessions.values()) {
			totalSize += session.size;
			const age = now - session.createdAt;
			if (age > oldestAge) oldestAge = age;
		}

		return {
			totalSessions: this.sessions.size,
			totalSizeBytes: totalSize,
			oldestSessionAge: oldestAge
		};
	}

	private startAutoEviction(): void {
		this.stopAutoEviction();
		this.evictionInterval = setInterval(() => {
			this.executeEviction();
		}, this.config.evictionIntervalMs);
	}

	private stopAutoEviction(): void {
		if (this.evictionInterval) {
			clearInterval(this.evictionInterval);
			this.evictionInterval = undefined;
		}
	}
}
