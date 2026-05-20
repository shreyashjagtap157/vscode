/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { KeyMod, KeyCode } from '../../../../../base/common/keyCodes.js';
import { ICouncilTelemetryService } from './councilTelemetryService.js';

export const ICouncilKeybindings = createDecorator<ICouncilKeybindings>('councilKeybindings');

export interface CouncilKeybinding {
	readonly id: string;
	readonly keybinding: number;
	readonly title: string;
	readonly category: string;
	readonly handler: () => void | Promise<void>;
	readonly when?: string;
}

export interface ICouncilKeybindings extends IDisposable {
	readonly _serviceBrand: undefined;

	registerKeybinding(keybinding: CouncilKeybinding): void;
	getKeybindings(): CouncilKeybinding[];
	getDefaultKeybindings(): CouncilKeybinding[];
	executeKeybinding(id: string): Promise<void>;
}

export class CouncilKeybindings extends Disposable implements ICouncilKeybindings {
	declare readonly _serviceBrand: undefined;

	private readonly keybindings: CouncilKeybinding[];
	private readonly handlers: Map<string, () => void | Promise<void>>;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@ILogService private readonly logService: ILogService,
		@ICouncilTelemetryService private readonly telemetryService: ICouncilTelemetryService
	) {
		super();
		this.keybindings = [];
		this.handlers = new Map();
		this.registerDefaults();
	}

	public registerKeybinding(keybinding: CouncilKeybinding): void {
		this.keybindings.push(keybinding);
		this.handlers.set(keybinding.id, keybinding.handler);
		this.logService.debug(`[Council Keybindings] Registered: ${keybinding.id}`);
	}

	public getKeybindings(): CouncilKeybinding[] {
		return [...this.keybindings];
	}

	public async executeKeybinding(id: string): Promise<void> {
		const handler = this.handlers.get(id);
		if (!handler) {
			this.logService.warn(`[Council Keybindings] No handler for: ${id}`);
			return;
		}

		const start = Date.now();
		try {
			await handler();
			this.telemetryService.sendUIAction(id, 'keybinding', Date.now() - start);
			this.logService.info(`[Council Keybindings] Executed: ${id}`);
		} catch (error) {
			this.logService.error(`[Council Keybindings] Failed to execute ${id}: ${error}`);
		}
	}

	public getDefaultKeybindings(): CouncilKeybinding[] {
		return [
			{
				id: 'council.openDashboard',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
				title: 'Open Council Dashboard',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('workbench.view.councilDashboard')
			},
			{
				id: 'council.startSession',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS,
				title: 'Start Council Session',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('chat.startCouncilSession')
			},
			{
				id: 'council.cancelSession',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyX,
				title: 'Cancel Council Session',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('chat.cancelCouncilSession')
			},
			{
				id: 'council.openWarRoom',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyW,
				title: 'Open Council War Room',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('council.openWarRoom')
			},
			{
				id: 'council.openAgentBuilder',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
				title: 'Open Agent Builder',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('council.openAgentBuilder')
			},
			{
				id: 'council.reviewPR',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyR,
				title: 'Review PR with Council',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('council.reviewPR')
			},
			{
				id: 'council.toggleStreaming',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyT,
				title: 'Toggle Streaming UI',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('council.toggleStreaming')
			},
			{
				id: 'council.replayLastSession',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP,
				title: 'Replay Last Council Session',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('council.replayLastSession')
			},
			{
				id: 'council.searchSessions',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF,
				title: 'Search Council Sessions',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('council.searchSessions')
			},
			{
				id: 'council.exportReport',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyE,
				title: 'Export Council Report',
				category: 'Agent Council',
				handler: () => this.commandService.executeCommand('council.exportReport')
			}
		];
	}

	private registerDefaults(): void {
		const defaults = this.getDefaultKeybindings();
		for (const kb of defaults) {
			this.keybindings.push(kb);
			this.handlers.set(kb.id, kb.handler);
		}
		this.logService.info(`[Council Keybindings] Registered ${defaults.length} default keybindings`);
	}
}
