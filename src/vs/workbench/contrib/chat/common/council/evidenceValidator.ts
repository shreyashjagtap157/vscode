/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService, IFileContent } from '../../../../../../platform/files/common/files.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { URI } from '../../../../../../base/common/uri.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';

export const IEvidenceValidator = createDecorator<IEvidenceValidator>('evidenceValidator');

export enum CitationType {
	File = 'file',
	Log = 'log',
	Test = 'test',
	URL = 'url',
	CodeBlock = 'codeblock'
}

export interface Citation {
	type: CitationType;
	raw: string;
	path?: string;
	line?: number;
	endLine?: number;
	identifier?: string;
	testId?: string;
	url?: string;
	language?: string;
}

export interface CitationValidation {
	citation: Citation;
	isValid: boolean;
	validationType: 'exists' | 'line_verified' | 'assumed_valid' | 'invalid_format' | 'not_found';
	message: string;
	details?: string;
	timestamp: number;
}

export interface EvidenceScore {
	totalCitations: number;
	validCitations: number;
	invalidCitations: number;
	unverifiedCitations: number;
	confidenceScore: number;
	reasoningDepth: number;
	evidenceDensity: number;
	citationBreakdown: Record<CitationType, number>;
	validationDetails: CitationValidation[];
}

export interface EvidenceReport {
	score: EvidenceScore;
	summary: string;
	recommendations: string[];
	strongestEvidence: CitationValidation[];
	weakestEvidence: CitationValidation[];
}

export interface IEvidenceValidator extends IDisposable {
	readonly _serviceBrand: undefined;

	parseCitations(text: string): Citation[];
	validateCitations(citations: Citation[], token?: CancellationToken): Promise<CitationValidation[]>;
	scoreEvidence(text: string, token?: CancellationToken): Promise<EvidenceScore>;
	generateEvidenceReport(text: string, token?: CancellationToken): Promise<EvidenceReport>;
}

export class EvidenceValidator extends Disposable implements IEvidenceValidator {
	declare readonly _serviceBrand: undefined;

