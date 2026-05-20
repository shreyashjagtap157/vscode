/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { Event, Emitter } from '../../../../../base/common/event.js';

export const ICouncilStreamingUI = createDecorator<ICouncilStreamingUI>('councilStreamingUI');

export type StreamingEventType = 'agent_start' | 'agent_progress' | 'agent_complete' | 'agent_failed' | 'task_start' | 'task_complete' | 'consensus_reached' | 'debate_detected' | 'session_complete' | 'session_failed';

export interface StreamingEvent {
	readonly id: string;
	readonly type: StreamingEventType;
	readonly timestamp: number;
	readonly sessionId: string;
	readonly agentId?: string;
	readonly taskId?: string;
	readonly content: string;
	readonly progress?: number;
	readonly metadata?: Record<string, unknown>;
}

export interface StreamingSession {
	readonly sessionId: string;
	readonly events: StreamingEvent[];
	readonly startTime: number;
	endTime?: number;
	status: 'streaming' | 'complete' | 'failed';
	readonly agentStatuses: Map<string, 'idle' | 'running' | 'complete' | 'failed'>;
}

export interface ICouncilStreamingUI extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onStreamingEvent: Event<StreamingEvent>;

	startSession(sessionId: string): void;
	emitAgentStart(sessionId: string, agentId: string, taskDescription: string): void;
	emitAgentProgress(sessionId: string, agentId: string, content: string, progress: number): void;
	emitAgentComplete(sessionId: string, agentId: string, result: string): void;
	emitAgentFailed(sessionId: string, agentId: string, error: string): void;
	emitTaskStart(sessionId: string, taskId: string, description: string): void;
	emitTaskComplete(sessionId: string, taskId: string, result: string): void;
	emitConsensusReached(sessionId: string, decision: string, confidence: number): void;
	emitDebateDetected(sessionId: string, topic: string, positions: string[]): void;
	completeSession(sessionId: string, summary: string): void;
	failSession(sessionId: string, error: string): void;
	getSession(sessionId: string): StreamingSession | undefined;
	getActiveSessions(): StreamingSession[];
}

export class CouncilStreamingUI extends Disposable implements ICouncilStreamingUI {
	declare readonly _serviceBrand: undefined;

	private readonly _onStreamingEvent = this._register(new Emitter<StreamingEvent>());
	readonly onStreamingEvent = this._onStreamingEvent.event;

	private readonly sessions: Map<string, StreamingSession>;
	private eventCounter = 0;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.sessions = new Map();
	}

	public startSession(sessionId: string): void {
		const session: StreamingSession = {
			sessionId,
			events: [],
			startTime: Date.now(),
			status: 'streaming',
			agentStatuses: new Map()
		};
		this.sessions.set(sessionId, session);
		this.logService.debug(`[Council Streaming] Session started: ${sessionId}`);
	}

	public emitAgentStart(sessionId: string, agentId: string, taskDescription: string): void {
		const event = this.createEvent(sessionId, 'agent_start', taskDescription, { agentId });
		this.updateAgentStatus(sessionId, agentId, 'running');
		this.fireEvent(event);
	}

	public emitAgentProgress(sessionId: string, agentId: string, content: string, progress: number): void {
		const event = this.createEvent(sessionId, 'agent_progress', content, { agentId, progress });
		this.fireEvent(event);
	}

	public emitAgentComplete(sessionId: string, agentId: string, result: string): void {
		const event = this.createEvent(sessionId, 'agent_complete', result, { agentId });
		this.updateAgentStatus(sessionId, agentId, 'complete');
		this.fireEvent(event);
	}

	public emitAgentFailed(sessionId: string, agentId: string, error: string): void {
		const event = this.createEvent(sessionId, 'agent_failed', error, { agentId });
		this.updateAgentStatus(sessionId, agentId, 'failed');
		this.fireEvent(event);
	}

	public emitTaskStart(sessionId: string, taskId: string, description: string): void {
		const event = this.createEvent(sessionId, 'task_start', description, { taskId });
		this.fireEvent(event);
	}

	public emitTaskComplete(sessionId: string, taskId: string, result: string): void {
		const event = this.createEvent(sessionId, 'task_complete', result, { taskId });
		this.fireEvent(event);
	}

	public emitConsensusReached(sessionId: string, decision: string, confidence: number): void {
		const event = this.createEvent(sessionId, 'consensus_reached', decision, { confidence });
		this.fireEvent(event);
	}

	public emitDebateDetected(sessionId: string, topic: string, positions: string[]): void {
		const event = this.createEvent(sessionId, 'debate_detected', topic, { positions });
		this.fireEvent(event);
	}

	public completeSession(sessionId: string, summary: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.endTime = Date.now();
			session.status = 'complete';
		}
		const event = this.createEvent(sessionId, 'session_complete', summary);
		this.fireEvent(event);
	}

	public failSession(sessionId: string, error: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.endTime = Date.now();
			session.status = 'failed';
		}
		const event = this.createEvent(sessionId, 'session_failed', error);
		this.fireEvent(event);
	}

	public getSession(sessionId: string): StreamingSession | undefined {
		return this.sessions.get(sessionId);
	}

	public getActiveSessions(): StreamingSession[] {
		return Array.from(this.sessions.values()).filter(s => s.status === 'streaming');
	}

	private createEvent(
		sessionId: string,
		type: StreamingEventType,
		content: string,
		metadata?: Record<string, unknown>
	): StreamingEvent {
		this.eventCounter++;
		return {
			id: `event-${this.eventCounter}`,
			type,
			timestamp: Date.now(),
			sessionId,
			agentId: metadata?.agentId as string,
			taskId: metadata?.taskId as string,
			content,
			progress: metadata?.progress as number,
			metadata
		};
	}

	private updateAgentStatus(sessionId: string, agentId: string, status: 'idle' | 'running' | 'complete' | 'failed'): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.agentStatuses.set(agentId, status);
		}
	}

	private fireEvent(event: StreamingEvent): void {
		const session = this.sessions.get(event.sessionId);
		if (session) {
			session.events.push(event);
		}
		this._onStreamingEvent.fire(event);
	}
}
