/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IAgentProfileManager, CouncilAgentProfile } from './agentProfileManager.js';
import { ILanguageModelsService, ChatMessageRole, IChatMessage } from '../languageModels.js';
import { ILanguageModelToolsService } from '../tools/languageModelToolsService.js';
import { IChatService } from '../chatService/chatService.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

export const ICouncilOrchestrator = createDecorator<ICouncilOrchestrator>('councilOrchestrator');

export interface CouncilTask {
	taskId: string;
	description: string;
	assignedRole: string;
	dependencies: string[];
	status: 'pending' | 'in_progress' | 'completed' | 'failed';
	result?: string;
	error?: string;
	startTime?: number;
	endTime?: number;
}

export interface CouncilSession {
	readonly sessionId: string;
	readonly originalRequest: string;
	readonly activeTaskGraph: CouncilTask[];
	readonly contributions: Map<string, string>;
	readonly sharedScratchpad: string[];
	readonly startTime: number;
	endTime?: number;
	status: 'planning' | 'executing' | 'reviewing' | 'completed' | 'failed' | 'cancelled';
}

export interface TaskDecomposition {
	tasks: CouncilTask[];
	summary: string;
}

export interface CouncilResult {
	readonly sessionId: string;
	readonly finalResponse: string;
	readonly contributions: Map<string, string>;
	readonly debateRecords: DebateRecord[];
	readonly confidence: number;
	readonly executionTimeMs: number;
	readonly status: 'success' | 'partial' | 'failed';
}

export interface DebateRecord {
	readonly topic: string;
	readonly positions: Array<{
		roleId: string;
		position: string;
		evidenceCount: number;
	}>;
	readonly resolution: string;
	readonly rationale: string;
}

export interface ICouncilOrchestrator extends IDisposable {
	readonly _serviceBrand: undefined;

	executeSession(request: string, selectedRoles?: string[], token?: CancellationToken): Promise<CouncilResult>;
	getSession(sessionId: string): CouncilSession | undefined;
	getActiveSessions(): CouncilSession[];
	cancelSession(sessionId: string): void;
}

export class CouncilOrchestrator extends Disposable implements ICouncilOrchestrator {
	declare readonly _serviceBrand: undefined;

	private readonly sessions: Map<string, CouncilSession>;
	private readonly cancellationTokens: Map<string, CancellationTokenSource>;

	constructor(
		@IAgentProfileManager private readonly profileManager: IAgentProfileManager,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@ILanguageModelToolsService _languageModelToolsService: ILanguageModelToolsService,
		@IChatService _chatService: IChatService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.sessions = new Map();
		this.cancellationTokens = new Map();
	}

	public async executeSession(
		request: string,
		selectedRoles?: string[],
		token: CancellationToken = CancellationToken.None
	): Promise<CouncilResult> {
		const sessionId = generateUuid();
		const cts = new CancellationTokenSource();
		const parentListener = token.onCancellationRequested(() => cts.cancel());
		this.cancellationTokens.set(sessionId, cts);

		const linkedToken = cts.token;

		try {
			this.logService.info(`[Council] Starting session ${sessionId} for request: ${request.substring(0, 100)}...`);

			const decomposition = await this.decomposeRequest(request, selectedRoles, linkedToken);
			const session = this.createSession(sessionId, request, decomposition);
			this.sessions.set(sessionId, session);

			this.logService.info(`[Council] Decomposed into ${decomposition.tasks.length} tasks`);

			const executionLevels = this.getExecutionLevels(decomposition.tasks);
			this.logService.info(`[Council] Execution levels: ${executionLevels.length}`);

			for (let levelIndex = 0; levelIndex < executionLevels.length; levelIndex++) {
				if (linkedToken.isCancellationRequested) {
					session.status = 'cancelled';
					throw new Error('Session cancelled');
				}

				const level = executionLevels[levelIndex];
				this.logService.info(`[Council] Executing level ${levelIndex + 1}/${executionLevels.length} with ${level.length} tasks`);

				const results = await Promise.allSettled(
					level.map(task => this.executeTask(session, task, linkedToken))
				);

				this.processTaskResults(session, results);
			}

			session.status = 'reviewing';
			const result = this.synthesizeResult(session);
			session.status = 'completed';
			session.endTime = Date.now();

			this.logService.info(`[Council] Session ${sessionId} completed in ${session.endTime - session.startTime}ms`);

			return result;
		} catch (error) {
			const session = this.sessions.get(sessionId);
			if (session) {
				session.status = 'failed';
				session.endTime = Date.now();
			}
			this.logService.error(`[Council] Session ${sessionId} failed: ${error}`);
			throw error;
		} finally {
			parentListener.dispose();
			this.cancellationTokens.delete(sessionId);
		}
	}

