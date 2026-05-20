/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ILanguageModelsService, ChatMessageRole } from '../languageModels.js';
import { CouncilAgentProfile } from './agentProfileManager.js';
import { EvidenceScore } from './evidenceValidator.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

export const IDebateResolver = createDecorator<IDebateResolver>('debateResolver');

export interface DebatePosition {
	roleId: string;
	roleName: string;
	position: string;
	evidence: EvidenceScore;
	reasoningStyle: string;
	timestamp: number;
}

export interface DebateRecord {
	readonly debateId: string;
	readonly sessionId: string;
	readonly topic: string;
	readonly positions: DebatePosition[];
	readonly createdAt: number;
	resolution?: string;
	resolutionRationale?: string;
	resolvedBy?: string;
	resolvedAt?: number;
	resolved: boolean;
	conflictType: 'contradiction' | 'tradeoff' | 'priority' | 'implementation';
}

export interface DebateResolution {
	debateId: string;
	resolution: string;
	rationale: string;
	confidence: number;
	compromise?: string;
	actionItems: string[];
}

export interface DebateAnalysis {
	conflictDetected: boolean;
	conflictType: DebateRecord['conflictType'];
	confidence: number;
	summary: string;
	keyDisagreements: string[];
	commonGround: string[];
}

export interface IDebateResolver extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onDebateResolved: Event<DebateRecord>;

	detectConflicts(
		contributions: Array<{ roleId: string; content: string; profile: CouncilAgentProfile }>,
		sessionId: string
	): DebateRecord[];

	analyzeDebate(debate: DebateRecord): Promise<DebateAnalysis>;
	resolveDebate(debate: DebateRecord, token?: CancellationToken): Promise<DebateResolution>;
	resolveDebateAutomatically(debate: DebateRecord, token?: CancellationToken): Promise<DebateResolution>;
	getDebateHistory(sessionId?: string): DebateRecord[];
	getUnresolvedDebates(sessionId?: string): DebateRecord[];
}

export const DebateResolvedEvent = 'debateResolved';

export class DebateResolver extends Disposable implements IDebateResolver {
	declare readonly _serviceBrand: undefined;

	private readonly _onDebateResolved = this._register(new Emitter<DebateRecord>());
	readonly onDebateResolved = this._onDebateResolved.event;

