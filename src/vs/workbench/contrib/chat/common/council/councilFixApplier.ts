/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { Event, Emitter } from '../../../../../base/common/event.js';

export const ICouncilFixApplier = createDecorator<ICouncilFixApplier>('councilFixApplier');

export interface CodeFix {
	readonly fixId: string;
	readonly file: string;
	readonly line?: number;
	readonly description: string;
	readonly originalCode?: string;
	readonly suggestedCode: string;
	readonly category: 'security' | 'performance' | 'quality' | 'style' | 'bug';
	readonly confidence: number;
}

export interface FixApplicationResult {
	readonly fixId: string;
	readonly success: boolean;
	readonly file: string;
	readonly error?: string;
	readonly backupPath?: string;
	readonly appliedAt: number;
}

export interface ICouncilFixApplier extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onFixApplied: Event<FixApplicationResult>;

	applyFix(fix: CodeFix, workspaceRoot: URI): Promise<FixApplicationResult>;
	applyFixes(fixes: CodeFix[], workspaceRoot: URI): Promise<FixApplicationResult[]>;
	parseFixFromMarkdown(markdown: string, file?: string): CodeFix[];
	generateFixDescription(fix: CodeFix): string;
}

export class CouncilFixApplier extends Disposable implements ICouncilFixApplier {
	declare readonly _serviceBrand: undefined;

	private readonly _onFixApplied = this._register(new Emitter<FixApplicationResult>());
	readonly onFixApplied = this._onFixApplied.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public async applyFix(fix: CodeFix, workspaceRoot: URI): Promise<FixApplicationResult> {
		const fileUri = URI.joinPath(workspaceRoot, fix.file);

		try {
			if (!(await this.fileService.exists(fileUri))) {
				return {
					fixId: fix.fixId,
					success: false,
					file: fix.file,
					error: `File not found: ${fix.file}`,
					appliedAt: Date.now()
				};
			}

			const content = await this.fileService.readFile(fileUri);
			const originalContent = content.value.toString();
			const lines = originalContent.split('\n');

			let newContent: string;
			if (fix.line !== undefined && fix.originalCode) {
				const lineIndex = fix.line - 1;
				const originalLine = lines[lineIndex];

				if (originalLine?.includes(fix.originalCode.trim().substring(0, 50))) {
					lines[lineIndex] = fix.suggestedCode;
					newContent = lines.join('\n');
				} else {
					newContent = originalContent + '\n' + fix.suggestedCode;
				}
			} else {
				newContent = originalContent + '\n' + fix.suggestedCode;
			}

			await this.fileService.writeFile(fileUri, {
				value: newContent,
				mtime: Date.now(),
				ctime: 0,
				size: newContent.length,
				etag: undefined,
				isReadonly: false,
				isSymbolicLink: false,
				isDirectory: false
			} as any);

			const result: FixApplicationResult = {
				fixId: fix.fixId,
				success: true,
				file: fix.file,
				appliedAt: Date.now()
			};

			this._onFixApplied.fire(result);
			this.logService.info(`[Council Fix] Applied fix to ${fix.file}`);
			return result;
		} catch (error) {
			const result: FixApplicationResult = {
				fixId: fix.fixId,
				success: false,
				file: fix.file,
				error: error instanceof Error ? error.message : String(error),
				appliedAt: Date.now()
			};

			this.logService.error(`[Council Fix] Failed to apply fix: ${result.error}`);
			return result;
		}
	}

	public async applyFixes(fixes: CodeFix[], workspaceRoot: URI): Promise<FixApplicationResult[]> {
		const results: FixApplicationResult[] = [];

		for (const fix of fixes) {
			const result = await this.applyFix(fix, workspaceRoot);
			results.push(result);
		}

		return results;
	}

	public parseFixFromMarkdown(markdown: string, file?: string): CodeFix[] {
		const fixes: CodeFix[] = [];
		const codeBlockPattern = /```(\w*)\n([\s\S]*?)```/g;
		let match;

		let fixIndex = 0;
		while ((match = codeBlockPattern.exec(markdown)) !== null) {
			const code = match[2];

			const beforeBlock = markdown.substring(0, match.index);
			const lineMatch = beforeBlock.match(/line\s*(\d+)/i);
			const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

			const descMatch = beforeBlock.match(/(?:fix|suggestion|change|replace)[:\s]+([^\n]+)/i);
			const description = descMatch ? descMatch[1].trim() : `Code suggestion ${fixIndex + 1}`;

			fixes.push({
				fixId: `fix-${Date.now()}-${fixIndex}`,
				file: file ?? 'unknown',
				line,
				description,
				suggestedCode: code,
				category: this.inferCategory(description, code),
				confidence: 0.7
			});

			fixIndex++;
		}

		return fixes;
	}

	public generateFixDescription(fix: CodeFix): string {
		const parts: string[] = [];

		parts.push(`**${fix.category.toUpperCase()} Fix**`);
		parts.push('');
		parts.push(`**File**: ${fix.file}${fix.line ? ` (line ${fix.line})` : ''}`);
		parts.push('');
		parts.push(fix.description);

		if (fix.originalCode) {
			parts.push('');
			parts.push('**Before**:');
			parts.push('```');
			parts.push(fix.originalCode);
			parts.push('```');
		}

		parts.push('');
		parts.push('**After**:');
		parts.push('```');
		parts.push(fix.suggestedCode);
		parts.push('```');

		parts.push('');
		parts.push(`Confidence: ${(fix.confidence * 100).toFixed(0)}%`);

		return parts.join('\n');
	}

	private inferCategory(description: string, code: string): CodeFix['category'] {
		const lower = (description + ' ' + code).toLowerCase();

		if (lower.includes('security') || lower.includes('vulnerability') || lower.includes('xss') || lower.includes('injection')) {
			return 'security';
		}
		if (lower.includes('performance') || lower.includes('optimize') || lower.includes('slow')) {
			return 'performance';
		}
		if (lower.includes('bug') || lower.includes('fix') || lower.includes('error')) {
			return 'bug';
		}
		if (lower.includes('style') || lower.includes('format') || lower.includes('lint')) {
			return 'style';
		}
		return 'quality';
	}
}
