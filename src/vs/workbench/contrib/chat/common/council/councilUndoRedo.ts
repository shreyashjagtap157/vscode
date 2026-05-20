/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';

export const ICouncilUndoRedo = createDecorator<ICouncilUndoRedo>('councilUndoRedo');

export interface UndoEntry {
	readonly id: string;
	readonly sessionId: string;
	readonly file: string;
	readonly originalContent: string;
	readonly newContent: string;
	readonly timestamp: number;
	undone: boolean;
}

export interface ICouncilUndoRedo extends IDisposable {
	readonly _serviceBrand: undefined;

	recordEdit(sessionId: string, file: string, originalContent: string, newContent: string): void;
	undo(sessionId?: string): Promise<UndoEntry[]>;
	redo(sessionId?: string): Promise<UndoEntry[]>;
	canUndo(sessionId?: string): boolean;
	canRedo(sessionId?: string): boolean;
	getHistory(sessionId?: string): UndoEntry[];
	clear(sessionId?: string): void;
}

export class CouncilUndoRedo extends Disposable implements ICouncilUndoRedo {
	declare readonly _serviceBrand: undefined;

	private readonly undoStack: UndoEntry[];
	private readonly redoStack: UndoEntry[];

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
		this.undoStack = [];
		this.redoStack = [];
	}

	public recordEdit(sessionId: string, file: string, originalContent: string, newContent: string): void {
		this.undoStack.push({
			id: `${sessionId}-${file}-${Date.now()}`,
			sessionId,
			file,
			originalContent,
			newContent,
			timestamp: Date.now(),
			undone: false
		});
		this.redoStack.length = 0;
	}

	public async undo(sessionId?: string): Promise<UndoEntry[]> {
		const undone: UndoEntry[] = [];

		while (this.undoStack.length > 0) {
			const entry = this.undoStack[this.undoStack.length - 1];
			if (sessionId && entry.sessionId !== sessionId) break;

			this.undoStack.pop();
			entry.undone = true;
			this.redoStack.push(entry);
			undone.push(entry);

			try {
				const uri = URI.file(entry.file);
				await this.fileService.writeFile(uri, this.stringToBuffer(entry.originalContent));
				this.logService.info(`[Council UndoRedo] Undid edit: ${entry.file}`);
			} catch (error) {
				this.logService.error(`[Council UndoRedo] Failed to undo: ${error}`);
			}
		}

		return undone;
	}

	public async redo(sessionId?: string): Promise<UndoEntry[]> {
		const redone: UndoEntry[] = [];

		while (this.redoStack.length > 0) {
			const entry = this.redoStack[this.redoStack.length - 1];
			if (sessionId && entry.sessionId !== sessionId) break;

			this.redoStack.pop();
			entry.undone = false;
			this.undoStack.push(entry);
			redone.push(entry);

			try {
				const uri = URI.file(entry.file);
				await this.fileService.writeFile(uri, this.stringToBuffer(entry.newContent));
				this.logService.info(`[Council UndoRedo] Redid edit: ${entry.file}`);
			} catch (error) {
				this.logService.error(`[Council UndoRedo] Failed to redo: ${error}`);
			}
		}

		return redone;
	}

	public canUndo(sessionId?: string): boolean {
		if (sessionId) {
			return this.undoStack.some(e => e.sessionId === sessionId);
		}
		return this.undoStack.length > 0;
	}

	public canRedo(sessionId?: string): boolean {
		if (sessionId) {
			return this.redoStack.some(e => e.sessionId === sessionId);
		}
		return this.redoStack.length > 0;
	}

	public getHistory(sessionId?: string): UndoEntry[] {
		if (sessionId) {
			return [...this.undoStack, ...this.redoStack]
				.filter(e => e.sessionId === sessionId)
				.sort((a, b) => a.timestamp - b.timestamp);
		}
		return [...this.undoStack, ...this.redoStack].sort((a, b) => a.timestamp - b.timestamp);
	}

	public clear(sessionId?: string): void {
		if (sessionId) {
			const undoIdx = this.undoStack.filter(e => e.sessionId !== sessionId);
			const redoIdx = this.redoStack.filter(e => e.sessionId !== sessionId);
			this.undoStack.length = 0;
			this.redoStack.length = 0;
			this.undoStack.push(...undoIdx);
			this.redoStack.push(...redoIdx);
		} else {
			this.undoStack.length = 0;
			this.redoStack.length = 0;
		}
	}

	private stringToBuffer(content: string): VSBuffer {
		return VSBuffer.fromString(content);
	}
}

import { VSBuffer } from '../../../../../base/common/buffer.js';
