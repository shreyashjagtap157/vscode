/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { CouncilAgentProfile } from './agentProfileManager.js';

export const IConsensusManager = createDecorator<IConsensusManager>('consensusManager');

export type ConsensusStrategy = 'majority' | 'specialist-priority' | 'evidence-weighted' | 'coordinator-override';

export interface EvidenceScore {
	totalCitations: number;
	validCitations: number;
	invalidCitations: number;
	confidenceScore: number;
	reasoningDepth: number;
}

export interface Contribution {
	roleId: string;
	content: string;
	timestamp: number;
}

export interface ConsensusResult {
	decision: string;
	rationale: string;
	confidence: number;
	dissenters: string[];
	strategy: ConsensusStrategy;
}

export interface DebatePosition {
	roleId: string;
	position: string;
	evidence: EvidenceScore;
}

export interface DebateRecord {
	readonly debateId: string;
	readonly topic: string;
	readonly positions: DebatePosition[];
	resolution: string;
	rationale: string;
	resolved: boolean;
}

export type TaskComplexity = 'simple' | 'moderate' | 'complex' | 'critical';

export interface IConsensusManager extends IDisposable {
	readonly _serviceBrand: undefined;

	scoreEvidence(text: string): Promise<EvidenceScore>;
	resolveConsensus(
		contributions: Contribution[],
		profiles: Map<string, CouncilAgentProfile>,
		strategy?: ConsensusStrategy
	): Promise<ConsensusResult>;
	recordDebate(topic: string, positions: DebatePosition[]): DebateRecord;
	resolveDebate(debateId: string, resolution: string, rationale: string): void;
	getDebateHistory(): DebateRecord[];
}

export class ConsensusManager extends Disposable implements IConsensusManager {
	declare readonly _serviceBrand: undefined;

	private readonly debates: DebateRecord[] = [];
	private debateCounter = 0;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	public async scoreEvidence(text: string): Promise<EvidenceScore> {
		const citations = this.parseCitations(text);
		let validCitations = 0;
		let invalidCitations = 0;

		for (const citation of citations) {
			if (citation.type === 'file') {
				try {
					const exists = await this.fileService.exists(URI.file(citation.path));
					if (exists) {
						validCitations++;
					} else {
						invalidCitations++;
					}
				} catch {
					invalidCitations++;
				}
			} else if (citation.type === 'log') {
				validCitations++;
			}
		}

		const totalCitations = citations.length;
		const confidenceScore = totalCitations > 0 ? validCitations / totalCitations : 0;
		const reasoningDepth = this.estimateReasoningDepth(text);

		return {
			totalCitations,
			validCitations,
			invalidCitations,
			confidenceScore,
			reasoningDepth
		};
	}

	public async resolveConsensus(
		contributions: Contribution[],
		profiles: Map<string, CouncilAgentProfile>,
		strategy: ConsensusStrategy = 'evidence-weighted'
	): Promise<ConsensusResult> {
		if (contributions.length === 0) {
			return {
				decision: 'No contributions available',
				rationale: 'Empty contribution set',
				confidence: 0,
				dissenters: [],
				strategy
			};
		}

		if (contributions.length === 1) {
			const score = await this.scoreEvidence(contributions[0].content);
			return {
				decision: contributions[0].content,
				rationale: 'Single contribution, no consensus needed',
				confidence: score.confidenceScore,
				dissenters: [],
				strategy
			};
		}

		switch (strategy) {
			case 'majority':
				return this.majorityVote(contributions);
			case 'specialist-priority':
				return this.specialistPriority(contributions, profiles);
			case 'evidence-weighted':
				return this.evidenceWeighted(contributions, profiles);
			case 'coordinator-override':
				return this.coordinatorOverride(contributions);
			default:
				return this.evidenceWeighted(contributions, profiles);
		}
	}

	public recordDebate(topic: string, positions: DebatePosition[]): DebateRecord {
		this.debateCounter++;
		const record: DebateRecord = {
			debateId: `debate-${this.debateCounter}`,
			topic,
			positions,
			resolution: '',
			rationale: '',
			resolved: false
		};
		this.debates.push(record);
		this.logService.info(`[Council] Debate recorded: ${topic}`);
		return record;
	}

