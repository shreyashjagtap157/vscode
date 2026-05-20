/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';

export const ICouncilSmartAgentSelector = createDecorator<ICouncilSmartAgentSelector>('councilSmartAgentSelector');

export interface FileTypeInfo {
	readonly filename: string;
	readonly extension: string;
	readonly language: string;
	readonly category: FileCategory;
}

export type FileCategory = 'frontend' | 'backend' | 'database' | 'infrastructure' | 'test' | 'config' | 'documentation' | 'security' | 'data' | 'mobile' | 'other';

export interface AgentSelectionResult {
	selectedRoles: string[];
	skippedRoles: string[];
	readonly reason: string;
	readonly confidence: number;
}

export interface RoleFileMapping {
	readonly roleId: string;
	readonly matchingCategories: FileCategory[];
	readonly matchingLanguages: string[];
	readonly weight: number;
}

export interface ICouncilSmartAgentSelector extends IDisposable {
	readonly _serviceBrand: undefined;

	selectAgentsForFiles(files: string[], availableRoles: string[]): AgentSelectionResult;
	selectAgentsForPR(files: Array<{ filename: string; status: string }>, availableRoles: string[]): AgentSelectionResult;
	selectAgentsForRequest(request: string, availableRoles: string[]): AgentSelectionResult;
	getFileCategory(filename: string): FileCategory;
	getLanguageFromFilename(filename: string): string;
}

const ROLE_FILE_MAPPINGS: RoleFileMapping[] = [
	{
		roleId: 'frontend',
		matchingCategories: ['frontend'],
		matchingLanguages: ['javascript', 'typescript', 'html', 'css', 'scss', 'vue', 'jsx', 'tsx'],
		weight: 10
	},
	{
		roleId: 'backend',
		matchingCategories: ['backend', 'database'],
		matchingLanguages: ['python', 'java', 'csharp', 'go', 'rust', 'ruby', 'php', 'sql', 'graphql'],
		weight: 10
	},
	{
		roleId: 'security',
		matchingCategories: ['backend', 'frontend', 'database', 'infrastructure', 'security'],
		matchingLanguages: ['javascript', 'typescript', 'python', 'java', 'csharp', 'go', 'sql', 'yaml', 'json'],
		weight: 8
	},
	{
		roleId: 'qa',
		matchingCategories: ['test'],
		matchingLanguages: ['javascript', 'typescript', 'python', 'java', 'csharp'],
		weight: 9
	},
	{
		roleId: 'devops',
		matchingCategories: ['infrastructure', 'config'],
		matchingLanguages: ['yaml', 'json', 'toml', 'dockerfile', 'shell', 'powershell', 'hcl', 'makefile'],
		weight: 10
	},
	{
		roleId: 'performance',
		matchingCategories: ['backend', 'frontend', 'database'],
		matchingLanguages: ['javascript', 'typescript', 'python', 'java', 'csharp', 'go', 'rust', 'sql'],
		weight: 7
	},
	{
		roleId: 'architect',
		matchingCategories: ['backend', 'frontend', 'infrastructure', 'database'],
		matchingLanguages: ['typescript', 'java', 'csharp', 'go', 'python', 'yaml', 'json'],
		weight: 6
	},
	{
		roleId: 'database',
		matchingCategories: ['database', 'data'],
		matchingLanguages: ['sql', 'graphql', 'python', 'javascript', 'typescript'],
		weight: 10
	},
	{
		roleId: 'docs',
		matchingCategories: ['documentation'],
		matchingLanguages: ['markdown', 'rst', 'asciidoc'],
		weight: 10
	}
];

