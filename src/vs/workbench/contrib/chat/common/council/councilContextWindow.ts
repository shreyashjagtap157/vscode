/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';

export const ICouncilContextWindow = createDecorator<ICouncilContextWindow>('councilContextWindow');

export interface ContextWindowConfig {
	readonly maxTokens: number;
	readonly reservedTokens: number;
	readonly truncationStrategy: 'oldest-first' | 'least-relevant' | 'summarize';
	readonly minContextTokens: number;
}

export interface ContextSegment {
	readonly id: string;
	readonly content: string;
	readonly tokenCount: number;
	readonly priority: number;
	readonly timestamp: number;
}

export interface ContextWindowResult {
	readonly segments: ContextSegment[];
	readonly totalTokens: number;
	readonly truncated: boolean;
	readonly removedSegments: string[];
}

export interface ICouncilContextWindow extends IDisposable {
	readonly _serviceBrand: undefined;

	configure(config: Partial<ContextWindowConfig>): void;
	addSegment(segment: ContextSegment): void;
	removeSegment(id: string): void;
	getOptimizedContext(): ContextWindowResult;
	estimateTokenCount(text: string): number;
	getStats(): { totalSegments: number; totalTokens: number; utilization: number };
}

const DEFAULT_CONFIG: ContextWindowConfig = {
	maxTokens: 128000,
	reservedTokens: 4000,
	truncationStrategy: 'oldest-first',
	minContextTokens: 1000
};

export class CouncilContextWindow extends Disposable implements ICouncilContextWindow {
	declare readonly _serviceBrand: undefined;

	private readonly segments: Map<string, ContextSegment>;
	private config: ContextWindowConfig;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.segments = new Map();
		this.config = { ...DEFAULT_CONFIG };
	}

	public configure(config: Partial<ContextWindowConfig>): void {
		this.config = { ...this.config, ...config };
	}

	public addSegment(segment: ContextSegment): void {
		this.segments.set(segment.id, segment);
	}

	public removeSegment(id: string): void {
		this.segments.delete(id);
	}

	public getOptimizedContext(): ContextWindowResult {
		const availableTokens = this.config.maxTokens - this.config.reservedTokens;
		const sortedSegments = Array.from(this.segments.values())
			.sort((a, b) => {
				switch (this.config.truncationStrategy) {
					case 'oldest-first':
						return a.timestamp - b.timestamp;
					case 'least-relevant':
						return a.priority - b.priority;
					default:
						return a.timestamp - b.timestamp;
				}
			});

		const kept: ContextSegment[] = [];
		const removed: string[] = [];
		let totalTokens = 0;

		for (const segment of sortedSegments) {
			if (totalTokens + segment.tokenCount <= availableTokens) {
				kept.push(segment);
				totalTokens += segment.tokenCount;
			} else {
				removed.push(segment.id);
			}
		}

		if (kept.length === 0 && sortedSegments.length > 0) {
			const highestPriority = sortedSegments[sortedSegments.length - 1];
			kept.push(highestPriority);
			totalTokens = highestPriority.tokenCount;
		}

		return {
			segments: kept,
			totalTokens,
			truncated: removed.length > 0,
			removedSegments: removed
		};
	}

	public estimateTokenCount(text: string): number {
		const chars = text.length;
		return Math.ceil(chars / 4);
	}

	public getStats(): { totalSegments: number; totalTokens: number; utilization: number } {
		let totalTokens = 0;
		for (const segment of this.segments.values()) {
			totalTokens += segment.tokenCount;
		}

		return {
			totalSegments: this.segments.size,
			totalTokens,
			utilization: totalTokens / this.config.maxTokens
		};
	}
}
