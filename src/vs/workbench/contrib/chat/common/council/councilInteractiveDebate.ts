/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { Event, Emitter } from '../../../../../../base/common/event.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';

export const ICouncilInteractiveDebate = createDecorator<ICouncilInteractiveDebate>('councilInteractiveDebate');

export interface DebateParticipant {
	readonly roleId: string;
	readonly position: string;
	readonly evidenceCount: number;
	readonly confidenceScore: number;
	readonly votes: number;
}

export interface InteractiveDebate {
	readonly debateId: string;
	readonly sessionId: string;
	readonly topic: string;
	readonly participants: DebateParticipant[];
	readonly status: 'active' | 'resolved' | 'dismissed';
	readonly resolution?: string;
	readonly resolutionMethod?: 'user_vote' | 'auto_resolve' | 'consensus';
	readonly createdAt: number;
	readonly resolvedAt?: number;
}

export interface UserVote {
	readonly debateId: string;
	readonly votedRoleId: string;
	readonly timestamp: number;
}

export interface ICouncilInteractiveDebate extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onDebateCreated: Event<InteractiveDebate>;
	readonly onDebateResolved: Event<InteractiveDebate>;
	readonly onUserVote: Event<UserVote>;

	createDebate(sessionId: string, topic: string, participants: DebateParticipant[]): InteractiveDebate;
	resolveDebate(debateId: string, resolution: string, method: 'user_vote' | 'auto_resolve' | 'consensus'): void;
	dismissDebate(debateId: string): void;
	castVote(debateId: string, votedRoleId: string): void;
	getDebate(debateId: string): InteractiveDebate | undefined;
	getActiveDebates(sessionId?: string): InteractiveDebate[];
	getDebateHistory(limit?: number): InteractiveDebate[];
}

export class CouncilInteractiveDebate extends Disposable implements ICouncilInteractiveDebate {
	declare readonly _serviceBrand: undefined;

	private readonly _onDebateCreated = this._register(new Emitter<InteractiveDebate>());
	readonly onDebateCreated = this._onDebateCreated.event;

	private readonly _onDebateResolved = this._register(new Emitter<InteractiveDebate>());
	readonly onDebateResolved = this._onDebateResolved.event;

	private readonly _onUserVote = this._register(new Emitter<UserVote>());
	readonly onUserVote = this._onUserVote.event;

	private readonly debates: Map<string, InteractiveDebate>;
	private readonly votes: UserVote[];

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.debates = new Map();
		this.votes = [];
	}

	public createDebate(
		sessionId: string,
		topic: string,
		participants: DebateParticipant[]
	): InteractiveDebate {
		const debate: InteractiveDebate = {
			debateId: generateUuid(),
			sessionId,
			topic,
			participants: participants.map(p => ({ ...p, votes: 0 })),
			status: 'active',
			createdAt: Date.now()
		};

		this.debates.set(debate.debateId, debate);
		this._onDebateCreated.fire(debate);

		this.logService.info(`[Council Debate] Created: ${topic} (${participants.length} participants)`);
		return debate;
	}

	public resolveDebate(
		debateId: string,
		resolution: string,
		method: 'user_vote' | 'auto_resolve' | 'consensus'
	): void {
		const debate = this.debates.get(debateId);
		if (!debate) return;

		debate.status = 'resolved';
		debate.resolution = resolution;
		debate.resolutionMethod = method;
		debate.resolvedAt = Date.now();

		this._onDebateResolved.fire(debate);
		this.logService.info(`[Council Debate] Resolved: ${debate.topic} via ${method}`);
	}

	public dismissDebate(debateId: string): void {
		const debate = this.debates.get(debateId);
		if (!debate) return;

		debate.status = 'dismissed';
		debate.resolvedAt = Date.now();

		this.logService.info(`[Council Debate] Dismissed: ${debate.topic}`);
	}

	public castVote(debateId: string, votedRoleId: string): void {
		const debate = this.debates.get(debateId);
		if (!debate || debate.status !== 'active') return;

		const participant = debate.participants.find(p => p.roleId === votedRoleId);
		if (!participant) return;

		participant.votes++;

		const vote: UserVote = {
			debateId,
			votedRoleId,
			timestamp: Date.now()
		};
		this.votes.push(vote);
		this._onUserVote.fire(vote);

		const totalVotes = debate.participants.reduce((sum, p) => sum + p.votes, 0);
		if (participant.votes > totalVotes / 2) {
			this.resolveDebate(debateId, `${votedRoleId} wins with majority vote`, 'user_vote');
		}

		this.logService.debug(`[Council Debate] Vote cast for ${votedRoleId} in ${debateId}`);
	}

	public getDebate(debateId: string): InteractiveDebate | undefined {
		return this.debates.get(debateId);
	}

	public getActiveDebates(sessionId?: string): InteractiveDebate[] {
		let debates = Array.from(this.debates.values()).filter(d => d.status === 'active');
		if (sessionId) {
			debates = debates.filter(d => d.sessionId === sessionId);
		}
		return debates;
	}

	public getDebateHistory(limit: number = 20): InteractiveDebate[] {
		return Array.from(this.debates.values())
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, limit);
	}
}
