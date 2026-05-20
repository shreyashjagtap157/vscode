/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { localize } from '../../../../../nls.js';

export const COUNCIL_CONFIGURATION = {
	Enabled: 'chat.council.enabled',
	DefaultStrategy: 'chat.council.defaultStrategy',
	MaxIterations: 'chat.council.maxIterations',
	EnableDebateView: 'chat.council.enableDebateView',
	AutoActivate: 'chat.council.autoActivate',
	AutoActivateKeywords: 'chat.council.autoActivateKeywords'
};

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'council',
	order: 150,
	title: localize('council.title', 'Agent Council'),
	type: 'object',
	properties: {
		[COUNCIL_CONFIGURATION.Enabled]: {
			type: 'boolean',
			default: true,
			description: localize('council.enabled', 'Enable the Agent Council system for multi-agent orchestration.'),
			tags: ['experimental']
		},
		[COUNCIL_CONFIGURATION.DefaultStrategy]: {
			type: 'string',
			enum: ['evidence-weighted', 'majority', 'specialist-priority', 'coordinator-override'],
			default: 'evidence-weighted',
			description: localize('council.defaultStrategy', 'Default consensus strategy for the Agent Council.')
		},
		[COUNCIL_CONFIGURATION.MaxIterations]: {
			type: 'number',
			default: 3,
			minimum: 1,
			maximum: 10,
			description: localize('council.maxIterations', 'Maximum number of review iterations per council session.')
		},
		[COUNCIL_CONFIGURATION.EnableDebateView]: {
			type: 'boolean',
			default: true,
			description: localize('council.enableDebateView', 'Show the debate view to visualize agent disagreements and resolutions.')
		},
		[COUNCIL_CONFIGURATION.AutoActivate]: {
			type: 'boolean',
			default: false,
			description: localize('council.autoActivate', 'Automatically activate the council for requests matching keywords.')
		},
		[COUNCIL_CONFIGURATION.AutoActivateKeywords]: {
			type: 'array',
			items: { type: 'string' },
			default: ['architecture', 'refactor', 'security', 'design', 'review', 'complex', 'multi-file'],
			description: localize('council.autoActivateKeywords', 'Keywords that trigger automatic council activation when auto-activate is enabled.')
		}
	}
});
