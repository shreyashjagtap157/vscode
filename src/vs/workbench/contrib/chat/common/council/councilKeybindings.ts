/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { KeyMod, KeyCode } from '../../../../../../base/common/keyCodes.js';

export const ICouncilKeybindings = createDecorator<ICouncilKeybindings>('councilKeybindings');

export interface CouncilKeybinding {
	readonly id: string;
	readonly keybinding: number;
	readonly title: string;
	readonly category: string;
	readonly handler: () => void;
	readonly when?: string;
}

export interface ICouncilKeybindings extends IDisposable {
	readonly _serviceBrand: undefined;

	registerKeybinding(keybinding: CouncilKeybinding): void;
	getKeybindings(): CouncilKeybinding[];
	getDefaultKeybindings(): CouncilKeybinding[];
}

export class CouncilKeybindings extends Disposable implements ICouncilKeybindings {
	declare readonly _serviceBrand: undefined;

	private readonly keybindings: CouncilKeybinding[];

	constructor(
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.keybindings = [];
		this.registerDefaults();
	}

	public registerKeybinding(keybinding: CouncilKeybinding): void {
		this.keybindings.push(keybinding);
		this.logService.debug(`[Council Keybindings] Registered: ${keybinding.id}`);
	}

	public getKeybindings(): CouncilKeybinding[] {
		return [...this.keybindings];
	}

	public getDefaultKeybindings(): CouncilKeybinding[] {
		return [
			{
				id: 'council.openDashboard',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
				title: 'Open Council Dashboard',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Open dashboard')
			},
			{
				id: 'council.startSession',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS,
				title: 'Start Council Session',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Start session')
			},
			{
				id: 'council.cancelSession',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyX,
				title: 'Cancel Council Session',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Cancel session')
			},
			{
				id: 'council.openWarRoom',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyW,
				title: 'Open Council War Room',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Open war room')
			},
			{
				id: 'council.openAgentBuilder',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
				title: 'Open Agent Builder',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Open agent builder')
			},
			{
				id: 'council.reviewPR',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyR,
				title: 'Review PR with Council',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Review PR')
			},
			{
				id: 'council.toggleStreaming',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyT,
				title: 'Toggle Streaming UI',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Toggle streaming')
			},
			{
				id: 'council.replayLastSession',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP,
				title: 'Replay Last Council Session',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Replay last session')
			},
			{
				id: 'council.searchSessions',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF,
				title: 'Search Council Sessions',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Search sessions')
			},
			{
				id: 'council.exportReport',
				keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyE,
				title: 'Export Council Report',
				category: 'Agent Council',
				handler: () => this.logService.info('[Council] Export report')
			}
		];
	}

	private registerDefaults(): void {
		const defaults = this.getDefaultKeybindings();
		for (const kb of defaults) {
			this.keybindings.push(kb);
		}
		this.logService.info(`[Council Keybindings] Registered ${defaults.length} default keybindings`);
	}
}
