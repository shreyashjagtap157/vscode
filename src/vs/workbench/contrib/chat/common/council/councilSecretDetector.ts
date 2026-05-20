/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { Event, Emitter } from '../../../../../base/common/event.js';

export const ICouncilSecretDetector = createDecorator<ICouncilSecretDetector>('councilSecretDetector');

export type SecretType = 'api_key' | 'password' | 'token' | 'private_key' | 'connection_string' | 'credential' | 'certificate' | 'aws_key' | 'github_token' | 'slack_token' | 'generic_secret';

export type SecretSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecretFinding {
	readonly findingId: string;
	readonly type: SecretType;
	readonly severity: SecretSeverity;
	readonly description: string;
	readonly file?: string;
	readonly line?: number;
	readonly matchedPattern: string;
	readonly recommendation: string;
	readonly cweId?: string;
}

export interface SecretScanResult {
	readonly scanId: string;
	readonly findings: SecretFinding[];
	readonly scannedAt: number;
	readonly filesScanned: number;
	readonly linesScanned: number;
}

export interface ICouncilSecretDetector extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onSecretFound: Event<SecretFinding>;

	scanText(text: string, file?: string): SecretScanResult;
	scanDiff(diff: string): SecretScanResult;
	scanFiles(content: Map<string, string>): SecretScanResult;
	getSecretTypes(): SecretType[];
}

