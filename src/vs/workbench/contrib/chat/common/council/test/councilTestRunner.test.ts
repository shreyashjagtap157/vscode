/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CouncilTestRunner } from '../councilTestRunner.js';

suite('CouncilTestRunner - Phase 2', () => {

	test('extracts npm test command', () => {
		const runner = createTestRunner();
		const contribution = 'Run the tests with npm test';
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 1);
		assert.strictEqual(commands[0].type, 'npm');
		assert.strictEqual(commands[0].command, 'npm test');
	});

	test('extracts jest command', () => {
		const runner = createTestRunner();
		const contribution = 'Execute jest --coverage';
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 1);
		assert.strictEqual(commands[0].type, 'jest');
		assert.ok(commands[0].command.includes('jest'));
	});

	test('extracts pytest command', () => {
		const runner = createTestRunner();
		const contribution = 'Run pytest tests/';
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 1);
		assert.strictEqual(commands[0].type, 'pytest');
	});

	test('extracts mocha command', () => {
		const runner = createTestRunner();
		const contribution = 'Execute mocha --reporter spec';
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 1);
		assert.strictEqual(commands[0].type, 'mocha');
	});

	test('extracts custom run command', () => {
		const runner = createTestRunner();
		const contribution = 'Run `npm run test:unit` to verify';
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 1);
		assert.strictEqual(commands[0].type, 'custom');
		assert.strictEqual(commands[0].command, 'npm run test:unit');
	});

	test('extracts custom execute command', () => {
		const runner = createTestRunner();
		const contribution = 'Execute "python test_runner.py"';
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 1);
		assert.strictEqual(commands[0].type, 'custom');
		assert.strictEqual(commands[0].command, 'python test_runner.py');
	});

	test('extracts multiple commands', () => {
		const runner = createTestRunner();
		const contribution = `
			First run npm test to verify.
			Then execute jest --coverage for coverage.
			Finally run \`python integration_tests.py\` for integration.
		`;
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 3);
		assert.strictEqual(commands[0].type, 'npm');
		assert.strictEqual(commands[1].type, 'jest');
		assert.strictEqual(commands[2].type, 'custom');
	});

	test('does not extract duplicate commands', () => {
		const runner = createTestRunner();
		const contribution = 'Run npm test and also npm test again';
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 1);
	});

	test('returns empty array for no test commands', () => {
		const runner = createTestRunner();
		const contribution = 'This is just a regular response with no test commands';
		const commands = runner.extractTestCommands(contribution);

		assert.strictEqual(commands.length, 0);
	});

	test('verifies contribution with no test commands', async () => {
		const runner = createTestRunner();
		const contribution = 'No tests mentioned here';
		const report = await runner.verifyContribution(contribution);

		assert.strictEqual(report.verified, false);
		assert.strictEqual(report.confidence, 0);
		assert.ok(report.recommendations.length > 0);
	});

	test('getTestHistory returns empty initially', () => {
		const runner = createTestRunner();
		const history = runner.getTestHistory();

		assert.strictEqual(history.length, 0);
	});
});

function createTestRunner(): CouncilTestRunner {
	const mockLogService = {
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {}
	};

	return new CouncilTestRunner(
		mockLogService as any
	);
}
