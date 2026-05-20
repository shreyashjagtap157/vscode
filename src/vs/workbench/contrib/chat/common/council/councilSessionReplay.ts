/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

export const ICouncilSessionReplay = createDecorator<ICouncilSessionReplay>('councilSessionReplay');

export interface ReplayEvent {
	readonly eventId: string;
	readonly timestamp: number;
	readonly relativeTime: number;
	readonly type: string;
	readonly agentId?: string;
	readonly content: string;
	readonly metadata?: Record<string, unknown>;
}

export interface RecordedSession {
	readonly sessionId: string;
	readonly request: string;
	readonly events: ReplayEvent[];
	result?: string;
	confidence?: number;
	readonly startTime: number;
	endTime?: number;
	readonly agents: string[];
	status: 'completed' | 'failed' | 'cancelled';
}

export interface ReplayState {
	currentEventIndex: number;
	isPlaying: boolean;
	speed: number;
	currentContent: string;
}

export interface ICouncilSessionReplay extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onReplayUpdate: Event<ReplayState>;

	recordSession(sessionId: string, request: string, agents: string[]): void;
	recordEvent(sessionId: string, type: string, agentId: string | undefined, content: string, metadata?: Record<string, unknown>): void;
	completeSession(sessionId: string, result: string, confidence: number): void;
	failSession(sessionId: string, error: string): void;

	getRecordedSessions(): RecordedSession[];
	getSession(sessionId: string): RecordedSession | undefined;

	startReplay(sessionId: string, speed?: number): ReplayState;
	pauseReplay(): void;
	resumeReplay(): void;
	stepForward(): ReplayState;
	stepBackward(): ReplayState;
	stopReplay(): void;
	setReplaySpeed(speed: number): void;

	deleteRecording(sessionId: string): void;
}

export class CouncilSessionReplay extends Disposable implements ICouncilSessionReplay {
	declare readonly _serviceBrand: undefined;

	private readonly _onReplayUpdate = this._register(new Emitter<ReplayState>());
	readonly onReplayUpdate = this._onReplayUpdate.event;

	private readonly recordings: Map<string, RecordedSession>;
	private activeReplay: { sessionId: string; state: ReplayState; interval?: ReturnType<typeof setInterval> } | undefined;