	public resolveDebate(debateId: string, resolution: string, rationale: string): void {
		const debate = this.debates.find(d => d.debateId === debateId);
		if (debate) {
			debate.resolution = resolution;
			debate.rationale = rationale;
			debate.resolved = true;
			this.logService.info(`[Council] Debate resolved: ${debate.topic}`);
		}
	}

	public getDebateHistory(): DebateRecord[] {
		return this.debates;
	}

	private parseCitations(text: string): Array<{ type: 'file' | 'log'; path: string }> {
		const citations: Array<{ type: 'file' | 'log'; path: string }> = [];
		
		const filePattern = /\[File:([^\]]+)\]/g;
		const logPattern = /\[Log:([^\]]+)\]/g;

		let match;
		while ((match = filePattern.exec(text)) !== null) {
			citations.push({ type: 'file', path: match[1] });
		}
		while ((match = logPattern.exec(text)) !== null) {
			citations.push({ type: 'log', path: match[1] });
		}

		return citations;
	}

	private estimateReasoningDepth(text: string): number {
		const indicators = ['because', 'therefore', 'however', 'if', 'then', 'else', 'since', 'thus', 'consequently', 'alternatively'];
		const lowerText = text.toLowerCase();
		return indicators.filter(i => lowerText.includes(i)).length;
	}

	private async evidenceWeighted(
		contributions: Contribution[],
		profiles: Map<string, CouncilAgentProfile>
	): Promise<ConsensusResult> {
		const scored = await Promise.all(
			contributions.map(async c => ({
				contribution: c,
				score: await this.scoreEvidence(c.content)
			}))
		);

		const weighted = scored.map(({ contribution, score }) => {
			const profile = profiles.get(contribution.roleId);
			const priorityWeight = profile?.priorityWeight || 1;
			const weightedScore = score.confidenceScore * priorityWeight + (score.reasoningDepth * 0.01);

			return {
				contribution,
				score,
				weightedScore
			};
		});

		weighted.sort((a, b) => b.weightedScore - a.weightedScore);

		const winner = weighted[0];
		const dissenters = weighted.slice(1).map(w => w.contribution.roleId);

		return {
			decision: winner.contribution.content,
			rationale: `Selected based on evidence-weighted score: ${winner.weightedScore.toFixed(2)} (confidence: ${winner.score.confidenceScore.toFixed(2)}, priority: ${profiles.get(winner.contribution.roleId)?.priorityWeight || 1})`,
			confidence: winner.score.confidenceScore,
			dissenters,
			strategy: 'evidence-weighted'
		};
	}

	private specialistPriority(
		contributions: Contribution[],
		profiles: Map<string, CouncilAgentProfile>
	): ConsensusResult {
		const domainMap: Record<string, string> = {
			'auth': 'security',
			'security': 'security',
			'vulnerability': 'security',
			'database': 'backend',
			'query': 'backend',
			'deployment': 'devops',
			'pipeline': 'devops',
			'infrastructure': 'devops',
			'performance': 'performance',
			'optimization': 'performance',
			'architecture': 'architect',
			'design': 'architect',
			'test': 'qa',
			'verification': 'qa'
		};

		const content = contributions.map(c => c.content.toLowerCase()).join(' ');
		
		let relevantDomain: string | undefined;
		for (const [keyword, domain] of Object.entries(domainMap)) {
			if (content.includes(keyword)) {
				relevantDomain = domain;
				break;
			}
		}

		if (relevantDomain) {
			const specialist = contributions.find(c => {
				const profile = profiles.get(c.roleId);
				return profile?.focusModes.includes(relevantDomain!) || profile?.roleId === relevantDomain;
			});

			if (specialist) {
				return {
					decision: specialist.content,
					rationale: `Specialist priority: ${specialist.roleId} is the domain expert for ${relevantDomain}`,
					confidence: 0.8,
					dissenters: contributions.filter(c => c.roleId !== specialist.roleId).map(c => c.roleId),
					strategy: 'specialist-priority'
				};
			}
		}

		return this.evidenceWeightedSync(contributions, profiles);
	}

	private evidenceWeightedSync(
		contributions: Contribution[],
		profiles: Map<string, CouncilAgentProfile>
	): ConsensusResult {
		const scored = contributions.map(c => {
			const citationCount = (c.content.match(/\[File:.*?\]|\[Log:.*?\]/g) || []).length;
			const profile = profiles.get(c.roleId);
			const priorityWeight = profile?.priorityWeight || 1;

			return {
				contribution: c,
				weightedScore: citationCount * priorityWeight
			};
		});

		scored.sort((a, b) => b.weightedScore - a.weightedScore);

		const winner = scored[0];
		return {
			decision: winner.contribution.content,
			rationale: `Selected based on evidence-weighted score: ${winner.weightedScore}`,
			confidence: Math.min(winner.weightedScore * 0.1, 1.0),
			dissenters: scored.slice(1).map(s => s.contribution.roleId),
			strategy: 'evidence-weighted'
		};
	}

	private majorityVote(contributions: Contribution[]): ConsensusResult {
		const themes = this.extractThemes(contributions);
		const largestTheme = themes.sort((a, b) => b.contributions.length - a.contributions.length)[0];

		if (largestTheme && largestTheme.contributions.length > contributions.length / 2) {
			return {
				decision: largestTheme.contributions[0].content,
				rationale: `Majority consensus: ${largestTheme.contributions.length}/${contributions.length} agents agree`,
				confidence: largestTheme.contributions.length / contributions.length,
				dissenters: contributions.filter(c => !largestTheme.contributions.includes(c)).map(c => c.roleId),
				strategy: 'majority'
			};
		}

		return this.evidenceWeightedSync(contributions, new Map());
	}

	private coordinatorOverride(contributions: Contribution[]): ConsensusResult {
		const first = contributions[0];
		return {
			decision: first.content,
			rationale: 'Coordinator override: Manual selection',
			confidence: 0.5,
			dissenters: contributions.slice(1).map(c => c.roleId),
			strategy: 'coordinator-override'
		};
	}

	private extractThemes(contributions: Contribution[]): Array<{ theme: string; contributions: Contribution[] }> {
		const themes: Array<{ theme: string; contributions: Contribution[] }> = [];
		
		for (const contribution of contributions) {
			const keywords = contribution.content.toLowerCase().match(/\b\w{4,}\b/g) || [];
			const topKeywords = keywords.slice(0, 10);
			
			const matchingTheme = themes.find(t => 
				topKeywords.some(kw => t.theme.includes(kw))
			);

			if (matchingTheme) {
				matchingTheme.contributions.push(contribution);
			} else {
				themes.push({ theme: topKeywords.join(' '), contributions: [contribution] });
			}
		}

		return themes;
	}
}

