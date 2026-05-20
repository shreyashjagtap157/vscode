/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ICouncilOrchestrator, CouncilResult } from './councilOrchestrator.js';
import { ICouncilTestRunner } from './councilTestRunner.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { Emitter, Event } from '../../../../../base/common/event.js';

export const ICouncilCIRunner = createDecorator<ICouncilCIRunner>('councilCIRunner');

export enum CIErrorType {
	TypeScript = 'typescript',
	ESLint = 'eslint',
	Test = 'test',
	Build = 'build',
	Dependency = 'dependency',
	Lint = 'lint',
	Compilation = 'compilation',
	Runtime = 'runtime'
}

export interface CIError {
	type: CIErrorType;
	message: string;
	file?: string;
	line?: number;
	column?: number;
	stack?: string;
}

export interface CIFailureAnalysis {
	errors: CIError[];
	summary: string;
	severity: 'critical' | 'high' | 'medium' | 'low';
	affectedFiles: string[];
	rootCause?: string;
	suggestedFix?: string;
}

export interface CIFixResult {
	analysis: CIFailureAnalysis;
	fixResult?: CouncilResult;
	fixApplied: boolean;
	ciRerun?: CIRerunResult;
	success: boolean;
	timestamp: number;
}

export interface CIRerunResult {
	passed: boolean;
	output: string;
	errors: string[];
	duration: number;
}

export interface CICallback {
	onAnalysisComplete: (analysis: CIFailureAnalysis) => void;
	onFixApplied: (success: boolean) => void;
	onRerunComplete: (result: CIRerunResult) => void;
}

export interface ICouncilCIRunner extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onFixApplied: Event<{ sessionId: string; success: boolean }>;
	readonly onRerunComplete: Event<CIRerunResult>;

	analyzeFailure(failureLog: string): Promise<CIFailureAnalysis>;
	resolveCIFailure(failureLog: string, token?: CancellationToken): Promise<CIFixResult>;
	parseCIOutput(output: string): CIError[];
}

export class CouncilCIRunner extends Disposable implements ICouncilCIRunner {
	declare readonly _serviceBrand: undefined;

	private readonly _onFixApplied = this._register(new Emitter<{ sessionId: string; success: boolean }>());
	readonly onFixApplied: Event<{ sessionId: string; success: boolean }> = this._onFixApplied.event;

	private readonly _onRerunComplete = this._register(new Emitter<CIRerunResult>());
	readonly onRerunComplete: Event<CIRerunResult> = this._onRerunComplete.event;

	private readonly fixHistory: CIFixResult[] = [];

	constructor(
		@ILogService private readonly logService: ILogService,
		@ICouncilOrchestrator private readonly orchestrator: ICouncilOrchestrator,
		@ICouncilTestRunner _testRunner: ICouncilTestRunner
	) {
		super();
		this.logService.info('[CouncilCIRunner] Initialized');
	}

	public async analyzeFailure(failureLog: string): Promise<CIFailureAnalysis> {
		this.logService.info('[CouncilCIRunner] Analyzing CI failure');

		const errors = this.parseCIOutput(failureLog);
		const affectedFiles = [...new Set(errors.filter(e => e.file).map(e => e.file!))];
		
		const severity = this.calculateSeverity(errors);
		const rootCause = this.identifyRootCause(errors);
		const suggestedFix = this.suggestFix(errors);

		const analysis: CIFailureAnalysis = {
			errors,
			summary: `Found ${errors.length} errors: ${errors.filter(e => e.type === CIErrorType.TypeScript).length} TypeScript, ${errors.filter(e => e.type === CIErrorType.ESLint).length} ESLint, ${errors.filter(e => e.type === CIErrorType.Test).length} Test failures`,
			severity,
			affectedFiles,
			rootCause,
			suggestedFix
		};

		this.logService.info(`[CouncilCIRunner] Analysis complete: ${errors.length} errors, severity: ${severity}`);

		return analysis;
	}

	public async resolveCIFailure(
		failureLog: string,
		token: CancellationToken = CancellationToken.None
	): Promise<CIFixResult> {
		const sessionId = generateUuid();
		this.logService.info(`[CouncilCIRunner] Starting autonomous CI failure resolution (session: ${sessionId})`);

		const analysis = await this.analyzeFailure(failureLog);

		const councilPrompt = `Fix the following CI failure:

CI Log:
${failureLog}

Analysis:
${analysis.summary}
Severity: ${analysis.severity}
Root Cause: ${analysis.rootCause || 'Unknown'}
Affected Files: ${analysis.affectedFiles.join(', ')}

Provide a detailed fix with code changes. Include the exact file paths and line numbers that need to be modified.`;

		const fixResult = await this.orchestrator.executeSession(
			councilPrompt,
			['backend', 'qa'],
			token
		);

		const fixApplied = fixResult.status === 'success';

		const result: CIFixResult = {
			analysis,
			fixResult,
			fixApplied,
			success: fixApplied,
			timestamp: Date.now()
		};

		this.fixHistory.push(result);
		this._onFixApplied.fire({ sessionId, success: fixApplied });

		this.logService.info(`[CouncilCIRunner] Fix ${fixApplied ? 'applied' : 'failed'} for session ${sessionId}`);

		return result;
	}