const FILE_CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: FileCategory }> = [
	{ pattern: /\.(js|jsx|ts|tsx|vue|svelte|html|css|scss|sass|less|styl)$/i, category: 'frontend' },
	{ pattern: /\.(py|java|cs|go|rs|rb|php|scala|kt|swift)$/i, category: 'backend' },
	{ pattern: /\.(sql|graphql|gql|mongo)$/i, category: 'database' },
	{ pattern: /\.(yml|yaml|toml|ini|conf|cfg|env)$/i, category: 'config' },
	{ pattern: /\.(dockerfile|Dockerfile|docker-compose|Makefile|CMakeLists|Jenkinsfile|Vagrantfile)$/i, category: 'infrastructure' },
	{ pattern: /\.(tf|tfvars|hcl|pulumi)$/i, category: 'infrastructure' },
	{ pattern: /\.(test|spec|e2e|integration|unit)\.(js|ts|jsx|tsx|py|java|cs|go|rb)$/i, category: 'test' },
	{ pattern: /\.(md|rst|adoc|txt|docx)$/i, category: 'documentation' },
	{ pattern: /\.(pem|key|cert|crt|p12|pfx|jks|keystore)$/i, category: 'security' },
	{ pattern: /\.(csv|json|xml|parquet|avro)$/i, category: 'data' },
	{ pattern: /\.(swift|kt|m|mm)$/i, category: 'mobile' }
];

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
	'javascript': ['.js', '.jsx', '.mjs', '.cjs'],
	'typescript': ['.ts', '.tsx', '.mts', '.cts'],
	'python': ['.py', '.pyw', '.pyi'],
	'java': ['.java'],
	'csharp': ['.cs', '.csx'],
	'go': ['.go'],
	'rust': ['.rs'],
	'ruby': ['.rb'],
	'php': ['.php'],
	'sql': ['.sql'],
	'html': ['.html', '.htm'],
	'css': ['.css'],
	'scss': ['.scss'],
	'yaml': ['.yml', '.yaml'],
	'json': ['.json'],
	'markdown': ['.md'],
	'shell': ['.sh', '.bash', '.zsh'],
	'powershell': ['.ps1', '.psm1', '.psd1'],
	'dockerfile': ['Dockerfile', '.dockerfile'],
	'graphql': ['.graphql', '.gql'],
	'vue': ['.vue'],
	'svelte': ['.svelte']
};

const REQUEST_KEYWORD_MAPPINGS: Record<string, string[]> = {
	'security': ['security', 'vulnerability', 'auth', 'authentication', 'authorization', 'xss', 'csrf', 'injection', 'encryption', 'token', 'password', 'secret'],
	'frontend': ['ui', 'frontend', 'component', 'css', 'style', 'html', 'react', 'vue', 'angular', 'svelte', 'responsive', 'layout'],
	'backend': ['api', 'backend', 'server', 'endpoint', 'route', 'controller', 'service', 'middleware', 'database'],
	'performance': ['performance', 'slow', 'optimize', 'memory', 'cpu', 'bottleneck', 'latency', 'throughput', 'cache'],
	'qa': ['test', 'testing', 'spec', 'assert', 'coverage', 'unit test', 'integration test', 'e2e'],
	'devops': ['deploy', 'ci', 'cd', 'pipeline', 'docker', 'kubernetes', 'infrastructure', 'monitoring', 'logging'],
	'architect': ['architecture', 'design', 'pattern', 'refactor', 'structure', 'modular', 'scalable'],
	'database': ['database', 'query', 'schema', 'migration', 'index', 'sql', 'nosql', 'orm']
};

export class CouncilSmartAgentSelector extends Disposable implements ICouncilSmartAgentSelector {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public selectAgentsForFiles(files: string[], availableRoles: string[]): AgentSelectionResult {
		if (files.length === 0) {
			return this.getDefaultSelection(availableRoles);
		}

		const categoryCounts = new Map<FileCategory, number>();
		const languageCounts = new Map<string, number>();

		for (const file of files) {
			const category = this.getFileCategory(file);
			const language = this.getLanguageFromFilename(file);

			categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
			languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
		}

		const roleScores = new Map<string, number>();
		for (const mapping of ROLE_FILE_MAPPINGS) {
			if (!availableRoles.includes(mapping.roleId)) continue;

			let score = 0;
			for (const [category, count] of categoryCounts) {
				if (mapping.matchingCategories.includes(category)) {
					score += count * mapping.weight;
				}
			}
			for (const [language, count] of languageCounts) {
				if (mapping.matchingLanguages.includes(language.toLowerCase())) {
					score += count * mapping.weight * 0.5;
				}
			}

			if (score > 0) {
				roleScores.set(mapping.roleId, score);
			}
		}

		const sortedRoles = Array.from(roleScores.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([roleId]) => roleId);

		const selectedRoles = sortedRoles.length > 0 ? sortedRoles : this.getDefaultRoles(availableRoles);
		const skippedRoles = availableRoles.filter(r => !selectedRoles.includes(r));
		const maxScore = Math.max(...Array.from(roleScores.values()), 1);
		const avgScore = Array.from(roleScores.values()).reduce((a, b) => a + b, 0) / roleScores.size;
		const confidence = Math.min(avgScore / maxScore, 1.0);