	private async decomposeRequest(
		request: string,
		selectedRoles: string[] | undefined,
		token: CancellationToken
	): Promise<TaskDecomposition> {
		const availableProfiles = selectedRoles
			? selectedRoles.map(roleId => this.profileManager.getProfile(roleId))
			: this.profileManager.getAllProfiles();

		const rolesList = availableProfiles.map(p => `- ${p.roleId}: ${p.displayName} (${p.focusModes.join(', ')})`).join('\n');

		const planningPrompt = `You are a Task Decomposition Coordinator. Analyze the following user request and break it down into specific tasks that can be assigned to specialized agents.

User Request: ${request}

Available Agent Roles:
${rolesList}

Output a JSON object with the following structure:
{
	"tasks": [
		{
			"taskId": "t1",
			"description": "Clear, specific task description",
			"assignedRole": "role_id",
			"dependencies": []
		}
	],
	"summary": "Brief summary of the execution plan"
}

Rules:
1. Each task must have exactly one assigned role from the available roles
2. Dependencies must reference existing taskIds only
3. No circular dependencies
4. Tasks with no dependencies should be at the top level (parallel execution)
5. Be specific in task descriptions - include what the agent should accomplish
6. Assign tasks to the most appropriate role based on their specialization

Output ONLY valid JSON, no markdown formatting.`;

		try {
			const models = await this.languageModelsService.getLanguageModelIds();
			const model = models.length > 0 ? models[0] : undefined;

			if (!model) {
				this.logService.warn('[Council] No language model available, using default decomposition');
				return this.getDefaultDecomposition(request, availableProfiles);
			}

			const response = await this.languageModelsService.sendChatRequest(
				model,
				undefined,
				[{ role: ChatMessageRole.User, content: [{ type: 'text', value: planningPrompt }] }],
				{},
				token
			);

			let responseText = '';
			for await (const chunk of response.stream) {
				if (Array.isArray(chunk)) {
					for (const part of chunk) {
						if (part.type === 'text') {
							responseText += part.value;
						}
					}
				} else if (chunk.type === 'text') {
					responseText += chunk.value;
				}
			}

			const parsed = this.parseTaskDecomposition(responseText, availableProfiles);
			return parsed;
		} catch (error) {
			this.logService.warn(`[Council] LLM decomposition failed, using default: ${error}`);
			return this.getDefaultDecomposition(request, availableProfiles);
		}
	}

