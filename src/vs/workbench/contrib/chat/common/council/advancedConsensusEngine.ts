/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { CouncilAgentProfile } from './agentProfileManager.js';
import { EvidenceScore, IEvidenceValidator } from './evidenceValidator.js';

export const IAdvancedConsensusEngine = createDecorator<IAdvancedConsensusEngine>('advancedConsensusEngine');

export type ConsensusStrategy =
	| 'evidence-weighted'
	| 'majority'
	| 'specialist-priority'
	| 'coordinator-override'
	| 'bayesian'
	| 'evidence-weighted-ci';

export interface ConfidenceInterval {
	lower: number;
	upper: number;
	confidence: number;
	marginOfError: number;
}

export interface ScoredContribution {
	roleId: string;
	content: string;
	evidenceScore: EvidenceScore;
	weightedScore: number;
	confidenceInterval: ConfidenceInterval;
	priorityWeight: number;
	timestamp: number;
}

export interface ConsensusResult {
	decision: string;
	decisionRoleId: string;
	rationale: string;
	confidence: number;
	confidenceInterval: ConfidenceInterval;
	dissenters: string[];
	strategy: ConsensusStrategy;
	allScores: ScoredContribution[];
	qualityMetrics: ConsensusQualityMetrics;
}

export interface ConsensusQualityMetrics {
	agreementLevel: number;
	evidenceConsistency: number;
	confidenceSpread: number;
	outlierCount: number;
	consensusStrength: 'strong' | 'moderate' | 'weak' | 'none';
}

export interface BayesianUpdate {
	prior: number;
	likelihood: number;
	posterior: number;
	evidence: string;
}

export interface IAdvancedConsensusEngine extends IDisposable {
	readonly _serviceBrand: undefined;

	resolveConsensus(
		contributions: Array<{ roleId: string; content: string; evidenceScore: EvidenceScore }>,
		profiles: Map<string, CouncilAgentProfile>,
		strategy?: ConsensusStrategy
	): Promise<ConsensusResult>;

	calculateConfidenceInterval(score: number, sampleSize: number, confidenceLevel?: number): ConfidenceInterval;
	detectOutliers(scores: number[], threshold?: number): number[];
	bayesianUpdate(prior: number, likelihood: number, evidence: string): BayesianUpdate;
}

