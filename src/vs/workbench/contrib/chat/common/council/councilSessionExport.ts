/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { CouncilSession, CouncilResult, DebateRecord } from './councilOrchestrator.js';
import { CouncilAgentProfile } from './agentProfileManager.js';

export const ICouncilSessionExport = createDecorator<ICouncilSessionExport>('councilSessionExport');

export interface ExportedSession {
	readonly version: string;
	readonly exportedAt: number;
	readonly session: CouncilSession;
	readonly result?: CouncilResult;
	readonly profiles: CouncilAgentProfile[];
	readonly debates: DebateRecord[];
}

export interface ImportResult {
	readonly success: boolean;
	readonly sessionId: string;
	readonly errors: string[];
}

export interface ICouncilSessionExport extends IDisposable {
	readonly _serviceBrand: undefined;

	exportSession(session: CouncilSession, result?: CouncilResult, profiles?: CouncilAgentProfile[]): string;
	exportMultipleSessions(sessions: CouncilSession[], results?: CouncilResult[]): string;
	importSession(data: string): ImportResult;
	validateExport(data: string): boolean;
	sanitizeForExport(data: string): string;
}

export class CouncilSessionExport extends Disposable implements ICouncilSessionExport {
	declare readonly _serviceBrand: undefined;

	private readonly currentVersion = '1.0.0';

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public exportSession(session: CouncilSession, result?: CouncilResult, profiles: CouncilAgentProfile[] = []): string {
		const exported: ExportedSession = {
			version: this.currentVersion,
			exportedAt: Date.now(),
			session: this.sanitizeSession(session),
			result: result ? this.sanitizeResult(result) : undefined,
			profiles: profiles.map(p => this.sanitizeProfile(p)),
			debates: result?.debateRecords ?? []
		};

		const json = JSON.stringify(exported, null, 2);
		return this.sanitizeForExport(json);
	}

	public exportMultipleSessions(sessions: CouncilSession[], results: CouncilResult[] = []): string {
		const exported = {
			version: this.currentVersion,
			exportedAt: Date.now(),
			count: sessions.length,
			sessions: sessions.map(s => this.sanitizeSession(s)),
			results: results.map(r => this.sanitizeResult(r))
		};

		return JSON.stringify(exported, null, 2);
	}

	public importSession(data: string): ImportResult {
		try {
			const parsed = JSON.parse(data) as ExportedSession;

			if (!parsed.version || !parsed.session) {
				return { success: false, sessionId: '', errors: ['Invalid export format'] };
			}

			if (parsed.version !== this.currentVersion) {
				this.logService.warn(`[Council Export] Version mismatch: ${parsed.version} vs ${this.currentVersion}`);
			}

			return {
				success: true,
				sessionId: parsed.session.sessionId,
				errors: []
			};
		} catch (error) {
			return {
				success: false,
				sessionId: '',
				errors: [`Parse error: ${error}`]
			};
		}
	}

	public validateExport(data: string): boolean {
		try {
			const parsed = JSON.parse(data);
			return parsed.version !== undefined && parsed.session !== undefined;
		} catch {
			return false;
		}
	}

	public sanitizeForExport(data: string): string {
		return data
			.replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, '[REDACTED]')
			.replace(/ghp_[A-Za-z0-9_]{36}/g, '[REDACTED]')
			.replace(/-----BEGIN.*?PRIVATE KEY-----/g, '[REDACTED]');
	}

	private sanitizeSession(session: CouncilSession): CouncilSession {
		return {
			...session,
			originalRequest: session.originalRequest.substring(0, 5000),
			sharedScratchpad: session.sharedScratchpad.map(s => s.substring(0, 2000))
		};
	}

	private sanitizeResult(result: CouncilResult): CouncilResult {
		return {
			...result,
			finalResponse: result.finalResponse.substring(0, 10000)
		};
	}

	private sanitizeProfile(profile: CouncilAgentProfile): CouncilAgentProfile {
		return {
			...profile,
			baseSystemPrompt: profile.baseSystemPrompt.substring(0, 2000)
		};
	}
}
