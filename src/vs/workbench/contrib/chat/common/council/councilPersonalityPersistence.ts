/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { CouncilAgentProfile } from './agentProfileManager.js';

export const ICouncilPersonalityPersistence = createDecorator<ICouncilPersonalityPersistence>('councilPersonalityPersistence');

export interface PersonalityAdaptation {
	readonly roleId: string;
	readonly temperatureAdjustment: number;
	readonly tokenAdjustment: number;
	readonly priorityWeightAdjustment: number;
	readonly preferredToolsAdjustment: string[];
	successCount: number;
	failureCount: number;
	lastAdapted: number;
}

export interface ICouncilPersonalityPersistence extends IDisposable {
	readonly _serviceBrand: undefined;

	saveAdaptation(roleId: string, adaptation: PersonalityAdaptation): void;
	getAdaptation(roleId: string): PersonalityAdaptation | undefined;
	getAllAdaptations(): PersonalityAdaptation[];
	recordSuccess(roleId: string): void;
	recordFailure(roleId: string): void;
	applyToProfile(profile: CouncilAgentProfile): CouncilAgentProfile;
	clearAdaptations(roleId?: string): void;
}

export class CouncilPersonalityPersistence extends Disposable implements ICouncilPersonalityPersistence {
	declare readonly _serviceBrand: undefined;

	private readonly adaptations: Map<string, PersonalityAdaptation>;
	private readonly storageKey = 'council.personalityAdaptations';

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.adaptations = new Map();
		this.loadAdaptations();
	}

	public saveAdaptation(roleId: string, adaptation: PersonalityAdaptation): void {
		this.adaptations.set(roleId, adaptation);
		this.saveToStorage();
		this.logService.info(`[Council Personality] Saved adaptation for ${roleId}`);
	}

	public getAdaptation(roleId: string): PersonalityAdaptation | undefined {
		return this.adaptations.get(roleId);
	}

	public getAllAdaptations(): PersonalityAdaptation[] {
		return Array.from(this.adaptations.values());
	}

	public recordSuccess(roleId: string): void {
		const adaptation = this.adaptations.get(roleId);
		if (adaptation) {
			adaptation.successCount++;
			adaptation.lastAdapted = Date.now();
			this.saveToStorage();
		}
	}

	public recordFailure(roleId: string): void {
		const adaptation = this.adaptations.get(roleId);
		if (adaptation) {
			adaptation.failureCount++;
			adaptation.lastAdapted = Date.now();
			this.saveToStorage();
		}
	}

	public applyToProfile(profile: CouncilAgentProfile): CouncilAgentProfile {
		const adaptation = this.adaptations.get(profile.roleId);
		if (!adaptation) return profile;

		return {
			...profile,
			temperature: Math.max(0, Math.min(1, (profile.temperature ?? 0.7) + adaptation.temperatureAdjustment)),
			maxTokens: Math.max(1000, (profile.maxTokens ?? 4000) + adaptation.tokenAdjustment),
			priorityWeight: Math.max(1, profile.priorityWeight + adaptation.priorityWeightAdjustment),
			preferredTools: [...new Set([...profile.preferredTools, ...adaptation.preferredToolsAdjustment])]
		};
	}

	public clearAdaptations(roleId?: string): void {
		if (roleId) {
			this.adaptations.delete(roleId);
		} else {
			this.adaptations.clear();
		}
		this.saveToStorage();
	}

	private loadAdaptations(): void {
		try {
			const stored = this.storageService.get(this.storageKey, StorageScope.WORKSPACE);
			if (stored) {
				const data = JSON.parse(stored) as PersonalityAdaptation[];
				for (const adaptation of data) {
					this.adaptations.set(adaptation.roleId, adaptation);
				}
				this.logService.info(`[Council Personality] Loaded ${data.length} adaptations`);
			}
		} catch (error) {
			this.logService.warn(`[Council Personality] Failed to load adaptations: ${error}`);
		}
	}

	private saveToStorage(): void {
		try {
			const data = Array.from(this.adaptations.values());
			this.storageService.store(
				this.storageKey,
				JSON.stringify(data),
				StorageScope.WORKSPACE,
				StorageTarget.USER
			);
		} catch (error) {
			this.logService.error(`[Council Personality] Failed to save adaptations: ${error}`);
		}
	}
}
