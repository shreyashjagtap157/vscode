/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../../base/common/uuid.js';

export const ICouncilTestRunner = createDecorator<ICouncilTestRunner>('councilTestRunner');

export enum TestStatus {
	Passed = 'passed',
	Failed = 'failed',
	Skipped = 'skipped',
	Error = 'error',
	Running = 'running'
}

export interface TestCommand {
	command: string;
	type: 'npm' | 'jest' | 'mocha' | 'pytest' | 'custom';
	args?: string;
	cwd?: string;
	timeout?: number;
}

export interface TestResult {
	testId: string;
	name: string;
	command: TestCommand;
	status: TestStatus;
	duration: number;
	output: string;
	error?: string;
	filePath?: string;
	lineNumber?: number;
}

export interface TestSuite {
	suiteId: string;
	name: string;
	tests: TestResult[];
	totalTests: number;
	passedTests: number;
	failedTests: number;
	skippedTests: number;
	duration: number;
	coverage?: CoverageReport;
}

export interface CoverageReport {
	lines: number;
	statements: number;
	functions: number;
	branches: number;
}

export interface VerificationReport {
	suite: TestSuite;
	summary: string;
	recommendations: string[];
	verified: boolean;
	confidence: number;
}

export interface ICouncilTestRunner extends IDisposable {
	readonly _serviceBrand: undefined;

	extractTestCommands(contribution: string): TestCommand[];
	runTests(commands: TestCommand[], token?: CancellationToken): Promise<TestSuite>;
	verifyContribution(contribution: string, token?: CancellationToken): Promise<VerificationReport>;
	getTestHistory(): TestSuite[];
}

export class CouncilTestRunner extends Disposable implements ICouncilTestRunner {
	declare readonly _serviceBrand: undefined;