	public parseCIOutput(output: string): CIError[] {
		const errors: CIError[] = [];

		const patterns = [
			{
				regex: /error\s+TS(\d+):\s*([^\n]+)\s+(\S+):(\d+):(\d+)/gi,
				type: CIErrorType.TypeScript,
				extractor: (m: RegExpExecArray): CIError => ({
					type: CIErrorType.TypeScript,
					message: m[2].trim(),
					file: m[3],
					line: parseInt(m[4], 10),
					column: parseInt(m[5], 10)
				})
			},
			{
				regex: /(\S+):(\d+):(\d+):\s+(error|warning)\s+([^\n]+)/gi,
				type: CIErrorType.ESLint,
				extractor: (m: RegExpExecArray): CIError => ({
					type: CIErrorType.ESLint,
					message: m[5].trim(),
					file: m[1],
					line: parseInt(m[2], 10),
					column: parseInt(m[3], 10)
				})
			},
			{
				regex: /FAIL\s+([^\n]+)/gi,
				type: CIErrorType.Test,
				extractor: (m: RegExpExecArray): CIError => ({
					type: CIErrorType.Test,
					message: `Test failed: ${m[1].trim()}`
				})
			},
			{
				regex: /Build failed|BUILD FAILED|npm ERR!/gi,
				type: CIErrorType.Build,
				extractor: (m: RegExpExecArray): CIError => ({
					type: CIErrorType.Build,
					message: m[0]
				})
			},
			{
				regex: /Cannot find module '([^']+)'/gi,
				type: CIErrorType.Dependency,
				extractor: (m: RegExpExecArray): CIError => ({
					type: CIErrorType.Dependency,
					message: `Cannot find module: ${m[1]}`
				})
			},
			{
				regex: /Module not found:\s+Error:\s+Can't resolve\s+'([^']+)'/gi,
				type: CIErrorType.Compilation,
				extractor: (m: RegExpExecArray): CIError => ({
					type: CIErrorType.Compilation,
					message: `Module not found: ${m[1]}`
				})
			}
		];

		for (const { regex, extractor } of patterns) {
			let match;
			while ((match = regex.exec(output)) !== null) {
				try {
					errors.push(extractor(match));
				} catch (e) {
					this.logService.warn(`[CouncilCIRunner] Failed to parse error: ${match[0]}`);
				}
			}
		}

		return errors;
	}

	private calculateSeverity(errors: CIError[]): CIFailureAnalysis['severity'] {
		if (errors.length === 0) return 'low';

		const criticalTypes = [CIErrorType.TypeScript, CIErrorType.Compilation, CIErrorType.Build];
		const hasCritical = errors.some(e => criticalTypes.includes(e.type));

		if (hasCritical && errors.length > 5) return 'critical';
		if (hasCritical) return 'high';
		if (errors.some(e => e.type === CIErrorType.Test)) return 'medium';
		return 'low';
	}

	private identifyRootCause(errors: CIError[]): string | undefined {
		const typeErrors = errors.filter(e => e.type === CIErrorType.TypeScript);
		const lintErrors = errors.filter(e => e.type === CIErrorType.ESLint);
		const testFailures = errors.filter(e => e.type === CIErrorType.Test);

		if (typeErrors.length > 0) {
			const commonFiles = [...new Set(typeErrors.map(e => e.file).filter(Boolean))];
			if (commonFiles.length === 1) {
				return `TypeScript errors in ${commonFiles[0]}`;
			}
			return `TypeScript type errors across ${commonFiles.length} files`;
		}

		if (lintErrors.length > 0) {
			return `ESLint violations (${lintErrors.length} issues)`;
		}

		if (testFailures.length > 0) {
			return `Test failures (${testFailures.length} tests)`;
		}

		return undefined;
	}

	private suggestFix(errors: CIError[]): string | undefined {
		const typeErrors = errors.filter(e => e.type === CIErrorType.TypeScript);
		const lintErrors = errors.filter(e => e.type === CIErrorType.ESLint);

		if (typeErrors.length > 0) {
			return 'Fix TypeScript type errors by checking type definitions and ensuring proper type annotations';
		}

		if (lintErrors.length > 0) {
			return 'Run ESLint auto-fix or manually address linting violations';
		}

		return undefined;
	}
}