	private readonly storageKey = 'council.sessionReplay.recordings';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.recordings = new Map();
		this.loadFromStorage();
	}

	public recordSession(sessionId: string, request: string, agents: string[]): void {
		const session: RecordedSession = {
			sessionId,
			request,
			events: [],
			agents,
			startTime: Date.now(),
			status: 'completed'
		};
		this.recordings.set(sessionId, session);
		this.logService.debug(`[Council Replay] Recording started: ${sessionId}`);
	}

	public recordEvent(
		sessionId: string,
		type: string,
		agentId: string | undefined,
		content: string,
		metadata?: Record<string, unknown>
	): void {
		const session = this.recordings.get(sessionId);
		if (!session) return;

		const relativeTime = Date.now() - session.startTime;

		const event: ReplayEvent = {
			eventId: generateUuid(),
			timestamp: Date.now(),
			relativeTime,
			type,
			agentId,
			content,
			metadata
		};

		session.events.push(event);
	}

	public completeSession(sessionId: string, result: string, confidence: number): void {
		const session = this.recordings.get(sessionId);
		if (!session) return;

		session.result = result;
		session.confidence = confidence;
		session.endTime = Date.now();
		session.status = 'completed';

		this.saveToStorage();
		this.logService.info(`[Council Replay] Recording completed: ${sessionId}`);
	}

	public failSession(sessionId: string, error: string): void {
		const session = this.recordings.get(sessionId);
		if (!session) return;

		session.result = `Failed: ${error}`;
		session.endTime = Date.now();
		session.status = 'failed';

		this.saveToStorage();
	}

	public getRecordedSessions(): RecordedSession[] {
		return Array.from(this.recordings.values())
			.sort((a, b) => b.startTime - a.startTime);
	}

	public getSession(sessionId: string): RecordedSession | undefined {
		return this.recordings.get(sessionId);
	}

	public startReplay(sessionId: string, speed: number = 1): ReplayState {
		const session = this.recordings.get(sessionId);
		if (!session || session.events.length === 0) {
			return { currentEventIndex: 0, isPlaying: false, speed: 1, currentContent: '' };
		}

		this.stopReplay();

		const state: ReplayState = {
			currentEventIndex: 0,
			isPlaying: true,
			speed,
			currentContent: session.events[0].content
		};

		this.activeReplay = { sessionId, state };

		this.startReplayInterval(session, speed);
		this._onReplayUpdate.fire(state);

		return state;
	}

	public pauseReplay(): void {
		if (this.activeReplay) {
			if (this.activeReplay.interval) {
				clearInterval(this.activeReplay.interval);
			}
			this.activeReplay.state.isPlaying = false;
			this._onReplayUpdate.fire(this.activeReplay.state);
		}
	}

	public resumeReplay(): void {
		if (this.activeReplay) {
			const session = this.recordings.get(this.activeReplay.sessionId);
			if (session) {
				this.activeReplay.state.isPlaying = true;
				this.startReplayInterval(session, this.activeReplay.state.speed);
				this._onReplayUpdate.fire(this.activeReplay.state);
			}
		}
	}

	public stepForward(): ReplayState {
		if (!this.activeReplay) return { currentEventIndex: 0, isPlaying: false, speed: 1, currentContent: '' };

		const session = this.recordings.get(this.activeReplay.sessionId);
		if (!session) return this.activeReplay.state;

		if (this.activeReplay.state.currentEventIndex < session.events.length - 1) {
			this.activeReplay.state.currentEventIndex++;
			this.activeReplay.state.currentContent = session.events[this.activeReplay.state.currentEventIndex].content;
		}

		this._onReplayUpdate.fire(this.activeReplay.state);
		return this.activeReplay.state;
	}

	public stepBackward(): ReplayState {
		if (!this.activeReplay) return { currentEventIndex: 0, isPlaying: false, speed: 1, currentContent: '' };

		if (this.activeReplay.state.currentEventIndex > 0) {
			const session = this.recordings.get(this.activeReplay.sessionId);
			if (session) {
				this.activeReplay.state.currentEventIndex--;
				this.activeReplay.state.currentContent = session.events[this.activeReplay.state.currentEventIndex].content;
			}
		}

		this._onReplayUpdate.fire(this.activeReplay.state);
		return this.activeReplay.state;
	}

	public stopReplay(): void {
		if (this.activeReplay) {
			if (this.activeReplay.interval) {
				clearInterval(this.activeReplay.interval);
			}
			this.activeReplay = undefined;
		}
	}

	public setReplaySpeed(speed: number): void {
		if (this.activeReplay) {
			this.activeReplay.state.speed = Math.max(0.25, Math.min(4, speed));

			if (this.activeReplay.state.isPlaying) {
				if (this.activeReplay.interval) clearInterval(this.activeReplay.interval);
				const session = this.recordings.get(this.activeReplay.sessionId);
				if (session) {
					this.startReplayInterval(session, this.activeReplay.state.speed);
				}
			}

			this._onReplayUpdate.fire(this.activeReplay.state);
		}
	}

	public deleteRecording(sessionId: string): void {
		this.recordings.delete(sessionId);
		this.saveToStorage();
	}

	private startReplayInterval(session: RecordedSession, speed: number): void {
		if (this.activeReplay?.interval) {
			clearInterval(this.activeReplay.interval);
		}

		const baseInterval = 1000 / speed;

		this.activeReplay!.interval = setInterval(() => {
			if (!this.activeReplay || !this.activeReplay.state.isPlaying) return;

			if (this.activeReplay.state.currentEventIndex < session.events.length - 1) {
				this.activeReplay.state.currentEventIndex++;
				this.activeReplay.state.currentContent = session.events[this.activeReplay.state.currentEventIndex].content;
				this._onReplayUpdate.fire(this.activeReplay.state);
			} else {
				this.activeReplay.state.isPlaying = false;
				if (this.activeReplay.interval) clearInterval(this.activeReplay.interval);
				this._onReplayUpdate.fire(this.activeReplay.state);
			}
		}, baseInterval);
	}

	private loadFromStorage(): void {
		try {
			const stored = this.storageService.get(this.storageKey, StorageScope.WORKSPACE, '{}');
			const data = JSON.parse(stored) as Record<string, RecordedSession>;
			for (const [id, session] of Object.entries(data)) {
				this.recordings.set(id, session);
			}
		} catch {
			// Ignore parse errors
		}
	}

	private saveToStorage(): void {
		try {
			const data: Record<string, RecordedSession> = {};
			for (const [id, session] of this.recordings) {
				data[id] = session;
			}
			this.storageService.store(
				this.storageKey,
				JSON.stringify(data),
				StorageScope.WORKSPACE,
				StorageTarget.USER
			);
		} catch (error) {
			this.logService.warn(`[Council Replay] Failed to save: ${error}`);
		}
	}
}
