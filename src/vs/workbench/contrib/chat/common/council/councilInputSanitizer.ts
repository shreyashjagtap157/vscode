/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';

export const ICouncilInputSanitizer = createDecorator<ICouncilInputSanitizer>('councilInputSanitizer');

export interface SanitizationResult {
	readonly originalText: string;
	readonly sanitizedText: string;
	readonly threatsDetected: SanitizationThreat[];
	readonly isSafe: boolean;
}

export interface SanitizationThreat {
	readonly type: ThreatType;
	readonly severity: 'low' | 'medium' | 'high' | 'critical';
	readonly description: string;
	readonly matchedText: string;
	readonly action: 'removed' | 'escaped' | 'flagged' | 'blocked';
}

export type ThreatType = 'prompt_injection' | 'role_play' | 'system_leak' | 'command_injection' | 'xss' | 'markdown_injection' | 'context_escape' | 'token_smuggling';

export interface ICouncilInputSanitizer extends IDisposable {
	readonly _serviceBrand: undefined;

	sanitizeInput(text: string): SanitizationResult;
	sanitizeForPrompt(text: string): string;
	isBlocked(text: string): boolean;
	getThreatTypes(): ThreatType[];
}

const PROMPT_INJECTION_PATTERNS: Array<{
	type: ThreatType;
	severity: SanitizationThreat['severity'];
	pattern: RegExp;
	description: string;
	action: SanitizationThreat['action'];
}> = [
	{
		type: 'prompt_injection',
		severity: 'critical',
		pattern: /\b(ignore|disregard|forget|override)\s+(previous|all|the|your)\s+(instructions|rules|prompt|system|context|directives)/gi,
		description: 'Attempt to override system instructions',
		action: 'blocked'
	},
	{
		type: 'prompt_injection',
		severity: 'critical',
		pattern: /\b(new\s+instructions|from\s+now\s+on|you\s+are\s+now|act\s+as\s+if|pretend\s+to)\b/gi,
		description: 'Attempt to change agent behavior',
		action: 'blocked'
	},
	{
		type: 'prompt_injection',
		severity: 'high',
		pattern: /\b(system\s*:|developer\s*:|user\s*:)\s*\[/gi,
		description: 'Attempt to impersonate system role',
		action: 'escaped'
	},
	{
		type: 'role_play',
		severity: 'high',
		pattern: /\b(you\s+are\s+now|act\s+as|pretend\s+you\s+are|roleplay\s+as|simulate\s+being)\b/gi,
		description: 'Role-play attempt to bypass restrictions',
		action: 'flagged'
	},
	{
		type: 'system_leak',
		severity: 'high',
		pattern: /\b(repeat|show|reveal|output|print|echo)\s+(your\s+)?(instructions|prompt|system\s+prompt|rules|guidelines|configuration)/gi,
		description: 'Attempt to extract system prompt',
		action: 'blocked'
	},
	{
		type: 'system_leak',
		severity: 'medium',
		pattern: /\b(what\s+are\s+your\s+|tell\s+me\s+your\s+|list\s+your\s+)(instructions|rules|guidelines|capabilities|limitations)/gi,
		description: 'Probing for system capabilities',
		action: 'flagged'
	},
	{
		type: 'command_injection',
		severity: 'critical',
		pattern: /`[^`]*\b(rm\s+-rf|chmod\s+777|curl\s+.*\|\s*(bash|sh)|wget\s+.*\|\s*(bash|sh)|nc\s+-|mkfifo|\/dev\/tcp)/gi,
		description: 'Potentially dangerous command injection',
		action: 'blocked'
	},
	{
		type: 'xss',
		severity: 'high',
		pattern: /<script[^>]*>[\s\S]*?<\/script>/gi,
		description: 'Script injection attempt',
		action: 'escaped'
	},
	{
		type: 'xss',
		severity: 'medium',
		pattern: /javascript\s*:/gi,
		description: 'JavaScript protocol handler',
		action: 'escaped'
	},
	{
		type: 'markdown_injection',
		severity: 'medium',
		pattern: /!\[.*\]\(data:image\/[^)]+\)/gi,
		description: 'Data URI in markdown image',
		action: 'flagged'
	},
	{
		type: 'context_escape',
		severity: 'high',
		pattern: /```[\s\S]*```/g,
		description: 'Code block that could contain injection',
		action: 'flagged'
	},
	{
		type: 'token_smuggling',
		severity: 'high',
		pattern: /[\u200B-\u200D\uFEFF]/g,
		description: 'Zero-width characters (potential token smuggling)',
		action: 'removed'
	},
	{
		type: 'token_smuggling',
		severity: 'medium',
		pattern: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
		description: 'Control characters detected',
		action: 'removed'
	}
];

export class CouncilInputSanitizer extends Disposable implements ICouncilInputSanitizer {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public sanitizeInput(text: string): SanitizationResult {
		const threats: SanitizationThreat[] = [];
		let sanitized = text;

		for (const pattern of PROMPT_INJECTION_PATTERNS) {
			const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
			let match;

			while ((match = regex.exec(sanitized)) !== null) {
				const threat: SanitizationThreat = {
					type: pattern.type,
					severity: pattern.severity,
					description: pattern.description,
					matchedText: match[0],
					action: pattern.action
				};
				threats.push(threat);

				switch (pattern.action) {
					case 'blocked':
						sanitized = sanitized.replace(match[0], '[BLOCKED]');
						break;
					case 'escaped':
						sanitized = sanitized.replace(match[0], this.escapeHTML(match[0]));
						break;
					case 'removed':
						sanitized = sanitized.replace(match[0], '');
						break;
					case 'flagged':
						break;
				}
			}
		}

		const hasCriticalThreats = threats.some(t => t.severity === 'critical' && t.action === 'blocked');
		const isSafe = !hasCriticalThreats;

		if (threats.length > 0) {
			this.logService.warn(`[Council Input Sanitizer] Detected ${threats.length} threat(s) in input`);
		}

		return {
			originalText: text,
			sanitizedText: sanitized,
			threatsDetected: threats,
			isSafe
		};
	}

	public sanitizeForPrompt(text: string): string {
		const result = this.sanitizeInput(text);

		let sanitized = result.sanitizedText;

		sanitized = sanitized.replace(/<[^>]*>/g, (match) => {
			if (/<(script|iframe|object|embed|form|input)/i.test(match)) {
				return '[HTML_REMOVED]';
			}
			return match;
		});

		sanitized = sanitized.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
			return `\`\`\`${lang}\n[CODE_BLOCK]\n\`\`\``;
		});

		const normalizedWhitespace = sanitized.replace(/\s+/g, ' ').trim();

		return normalizedWhitespace;
	}

	public isBlocked(text: string): boolean {
		const result = this.sanitizeInput(text);
		return !result.isSafe;
	}

	public getThreatTypes(): ThreatType[] {
		return Array.from(new Set(PROMPT_INJECTION_PATTERNS.map(p => p.type)));
	}

	private escapeHTML(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#x27;');
	}
}