export class AdvancedConsensusEngine extends Disposable implements IAdvancedConsensusEngine {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEvidenceValidator private readonly evidenceValidator: IEvidenceValidator
	) {
		super();
	}

	public async resolveConsensus(
		contributions: Array<{ roleId: string; content: string; evidenceScore: EvidenceScore }>,
		profiles: Map<string, CouncilAgentProfile>,
		strategy: ConsensusStrategy = 'evidence-weighted-ci'
	): Promise<ConsensusResult> {
		if (contributions.length === 0) {
			return this.createEmptyResult(strategy);
		}

		if (contributions.length === 1) {
			const single = contributions[0];
			const ci = this.calculateConfidenceInterval(
				single.evidenceScore.confidenceScore,
				single.evidenceScore.totalCitations || 1
			);

			return {
				decision: single.content,
				decisionRoleId: single.roleId,
				rationale: 'Single contribution, no consensus needed',
				confidence: single.evidenceScore.confidenceScore,
				confidenceInterval: ci,
				dissenters: [],
				strategy,
				allScores: [{
					roleId: single.roleId,
					content: single.content,
					evidenceScore: single.evidenceScore,
					weightedScore: single.evidenceScore.confidenceScore,
					confidenceInterval: ci,
					priorityWeight: profiles.get(single.roleId)?.priorityWeight || 1,
					timestamp: Date.now()
				}],
				qualityMetrics: this.calculateQualityMetrics([{
					roleId: single.roleId,
					content: single.content,
					evidenceScore: single.evidenceScore,
					weightedScore: single.evidenceScore.confidenceScore,
					confidenceInterval: ci,
					priorityWeight: profiles.get(single.roleId)?.priorityWeight || 1,
					timestamp: Date.now()
				}])
			};
		}

		const scoredContributions: ScoredContribution[] = [];

		for (const contribution of contributions) {
			const profile = profiles.get(contribution.roleId);
			const priorityWeight = profile?.priorityWeight || 1;
			const baseScore = contribution.evidenceScore.confidenceScore;
			const weightedScore = baseScore * priorityWeight;

			const ci = this.calculateConfidenceInterval(
				baseScore,
				contribution.evidenceScore.totalCitations || 1
			);

			scoredContributions.push({
				roleId: contribution.roleId,
				content: contribution.content,
				evidenceScore: contribution.evidenceScore,
				weightedScore,
				confidenceInterval: ci,
				priorityWeight,
				timestamp: Date.now()
			});
		}

		switch (strategy) {
			case 'evidence-weighted-ci':
				return this.resolveEvidenceWeightedCI(scoredContributions);
			
			case 'evidence-weighted':
				return this.resolveEvidenceWeighted(scoredContributions);
			
			case 'majority':
				return this.resolveMajority(scoredContributions);
			
			case 'specialist-priority':
				return this.resolveSpecialistPriority(scoredContributions, profiles);
			
			case 'bayesian':
				return this.resolveBayesian(scoredContributions);
			
			case 'coordinator-override':
				return this.resolveCoordinatorOverride(scoredContributions);
			
			default:
				return this.resolveEvidenceWeightedCI(scoredContributions);
		}
	}

	public calculateConfidenceInterval(
		score: number,
		sampleSize: number,
		confidenceLevel: number = 0.95
	): ConfidenceInterval {
		const zScores: Record<number, number> = {
			0.90: 1.645,
			0.95: 1.96,
			0.99: 2.576
		};

		const z = zScores[confidenceLevel] || 1.96;
		const n = Math.max(sampleSize, 1);
		
		const marginOfError = z * Math.sqrt((score * (1 - score)) / n);
		
		return {
			lower: Math.max(0, score - marginOfError),
			upper: Math.min(1, score + marginOfError),
			confidence: confidenceLevel,
			marginOfError
		};
	}

	public detectOutliers(scores: number[], threshold: number = 2.0): number[] {
		if (scores.length < 3) {
			return [];
		}

		const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
		const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
		const stdDev = Math.sqrt(variance);

		if (stdDev === 0) {
			return [];
		}

		const outlierIndices: number[] = [];
		scores.forEach((score, index) => {
			const zScore = Math.abs((score - mean) / stdDev);
			if (zScore > threshold) {
				outlierIndices.push(index);
			}
		});

		return outlierIndices;
	}

	public bayesianUpdate(prior: number, likelihood: number, evidence: string): BayesianUpdate {
		const numerator = likelihood * prior;
		const denominator = (likelihood * prior) + ((1 - likelihood) * (1 - prior));
		const posterior = denominator > 0 ? numerator / denominator : prior;

		return {
			prior,
			likelihood,
			posterior: Math.min(Math.max(posterior, 0), 1),
			evidence
		};
	}

	private async resolveEvidenceWeightedCI(
		scoredContributions: ScoredContribution[]
	): Promise<ConsensusResult> {
		sortedContributions.sort((a, b) => b.weightedScore - a.weightedScore);

		const winner = scoredContributions[0];
		const dissenters = scoredContributions.slice(1).map(c => c.roleId);

		const outlierIndices = this.detectOutliers(scoredContributions.map(c => c.weightedScore));
		const hasOutliers = outlierIndices.length > 0;

		const agreementLevel = this.calculateAgreementLevel(scoredContributions);

		const rationale = hasOutliers
			? `Evidence-weighted consensus with outliers detected. Winner: ${winner.roleId} (score: ${winner.weightedScore.toFixed(2)}, CI: [${winner.confidenceInterval.lower.toFixed(2)}, ${winner.confidenceInterval.upper.toFixed(2)}]). Outliers: ${outlierIndices.map(i => scoredContributions[i].roleId).join(', ')}`
			: `Evidence-weighted consensus. Winner: ${winner.roleId} (score: ${winner.weightedScore.toFixed(2)}, CI: [${winner.confidenceInterval.lower.toFixed(2)}, ${winner.confidenceInterval.upper.toFixed(2)}])`;

		return {
			decision: winner.content,
			decisionRoleId: winner.roleId,
			rationale,
			confidence: winner.evidenceScore.confidenceScore,
			confidenceInterval: winner.confidenceInterval,
			dissenters,
			strategy: 'evidence-weighted-ci',
			allScores: scoredContributions,
			qualityMetrics: this.calculateQualityMetrics(scoredContributions)
		};
	}

	private async resolveEvidenceWeighted(
		scoredContributions: ScoredContribution[]
	): Promise<ConsensusResult> {
		scoredContributions.sort((a, b) => b.weightedScore - a.weightedScore);

		const winner = scoredContributions[0];
		const dissenters = scoredContributions.slice(1).map(c => c.roleId);

		return {
			decision: winner.content,
			decisionRoleId: winner.roleId,
			rationale: `Evidence-weighted score: ${winner.weightedScore.toFixed(2)} (confidence: ${winner.evidenceScore.confidenceScore.toFixed(2)}, priority: ${winner.priorityWeight})`,
			confidence: winner.evidenceScore.confidenceScore,
			confidenceInterval: winner.confidenceInterval,
			dissenters,
			strategy: 'evidence-weighted',
			allScores: scoredContributions,
			qualityMetrics: this.calculateQualityMetrics(scoredContributions)
		};
	}

	private async resolveMajority(
		scoredContributions: ScoredContribution[]
	): Promise<ConsensusResult> {
		const themes = this.extractThemes(scoredContributions);
		const largestTheme = themes.sort((a, b) => b.contributions.length - a.contributions.length)[0];

		if (largestTheme && largestTheme.contributions.length > scoredContributions.length / 2) {
			const winner = largestTheme.contributions[0];
			const dissenters = scoredContributions.filter(c => !largestTheme.contributions.includes(c)).map(c => c.roleId);

			return {
				decision: winner.content,
				decisionRoleId: winner.roleId,
				rationale: `Majority consensus: ${largestTheme.contributions.length}/${scoredContributions.length} agents agree on theme: ${largestTheme.theme}`,
				confidence: largestTheme.contributions.length / scoredContributions.length,
				confidenceInterval: this.calculateConfidenceInterval(
					largestTheme.contributions.length / scoredContributions.length,
					scoredContributions.length
				),
				dissenters,
				strategy: 'majority',
				allScores: scoredContributions,
				qualityMetrics: this.calculateQualityMetrics(scoredContributions)
			};
		}

		return this.resolveEvidenceWeighted(scoredContributions);
	}

	private async resolveSpecialistPriority(
		scoredContributions: ScoredContribution[],
		profiles: Map<string, CouncilAgentProfile>
	): Promise<ConsensusResult> {
		const domainMap: Record<string, string[]> = {
			'auth': ['security'],
			'security': ['security'],
			'vulnerability': ['security'],
			'encryption': ['security'],
			'database': ['backend'],
			'query': ['backend'],
			'api': ['backend'],
			'deployment': ['devops'],
			'pipeline': ['devops'],
			'infrastructure': ['devops'],
			'performance': ['performance'],
			'optimization': ['performance'],
			'architecture': ['architect'],
			'design': ['architect'],
			'test': ['qa'],
			'verification': ['qa']
		};

		const combinedContent = scoredContributions.map(c => c.content.toLowerCase()).join(' ');
		
		let relevantDomain: string | undefined;
		let specialists: string[] = [];

		for (const [keyword, roles] of Object.entries(domainMap)) {
			if (combinedContent.includes(keyword)) {
				relevantDomain = keyword;
				specialists = roles;
				break;
			}
		}

		if (relevantDomain) {
			const specialistContributions = scoredContributions.filter(c =>
				specialists.includes(c.roleId) ||
				profiles.get(c.roleId)?.focusModes.includes(relevantDomain)
			);

			if (specialistContributions.length > 0) {
				specialistContributions.sort((a, b) => b.weightedScore - a.weightedScore);
				const winner = specialistContributions[0];
				const dissenters = scoredContributions.filter(c => c.roleId !== winner.roleId).map(c => c.roleId);

				return {
					decision: winner.content,
					decisionRoleId: winner.roleId,
					rationale: `Specialist priority: ${winner.roleId} is the domain expert for ${relevantDomain} (score: ${winner.weightedScore.toFixed(2)})`,
					confidence: winner.evidenceScore.confidenceScore,
					confidenceInterval: winner.confidenceInterval,
					dissenters,
					strategy: 'specialist-priority',
					allScores: scoredContributions,
					qualityMetrics: this.calculateQualityMetrics(scoredContributions)
				};
			}
		}

		return this.resolveEvidenceWeighted(scoredContributions);
	}

	private async resolveBayesian(
		scoredContributions: ScoredContribution[]
	): Promise<ConsensusResult> {
		let prior = 0.5;
		const updates: BayesianUpdate[] = [];

		for (const contribution of scoredContributions) {
			const likelihood = contribution.evidenceScore.confidenceScore;
			const update = this.bayesianUpdate(
				prior,
				likelihood,
				`${contribution.roleId} contribution with ${contribution.evidenceScore.totalCitations} citations`
			);
			updates.push(update);
			prior = update.posterior;
		}

		const finalPosterior = updates.length > 0 ? updates[updates.length - 1].posterior : 0.5;
		const ci = this.calculateConfidenceInterval(finalPosterior, scoredContributions.length);

		scoredContributions.sort((a, b) => b.evidenceScore.confidenceScore - a.evidenceScore.confidenceScore);
		const winner = scoredContributions[0];

		return {
			decision: winner.content,
			decisionRoleId: winner.roleId,
			rationale: `Bayesian consensus: posterior probability ${finalPosterior.toFixed(2)} after ${updates.length} updates`,
			confidence: finalPosterior,
			confidenceInterval: ci,
			dissenters: scoredContributions.slice(1).map(c => c.roleId),
			strategy: 'bayesian',
			allScores: scoredContributions,
			qualityMetrics: this.calculateQualityMetrics(scoredContributions)
		};
	}

	private async resolveCoordinatorOverride(
		scoredContributions: ScoredContribution[]
	): Promise<ConsensusResult> {
		const winner = scoredContributions[0];

		return {
			decision: winner.content,
			decisionRoleId: winner.roleId,
			rationale: 'Coordinator override: Manual selection',
			confidence: 0.5,
			confidenceInterval: this.calculateConfidenceInterval(0.5, 1),
			dissenters: scoredContributions.slice(1).map(c => c.roleId),
			strategy: 'coordinator-override',
			allScores: scoredContributions,
			qualityMetrics: this.calculateQualityMetrics(scoredContributions)
		};
	}

	private calculateAgreementLevel(scoredContributions: ScoredContribution[]): number {
		if (scoredContributions.length < 2) {
			return 1.0;
		}

		const scores = scoredContributions.map(c => c.weightedScore);
		const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
		const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
		const stdDev = Math.sqrt(variance);

		return Math.max(0, 1 - stdDev);
	}

	private calculateQualityMetrics(scoredContributions: ScoredContribution[]): ConsensusQualityMetrics {
		const agreementLevel = this.calculateAgreementLevel(scoredContributions);
		
		const scores = scoredContributions.map(c => c.evidenceScore.confidenceScore);
		const evidenceConsistency = scores.length > 1
			? 1 - (Math.max(...scores) - Math.min(...scores))
			: 1.0;

		const confidenceSpread = scoredContributions.length > 1
			? Math.max(...scoredContributions.map(c => c.confidenceInterval.marginOfError))
			: 0;

		const outlierIndices = this.detectOutliers(scoredContributions.map(c => c.weightedScore));
		const outlierCount = outlierIndices.length;

		const consensusStrength = agreementLevel >= 0.8
			? 'strong'
			: agreementLevel >= 0.6
				? 'moderate'
				: agreementLevel >= 0.4
					? 'weak'
					: 'none';

		return {
			agreementLevel,
			evidenceConsistency,
			confidenceSpread,
			outlierCount,
			consensusStrength
		};
	}

	private extractThemes(scoredContributions: ScoredContribution[]): Array<{ theme: string; contributions: ScoredContribution[] }> {
		const themes: Array<{ theme: string; contributions: ScoredContribution[] }> = [];
		
		for (const contribution of scoredContributions) {
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

	private createEmptyResult(strategy: ConsensusStrategy): ConsensusResult {
		return {
			decision: 'No contributions available',
			decisionRoleId: '',
			rationale: 'Empty contribution set',
			confidence: 0,
			confidenceInterval: this.calculateConfidenceInterval(0, 1),
			dissenters: [],
			strategy,
			allScores: [],
			qualityMetrics: {
				agreementLevel: 0,
				evidenceConsistency: 0,
				confidenceSpread: 0,
				outlierCount: 0,
				consensusStrength: 'none'
			}
		};
	}
}
