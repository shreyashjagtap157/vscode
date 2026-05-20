/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICouncilTelemetryService } from './councilTelemetryService.js';

export const ICouncilTelemetrySampling = createDecorator<ICouncilTelemetrySampling>('councilTelemetrySampling');

export interface SamplingConfig {
	readonly debugEventSampleRate: number;
	readonly errorEventSampleRate: number;
	readonly performanceEventSampleRate: number;
	readonly uiEventSampleRate: number;
	readonly enableSampling: boolean;
}

export interface ICouncilTelemetrySampling extends IDisposable {
	readonly _serviceBrand: undefined;

	configure(config: Partial<SamplingConfig>): void;
	shouldSend(eventType: 'debug' | 'error' | 'performance' | 'ui' | 'default'): boolean;
	recordSent(eventType: string): void;
	recordDropped(eventType: string): void;
	getStats(): { totalSent: number; totalDropped: number; effectiveRate: number };
}

export class CouncilTelemetrySampling extends Disposable implements ICouncilTelemetrySampling {
	declare readonly _serviceBrand: undefined;

	private config: SamplingConfig;
	private totalSent: number;
	private totalDropped: number;
	private readonly eventTypeCounts: Map<string, { sent: number; dropped: number }>;

	constructor(
		@ILogService _logService: ILogService,
		@ICouncilTelemetryService _telemetryService: ICouncilTelemetryService
	) {
		super();
		this.config = {
			debugEventSampleRate: 0.1,
			errorEventSampleRate: 1.0,
			performanceEventSampleRate: 0.5,
			uiEventSampleRate: 0.3,
			enableSampling: true
		};
		this.totalSent = 0;
		this.totalDropped = 0;
		this.eventTypeCounts = new Map();
	}

	public configure(config: Partial<SamplingConfig>): void {
		this.config = { ...this.config, ...config };
	}

	public shouldSend(eventType: 'debug' | 'error' | 'performance' | 'ui' | 'default'): boolean {
		if (!this.config.enableSampling) return true;

		switch (eventType) {
			case 'debug':
				return Math.random() < this.config.debugEventSampleRate;
			case 'error':
				return Math.random() < this.config.errorEventSampleRate;
			case 'performance':
				return Math.random() < this.config.performanceEventSampleRate;
			case 'ui':
				return Math.random() < this.config.uiEventSampleRate;
			default:
				return Math.random() < 0.5;
		}
	}

	public recordSent(eventType: string): void {
		this.totalSent++;
		const counts = this.eventTypeCounts.get(eventType) ?? { sent: 0, dropped: 0 };
		counts.sent++;
		this.eventTypeCounts.set(eventType, counts);
	}

	public recordDropped(eventType: string): void {
		this.totalDropped++;
		const counts = this.eventTypeCounts.get(eventType) ?? { sent: 0, dropped: 0 };
		counts.dropped++;
		this.eventTypeCounts.set(eventType, counts);
	}

	public getStats(): { totalSent: number; totalDropped: number; effectiveRate: number } {
		const total = this.totalSent + this.totalDropped;
		return {
			totalSent: this.totalSent,
			totalDropped: this.totalDropped,
			effectiveRate: total > 0 ? this.totalSent / total : 0
		};
	}
}