	private readonly validationCache = new Map<string, CitationValidation>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IModelService private readonly modelService: IModelService
	) {
		super();
	}

	public parseCitations(text: string): Citation[] {
		const citations: Citation[] = [];
		
		const patterns = [
			{
				regex: /\[File:([^\]:]+)(?::(\d+))?(?:-(\d+))?\]/g,
				type: CitationType.File,
				parser: (match: RegExpExecArray): Citation => ({
					type: CitationType.File,
					raw: match[0],
					path: match[1],
					line: match[2] ? parseInt(match[2], 10) : undefined,
					endLine: match[3] ? parseInt(match[3], 10) : undefined
				})
			},
			{
				regex: /\[Log:([^\]]+)\]/g,
				type: CitationType.Log,
				parser: (match: RegExpExecArray): Citation => ({
					type: CitationType.Log,
					raw: match[0],
					identifier: match[1]
				})
			},
			{
				regex: /\[Test:([^\]]+)\]/g,
				type: CitationType.Test,
				parser: (match: RegExpExecArray): Citation => ({
					type: CitationType.Test,
					raw: match[0],
					testId: match[1]
				})
			},
			{
				regex: /\[URL:([^\]]+)\]/g,
				type: CitationType.URL,
				parser: (match: RegExpExecArray): Citation => ({
					type: CitationType.URL,
					raw: match[0],
					url: match[1]
				})
			},
			{
				regex: /```(\w+)?\n([\s\S]*?)```/g,
				type: CitationType.CodeBlock,
				parser: (match: RegExpExecArray): Citation => ({
					type: CitationType.CodeBlock,
					raw: match[0],
					language: match[1],
					path: undefined
				})
			}
		];

		for (const { regex, type, parser } of patterns) {
			let match;
			while ((match = regex.exec(text)) !== null) {
				try {
					const citation = parser(match);
					citations.push(citation);
				} catch (error) {
					this.logService.warn(`[EvidenceValidator] Failed to parse citation: ${match[0]}`);
				}
			}
		}

		return citations;
	}

	public async validateCitations(
		citations: Citation[],
		token: CancellationToken = CancellationToken.None
	): Promise<CitationValidation[]> {
		const validations: CitationValidation[] = [];

		for (const citation of citations) {
			if (token.isCancellationRequested) {
				break;
			}

			const cacheKey = this.getCacheKey(citation);
			const cached = this.validationCache.get(cacheKey);
			if (cached) {
				validations.push(cached);
				continue;
			}

			const validation = await this.validateSingleCitation(citation);
			this.validationCache.set(cacheKey, validation);
			validations.push(validation);
		}

		return validations;
	}

	public async scoreEvidence(
		text: string,
		token: CancellationToken = CancellationToken.None
	): Promise<EvidenceScore> {
		const citations = this.parseCitations(text);
		const validations = await this.validateCitations(citations, token);

		const validCitations = validations.filter(v => v.isValid).length;
		const invalidCitations = validations.filter(v => !v.isValid && v.validationType !== 'assumed_valid').length;
		const unverifiedCitations = validations.filter(v => v.validationType === 'assumed_valid').length;

		const citationBreakdown = {} as Record<CitationType, number>;
		for (const type of Object.values(CitationType)) {
			citationBreakdown[type] = citations.filter(c => c.type === type).length;
		}

		const confidenceScore = this.calculateConfidenceScore(validations);
		const reasoningDepth = this.estimateReasoningDepth(text);
		const evidenceDensity = citations.length / Math.max(text.split('\n').length, 1);

		return {
			totalCitations: citations.length,
			validCitations: validCitations,
			invalidCitations: invalidCitations,
			unverifiedCitations: unverifiedCitations,
			confidenceScore,
			reasoningDepth,
			evidenceDensity,
			citationBreakdown,
			validationDetails: validations
		};
	}

	public async generateEvidenceReport(
		text: string,
		token: CancellationToken = CancellationToken.None
	): Promise<EvidenceReport> {
		const score = await this.scoreEvidence(text, token);

		const strongestEvidence = score.validationDetails
			.filter(v => v.isValid && v.validationType !== 'assumed_valid')
			.sort((a, b) => {
				const typeOrder = [CitationType.File, CitationType.Test, CitationType.Log, CitationType.URL, CitationType.CodeBlock];
				return typeOrder.indexOf(a.citation.type) - typeOrder.indexOf(b.citation.type);
			})
			.slice(0, 5);

		const weakestEvidence = score.validationDetails
			.filter(v => !v.isValid)
			.slice(0, 5);

		const recommendations = this.generateRecommendations(score);

		const summary = this.generateSummary(score);

		return {
			score,
			summary,
			recommendations,
			strongestEvidence,
			weakestEvidence
		};
	}

	private async validateSingleCitation(citation: Citation): Promise<CitationValidation> {
		try {
			switch (citation.type) {
				case CitationType.File:
					return await this.validateFileCitation(citation);
				
				case CitationType.Log:
					return this.createValidation(citation, true, 'assumed_valid', 'Log reference assumed valid');
				
				case CitationType.Test:
					return this.createValidation(citation, true, 'assumed_valid', 'Test reference assumed valid');
				
				case CitationType.URL:
					return this.createValidation(citation, true, 'assumed_valid', 'URL reference assumed valid');
				
				case CitationType.CodeBlock:
					return this.createValidation(citation, true, 'assumed_valid', 'Code block present');
				
				default:
					return this.createValidation(citation, false, 'invalid_format', `Unknown citation type: ${citation.type}`);
			}
		} catch (error) {
			return this.createValidation(
				citation,
				false,
				'invalid_format',
				`Validation error: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	private async validateFileCitation(citation: Citation): Promise<CitationValidation> {
		if (!citation.path) {
			return this.createValidation(citation, false, 'invalid_format', 'File path is required');
		}

		try {
			const uri = URI.file(citation.path);
			const exists = await this.fileService.exists(uri);

			if (!exists) {
				return this.createValidation(citation, false, 'not_found', `File not found: ${citation.path}`);
			}

			if (citation.line !== undefined) {
				const fileContent = await this.fileService.readFile(uri);
				const content = fileContent.value.toString();
				const lines = content.split('\n');

				if (citation.line < 1 || citation.line > lines.length) {
					return this.createValidation(
						citation,
						false,
						'not_found',
						`Line ${citation.line} out of range (file has ${lines.length} lines)`
					);
				}

				const lineContent = lines[citation.line - 1].trim();
				if (lineContent.length === 0) {
					return this.createValidation(
						citation,
						true,
						'line_verified',
						`Line ${citation.line} exists but is empty`,
						`Line content: "${lineContent}"`
					);
				}

				return this.createValidation(
					citation,
					true,
					'line_verified',
					`Line ${citation.line} verified in ${citation.path}`,
					`Line content: "${lineContent.substring(0, 100)}${lineContent.length > 100 ? '...' : ''}"`
				);
			}

			return this.createValidation(
				citation,
				true,
				'exists',
				`File exists: ${citation.path}`
			);
		} catch (error) {
			return this.createValidation(
				citation,
				false,
				'not_found',
				`File validation failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	private calculateConfidenceScore(validations: CitationValidation[]): number {
		if (validations.length === 0) {
			return 0;
		}

		const typeWeights: Record<CitationType, number> = {
			[CitationType.File]: 1.0,
			[CitationType.Test]: 0.9,
			[CitationType.Log]: 0.7,
			[CitationType.URL]: 0.6,
			[CitationType.CodeBlock]: 0.5
		};

		let totalWeight = 0;
		let validWeight = 0;

		for (const validation of validations) {
			const weight = typeWeights[validation.citation.type] || 0.5;
			totalWeight += weight;

			if (validation.isValid) {
				const typeBonus = validation.validationType === 'line_verified' ? 1.2 : 1.0;
				validWeight += weight * typeBonus;
			}
		}

		return totalWeight > 0 ? Math.min(validWeight / totalWeight, 1.0) : 0;
	}

	private estimateReasoningDepth(text: string): number {
		const indicators = [
			'because', 'therefore', 'however', 'if', 'then', 'else',
			'since', 'thus', 'consequently', 'alternatively', 'moreover',
			'furthermore', 'nevertheless', 'nonetheless', 'accordingly',
			'hence', 'so', 'but', 'although', 'despite', 'whereas'
		];

		const lowerText = text.toLowerCase();
		let depth = 0;

		for (const indicator of indicators) {
			const regex = new RegExp(`\\b${indicator}\\b`, 'g');
			const matches = lowerText.match(regex);
			if (matches) {
				depth += matches.length;
			}
		}

		const conditionalPatterns = [
			/if\s+\(.+?\)\s*{/g,
			/switch\s*\(.+?\)\s*{/g,
			/try\s*{/g,
			/catch\s*\(.+?\)\s*{/g
		];

		for (const pattern of conditionalPatterns) {
			const matches = text.match(pattern);
			if (matches) {
				depth += matches.length;
			}
		}

		return depth;
	}

	private generateRecommendations(score: EvidenceScore): string[] {
		const recommendations: string[] = [];

		if (score.totalCitations === 0) {
			recommendations.push('No citations found. Add file references to support your claims.');
		}

		if (score.invalidCitations > 0) {
			recommendations.push(`${score.invalidCitations} invalid citation(s) found. Verify file paths and line numbers.`);
		}

		if (score.confidenceScore < 0.5) {
			recommendations.push('Low confidence score. Provide more verified evidence to strengthen your argument.');
		}

		if (score.reasoningDepth < 3) {
			recommendations.push('Limited reasoning depth. Provide more detailed analysis with logical connectors.');
		}

		if (score.evidenceDensity < 0.1) {
			recommendations.push('Low evidence density. Add more citations per section of your response.');
		}

		if (score.citationBreakdown[CitationType.File] === 0 && score.totalCitations > 0) {
			recommendations.push('No file citations found. File references provide the strongest evidence.');
		}

		return recommendations;
	}

	private generateSummary(score: EvidenceScore): string {
		if (score.totalCitations === 0) {
			return 'No evidence citations found in the response.';
		}

		const confidenceLevel = score.confidenceScore >= 0.8 ? 'High' :
			score.confidenceScore >= 0.5 ? 'Medium' : 'Low';

		return `${confidenceLevel} confidence (${(score.confidenceScore * 100).toFixed(0)}%) with ${score.totalCitations} citation(s): ${score.validCitations} valid, ${score.invalidCitations} invalid, ${score.unverifiedCitations} unverified. Reasoning depth: ${score.reasoningDepth}.`;
	}

	private createValidation(
		citation: Citation,
		isValid: boolean,
		validationType: CitationValidation['validationType'],
		message: string,
		details?: string
	): CitationValidation {
		return {
			citation,
			isValid,
			validationType,
			message,
			details,
			timestamp: Date.now()
		};
	}

	private getCacheKey(citation: Citation): string {
		return `${citation.type}:${citation.raw}`;
	}

	public clearCache(): void {
		this.validationCache.clear();
	}
}
