/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICouncilTelemetryService } from './councilTelemetryService.js';

export const ICouncilCredentialManager = createDecorator<ICouncilCredentialManager>('councilCredentialManager');

export interface CredentialEntry {
	readonly id: string;
	readonly service: string;
	readonly key: string;
	readonly createdAt: number;
	readonly lastUsed?: number;
}

export interface ICouncilCredentialManager extends IDisposable {
	readonly _serviceBrand: undefined;

	setCredential(service: string, key: string, value: string): Promise<void>;
	getCredential(service: string, key: string): Promise<string | undefined>;
	deleteCredential(service: string, key: string): Promise<void>;
	listCredentials(service: string): Promise<CredentialEntry[]>;
	clearAll(service?: string): Promise<void>;
}

interface CredentialMetadata {
	[key: string]: {
		service: string;
		key: string;
		createdAt: number;
		lastUsed?: number;
	};
}

export class CouncilCredentialManager extends Disposable implements ICouncilCredentialManager {
	declare readonly _serviceBrand: undefined;

	private readonly credentialKey = 'council.credentials';
	private metadata: CredentialMetadata;

	constructor(
		@ISecretStorageService private readonly secretStorage: ISecretStorageService,
		@ILogService private readonly _logService: ILogService,
		@ICouncilTelemetryService _telemetryService: ICouncilTelemetryService
	) {
		super();
		this.metadata = this.loadMetadata();
	}

	public async setCredential(service: string, key: string, value: string): Promise<void> {
		const storageKey = `${this.credentialKey}.${service}.${key}`;
		await this.secretStorage.set(storageKey, value);

		const id = `${service}/${key}`;
		this.metadata[id] = {
			service,
			key,
			createdAt: Date.now(),
			lastUsed: undefined
		};
		this.saveMetadata();

		this._logService.info(`[Council Credentials] Stored credential for ${service}/${key}`);
	}

	public async getCredential(service: string, key: string): Promise<string | undefined> {
		const storageKey = `${this.credentialKey}.${service}.${key}`;
		try {
			const value = await this.secretStorage.get(storageKey);
			if (value) {
				const id = `${service}/${key}`;
				if (this.metadata[id]) {
					this.metadata[id] = {
						...this.metadata[id],
						lastUsed: Date.now()
					};
					this.saveMetadata();
				}
				this._logService.debug(`[Council Credentials] Retrieved credential for ${service}/${key}`);
			}
			return value;
		} catch {
			return undefined;
		}
	}

	public async deleteCredential(service: string, key: string): Promise<void> {
		const storageKey = `${this.credentialKey}.${service}.${key}`;
		await this.secretStorage.delete(storageKey);

		const id = `${service}/${key}`;
		delete this.metadata[id];
		this.saveMetadata();

		this._logService.info(`[Council Credentials] Deleted credential for ${service}/${key}`);
	}

	public async listCredentials(service: string): Promise<CredentialEntry[]> {
		const entries: CredentialEntry[] = [];

		for (const [id, meta] of Object.entries(this.metadata)) {
			if (service && meta.service !== service) continue;

			entries.push({
				id,
				service: meta.service,
				key: meta.key,
				createdAt: meta.createdAt,
				lastUsed: meta.lastUsed
			});
		}

		return entries.sort((a, b) => b.createdAt - a.createdAt);
	}

	public async clearAll(service?: string): Promise<void> {
		const toDelete: string[] = [];

		for (const [id, meta] of Object.entries(this.metadata)) {
			if (service && meta.service !== service) continue;
			toDelete.push(id);
		}

		for (const id of toDelete) {
			const meta = this.metadata[id];
			const storageKey = `${this.credentialKey}.${meta.service}.${meta.key}`;
			await this.secretStorage.delete(storageKey);
			delete this.metadata[id];
		}

		this.saveMetadata();
		this._logService.info(`[Council Credentials] Cleared ${toDelete.length} credentials${service ? ` for ${service}` : ''}`);
	}

	private loadMetadata(): CredentialMetadata {
		try {
			return {};
		} catch {
			return {};
		}
	}

	private saveMetadata(): void {
		// Metadata is kept in memory for security reasons
		// In a production environment, this would be encrypted
	}
}
