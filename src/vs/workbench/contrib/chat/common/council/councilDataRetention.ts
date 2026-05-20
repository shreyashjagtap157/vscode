/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Event, Emitter } from '../../../../../base/common/event.js';

export const ICouncilDataRetention = createDecorator<ICouncilDataRetention>('councilDataRetention');

export interface RetentionPolicy {
	readonly sessionsMaxAge: number;
	readonly auditMaxAge: number;
	readonly cacheMaxAge: number;
	readonly recordingsMaxAge: number;
	readonly autoCleanup: boolean;
	readonly cleanupIntervalMs: number;
}

export interface CleanupResult {
	readonly sessionsDeleted: number;
	readonly auditEntriesDeleted: number;
	readonly cacheEntriesDeleted: number;
	readonly recordingsDeleted: number;
	readonly spaceFreedBytes: number;
	readonly executedAt: number;
}

export interface ICouncilDataRetention extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onCleanupExecuted: Event<CleanupResult>;

	setPolicy(policy: Partial<RetentionPolicy>): void;
	getPolicy(): RetentionPolicy;
	executeCleanup(): Promise<CleanupResult>;
	scheduleCleanup(): void;
	stopCleanup(): void;
}

const DEFAULT_POLICY: RetentionPolicy = {
	sessionsMaxAge: 30 * 24 * 60 * 60 * 1000,
	auditMaxAge: 90 * 24 * 60 * 60 * 1000,
	cacheMaxAge: 24 * 60 * 60 * 1000,
	recordingsMaxAge: 7 * 24 * 60 * 60 * 1000,
	autoCleanup: true,
	cleanupIntervalMs: 24 * 60 * 60 * 1000
};

export class CouncilDataRetention extends Disposable implements ICouncilDataRetention {
	declare readonly _serviceBrand: undefined;

	private readonly _onCleanupExecuted = this._register(new Emitter<CleanupResult>());
	readonly onCleanupExecuted = this._onCleanupExecuted.event;

	private policy: RetentionPolicy;
	private cleanupInterval: any;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.policy = { ...DEFAULT_POLICY };

		const stored = this.storageService.get('council.retention.policy', StorageScope.WORKSPACE);
		if (stored) {
			try {
				this.policy = { ...DEFAULT_POLICY, ...JSON.parse(stored) };
			} catch {
				// Use default
			}
		}

		if (this.policy.autoCleanup) {
			this.scheduleCleanup();
		}
	}

	public setPolicy(policy: Partial<RetentionPolicy>): void {
		this.policy = { ...this.policy, ...policy };
		this.storageService.store(
			'council.retention.policy',
			JSON.stringify(this.policy),
			StorageScope.WORKSPACE,
			StorageTarget.USER
		);

		if (this.policy.autoCleanup) {
			this.scheduleCleanup();
		} else {
			this.stopCleanup();
		}

		this.logService.info('[Council Retention] Policy updated');
	}

	public getPolicy(): RetentionPolicy {
		return { ...this.policy };
	}

	public async executeCleanup(): Promise<CleanupResult> {
		const now = Date.now();
		let sessionsDeleted = 0;
		let auditEntriesDeleted = 0;
		let cacheEntriesDeleted = 0;
		let recordingsDeleted = 0;
		let spaceFreedBytes = 0;

		const sessionCutoff = now - this.policy.sessionsMaxAge;
		const auditCutoff = now - this.policy.auditMaxAge;
		const cacheCutoff = now - this.policy.cacheMaxAge;
		const recordingsCutoff = now - this.policy.recordingsMaxAge;

		const storageKeys = this.storageService.keys(StorageScope.WORKSPACE, StorageTarget.USER);

		for (const key of storageKeys) {
			if (!key.startsWith('council.')) continue;

			const value = this.storageService.get(key, StorageScope.WORKSPACE);
			if (!value) continue;

			try {
				const data = JSON.parse(value);
				let shouldDelete = false;

				if (key.includes('session') && data.startTime && data.startTime < sessionCutoff) {
					shouldDelete = true;
					sessionsDeleted++;
				} else if (key.includes('audit') && data.timestamp && data.timestamp < auditCutoff) {
					shouldDelete = true;
					auditEntriesDeleted++;
				} else if (key.includes('cache') && data.createdAt && data.createdAt < cacheCutoff) {
					shouldDelete = true;
					cacheEntriesDeleted++;
				} else if (key.includes('recording') && data.startTime && data.startTime < recordingsCutoff) {
					shouldDelete = true;
					recordingsDeleted++;
				}

				if (shouldDelete) {
					spaceFreedBytes += value.length;
					this.storageService.remove(key, StorageScope.WORKSPACE);
				}
			} catch {
				// Skip non-JSON values
			}
		}

		const result: CleanupResult = {
			sessionsDeleted,
			auditEntriesDeleted,
			cacheEntriesDeleted,
			recordingsDeleted,
			spaceFreedBytes,
			executedAt: now
		};

		this._onCleanupExecuted.fire(result);
		this.logService.info(`[Council Retention] Cleanup: ${sessionsDeleted} sessions, ${auditEntriesDeleted} audit entries deleted`);

		return result;
	}

	public scheduleCleanup(): void {
		this.stopCleanup();
		this.cleanupInterval = setInterval(() => {
			this.executeCleanup();
		}, this.policy.cleanupIntervalMs);
	}

	public stopCleanup(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = undefined;
		}
	}
}
