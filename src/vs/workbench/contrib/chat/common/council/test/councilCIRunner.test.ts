/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilCIRunner, CIErrorType } from '../councilCIRunner.js';

suite('CouncilCIRunner - Phase 4', () => {

	test('parses TypeScript errors', () => {
		const runner = createTestCIRunner();
		const output = `
			error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
			src/auth.ts:45:10
		`;
		const errors = runner.parseCIOutput(output);

		assert.strictEqual(errors.length, 1);
		assert.strictEqual(errors[0].type, CIErrorType.TypeScript);
		assert.ok(errors[0].message.includes('TS2345'));
	});

	test('parses ESLint errors', () => {
		const runner = createTestCIRunner();
		const output = `
			src/app.ts:10:5: error  'console' is not defined  no-undef
		`;
		const errors = runner.parseCIOutput(output);

		assert.strictEqual(errors.length, 1);
		assert.strictEqual(errors[0].type, CIErrorType.ESLint);
		assert.ok(errors[0].message.includes('console'));
	});

	test('parses test failures', () => {
		const runner = createTestCIRunner();
		const output = `
			FAIL  src/tests/auth.test.ts
			Tests: 1 failed, 5 passed
		`;
		const errors = runner.parseCIOutput(output);

		assert.strictEqual(errors.length, 1);
		assert.strictEqual(errors[0].type, CIErrorType.Test);
		assert.ok(errors[0].message.includes('auth.test.ts'));
	});

	test('parses build failures', () => {
		const runner = createTestCIRunner();
		const output = `
			BUILD FAILED
			npm ERR! code ELIFECYCLE
		`;
		const errors = runner.parseCIOutput(output);

		assert.ok(errors.length > 0);
		assert.ok(errors.some(e => e.type === CIErrorType.Build));
	});

	test('parses dependency errors', () => {
		const runner = createTestCIRunner();
		const output = `
			Cannot find module 'express'
		`;
		const errors = runner.parseCIOutput(output);

		assert.strictEqual(errors.length, 1);
		assert.strictEqual(errors[0].type, CIErrorType.Dependency);
		assert.ok(errors[0].message.includes('express'));
	});

	test('parses compilation errors', () => {
		const runner = createTestCIRunner();
		const output = `
			Module not found: Error: Can't resolve './utils'
		`;
		const errors = runner.parseCIOutput(output);

		assert.strictEqual(errors.length, 1);
		assert.strictEqual(errors[0].type, CIErrorType.Compilation);
		assert.ok(errors[0].message.includes('./utils'));
	});

	test('parses multiple error types', () => {
		const runner = createTestCIRunner();
		const output = `
			error TS2345: Argument of type 'string' is not assignable.
			src/auth.ts:45:10
			src/app.ts:10:5: error  'console' is not defined  no-undef
			FAIL  src/tests/auth.test.ts
		`;
		const errors = runner.parseCIOutput(output);

		assert.ok(errors.length >= 2);
		assert.ok(errors.some(e => e.type === CIErrorType.TypeScript));
		assert.ok(errors.some(e => e.type === CIErrorType.ESLint));
		assert.ok(errors.some(e => e.type === CIErrorType.Test));
	});

	test('analyzes failure with multiple errors', async () => {
		const runner = createTestCIRunner();
		const output = `
			error TS2345: Type mismatch.
			src/auth.ts:45:10
			src/app.ts:10:5: error  'console' is not defined
		`;
		const analysis = await runner.analyzeFailure(output);

		assert.ok(analysis.errors.length > 0);
		assert.ok(analysis.summary);
		assert.ok(analysis.severity);
		assert.ok(analysis.affectedFiles.length > 0);
	});

	test('calculates severity correctly', async () => {
		const runner = createTestCIRunner();
		
		const criticalOutput = `
			error TS2345: Type mismatch
			error TS2345: Type mismatch
			error TS2345: Type mismatch
			error TS2345: Type mismatch
			error TS2345: Type mismatch
			error TS2345: Type mismatch
		`;
		const criticalAnalysis = await runner.analyzeFailure(criticalOutput);
		assert.strictEqual(criticalAnalysis.severity, 'critical');

		const lowOutput = `FAIL src/tests/test.ts`;
		const lowAnalysis = await runner.analyzeFailure(lowOutput);
		assert.strictEqual(lowAnalysis.severity, 'medium');
	});

	test('identifies root cause', async () => {
		const runner = createTestCIRunner();
		const output = `
			error TS2345: Type mismatch
			src/auth.ts:45:10
			error TS2345: Type mismatch
			src/auth.ts:50:10
		`;
		const analysis = await runner.analyzeFailure(output);

		assert.ok(analysis.rootCause);
		assert.ok(analysis.rootCause!.includes('auth.ts'));
	});

	test('suggests fix for TypeScript errors', async () => {
		const runner = createTestCIRunner();
		const output = `error TS2345: Type mismatch`;
		const analysis = await runner.analyzeFailure(output);

		assert.ok(analysis.suggestedFix);
		assert.ok(analysis.suggestedFix!.toLowerCase().includes('type'));
	});

	test('resolves CI failure', async () => {
		const runner = createTestCIRunner();
		const output = `error TS2345: Type mismatch\nsrc/auth.ts:45:10`;
		const result = await runner.resolveCIFailure(output);

		assert.ok(result.analysis);
		assert.ok(result.fixResult);
		assert.ok(result.timestamp > 0);
	});
});

function createTestCIRunner(): CouncilCIRunner {
	const mockLogService = {
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {}
	};

	const mockOrchestrator = {
		executeSession: () => Promise.resolve({ status: 'success', contributions: new Map() })
	};

	const mockTestRunner = {
		runTests: () => Promise.resolve({ totalTests: 0, passedTests: 0, failedTests: 0 })
	};

	return new CouncilCIRunner(
		mockLogService as any,
		mockOrchestrator as any,
		mockTestRunner as any
	);
}
