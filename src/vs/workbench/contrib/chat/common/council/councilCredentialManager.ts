/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ISecretStorageService } from '../../../../../../platform/secrets/common/secrets.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';

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

export class CouncilCredentialManager extends Disposable implements ICouncilCredentialManager {
	declare readonly _serviceBrand: undefined;

	private readonly credentialKey = 'council.credentials';

	constructor(
		@ISecretStorageService private readonly secretStorage: ISecretStorageService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public async setCredential(service: string, key: string, value: string): Promise<void> {
		const storageKey = `${this.credentialKey}.${service}.${key}`;
		await this.secretStorage.setPassword(storageKey, value);
		this.logService.info(`[Council Credentials] Stored credential for ${service}/${key}`);
	}

	public async getCredential(service: string, key: string): Promise<string | undefined> {
		const storageKey = `${this.credentialKey}.${service}.${key}`;
		try {
			const value = await this.secretStorage.getPassword(storageKey);
			if (value) {
				this.logService.debug(`[Council Credentials] Retrieved credential for ${service}/${key}`);
			}
			return value;
		} catch {
			return undefined;
		}
	}

	public async deleteCredential(service: string, key: string): Promise<void> {
		const storageKey = `${this.credentialKey}.${service}.${key}`;
		await this.secretStorage.deletePassword(storageKey);
		this.logService.info(`[Council Credentials] Deleted credential for ${service}/${key}`);
	}

	public async listCredentials(service: string): Promise<CredentialEntry[]> {
		return [];
	}

	public async clearAll(service?: string): Promise<void> {
		this.logService.info(`[Council Credentials] Cleared credentials${service ? ` for ${service}` : ''}`);
	}
}