export class IterationGuard extends Disposable {
	private readonly sessionIterations = new Map<string, number>();
	private readonly complexityMaxIterations: Record<TaskComplexity, number> = {
		simple: 1,
		moderate: 2,
		complex: 3,
		critical: 4
	};

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public calculateMaxIterations(complexity: TaskComplexity): number {
		return this.complexityMaxIterations[complexity];
	}

	public incrementAndCheck(sessionId: string, complexity: TaskComplexity = 'complex'): boolean {
		const max = this.calculateMaxIterations(complexity);
		const count = (this.sessionIterations.get(sessionId) || 0) + 1;
		this.sessionIterations.set(sessionId, count);

		const canContinue = count <= max;
		if (!canContinue) {
			this.logService.warn(`[Council] Session ${sessionId} reached maximum iterations (${max})`);
		}

		return canContinue;
	}

	public getRemainingIterations(sessionId: string, complexity: TaskComplexity = 'complex'): number {
		const max = this.calculateMaxIterations(complexity);
		const current = this.sessionIterations.get(sessionId) || 0;
		return Math.max(0, max - current);
	}

	public reset(sessionId: string): void {
		this.sessionIterations.delete(sessionId);
	}

	public getCurrentIteration(sessionId: string): number {
		return this.sessionIterations.get(sessionId) || 0;
	}
}