	private parseTaskDecomposition(responseText: string, availableProfiles: CouncilAgentProfile[]): TaskDecomposition {
		try {
			const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
			const parsed = JSON.parse(cleaned) as TaskDecomposition;

			if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
				throw new Error('Invalid decomposition: missing tasks array');
			}

			const validRoles = new Set(availableProfiles.map(p => p.roleId));
			for (const task of parsed.tasks) {
				if (!validRoles.has(task.assignedRole)) {
					this.logService.warn(`[Council] Invalid role ${task.assignedRole}, defaulting to architect`);
					task.assignedRole = 'architect';
				}
				if (!task.taskId) task.taskId = generateUuid();
				if (!task.dependencies) task.dependencies = [];
				task.status = 'pending';
			}

			this.validateDAG(parsed.tasks);

			return {
				tasks: parsed.tasks,
				summary: parsed.summary || 'Council execution plan'
			};
		} catch (error) {
			this.logService.error(`[Council] Failed to parse decomposition response: ${error}`);
			throw new Error(`Invalid decomposition response: ${error}`);
		}
	}

	private getDefaultDecomposition(request: string, availableProfiles: CouncilAgentProfile[]): TaskDecomposition {
		const roles = availableProfiles.length > 0 ? availableProfiles : [this.profileManager.getProfile('architect')];
		
		return {
			summary: 'Default council decomposition',
			tasks: roles.slice(0, 3).map((profile, index) => ({
				taskId: `t${index + 1}`,
				description: `Analyze and provide recommendations for: ${request.substring(0, 200)}`,
				assignedRole: profile.roleId,
				dependencies: index === 0 ? [] : [`t${index}`],
				status: 'pending' as const
			}))
		};
	}

	private validateDAG(tasks: CouncilTask[]): void {
		const visited = new Set<string>();
		const inStack = new Set<string>();

		const hasCycle = (taskId: string): boolean => {
			if (inStack.has(taskId)) return true;
			if (visited.has(taskId)) return false;

			inStack.add(taskId);
			const task = tasks.find(t => t.taskId === taskId);
			if (task) {
				for (const dep of task.dependencies) {
					if (hasCycle(dep)) return true;
				}
			}
			inStack.delete(taskId);
			visited.add(taskId);
			return false;
		};

		for (const task of tasks) {
			if (hasCycle(task.taskId)) {
				throw new Error(`Circular dependency detected in task graph involving task ${task.taskId}`);
			}
		}
	}

	private createSession(sessionId: string, request: string, decomposition: TaskDecomposition): CouncilSession {
		return {
			sessionId,
			originalRequest: request,
			activeTaskGraph: decomposition.tasks,
			contributions: new Map(),
			sharedScratchpad: [],
			startTime: Date.now(),
			status: 'planning'
		};
	}

	private getExecutionLevels(tasks: CouncilTask[]): CouncilTask[][] {
		const levels: CouncilTask[][] = [];
		const completed = new Set<string>();
		const remaining = new Set(tasks.map(t => t.taskId));

		while (remaining.size > 0) {
			const ready: CouncilTask[] = [];
			
			for (const taskId of remaining) {
				const task = tasks.find(t => t.taskId === taskId);
				if (task && task.dependencies.every(dep => completed.has(dep))) {
					ready.push(task);
				}
			}

			if (ready.length === 0) {
				this.logService.warn('[Council] Deadlock detected in task graph, forcing remaining tasks');
				ready.push(...tasks.filter(t => remaining.has(t.taskId)));
			}

			levels.push(ready);
			ready.forEach(t => {
				completed.add(t.taskId);
				remaining.delete(t.taskId);
			});
		}

		return levels;
	}

	private async executeTask(
		session: CouncilSession,
		task: CouncilTask,
		token: CancellationToken
	): Promise<void> {
		task.status = 'in_progress';
		task.startTime = Date.now();
		this.logService.info(`[Council] Executing task ${task.taskId} (${task.assignedRole}): ${task.description.substring(0, 80)}...`);

		try {
			const profile = this.profileManager.getProfile(task.assignedRole);
			const context = this.buildAgentContext(session, task);
			const systemPrompt = this.profileManager.buildSystemPrompt(task.assignedRole, context);

			const result = await this.invokeSubAgent(profile, systemPrompt, task.description, token);

			task.result = result;
			task.status = 'completed';
			task.endTime = Date.now();
			session.contributions.set(task.assignedRole, result);
			session.sharedScratchpad.push(`[${profile.displayName}]: ${result.substring(0, 500)}...`);

			this.logService.info(`[Council] Task ${task.taskId} completed in ${task.endTime - task.startTime!}ms`);
		} catch (error) {
			task.status = 'failed';
			task.error = error instanceof Error ? error.message : String(error);
			task.endTime = Date.now();
			this.logService.error(`[Council] Task ${task.taskId} failed: ${task.error}`);
		}
	}

	private buildAgentContext(session: CouncilSession, task: CouncilTask): string {
		const dependencyResults = task.dependencies
			.map(depId => {
				const depTask = session.activeTaskGraph.find(t => t.taskId === depId);
				if (depTask?.result) {
					return `## ${depTask.assignedRole} (Task ${depId})\n${depTask.result}`;
				}
				return '';
			})
			.filter(Boolean)
			.join('\n\n');

		const scratchpadSummary = session.sharedScratchpad.length > 0
			? `## Previous Council Discussion\n${session.sharedScratchpad.join('\n\n')}`
			: '';

		return `## Original Request\n${session.originalRequest}\n\n${scratchpadSummary}\n\n${dependencyResults}`;
	}

	private async invokeSubAgent(
		profile: CouncilAgentProfile,
		systemPrompt: string,
		taskDescription: string,
		token: CancellationToken
	): Promise<string> {
		const models = await this.languageModelsService.getLanguageModelIds();
		const modelId = profile.modelOverride && models.includes(profile.modelOverride)
			? profile.modelOverride
			: models[0];

		if (!modelId) {
			throw new Error('No language model available for sub-agent invocation');
		}

		this.logService.debug(`[Council] Invoking sub-agent ${profile.roleId} with model ${modelId}`);

		const messages: IChatMessage[] = [
			{ role: ChatMessageRole.System, content: [{ type: 'text', value: systemPrompt }] },
			{ role: ChatMessageRole.User, content: [{ type: 'text', value: taskDescription }] }
		];

		const response = await this.languageModelsService.sendChatRequest(
			modelId,
			undefined,
			messages,
			{
				max_tokens: profile.maxTokens || 4000,
				temperature: profile.temperature ?? 0.7
			},
			token
		);

		let result = '';
		for await (const chunk of response.stream) {
			if (token.isCancellationRequested) break;
			if (Array.isArray(chunk)) {
				for (const part of chunk) {
					if (part.type === 'text') {
						result += part.value;
					}
				}
			} else if (chunk.type === 'text') {
				result += chunk.value;
			}
		}

		return result || `[${profile.displayName}] Task completed (no output)`;
	}

	private processTaskResults(
		session: CouncilSession,
		results: PromiseSettledResult<void>[]
	): void {
		for (const result of results) {
			if (result.status === 'rejected') {
				this.logService.warn(`[Council] Task execution rejected: ${result.reason}`);
			}
		}
	}

	private synthesizeResult(session: CouncilSession): CouncilResult {
		const contributions = Array.from(session.contributions.entries());
		const failedTasks = session.activeTaskGraph.filter(t => t.status === 'failed');

		const synthesisPrompt = `You are the Council Coordinator. Synthesize the following agent contributions into a coherent, comprehensive response to the original request.

Original Request: ${session.originalRequest}

## Agent Contributions
${contributions.map(([role, content]) => `### ${role}\n${content}`).join('\n\n')}

## Instructions
1. Combine the insights from all agents
2. Highlight areas of agreement and disagreement
3. Provide a final recommendation based on the evidence
4. Be transparent about any uncertainties or limitations
5. Structure the response clearly with headings and bullet points where appropriate

Provide the synthesized response:`;

		const confidence = this.calculateConfidence(session);
		const executionTime = (session.endTime || Date.now()) - session.startTime;

		return {
			sessionId: session.sessionId,
			finalResponse: synthesisPrompt,
			contributions: new Map(contributions),
			debateRecords: this.detectDebates(session),
			confidence,
			executionTimeMs: executionTime,
			status: failedTasks.length === 0 ? 'success' : failedTasks.length < session.activeTaskGraph.length / 2 ? 'partial' : 'failed'
		};
	}

	private calculateConfidence(session: CouncilSession): number {
		const totalTasks = session.activeTaskGraph.length;
		const completedTasks = session.activeTaskGraph.filter(t => t.status === 'completed').length;
		const evidenceCount = Array.from(session.contributions.values())
			.reduce((sum, content) => sum + (content.match(/\[File:.*?\]|\[Log:.*?\]/g) || []).length, 0);

		const completionRate = completedTasks / totalTasks;
		const evidenceBonus = Math.min(evidenceCount * 0.05, 0.3);

		return Math.min(completionRate * 0.7 + evidenceBonus, 1.0);
	}

	private detectDebates(session: CouncilSession): DebateRecord[] {
		const debates: DebateRecord[] = [];
		const contributions = Array.from(session.contributions.entries());

		for (let i = 0; i < contributions.length; i++) {
			for (let j = i + 1; j < contributions.length; j++) {
				const [roleA, contentA] = contributions[i];
				const [roleB, contentB] = contributions[j];

				if (this.detectConflict(contentA, contentB)) {
					debates.push({
						topic: `Conflict between ${roleA} and ${roleB}`,
						positions: [
							{ roleId: roleA, position: contentA.substring(0, 200), evidenceCount: (contentA.match(/\[File:.*?\]|\[Log:.*?\]/g) || []).length },
							{ roleId: roleB, position: contentB.substring(0, 200), evidenceCount: (contentB.match(/\[File:.*?\]|\[Log:.*?\]/g) || []).length }
						],
						resolution: 'Coordinator will resolve based on priority weights',
						rationale: 'Conflicting recommendations detected'
					});
				}
			}
		}

		return debates;
	}

	private detectConflict(contentA: string, contentB: string): boolean {
		const conflictIndicators = ['disagree', 'however', 'contradicts', 'incorrect', 'flawed', 'risk'];
		const combined = (contentA + ' ' + contentB).toLowerCase();
		return conflictIndicators.some(indicator => combined.includes(indicator));
	}

	public getSession(sessionId: string): CouncilSession | undefined {
		return this.sessions.get(sessionId);
	}

	public getActiveSessions(): CouncilSession[] {
		return Array.from(this.sessions.values()).filter(s => s.status === 'executing' || s.status === 'planning');
	}

	public cancelSession(sessionId: string): void {
		const cts = this.cancellationTokens.get(sessionId);
		if (cts) {
			cts.cancel();
			this.logService.info(`[Council] Session ${sessionId} cancelled`);
		}
	}
}