		const result: AgentSelectionResult = {
			selectedRoles,
			skippedRoles,
			reason: `Selected ${selectedRoles.length} agents based on ${files.length} files across ${categoryCounts.size} categories`,
			confidence
		};

		this.logService.info(`[Council Smart Selector] ${result.reason}`);
		return result;
	}

	public selectAgentsForPR(
		files: Array<{ filename: string; status: string }>,
		availableRoles: string[]
	): AgentSelectionResult {
		const filenames = files.map(f => f.filename);
		const result = this.selectAgentsForFiles(filenames, availableRoles);

		const hasTests = filenames.some(f => /\.test\./.test(f) || /\.spec\./.test(f));
		const hasSecurityFiles = filenames.some(f => /\.(pem|key|cert|crt)$/.test(f));
		const hasConfigFiles = filenames.some(f => /\.(yml|yaml|toml|dockerfile|tf)$/i.test(f));

		if (hasTests && !result.selectedRoles.includes('qa')) {
			if (availableRoles.includes('qa')) {
				result.selectedRoles.push('qa');
				result.skippedRoles = result.skippedRoles.filter(r => r !== 'qa');
			}
		}

		if (hasSecurityFiles && !result.selectedRoles.includes('security')) {
			if (availableRoles.includes('security')) {
				result.selectedRoles.push('security');
				result.skippedRoles = result.skippedRoles.filter(r => r !== 'security');
			}
		}

		if (hasConfigFiles && !result.selectedRoles.includes('devops')) {
			if (availableRoles.includes('devops')) {
				result.selectedRoles.push('devops');
				result.skippedRoles = result.skippedRoles.filter(r => r !== 'devops');
			}
		}

		return result;
	}

	public selectAgentsForRequest(request: string, availableRoles: string[]): AgentSelectionResult {
		const lowerRequest = request.toLowerCase();
		const roleScores = new Map<string, number>();

		for (const [role, keywords] of Object.entries(REQUEST_KEYWORD_MAPPINGS)) {
			if (!availableRoles.includes(role)) continue;

			let score = 0;
			for (const keyword of keywords) {
				const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
				const matches = lowerRequest.match(regex);
				if (matches) {
					score += matches.length;
				}
			}

			if (score > 0) {
				roleScores.set(role, score);
			}
		}

		const sortedRoles = Array.from(roleScores.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([roleId]) => roleId);

		const selectedRoles = sortedRoles.length > 0 ? sortedRoles : this.getDefaultRoles(availableRoles);
		const skippedRoles = availableRoles.filter(r => !selectedRoles.includes(r));
		const maxScore = Math.max(...Array.from(roleScores.values()), 1);
		const avgScore = Array.from(roleScores.values()).reduce((a, b) => a + b, 0) / roleScores.size;
		const confidence = Math.min(avgScore / maxScore, 1.0);

		return {
			selectedRoles,
			skippedRoles,
			reason: `Selected ${selectedRoles.length} agents based on request keywords`,
			confidence
		};
	}

	public getFileCategory(filename: string): FileCategory {
		for (const { pattern, category } of FILE_CATEGORY_PATTERNS) {
			if (pattern.test(filename)) {
				return category;
			}
		}
		return 'other';
	}

	public getLanguageFromFilename(filename: string): string {
		const basename = filename.split('/').pop() ?? filename;
		const extension = '.' + (basename.split('.').pop() ?? '').toLowerCase();

		for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
			if (extensions.some(ext => ext.toLowerCase() === extension || ext === basename)) {
				return language;
			}
		}

		return 'unknown';
	}

	private getDefaultSelection(availableRoles: string[]): AgentSelectionResult {
		const defaultRoles = this.getDefaultRoles(availableRoles);
		return {
			selectedRoles: defaultRoles,
			skippedRoles: availableRoles.filter(r => !defaultRoles.includes(r)),
			reason: 'Using default agent selection (no files provided)',
			confidence: 0.5
		};
	}

	private getDefaultRoles(availableRoles: string[]): string[] {
		const preferredOrder = ['architect', 'backend', 'security', 'qa'];
		return preferredOrder.filter(r => availableRoles.includes(r));
	}
}
