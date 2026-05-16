/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EvidenceValidator, CitationType } from '../evidenceValidator.js';

suite('EvidenceValidator - Phase 2', () => {

	test('parses file citations correctly', () => {
		const validator = createTestValidator();
		const text = 'Issue in [File:src/auth.ts:45] and [File:config.json:10-20]';
		const citations = validator.parseCitations(text);

		assert.strictEqual(citations.length, 2);
		assert.strictEqual(citations[0].type, CitationType.File);
		assert.strictEqual(citations[0].path, 'src/auth.ts');
		assert.strictEqual(citations[0].line, 45);
		assert.strictEqual(citations[1].endLine, 20);
	});

	test('parses log citations correctly', () => {
		const validator = createTestValidator();
		const text = 'See [Log:ci-error-2024] for details';
		const citations = validator.parseCitations(text);

		assert.strictEqual(citations.length, 1);
		assert.strictEqual(citations[0].type, CitationType.Log);
		assert.strictEqual(citations[0].identifier, 'ci-error-2024');
	});

	test('parses test citations correctly', () => {
		const validator = createTestValidator();
		const text = 'Verified by [Test:auth-login-test]';
		const citations = validator.parseCitations(text);

		assert.strictEqual(citations.length, 1);
		assert.strictEqual(citations[0].type, CitationType.Test);
		assert.strictEqual(citations[0].testId, 'auth-login-test');
	});

	test('parses URL citations correctly', () => {
		const validator = createTestValidator();
		const text = 'Reference: [URL:https://example.com/docs]';
		const citations = validator.parseCitations(text);

		assert.strictEqual(citations.length, 1);
		assert.strictEqual(citations[0].type, CitationType.URL);
		assert.strictEqual(citations[0].url, 'https://example.com/docs');
	});

	test('parses code blocks correctly', () => {
		const validator = createTestValidator();
		const text = '```typescript\nconst x = 1;\n```';
		const citations = validator.parseCitations(text);

		assert.strictEqual(citations.length, 1);
		assert.strictEqual(citations[0].type, CitationType.CodeBlock);
		assert.strictEqual(citations[0].language, 'typescript');
	});

	test('parses multiple citation types', () => {
		const validator = createTestValidator();
		const text = `
			File: [File:src/main.ts:10]
			Log: [Log:test-output]
			Test: [Test:unit-test-1]
			URL: [URL:https://docs.example.com]
			\`\`\`javascript
			console.log('test');
			\`\`\`
		`;
		const citations = validator.parseCitations(text);

		assert.strictEqual(citations.length, 5);
		assert.strictEqual(citations[0].type, CitationType.File);
		assert.strictEqual(citations[1].type, CitationType.Log);
		assert.strictEqual(citations[2].type, CitationType.Test);
		assert.strictEqual(citations[3].type, CitationType.URL);
		assert.strictEqual(citations[4].type, CitationType.CodeBlock);
	});

	test('scores evidence with no citations', async () => {
		const validator = createTestValidator();
		const text = 'This is a plain response with no citations';
		const score = await validator.scoreEvidence(text);

		assert.strictEqual(score.totalCitations, 0);
		assert.strictEqual(score.validCitations, 0);
		assert.strictEqual(score.invalidCitations, 0);
		assert.strictEqual(score.confidenceScore, 0);
	});

	test('estimates reasoning depth correctly', async () => {
		const validator = createTestValidator();
		const text = 'Because the system uses authentication, therefore we must ensure security. However, if we implement OAuth, then we need to handle tokens. Consequently, the architecture must support this.';
		const score = await validator.scoreEvidence(text);

		assert.ok(score.reasoningDepth > 0);
	});

	test('generates evidence report with recommendations', async () => {
		const validator = createTestValidator();
		const text = 'No citations here';
		const report = await validator.generateEvidenceReport(text);

		assert.ok(report.recommendations.length > 0);
		assert.ok(report.summary.includes('No evidence'));
	});

	test('calculates confidence score with weighted types', async () => {
		const validator = createTestValidator();
		const text = '[File:src/test.ts:1] [File:src/test.ts:2] [Log:log1]';
		const score = await validator.scoreEvidence(text);

		assert.strictEqual(score.totalCitations, 3);
		assert.strictEqual(score.citationBreakdown[CitationType.File], 2);
		assert.strictEqual(score.citationBreakdown[CitationType.Log], 1);
	});

	test('clears validation cache', () => {
		const validator = createTestValidator();
		validator.clearCache();
	});
});

function createTestValidator(): EvidenceValidator {
	const mockLogService = {
		warn: () => {},
		info: () => {},
		error: () => {},
		debug: () => {}
	};

	const mockFileService = {
		exists: () => Promise.resolve(false),
		readFile: () => Promise.resolve({ value: { toString: () => '' } })
	};

	const mockModelService = {};

	return new EvidenceValidator(
		mockLogService as any,
		mockFileService as any,
		mockModelService as any
	);
}
