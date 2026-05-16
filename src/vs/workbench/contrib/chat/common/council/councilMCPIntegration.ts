/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';

export const ICouncilMCPIntegration = createDecorator<ICouncilMCPIntegration>('councilMCPIntegration');

export enum MCPArtifactType {
	Code = 'code',
	Design = 'design',
	Test = 'test',
	Document = 'document',
	Configuration = 'configuration'
}

export interface CouncilArtifact {
	id: string;
	type: MCPArtifactType;
	title: string;
	content: string;
	metadata: Record<string, any>;
	createdBy: string;
	createdAt: number;
	sessionId: string;
	tags: string[];
}

export interface MCPSessionState {
	sessionId: string;
	request: string;
	tasks: Array<{
		taskId: string;
		description: string;
		assignedRole: string;
		dependencies: string[];
		status: string;
		result?: string;
	}>;
	contributions: Array<{ roleId: string; content: string }>;
	scratchpad: string[];
	startTime: number;
	endTime?: number;
	status: string;
}

export interface MCPAgentMessage {
	messageId: string;
	from: string;
	to: string;
	content: string;
	timestamp: number;
	type: 'request' | 'response' | 'critique' | 'consensus';
}

export interface ICouncilMCPIntegration extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onArtifactShared: Event<CouncilArtifact>;
	readonly onSessionStateUpdated: Event<MCPSessionState>;

	isConnected(): boolean;
	connect(): Promise<void>;
	disconnect(): Promise<void>;

	storeSessionState(state: MCPSessionState): Promise<void>;
	loadSessionState(sessionId: string): Promise<MCPSessionState | undefined>;
	getAllSessionStates(): Promise<MCPSessionState[]>;

	shareArtifact(artifact: CouncilArtifact): Promise<void>;
	getArtifactsBySession(sessionId: string): Promise<CouncilArtifact[]>;
	getArtifactsByTag(tag: string): Promise<CouncilArtifact[]>;
	searchArtifacts(query: string): Promise<CouncilArtifact[]>;

	sendAgentMessage(message: MCPAgentMessage): Promise<void>;
	getAgentMessages(sessionId: string): Promise<MCPAgentMessage[]>;

	getSharedScratchpad(sessionId: string): Promise<string[]>;
	updateSharedScratchpad(sessionId: string, entries: string[]): Promise<void>;
}

export class CouncilMCPIntegration extends Disposable implements ICouncilMCPIntegration {
	declare readonly _serviceBrand: undefined;

	private readonly _onArtifactShared = this._register(new Emitter<CouncilArtifact>());
	readonly onArtifactShared: Event<CouncilArtifact> = this._onArtifactShared.event;

	private readonly _onSessionStateUpdated = this._register(new Emitter<MCPSessionState>());
	readonly onSessionStateUpdated: Event<MCPSessionState> = this._onSessionStateUpdated.event;

	private connected = false;

	private readonly sessionStates = new Map<string, MCPSessionState>();
	private readonly artifacts = new Map<string, CouncilArtifact[]>();
	private readonly agentMessages = new Map<string, MCPAgentMessage[]>();
	private readonly scratchpads = new Map<string, string[]>();

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.logService.info('[CouncilMCP] Integration initialized (in-memory mode)');
	}

	public isConnected(): boolean {
		return this.connected;
	}

	public async connect(): Promise<void> {
		this.connected = true;
		this.logService.info('[CouncilMCP] Connected');
	}

	public async disconnect(): Promise<void> {
		this.connected = false;
		this.logService.info('[CouncilMCP] Disconnected');
	}

	public async storeSessionState(state: MCPSessionState): Promise<void> {
		this.sessionStates.set(state.sessionId, state);
		this._onSessionStateUpdated.fire(state);
		this.logService.debug(`[CouncilMCP] Stored session state: ${state.sessionId}`);
	}

	public async loadSessionState(sessionId: string): Promise<MCPSessionState | undefined> {
		return this.sessionStates.get(sessionId);
	}

	public async getAllSessionStates(): Promise<MCPSessionState[]> {
		return Array.from(this.sessionStates.values());
	}

	public async shareArtifact(artifact: CouncilArtifact): Promise<void> {
		const sessionArtifacts = this.artifacts.get(artifact.sessionId) || [];
		sessionArtifacts.push(artifact);
		this.artifacts.set(artifact.sessionId, sessionArtifacts);
		this._onArtifactShared.fire(artifact);
		this.logService.debug(`[CouncilMCP] Shared artifact: ${artifact.title} (${artifact.type})`);
	}

	public async getArtifactsBySession(sessionId: string): Promise<CouncilArtifact[]> {
		return this.artifacts.get(sessionId) || [];
	}

	public async getArtifactsByTag(tag: string): Promise<CouncilArtifact[]> {
		const allArtifacts = Array.from(this.artifacts.values()).flat();
		return allArtifacts.filter(a => a.tags.includes(tag));
	}

	public async searchArtifacts(query: string): Promise<CouncilArtifact[]> {
		const allArtifacts = Array.from(this.artifacts.values()).flat();
		const lowerQuery = query.toLowerCase();
		return allArtifacts.filter(a =>
			a.title.toLowerCase().includes(lowerQuery) ||
			a.content.toLowerCase().includes(lowerQuery) ||
			a.tags.some(t => t.toLowerCase().includes(lowerQuery))
		);
	}

	public async sendAgentMessage(message: MCPAgentMessage): Promise<void> {
		const sessionMessages = this.agentMessages.get(message.messageId.split('-')[0]) || [];
		sessionMessages.push(message);
		this.agentMessages.set(message.messageId.split('-')[0], sessionMessages);
		this.logService.debug(`[CouncilMCP] Agent message: ${message.from} -> ${message.to}`);
	}

	public async getAgentMessages(sessionId: string): Promise<MCPAgentMessage[]> {
		return this.agentMessages.get(sessionId) || [];
	}

	public async getSharedScratchpad(sessionId: string): Promise<string[]> {
		return this.scratchpads.get(sessionId) || [];
	}

	public async updateSharedScratchpad(sessionId: string, entries: string[]): Promise<void> {
		this.scratchpads.set(sessionId, entries);
		this.logService.debug(`[CouncilMCP] Updated scratchpad for session: ${sessionId}`);
	}

	public async createArtifact(options: {
		type: MCPArtifactType;
		title: string;
		content: string;
		sessionId: string;
		createdBy: string;
		metadata?: Record<string, any>;
		tags?: string[];
	}): Promise<CouncilArtifact> {
		const artifact: CouncilArtifact = {
			id: generateUuid(),
			type: options.type,
			title: options.title,
			content: options.content,
			metadata: options.metadata || {},
			createdBy: options.createdBy,
			createdAt: Date.now(),
			sessionId: options.sessionId,
			tags: options.tags || []
		};

		await this.shareArtifact(artifact);
		return artifact;
	}
}
