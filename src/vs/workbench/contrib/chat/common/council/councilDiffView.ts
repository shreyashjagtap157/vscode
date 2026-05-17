/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';

export const ICouncilDiffView = createDecorator<ICouncilDiffView>('councilDiffView');

export interface DiffLine {
	readonly lineNumber: number;
	readonly originalLine?: string;
	readonly newLine?: string;
	readonly type: 'unchanged' | 'added' | 'removed' | 'modified';
	readonly comments: DiffComment[];
}

export interface DiffComment {
	readonly commentId: string;
	readonly author: string;
	readonly content: string;
	readonly severity: 'info' | 'warning' | 'error' | 'critical';
	readonly category: string;
	readonly suggestion?: string;
	readonly timestamp: number;
}

export interface FileDiff {
	readonly filename: string;
	readonly status: 'added' | 'modified' | 'removed' | 'renamed';
	readonly lines: DiffLine[];
	readonly additions: number;
	readonly deletions: number;
	readonly comments: DiffComment[];
}

export interface DiffViewState {
	readonly files: FileDiff[];
	readonly selectedFile?: string;
	readonly selectedLine?: number;
	readonly showComments: boolean;
	readonly showOnlyCommented: boolean;
}

export interface ICouncilDiffView extends IDisposable {
	readonly _serviceBrand: undefined;

	parseDiff(diff: string, files: Array<{ filename: string; status: string; additions: number; deletions: number }>): FileDiff[];
	addCommentToLine(filename: string, lineNumber: number, comment: DiffComment): void;
	getCommentsForFile(filename: string): DiffComment[];
	getCommentsForLine(filename: string, lineNumber: number): DiffComment[];
	createViewState(files: FileDiff[]): DiffViewState;
	filterViewByComments(state: DiffViewState): DiffViewState;
	generateDiffSummary(files: FileDiff[]): string;
}

export class CouncilDiffView extends Disposable implements ICouncilDiffView {
	declare readonly _serviceBrand: undefined;

	private readonly comments: Map<string, DiffComment[]>;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.comments = new Map();
	}

	public parseDiff(
		diff: string,
		files: Array<{ filename: string; status: string; additions: number; deletions: number }>
	): FileDiff[] {
		const fileDiffs: FileDiff[] = [];

		for (const fileInfo of files) {
			const fileDiff = this.parseFileDiff(diff, fileInfo);
			fileDiffs.push(fileDiff);
		}

		this.logService.info(`[Council Diff] Parsed ${fileDiffs.length} file diffs`);
		return fileDiffs;
	}

	public addCommentToLine(filename: string, lineNumber: number, comment: DiffComment): void {
		const key = `${filename}:${lineNumber}`;
		const existing = this.comments.get(key) ?? [];
		existing.push(comment);
		this.comments.set(key, existing);

		this.logService.debug(`[Council Diff] Comment added to ${key}`);
	}

	public getCommentsForFile(filename: string): DiffComment[] {
		const fileComments: DiffComment[] = [];
		for (const [key, comments] of this.comments) {
			if (key.startsWith(`${filename}:`)) {
				fileComments.push(...comments);
			}
		}
		return fileComments;
	}

	public getCommentsForLine(filename: string, lineNumber: number): DiffComment[] {
		const key = `${filename}:${lineNumber}`;
		return this.comments.get(key) ?? [];
	}

	public createViewState(files: FileDiff[]): DiffViewState {
		return {
			files,
			showComments: true,
			showOnlyCommented: false
		};
	}

	public filterViewByComments(state: DiffViewState): DiffViewState {
		if (!state.showOnlyCommented) return state;

		const filteredFiles = state.files
			.map(file => ({
				...file,
				lines: file.lines.filter(line => line.comments.length > 0)
			}))
			.filter(file => file.lines.length > 0);

		return {
			...state,
			files: filteredFiles
		};
	}

	public generateDiffSummary(files: FileDiff[]): string {
		const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
		const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
		const totalComments = files.reduce((sum, f) => sum + this.getCommentsForFile(f.filename).length, 0);

		const parts: string[] = [];
		parts.push(`## Diff Summary`);
		parts.push('');
		parts.push(`| Metric | Count |`);
		parts.push(`|--------|-------|`);
		parts.push(`| Files Changed | ${files.length} |`);
		parts.push(`| Additions | +${totalAdditions} |`);
		parts.push(`| Deletions | -${totalDeletions} |`);
		parts.push(`| Council Comments | ${totalComments} |`);
		parts.push('');

		for (const file of files) {
			const fileComments = this.getCommentsForFile(file.filename);
			if (fileComments.length > 0) {
				parts.push(`### ${file.filename} (${fileComments.length} comments)`);
				parts.push('');
				for (const comment of fileComments) {
					parts.push(`- **${comment.severity.toUpperCase()}**: ${comment.content}`);
				}
				parts.push('');
			}
		}

		return parts.join('\n');
	}

	private parseFileDiff(
		diff: string,
		fileInfo: { filename: string; status: string; additions: number; deletions: number }
	): FileDiff {
		const lines: DiffLine[] = [];

		const fileStart = diff.indexOf(`b/${fileInfo.filename}`);
		if (fileStart === -1) {
			return {
				filename: fileInfo.filename,
				status: fileInfo.status as FileDiff['status'],
				lines: [],
				additions: fileInfo.additions,
				deletions: fileInfo.deletions,
				comments: this.getCommentsForFile(fileInfo.filename)
			};
		}

		const nextFile = diff.indexOf('diff --git', fileStart + 1);
		const fileContent = nextFile !== -1 ? diff.substring(fileStart, nextFile) : diff.substring(fileStart);

		const contentLines = fileContent.split('\n');
		let originalLineNum = 0;
		let newLineNum = 0;

		for (const line of contentLines) {
			if (line.startsWith('@@')) {
				const match = line.match(/-(\d+),?\d* \+(\d+),?\d*/);
				if (match) {
					originalLineNum = parseInt(match[1], 10);
					newLineNum = parseInt(match[2], 10);
				}
				continue;
			}

			if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff') || line.startsWith('index')) {
				continue;
			}

			if (line.startsWith('+')) {
				const lineNum = newLineNum++;
				lines.push({
					lineNumber: lineNum,
					newLine: line.substring(1),
					type: 'added',
					comments: this.getCommentsForLine(fileInfo.filename, lineNum)
				});
			} else if (line.startsWith('-')) {
				const lineNum = originalLineNum++;
				lines.push({
					lineNumber: lineNum,
					originalLine: line.substring(1),
					type: 'removed',
					comments: this.getCommentsForLine(fileInfo.filename, lineNum)
				});
			} else if (line.startsWith(' ')) {
				const lineNum = newLineNum++;
				originalLineNum++;
				lines.push({
					lineNumber: lineNum,
					originalLine: line.substring(1),
					newLine: line.substring(1),
					type: 'unchanged',
					comments: this.getCommentsForLine(fileInfo.filename, lineNum)
				});
			}
		}

		return {
			filename: fileInfo.filename,
			status: fileInfo.status as FileDiff['status'],
			lines,
			additions: fileInfo.additions,
			deletions: fileInfo.deletions,
			comments: this.getCommentsForFile(fileInfo.filename)
		};
	}
}
