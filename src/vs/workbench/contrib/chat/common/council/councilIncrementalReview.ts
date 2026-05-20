/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';

export const ICouncilIncrementalReview = createDecorator<ICouncilIncrementalReview>('councilIncrementalReview');

export interface FileChange {
	readonly filename: string;
	readonly status: 'added' | 'modified' | 'removed' | 'renamed';
	readonly additions: number;
	readonly deletions: number;
	readonly patch?: string;
}

export interface IncrementalReviewScope {
	readonly changedFiles: FileChange[];
	readonly relatedFiles: string[];
	readonly affectedModules: string[];
	readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface ReviewFocus {
	readonly files: string[];
	readonly priorities: Map<string, 'high' | 'medium' | 'low'>;
	readonly recommendedRoles: string[];
	readonly estimatedEffort: 'quick' | 'moderate' | 'extensive';
}

export interface ICouncilIncrementalReview extends IDisposable {
	readonly _serviceBrand: undefined;

	analyzeScope(changes: FileChange[], codebaseStructure?: Map<string, string[]>): IncrementalReviewScope;
	determineFocus(scope: IncrementalReviewScope, availableRoles: string[]): ReviewFocus;
	getChangedContent(changes: FileChange[], fullDiff: string): string;
	isHighRisk(change: FileChange): boolean;
	getRelatedFiles(filename: string, codebaseStructure?: Map<string, string[]>): string[];
}

const HIGH_RISK_PATTERNS: RegExp[] = [
	/\/auth\//i,
	/\/security\//i,
	/\/crypto\//i,
	/\/payment\//i,
	/\/admin\//i,
	/\.env/i,
	/\.config\./i,
	/webpack\.config/i,
	/tsconfig\.json/i,
	/package\.json/i,
	/Cargo\.toml/i,
	/go\.mod/i,
	/requirements\.txt/i,
	/\.github\/workflows/i,
	/Dockerfile/i,
	/docker-compose/i
];

const MODULE_PATTERNS: Array<{ pattern: RegExp; module: string }> = [
	{ pattern: /\/src\/components\//i, module: 'frontend-components' },
	{ pattern: /\/src\/pages\//i, module: 'frontend-pages' },
	{ pattern: /\/src\/services\//i, module: 'backend-services' },
	{ pattern: /\/src\/api\//i, module: 'api-layer' },
	{ pattern: /\/src\/models\//i, module: 'data-models' },
	{ pattern: /\/src\/utils\//i, module: 'utilities' },
	{ pattern: /\/src\/middleware\//i, module: 'middleware' },
	{ pattern: /\/src\/config\//i, module: 'configuration' },
	{ pattern: /\/src\/tests?\//i, module: 'tests' },
	{ pattern: /\/src\/styles?\//i, module: 'styles' },
	{ pattern: /\/src\/hooks\//i, module: 'hooks' },
	{ pattern: /\/src\/store\//i, module: 'state-management' },
	{ pattern: /\/src\/db\//i, module: 'database' },
	{ pattern: /\/src\/migrations?\//i, module: 'migrations' }
];

export class CouncilIncrementalReview extends Disposable implements ICouncilIncrementalReview {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	public analyzeScope(
		changes: FileChange[],
		codebaseStructure?: Map<string, string[]>
	): IncrementalReviewScope {
		const relatedFiles = new Set<string>();
		const affectedModules = new Set<string>();
		let maxRisk: IncrementalReviewScope['riskLevel'] = 'low';

		for (const change of changes) {
			if (this.isHighRisk(change)) {
				maxRisk = 'high';
			}

			const module = this.detectModule(change.filename);
			if (module) {
				affectedModules.add(module);
			}

			const related = this.getRelatedFiles(change.filename, codebaseStructure);
			for (const f of related) {
				relatedFiles.add(f);
			}
		}

		if (changes.some(c => c.status === 'removed' && c.deletions > 100)) {
			maxRisk = 'critical';
		}

		if (changes.length > 20) {
			maxRisk = maxRisk === 'low' ? 'medium' : maxRisk;
		}

		const scope: IncrementalReviewScope = {
			changedFiles: changes,
			relatedFiles: Array.from(relatedFiles),
			affectedModules: Array.from(affectedModules),
			riskLevel: maxRisk
		};

		this.logService.info(`[Council Incremental] Scope: ${changes.length} files, ${affectedModules.size} modules, risk: ${maxRisk}`);
		return scope;
	}

	public determineFocus(
		scope: IncrementalReviewScope,
		availableRoles: string[]
	): ReviewFocus {
		const priorities = new Map<string, 'high' | 'medium' | 'low'>();
		const recommendedRoles = new Set<string>();

		for (const file of scope.changedFiles) {
			let priority: 'high' | 'medium' | 'low' = 'medium';

			if (this.isHighRisk(file)) {
				priority = 'high';
			} else if (file.additions + file.deletions > 100) {
				priority = 'high';
			} else if (file.additions + file.deletions > 20) {
				priority = 'medium';
			} else {
				priority = 'low';
			}

			priorities.set(file.filename, priority);

			const module = this.detectModule(file.filename);
			if (module) {
				const role = this.moduleToRole(module);
				if (availableRoles.includes(role)) {
					recommendedRoles.add(role);
				}
			}

			if (priority === 'high' && availableRoles.includes('security')) {
				recommendedRoles.add('security');
			}
		}

		if (scope.riskLevel === 'critical' || scope.riskLevel === 'high') {
			if (availableRoles.includes('architect')) recommendedRoles.add('architect');
			if (availableRoles.includes('security')) recommendedRoles.add('security');
		}

		if (!recommendedRoles.has('backend') && availableRoles.includes('backend')) {
			recommendedRoles.add('backend');
		}

		const totalChanges = scope.changedFiles.reduce((sum, c) => sum + c.additions + c.deletions, 0);
		let estimatedEffort: ReviewFocus['estimatedEffort'] = 'quick';
		if (totalChanges > 500 || scope.changedFiles.length > 10) {
			estimatedEffort = 'extensive';
		} else if (totalChanges > 100 || scope.changedFiles.length > 3) {
			estimatedEffort = 'moderate';
		}

		return {
			files: scope.changedFiles.map(f => f.filename),
			priorities,
			recommendedRoles: Array.from(recommendedRoles),
			estimatedEffort
		};
	}

	public getChangedContent(changes: FileChange[], fullDiff: string): string {
		const lines = fullDiff.split('\n');
		const changedSections: string[] = [];

		for (const change of changes) {
			const fileStart = lines.findIndex(l => l.includes(`b/${change.filename}`) || l.includes(`--- a/${change.filename}`));
			if (fileStart === -1) continue;

			let fileEnd = lines.findIndex((l, i) => i > fileStart && (l.startsWith('diff --git') || l.startsWith('--- a/')));
			if (fileEnd === -1) fileEnd = lines.length;

			changedSections.push(lines.slice(fileStart, fileEnd).join('\n'));
		}

		return changedSections.join('\n\n');
	}

	public isHighRisk(change: FileChange): boolean {
		return HIGH_RISK_PATTERNS.some(pattern => pattern.test(change.filename));
	}

	public getRelatedFiles(
		filename: string,
		codebaseStructure?: Map<string, string[]>
	): string[] {
		const related: string[] = [];
		const basename = filename.split('/').pop() ?? '';
		const nameWithoutExt = basename.replace(/\.[^.]+$/, '');

		if (codebaseStructure) {
			for (const [file, imports] of codebaseStructure) {
				if (file === filename) continue;
				if (imports.some(i => i.includes(nameWithoutExt) || i.includes(basename))) {
					related.push(file);
				}
			}
		}

		const testFile = this.findTestFile(filename);
		if (testFile) related.push(testFile);

		const configFiles = this.findConfigFiles(filename);
		related.push(...configFiles);

		return related;
	}

	private detectModule(filename: string): string | undefined {
		for (const { pattern, module } of MODULE_PATTERNS) {
			if (pattern.test(filename)) {
				return module;
			}
		}
		return undefined;
	}

	private moduleToRole(module: string): string {
		const moduleRoleMap: Record<string, string> = {
			'frontend-components': 'frontend',
			'frontend-pages': 'frontend',
			'styles': 'frontend',
			'hooks': 'frontend',
			'backend-services': 'backend',
			'api-layer': 'backend',
			'data-models': 'backend',
			'database': 'database',
			'migrations': 'database',
			'tests': 'qa',
			'configuration': 'devops',
			'middleware': 'backend',
			'state-management': 'frontend',
			'utilities': 'backend'
		};
		return moduleRoleMap[module] ?? 'backend';
	}

	private findTestFile(filename: string): string | undefined {
		const dir = filename.substring(0, filename.lastIndexOf('/'));
		const basename = filename.split('/').pop() ?? '';
		const nameWithoutExt = basename.replace(/\.[^.]+$/, '');
		const ext = basename.includes('.') ? '.' + basename.split('.').pop() : '';

		const testPatterns = [
			`${dir}/${nameWithoutExt}.test${ext}`,
			`${dir}/${nameWithoutExt}.spec${ext}`,
			`${dir}/__tests__/${nameWithoutExt}${ext}`,
			`${dir}/test/${nameWithoutExt}${ext}`
		];

		return testPatterns[0];
	}

	private findConfigFiles(filename: string): string[] {
		const configs: string[] = [];
		if (filename.endsWith('.ts') || filename.endsWith('.js')) {
			configs.push('tsconfig.json', 'package.json');
		}
		if (filename.includes('/src/')) {
			configs.push('.eslintrc', '.prettierrc');
		}
		return configs;
	}
}