const SECRET_PATTERNS: Array<{
	type: SecretType;
	severity: SecretSeverity;
	pattern: RegExp;
	description: string;
	recommendation: string;
	cweId?: string;
}> = [
	{
		type: 'aws_key',
		severity: 'critical',
		pattern: /AKIA[0-9A-Z]{16}/g,
		description: 'AWS Access Key ID detected',
		recommendation: 'Use AWS IAM roles or environment variables instead of hardcoding keys',
		cweId: 'CWE-798'
	},
	{
		type: 'aws_key',
		severity: 'critical',
		pattern: /aws_secret_access_key\s*=\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi,
		description: 'AWS Secret Access Key detected',
		recommendation: 'Use AWS IAM roles or AWS Secrets Manager',
		cweId: 'CWE-798'
	},
	{
		type: 'github_token',
		severity: 'critical',
		pattern: /ghp_[A-Za-z0-9_]{36}/g,
		description: 'GitHub Personal Access Token detected',
		recommendation: 'Use GitHub Apps or environment variables for authentication',
		cweId: 'CWE-798'
	},
	{
		type: 'github_token',
		severity: 'high',
		pattern: /gho_[A-Za-z0-9_]{36}/g,
		description: 'GitHub OAuth Access Token detected',
		recommendation: 'Store tokens securely and use environment variables',
		cweId: 'CWE-798'
	},
	{
		type: 'slack_token',
		severity: 'high',
		pattern: /xox[baprs]-[0-9a-zA-Z-]+/g,
		description: 'Slack token detected',
		recommendation: 'Use Slack App configuration and environment variables',
		cweId: 'CWE-798'
	},
	{
		type: 'private_key',
		severity: 'critical',
		pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
		description: 'Private key detected',
		recommendation: 'Never commit private keys. Use a secrets manager or key vault',
		cweId: 'CWE-321'
	},
	{
		type: 'private_key',
		severity: 'critical',
		pattern: /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/g,
		description: 'EC Private Key detected',
		recommendation: 'Never commit private keys. Use a secrets manager or key vault',
		cweId: 'CWE-321'
	},
	{
		type: 'connection_string',
		severity: 'high',
		pattern: /(mongodb|postgres|mysql|redis|amqp):\/\/[^\s]+:[^\s]+@[^\s]+/gi,
		description: 'Database connection string with credentials detected',
		recommendation: 'Use environment variables or a connection string manager',
		cweId: 'CWE-798'
	},
	{
		type: 'api_key',
		severity: 'high',
		pattern: /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9]{20,}['"]?/gi,
		description: 'API key detected',
		recommendation: 'Store API keys in environment variables or a secrets manager',
		cweId: 'CWE-798'
	},
	{
		type: 'password',
		severity: 'high',
		pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/gi,
		description: 'Hardcoded password detected',
		recommendation: 'Use environment variables, keychain, or a password manager',
		cweId: 'CWE-259'
	},
	{
		type: 'token',
		severity: 'high',
		pattern: /(bearer|token|auth)\s+['"]?[A-Za-z0-9\-._~+\/]+=*['"]?/gi,
		description: 'Authentication token detected',
		recommendation: 'Use secure token storage and rotation',
		cweId: 'CWE-798'
	},
	{
		type: 'generic_secret',
		severity: 'medium',
		pattern: /(secret|credential|access_token|refresh_token)\s*[:=]\s*['"]?[A-Za-z0-9]{16,}['"]?/gi,
		description: 'Potential secret or credential detected',
		recommendation: 'Verify if this is a secret and move to secure storage',
		cweId: 'CWE-798'
	},
	{
		type: 'generic_secret',
		severity: 'medium',
		pattern: /dotenv|\.env|env\s*=\s*{/gi,
		description: 'Environment variable configuration detected',
		recommendation: 'Ensure .env files are in .gitignore and not committed',
		cweId: 'CWE-321'
	}
];

const FALSE_POSITIVE_PATTERNS: RegExp[] = [
	/example|sample|test|dummy|placeholder|fake|mock|todo|fixme/i,
	/your[_-]?(api[_-]?key|token|secret|password)/i,
	/<[^>]+>/,
	/\$\{[^}]+\}/,
	/\{\{[^}]+\}\}/,
	/\$[A-Z_]+/,
	/process\.env\./,
	/getenv\(/,
	/System\.getenv\(/
];

export class CouncilSecretDetector extends Disposable implements ICouncilSecretDetector {
	declare readonly _serviceBrand: undefined;

	private readonly _onSecretFound = this._register(new Emitter<SecretFinding>());
	readonly onSecretFound = this._onSecretFound.event;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public scanText(text: string, file?: string): SecretScanResult {
		const findings: SecretFinding[] = [];
		const lines = text.split('\n');

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex];

			for (const pattern of SECRET_PATTERNS) {
				let match;
				const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
				while ((match = regex.exec(line)) !== null) {
					if (this.isFalsePositive(match[0])) continue;

					const finding: SecretFinding = {
						findingId: `secret-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
						type: pattern.type,
						severity: pattern.severity,
						description: pattern.description,
						file,
						line: lineIndex + 1,
						matchedPattern: this.maskSecret(match[0]),
						recommendation: pattern.recommendation,
						cweId: pattern.cweId
					};

					findings.push(finding);
					this._onSecretFound.fire(finding);
				}
			}
		}

		const result: SecretScanResult = {
			scanId: `scan-${Date.now()}`,
			findings,
			scannedAt: Date.now(),
			filesScanned: file ? 1 : 0,
			linesScanned: lines.length
		};

		if (findings.length > 0) {
			this.logService.warn(`[Council Secret Detector] Found ${findings.length} secret(s)${file ? ` in ${file}` : ''}`);
		}

		return result;
	}

	public scanDiff(diff: string): SecretScanResult {
		const findings: SecretFinding[] = [];
		const lines = diff.split('\n');
		let currentFile: string | undefined;
		let addedLines = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
			if (fileMatch) {
				currentFile = fileMatch[1];
			}

			if (line.startsWith('+') && !line.startsWith('+++')) {
				addedLines++;
				const lineContent = line.substring(1);

				for (const pattern of SECRET_PATTERNS) {
					const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
					let match;
					while ((match = regex.exec(lineContent)) !== null) {
						if (this.isFalsePositive(match[0])) continue;

						findings.push({
							findingId: `secret-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
							type: pattern.type,
							severity: pattern.severity,
							description: pattern.description,
							file: currentFile,
							line: i + 1,
							matchedPattern: this.maskSecret(match[0]),
							recommendation: pattern.recommendation,
							cweId: pattern.cweId
						});
					}
				}
			}
		}

		return {
			scanId: `scan-${Date.now()}`,
			findings,
			scannedAt: Date.now(),
			filesScanned: new Set(findings.map(f => f.file).filter(Boolean)).size,
			linesScanned: addedLines
		};
	}

	public scanFiles(content: Map<string, string>): SecretScanResult {
		const allFindings: SecretFinding[] = [];
		let totalLines = 0;

		for (const [file, text] of content) {
			const result = this.scanText(text, file);
			allFindings.push(...result.findings);
			totalLines += result.linesScanned;
		}

		return {
			scanId: `scan-${Date.now()}`,
			findings: allFindings,
			scannedAt: Date.now(),
			filesScanned: content.size,
			linesScanned: totalLines
		};
	}

	public getSecretTypes(): SecretType[] {
		return Array.from(new Set(SECRET_PATTERNS.map(p => p.type)));
	}

	private isFalsePositive(matched: string): boolean {
		return FALSE_POSITIVE_PATTERNS.some(pattern => pattern.test(matched));
	}

	private maskSecret(secret: string): string {
		if (secret.length <= 8) return '***';
		return secret.substring(0, 4) + '***' + secret.substring(secret.length - 4);
	}
}
