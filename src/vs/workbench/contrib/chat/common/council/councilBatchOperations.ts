/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { ICouncilFixApplier, CodeFix, FixApplicationResult } from './councilFixApplier.js';
import { ICouncilUndoRedo } from './councilUndoRedo.js';

export const ICouncilBatchOperations = createDecorator<ICouncilBatchOperations>('councilBatchOperations');

export interface BatchOperation {
	readonly id: string;
	readonly type: 'write' | 'delete' | 'rename';
	readonly uri: URI;
	readonly content?: VSBuffer;
	readonly newUri?: URI;
}

export interface BatchResult {
	readonly success: boolean;
	readonly operations: Array<{ operation: BatchOperation; success: boolean; error?: string }>;
	readonly totalDuration: number;
	readonly rolledBack: boolean;
}

export interface ICouncilBatchOperations extends IDisposable {
	readonly _serviceBrand: undefined;

	executeBatch(operations: BatchOperation[], sessionId?: string): Promise<BatchResult>;
	executeBatchWithRollback(operations: BatchOperation[], sessionId?: string): Promise<BatchResult>;
	createWriteOperation(uri: URI, content: string): BatchOperation;
	createDeleteOperation(uri: URI): BatchOperation;
	createRenameOperation(oldUri: URI, newUri: URI): BatchOperation;
}

export class CouncilBatchOperations extends Disposable implements ICouncilBatchOperations {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@ICouncilFixApplier private readonly fixApplier: ICouncilFixApplier,
		@ICouncilUndoRedo private readonly undoRedo: ICouncilUndoRedo
	) {
		super();
	}

	public async executeBatch(operations: BatchOperation[], sessionId?: string): Promise<BatchResult> {
		const startTime = Date.now();
		const results: Array<{ operation: BatchOperation; success: boolean; error?: string }> = [];

		for (const operation of operations) {
			try {
				switch (operation.type) {
					case 'write':
						if (operation.content) {
							await this.fileService.writeFile(operation.uri, operation.content);
						}
						break;
					case 'delete':
						await this.fileService.delete(operation.uri);
						break;
					case 'rename':
						if (operation.newUri) {
							await this.fileService.move(operation.uri, operation.newUri);
						}
						break;
				}
				results.push({ operation, success: true });
			} catch (error) {
				results.push({ operation, success: false, error: String(error) });
			}
		}

		const allSuccess = results.every(r => r.success);

		return {
			success: allSuccess,
			operations: results,
			totalDuration: Date.now() - startTime,
			rolledBack: false
		};
	}

	public async executeBatchWithRollback(operations: BatchOperation[], sessionId?: string): Promise<BatchResult> {
		const startTime = Date.now();
		const results: Array<{ operation: BatchOperation; success: boolean; error?: string }> = [];
		const originalContents: Map<string, string> = new Map();

		for (const operation of operations) {
			try {
				if (operation.type === 'write') {
					const exists = await this.fileService.exists(operation.uri);
					if (exists) {
						const content = await this.fileService.readFile(operation.uri);
						originalContents.set(operation.uri.toString(), content.value.toString());
					}
				}

				switch (operation.type) {
					case 'write':
						if (operation.content) {
							await this.fileService.writeFile(operation.uri, operation.content);
						}
						break;
					case 'delete':
						await this.fileService.delete(operation.uri);
						break;
					case 'rename':
						if (operation.newUri) {
							await this.fileService.move(operation.uri, operation.newUri);
						}
						break;
				}
				results.push({ operation, success: true });
			} catch (error) {
				results.push({ operation, success: false, error: String(error) });

				this.logService.warn('[Council Batch] Operation failed, rolling back...');
				await this.rollback(results.filter(r => r.success).map(r => r.operation), originalContents);

				return {
					success: false,
					operations: results,
					totalDuration: Date.now() - startTime,
					rolledBack: true
				};
			}
		}

		if (sessionId) {
			for (const result of results) {
				if (result.success && result.operation.type === 'write') {
					const original = originalContents.get(result.operation.uri.toString());
					if (original && result.operation.content) {
						this.undoRedo.recordEdit(
							sessionId,
							result.operation.uri.fsPath,
							original,
							result.operation.content.toString()
						);
					}
				}
			}
		}

		return {
			success: true,
			operations: results,
			totalDuration: Date.now() - startTime,
			rolledBack: false
		};
	}

	public createWriteOperation(uri: URI, content: string): BatchOperation {
		return {
			id: `write-${uri.fsPath}-${Date.now()}`,
			type: 'write',
			uri,
			content: VSBuffer.fromString(content)
		};
	}

	public createDeleteOperation(uri: URI): BatchOperation {
		return {
			id: `delete-${uri.fsPath}-${Date.now()}`,
			type: 'delete',
			uri
		};
	}

	public createRenameOperation(oldUri: URI, newUri: URI): BatchOperation {
		return {
			id: `rename-${oldUri.fsPath}-${Date.now()}`,
			type: 'rename',
			uri: oldUri,
			newUri
		};
	}

	private async rollback(successfulOps: BatchOperation[], originalContents: Map<string, string>): Promise<void> {
		for (const operation of successfulOps.reverse()) {
			try {
				if (operation.type === 'write') {
					const original = originalContents.get(operation.uri.toString());
					if (original) {
						await this.fileService.writeFile(operation.uri, VSBuffer.fromString(original));
					} else {
						await this.fileService.delete(operation.uri);
					}
				} else if (operation.type === 'delete') {
					this.logService.warn(`[Council Batch] Cannot rollback delete: ${operation.uri.fsPath}`);
				} else if (operation.type === 'rename' && operation.newUri) {
					await this.fileService.move(operation.newUri, operation.uri);
				}
			} catch (error) {
				this.logService.error(`[Council Batch] Rollback failed: ${error}`);
			}
		}
	}
}