	private readonly testHistory: TestSuite[] = [];

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public extractTestCommands(contribution: string): TestCommand[] {
		const commands: TestCommand[] = [];
		const seen = new Set<string>();

		const patterns = [
			{
				regex: /npm\s+test(?:\s+--\s+([^\n]+))?/gi,
				type: 'npm' as const,
				extractor: (match: RegExpExecArray): TestCommand => ({
					command: match[0],
					type: 'npm',
					args: match[1]
				})
			},
			{
				regex: /jest(?:\s+([^\n]+))?/gi,
				type: 'jest' as const,
				extractor: (match: RegExpExecArray): TestCommand => ({
					command: match[0],
					type: 'jest',
					args: match[1]
				})
			},
			{
				regex: /mocha(?:\s+([^\n]+))?/gi,
				type: 'mocha' as const,
				extractor: (match: RegExpExecArray): TestCommand => ({
					command: match[0],
					type: 'mocha',
					args: match[1]
				})
			},
			{
				regex: /pytest(?:\s+([^\n]+))?/gi,
				type: 'pytest' as const,
				extractor: (match: RegExpExecArray): TestCommand => ({
					command: match[0],
					type: 'pytest',
					args: match[1]
				})
			},
			{
				regex: /run[:\s]+(?:`([^`]+)`|"([^"]+)"|'([^']+)')/gi,
				type: 'custom' as const,
				extractor: (match: RegExpExecArray): TestCommand => ({
					command: match[1] || match[2] || match[3],
					type: 'custom'
				})
			},
			{
				regex: /execute[:\s]+(?:`([^`]+)`|"([^"]+)"|'([^']+)')/gi,
				type: 'custom' as const,
				extractor: (match: RegExpExecArray): TestCommand => ({
					command: match[1] || match[2] || match[3],
					type: 'custom'
				})
			},
			{
				regex: /test[:\s]+(?:`([^`]+)`|"([^"]+)"|'([^']+)')/gi,
				type: 'custom' as const,
				extractor: (match: RegExpExecArray): TestCommand => ({
					command: match[1] || match[2] || match[3],
					type: 'custom'
				})
			}
		];

		for (const { regex, extractor } of patterns) {
			let match;
			while ((match = regex.exec(contribution)) !== null) {
				try {
					const command = extractor(match);
					if (command.command && !seen.has(command.command)) {
						seen.add(command.command);
						commands.push(command);
					}
				} catch (error) {
					this.logService.warn(`[CouncilTestRunner] Failed to extract command: ${match[0]}`);
				}
			}
		}

		return commands;
	}

	public async runTests(
		commands: TestCommand[],
		token: CancellationToken = CancellationToken.None
	): Promise<TestSuite> {
		const suiteId = generateUuid();
		const tests: TestResult[] = [];
		let totalDuration = 0;

		this.logService.info(`[CouncilTestRunner] Running test suite ${suiteId} with ${commands.length} commands`);

		for (const command of commands) {
			if (token.isCancellationRequested) {
				break;
			}

			const testResult = await this.executeTest(command, token);
			tests.push(testResult);
			totalDuration += testResult.duration;
		}

		const passedTests = tests.filter(t => t.status === TestStatus.Passed).length;
		const failedTests = tests.filter(t => t.status === TestStatus.Failed || t.status === TestStatus.Error).length;
		const skippedTests = tests.filter(t => t.status === TestStatus.Skipped).length;

		const suite: TestSuite = {
			suiteId,
			name: `Council Test Suite ${new Date().toISOString()}`,
			tests,
			totalTests: tests.length,
			passedTests,
			failedTests,
			skippedTests,
			duration: totalDuration
		};

		this.testHistory.push(suite);
		this.logService.info(`[CouncilTestRunner] Suite ${suiteId} completed: ${passedTests}/${tests.length} passed`);

		return suite;
	}

	public async verifyContribution(
		contribution: string,
		token: CancellationToken = CancellationToken.None
	): Promise<VerificationReport> {
		const commands = this.extractTestCommands(contribution);
		
		if (commands.length === 0) {
			return {
				suite: {
					suiteId: generateUuid(),
					name: 'No tests found',
					tests: [],
					totalTests: 0,
					passedTests: 0,
					failedTests: 0,
					skippedTests: 0,
					duration: 0
				},
				summary: 'No test commands found in contribution',
				recommendations: ['Add test commands to verify your claims'],
				verified: false,
				confidence: 0
			};
		}

		const suite = await this.runTests(commands, token);
		
		const verified = suite.failedTests === 0 && suite.totalTests > 0;
		const confidence = suite.totalTests > 0 ? suite.passedTests / suite.totalTests : 0;

		const recommendations = this.generateTestRecommendations(suite);
		const summary = this.generateTestSummary(suite);

		return {
			suite,
			summary,
			recommendations,
			verified,
			confidence
		};
	}

	public getTestHistory(): TestSuite[] {
		return [...this.testHistory];
	}

	private async executeTest(
		command: TestCommand,
		token: CancellationToken
	): Promise<TestResult> {
		const testId = generateUuid();
		const startTime = Date.now();

		this.logService.debug(`[CouncilTestRunner] Executing test: ${command.command}`);

		try {
			const output = await this.simulateTestExecution(command, token);
			const duration = Date.now() - startTime;

			const status = this.parseTestStatus(output);
			const error = status === TestStatus.Failed ? this.extractErrorMessage(output) : undefined;

			return {
				testId,
				name: command.command,
				command,
				status,
				duration,
				output,
				error
			};
		} catch (error) {
			const duration = Date.now() - startTime;
			
			return {
				testId,
				name: command.command,
				command,
				status: TestStatus.Error,
				duration,
				output: '',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	private async simulateTestExecution(
		command: TestCommand,
		token: CancellationToken
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				resolve(`Test execution completed for: ${command.command}`);
			}, command.timeout || 5000);

			token.onCancellationRequested(() => {
				clearTimeout(timeoutId);
				reject(new Error('Test execution cancelled'));
			});
		});
	}

	private parseTestStatus(output: string): TestStatus {
		if (output.includes('FAIL') || output.includes('failed') || output.includes('Error:')) {
			return TestStatus.Failed;
		}

		if (output.includes('PASS') || output.includes('passed') || output.includes('✓')) {
			return TestStatus.Passed;
		}

		if (output.includes('skipped') || output.includes('pending')) {
			return TestStatus.Skipped;
		}

		return TestStatus.Error;
	}

	private extractErrorMessage(output: string): string {
		const errorPatterns = [
			/Error:\s*([^\n]+)/gi,
			/AssertionError:\s*([^\n]+)/gi,
			/FAIL\s+([^\n]+)/gi
		];

		for (const pattern of errorPatterns) {
			const match = pattern.exec(output);
			if (match) {
				return match[1].trim();
			}
		}

		return 'Unknown error';
	}

	private generateTestRecommendations(suite: TestSuite): string[] {
		const recommendations: string[] = [];

		if (suite.totalTests === 0) {
			recommendations.push('No tests were executed. Add test commands to verify claims.');
		}

		if (suite.failedTests > 0) {
			recommendations.push(`${suite.failedTests} test(s) failed. Review and fix the issues.`);
		}

		if (suite.passedTests === suite.totalTests && suite.totalTests > 0) {
			recommendations.push('All tests passed. Consider adding more test coverage.');
		}

		if (suite.duration > 60000) {
			recommendations.push('Test execution took over 60 seconds. Consider optimizing tests.');
		}

		return recommendations;
	}

	private generateTestSummary(suite: TestSuite): string {
		if (suite.totalTests === 0) {
			return 'No tests executed';
		}

		const passRate = ((suite.passedTests / suite.totalTests) * 100).toFixed(0);
		return `${suite.passedTests}/${suite.totalTests} tests passed (${passRate}%) in ${(suite.duration / 1000).toFixed(1)}s`;
	}
}
