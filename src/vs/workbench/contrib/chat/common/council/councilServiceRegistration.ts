/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from '../../../../../../platform/instantiation/common/extensions.js';
import { InstantiationType } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IAgentProfileManager, AgentProfileManager } from './agentProfileManager.js';
import { ICouncilOrchestrator, CouncilOrchestrator } from './councilOrchestrator.js';
import { IConsensusManager, ConsensusManager, IterationGuard } from './councilCoordinator.js';
import { IEvidenceValidator, EvidenceValidator } from './evidenceValidator.js';
import { IAdvancedConsensusEngine, AdvancedConsensusEngine } from './advancedConsensusEngine.js';
import { IDebateResolver, DebateResolver } from './debateResolver.js';
import { ICouncilTestRunner, CouncilTestRunner } from './councilTestRunner.js';

registerSingleton(IAgentProfileManager, AgentProfileManager, InstantiationType.Delayed);
registerSingleton(ICouncilOrchestrator, CouncilOrchestrator, InstantiationType.Delayed);
registerSingleton(IConsensusManager, ConsensusManager, InstantiationType.Delayed);
registerSingleton(IEvidenceValidator, EvidenceValidator, InstantiationType.Delayed);
registerSingleton(IAdvancedConsensusEngine, AdvancedConsensusEngine, InstantiationType.Delayed);
registerSingleton(IDebateResolver, DebateResolver, InstantiationType.Delayed);
registerSingleton(ICouncilTestRunner, CouncilTestRunner, InstantiationType.Delayed);