	private readonly debates: DebateRecord[] = [];

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService
	) {
		super();
	}

	public detectConflicts(
		contributions: Array<{ roleId: string; content: string; profile: CouncilAgentProfile }>,
		sessionId: string
	): DebateRecord[] {
		const debates: DebateRecord[] = [];

		for (let i = 0; i < contributions.length; i++) {
			for (let j = i + 1; j < contributions.length; j++) {
				const contribA = contributions[i];
				const contribB = contributions[j];

				const conflict = this.analyzeConflict(contribA.content, contribB.content);
				
				if (conflict.conflictDetected) {
					const debate: DebateRecord = {
						debateId: generateUuid(),
						sessionId,
						topic: `Conflict between ${contribA.profile.displayName} and ${contribB.profile.displayName}`,
						positions: [
							this.createPosition(contribA),
							this.createPosition(contribB)
						],
						createdAt: Date.now(),
						resolved: false,
						conflictType: conflict.conflictType
					};

					this.debates.push(debate);
					this.logService.info(`[DebateResolver] Debate detected: ${debate.topic}`);
				}
			}
		}

		return debates;
	}

	public async analyzeDebate(debate: DebateRecord): Promise<DebateAnalysis> {
		const analysisPrompt = `Analyze the following debate between agents and identify the key conflicts and common ground.

Topic: ${debate.topic}
Conflict Type: ${debate.conflictType}

Position 1 (${debate.positions[0].roleName}):
${debate.positions[0].position}

Position 2 (${debate.positions[1].roleName}):
${debate.positions[1].position}

Provide a structured analysis:
1. Key disagreements (list 2-3 specific points)
2. Common ground (list 1-2 areas of agreement)
3. Conflict type assessment (contradiction, tradeoff, priority, or implementation)

Output JSON:
{
	"conflictDetected": true,
	"conflictType": "contradiction|tradeoff|priority|implementation",
	"confidence": 0.0-1.0,
	"summary": "Brief summary",
	"keyDisagreements": ["point1", "point2"],
	"commonGround": ["point1"]
}`;

		try {
			const models = await this.languageModelsService.getLanguageModelIds();
			const modelId = models.length > 0 ? models[0] : undefined;

			if (!modelId) {
				return this.fallbackAnalysis(debate);
			}

			const response = await this.languageModelsService.sendChatRequest(
				modelId,
				undefined,
				[{ role: ChatMessageRole.User, content: [{ type: 'text', value: analysisPrompt }] }],
				{},
				CancellationToken.None
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

			const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
			const analysis = JSON.parse(cleaned) as DebateAnalysis;

			return analysis;
		} catch (error) {
			this.logService.warn(`[DebateResolver] LLM analysis failed, using fallback: ${error}`);
			return this.fallbackAnalysis(debate);
		}
	}

	public async resolveDebate(
		debate: DebateRecord,
		token: CancellationToken = CancellationToken.None
	): Promise<DebateResolution> {
		return this.resolveDebateAutomatically(debate, token);
	}

	public async resolveDebateAutomatically(
		debate: DebateRecord,
		token: CancellationToken = CancellationToken.None
	): Promise<DebateResolution> {
		this.logService.info(`[DebateResolver] Resolving debate: ${debate.topic}`);

		const resolutionPrompt = `You are an impartial Debate Resolver. Analyze the following debate and provide a fair resolution.

Topic: ${debate.topic}
Conflict Type: ${debate.conflictType}

Position 1 (${debate.positions[0].roleName}, ${debate.positions[0].reasoningStyle}):
${debate.positions[0].position}
Evidence Score: ${(debate.positions[0].evidence.confidenceScore * 100).toFixed(0)}%

Position 2 (${debate.positions[1].roleName}, ${debate.positions[1].reasoningStyle}):
${debate.positions[1].position}
Evidence Score: ${(debate.positions[1].evidence.confidenceScore * 100).toFixed(0)}%

Resolution Guidelines:
1. Consider evidence quality (citations, file references, test results)
2. Consider specialist priority (security > architect for auth issues)
3. Look for compromise solutions that address both concerns
4. Be specific about which aspects of each position are valid
5. Provide actionable next steps

Provide your resolution in this JSON format:
{
	"resolution": "The final decision/recommendation",
	"rationale": "Why this resolution was chosen",
	"confidence": 0.0-1.0,
	"compromise": "Optional compromise solution",
	"actionItems": ["action1", "action2"]
}`;

		try {
			const models = await this.languageModelsService.getLanguageModelIds();
			const modelId = models.length > 0 ? models[0] : undefined;

			if (!modelId) {
				return this.fallbackResolution(debate);
			}

			const response = await this.languageModelsService.sendChatRequest(
				modelId,
				undefined,
				[{ role: ChatMessageRole.User, content: [{ type: 'text', value: resolutionPrompt }] }],
				{},
				token
			);

			let responseText = '';
			for await (const chunk of response.stream) {
				if (token.isCancellationRequested) break;
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

			const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
			const resolution = JSON.parse(cleaned) as DebateResolution;

			this.recordResolution(debate.debateId, resolution);

			return resolution;
		} catch (error) {
			this.logService.warn(`[DebateResolver] LLM resolution failed, using fallback: ${error}`);
			return this.fallbackResolution(debate);
		}
	}

	public getDebateHistory(sessionId?: string): DebateRecord[] {
		if (sessionId) {
			return this.debates.filter(d => d.sessionId === sessionId);
		}
		return [...this.debates];
	}

	public getUnresolvedDebates(sessionId?: string): DebateRecord[] {
		const debates = this.getDebateHistory(sessionId);
		return debates.filter(d => !d.resolved);
	}

	private analyzeConflict(contentA: string, contentB: string): DebateAnalysis {
		const conflictIndicators = {
			contradiction: [
				/\b(disagree|incorrect|wrong|flawed|invalid)\b/gi,
				/\b(should not|must not|cannot|never)\b/gi,
				/\b(opposite|contrary|conflicts)\b/gi
			],
			tradeoff: [
				/\b(tradeoff|compromise|balance|versus|vs)\b/gi,
				/\b(either|or|alternative)\b/gi,
				/\b(performance|security|maintainability)\b/gi
			],
			priority: [
				/\b(priority|important|critical|essential)\b/gi,
				/\b(must|should|need to)\b/gi,
				/\b(first|primary|main)\b/gi
			],
			implementation: [
				/\b(how|approach|method|technique)\b/gi,
				/\b(use|implement|create)\b/gi,
				/\b(pattern|architecture|design)\b/gi
			]
		};

		const combined = `${contentA} ${contentB}`.toLowerCase();
		let maxScore = 0;
		let conflictType: DebateRecord['conflictType'] = 'implementation';

		for (const [type, patterns] of Object.entries(conflictIndicators)) {
			let score = 0;
			for (const pattern of patterns) {
				const matches = combined.match(pattern);
				if (matches) {
					score += matches.length;
				}
			}

			if (score > maxScore) {
				maxScore = score;
				conflictType = type as DebateRecord['conflictType'];
			}
		}

		const conflictDetected = maxScore >= 2;
		const confidence = Math.min(maxScore / 10, 1.0);

		return {
			conflictDetected,
			conflictType,
			confidence,
			summary: conflictDetected ? `Conflict detected: ${conflictType}` : 'No significant conflict detected',
			keyDisagreements: conflictDetected ? [`Multiple ${conflictType} indicators found`] : [],
			commonGround: []
		};
	}

	private createPosition(contrib: { roleId: string; content: string; profile: CouncilAgentProfile }): DebatePosition {
		return {
			roleId: contrib.roleId,
			roleName: contrib.profile.displayName,
			position: contrib.content,
			evidence: {
				totalCitations: (contrib.content.match(/\[File:.*?\]|\[Log:.*?\]/g) || []).length,
				validCitations: 0,
				invalidCitations: 0,
				unverifiedCitations: 0,
				confidenceScore: 0.5,
				reasoningDepth: 0,
				evidenceDensity: 0,
				citationBreakdown: {} as any,
				validationDetails: []
			},
			reasoningStyle: contrib.profile.reasoningStyle,
			timestamp: Date.now()
		};
	}

	private recordResolution(debateId: string, resolution: DebateResolution): void {
		const debate = this.debates.find(d => d.debateId === debateId);
		if (debate) {
			debate.resolution = resolution.resolution;
			debate.resolutionRationale = resolution.rationale;
			debate.resolvedBy = 'automated';
			debate.resolvedAt = Date.now();
			debate.resolved = true;

			this._onDebateResolved.fire(debate);
			this.logService.info(`[DebateResolver] Debate resolved: ${debate.topic}`);
		}
	}

	private fallbackAnalysis(debate: DebateRecord): DebateAnalysis {
		return {
			conflictDetected: true,
			conflictType: debate.conflictType,
			confidence: 0.5,
			summary: `Conflict between ${debate.positions[0].roleName} and ${debate.positions[1].roleName}`,
			keyDisagreements: ['Positions differ on approach'],
			commonGround: ['Both aim to improve the solution']
		};
	}

	private fallbackResolution(debate: DebateRecord): DebateResolution {
		const higherEvidence = debate.positions.reduce((a, b) =>
			a.evidence.confidenceScore >= b.evidence.confidenceScore ? a : b
		);

		return {
			debateId: debate.debateId,
			resolution: higherEvidence.position,
			rationale: 'Fallback resolution: Selected position with higher evidence score',
			confidence: 0.5,
			compromise: 'Consider combining elements from both positions',
			actionItems: ['Review both positions for valid points', 'Seek additional evidence']
		};
	}
}
