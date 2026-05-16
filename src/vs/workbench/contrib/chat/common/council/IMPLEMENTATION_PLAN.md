# Agent Council System - Complete Implementation Plan

## Document Information
- **Issue**: [#316759](https://github.com/microsoft/vscode/issues/316759)
- **Branch**: `shreyashjagtap157/issue-316759-agent-council`
- **Status**: Phase 1 (Architectural Foundation) Complete
- **Last Updated**: 2026-05-16

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Target Architecture](#3-target-architecture)
4. [Phase 1: Architectural Foundation (COMPLETE)](#4-phase-1-architectural-foundation-complete)
5. [Phase 2: Evidence & Consensus Engine](#5-phase-2-evidence--consensus-engine)
6. [Phase 3: UI/UX Integration](#6-phase-3-uiux-integration)
7. [Phase 4: Advanced Capabilities](#7-phase-4-advanced-capabilities)
8. [Phase 5: Enterprise Features](#8-phase-5-enterprise-features)
9. [Testing Strategy](#9-testing-strategy)
10. [Risk Mitigation](#10-risk-mitigation)
11. [Migration Path](#11-migration-path)
12. [File Inventory](#12-file-inventory)

---

## 1. Executive Summary

The Agent Council system transforms GitHub Copilot Chat from a single-agent interaction model into a multi-agent orchestration framework. By leveraging specialized AI agents with distinct roles, personalities, and focus modes, the system simulates a real-world engineering team capable of collaborative planning, architecture review, implementation discussion, debugging, testing, and deployment verification.

### Key Benefits
- **Higher Reliability**: Multiple reviewers reduce hallucinations and weak implementations
- **Better Architectural Quality**: Collaborative review encourages cleaner systems
- **Stronger Verification**: Dedicated testing and validation agents improve correctness
- **Faster Resolution of Complex Issues**: Parallel reasoning accelerates debugging
- **Reduced Context Window Pressure**: Specialized subagents isolate reasoning workloads
- **Increased Enterprise Readiness**: Multi-agent review workflows align with professional engineering standards
- **Improved Transparency**: Users can inspect reasoning, disagreements, evidence, and validation

---

## 2. Current State Analysis

### 2.1 What Exists Today (VS Code Codebase)

| Component | Location | Purpose |
|-----------|----------|---------|
| `IChatService` | `chatService.ts` | Entry point for chat requests |
| `IChatAgentService` | `chatAgents.ts` | Agent registry and invocation |
| `RunSubagentTool` | `runSubagentTool.ts` | Single nested agent spawning |
| `ILanguageModelsService` | `languageModels.ts` | LLM interaction layer |
| `ILanguageModelToolsService` | `languageModelToolsService.ts` | Tool registration and execution |
| `IChatPlanReview` | `chatService.ts` | Plan approval UI |
| `ManageTodoListTool` | `manageTodoListTool.ts` | Task list management |
| MCP Integration | `vscode.proposed.mcp*.d.ts` | External tool server support |

### 2.2 Limitations of Current State
- **Single-Agent Flow**: Linear `User → Model → Response` pipeline
- **No Multi-Agent Orchestration**: No concept of parallel agents, debate, or consensus
- **No Profile System**: Agents are generic; no personality, profession, or focus mode configuration
- **No Evidence Validation**: No mechanism to verify citations or evidence-backed reasoning
- **No Conflict Resolution**: No way to handle disagreements between multiple perspectives

### 2.3 What We've Built (Phase 1)
- **Agent Profile System**: Registry with 6 default roles, validation, persistence, and prompt building
- **Council Orchestrator**: LLM-driven task decomposition, parallel execution, session management
- **Coordination Logic**: Evidence scoring, multi-strategy consensus, debate tracking, iteration guard
- **VS Code Integration**: Service registrations, chat participant, configuration settings
- **UI Components**: Session widget, configuration panel, debate view, CSS styling
- **Test Suite**: Unit tests for profile manager and consensus manager

---

## 3. Target Architecture

### 3.1 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           VS Code Chat Interface                         │
├─────────────────────────────────────────────────────────────────────────┤
│  User Request                                                            │
│       ↓                                                                  │
│  CouncilChatParticipant (copilot.council)                                │
│       ↓                                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Council Orchestrator                            │  │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │  │
│  │  │ TaskDecomposer  │  │ ExecutionEngine  │  │   Synthesizer    │ │  │
│  │  │ (LLM-driven)    │  │ (Parallel/Seq)   │  │ (Final Response) │ │  │
│  │  └─────────────────┘  └──────────────────┘  └──────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│       ↓                                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Agent Profile Manager                           │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │  │
│  │  │Architect │ │ Backend  │ │ Security │ │    QA    │ ...         │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│       ↓                                                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Consensus Manager                               │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │  │
│  │  │EvidenceScore │ │ConflictResolve│ │DebateTracker │              │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│       ↓                                                                  │
│  Council Result (with confidence, debates, contributions)                │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
User Request
    ↓
[1] CouncilChatParticipant.invoke()
    ↓
[2] CouncilOrchestrator.executeSession()
    ├── [2a] TaskDecomposer.decompose() → DAG of CouncilTasks
    ├── [2b] AgentProfileManager.getProfile() → Role-specific prompts
    ├── [2c] ExecutionEngine.execute() → Parallel/Sequential sub-agent calls
    │   ├── invokeSubAgent() → ILanguageModelsService.sendChatRequest()
    │   └── buildAgentContext() → Shared scratchpad + dependency results
    └── [2d] Synthesizer.synthesize() → Final response
    ↓
[3] ConsensusManager.resolveConsensus()
    ├── scoreEvidence() → Citation validation
    ├── resolveConflict() → Priority-weighted decision
    └── recordDebate() → Disagreement tracking
    ↓
[4] CouncilChatParticipant.renderCouncilResult()
    └── Progress stream → UI rendering
```

### 3.3 Service Dependencies

```
CouncilOrchestrator
    ├── IAgentProfileManager (profile registry, prompt building)
    ├── ILanguageModelsService (LLM invocation)
    ├── ILanguageModelToolsService (tool filtering)
    ├── IChatService (session management)
    └── ILogService (logging)

ConsensusManager
    ├── IFileService (citation validation)
    └── ILogService (logging)

CouncilChatParticipant
    ├── ICouncilOrchestrator (execution)
    ├── IAgentProfileManager (profile lookup)
    ├── IChatAgentService (participant registration)
    └── ILogService (logging)
```

---

## 4. Phase 1: Architectural Foundation (COMPLETE)

### 4.1 What Was Implemented

#### A. Agent Profile System (`agentProfileManager.ts`)
- **Interface**: `CouncilAgentProfile` with roleId, displayName, baseSystemPrompt, reasoningStyle, priorityWeight, preferredTools, excludedTools, maxTokens, temperature, focusModes, modelOverride
- **Default Profiles**: 6 roles (Architect, Backend, Security, QA, DevOps, Performance)
- **Validation**: `ProfileValidationError` with field-specific error messages
- **Persistence**: Load from `~/.vscode/council-profiles.json`
- **Prompt Building**: `buildSystemPrompt()` with council protocol, context, tool restrictions
- **Tool Filtering**: `buildToolFilter()` returning allowed/excluded tool lists
- **VS Code DI**: `IAgentProfileManager` service interface with `registerSingleton`

#### B. Council Orchestrator (`councilOrchestrator.ts`)
- **Task Decomposition**: LLM-driven planning prompt → JSON task graph
- **DAG Validation**: Cycle detection via topological sort
- **Execution Levels**: Parallel execution within dependency levels
- **Session Management**: `CouncilSession` with taskId, status, result, error, timing
- **Context Building**: Dependency results + shared scratchpad + original request
- **Sub-Agent Invocation**: `ILanguageModelsService.sendChatRequest()` with profile-specific parameters
- **Synthesis**: Final response generation with confidence scoring
- **Cancellation**: `CancellationToken` propagation
- **Error Recovery**: Per-task error handling, partial success support

#### C. Coordination Logic (`councilCoordinator.ts`)
- **Evidence Scoring**: Parse `[File:path:line]` and `[Log:id]` citations, validate file existence
- **Reasoning Depth**: Count logical connectors (because, therefore, however, etc.)
- **Consensus Strategies**:
  - `evidence-weighted`: confidenceScore × priorityWeight + reasoningDepth bonus
  - `majority`: Theme-based voting
  - `specialist-priority`: Domain expert override (security→auth, devops→deployment, etc.)
  - `coordinator-override`: Manual selection
- **Debate Tracking**: Record positions, evidence counts, resolution rationale
- **Iteration Guard**: Complexity-based limits (simple:1, moderate:2, complex:3, critical:4)

#### D. VS Code Integration
- **Service Registration**: `councilServiceRegistration.ts` with `registerSingleton`
- **Chat Participant**: `CouncilChatParticipant` with slash commands (`/plan`, `/review`, `/architect`, `/security`)
- **Configuration**: 6 settings (enabled, defaultStrategy, maxIterations, enableDebateView, autoActivate, autoActivateKeywords)
- **Workbench Contribution**: `CouncilParticipantContribution` for automatic registration

#### E. UI Components
- **Session Widget**: `CouncilSessionWidget` with status, agent list, progress bar, debate view
- **Configuration Panel**: `CouncilConfigurationPanel` with agent selector, strategy dropdown, options
- **CSS Styling**: `council.css` with VS Code theme variables, animations, responsive design

#### F. Test Suite
- **Profile Manager Tests**: 10 tests covering validation, registration, prompt building, tool filtering
- **Coordinator Tests**: 10 tests covering evidence scoring, consensus, iteration guard, debate tracking

### 4.2 Files Created
| File | Purpose | Lines |
|------|---------|-------|
| `agentProfileManager.ts` | Profile registry, validation, prompt building | ~220 |
| `councilOrchestrator.ts` | Task decomposition, execution, synthesis | ~350 |
| `councilCoordinator.ts` | Evidence scoring, consensus, debate tracking | ~300 |
| `councilParticipant.ts` | Chat participant integration | ~150 |
| `councilConfiguration.ts` | VS Code settings registration | ~60 |
| `council.ts` | Barrel exports | ~10 |
| `councilServiceRegistration.ts` | DI service registration | ~15 |
| `councilSessionWidget.ts` | UI session widget | ~130 |
| `councilConfigurationPanel.ts` | UI configuration panel | ~150 |
| `council.css` | Styling | ~180 |
| `test/agentProfileManager.test.ts` | Profile manager tests | ~130 |
| `test/councilCoordinator.test.ts` | Coordinator tests | ~120 |

### 4.3 Verification Steps
- [x] Profile validation rejects invalid inputs
- [x] Default profiles load correctly
- [x] System prompt includes council protocol
- [x] Task decomposition produces valid DAG
- [x] Parallel execution respects dependencies
- [x] Evidence scoring counts citations correctly
- [x] Consensus strategies return weighted results
- [x] Iteration guard prevents infinite loops
- [x] Chat participant registers with slash commands
- [x] Configuration settings appear in VS Code settings UI

---

## 5. Phase 2: Evidence & Consensus Engine

### 5.1 Objectives
- Enhance evidence validation with real file system checks
- Implement advanced consensus with confidence intervals
- Add debate resolution automation
- Integrate with VS Code's test runner for verification

### 5.2 Implementation Steps

#### A. Enhanced Evidence Validation
**File**: `councilCoordinator.ts` (extend `EvidenceScorer`)

```typescript
export class EnhancedEvidenceScorer {
    constructor(
        @IModelService private modelService: IModelService,
        @IFileService private fileService: IFileService,
        @ITerminalService private terminalService: ITerminalService
    ) {}

    public async scoreEvidence(text: string): Promise<EnhancedEvidenceScore> {
        const citations = this.parseCitations(text);
        const validatedCitations: ValidatedCitation[] = [];

        for (const citation of citations) {
            const validation = await this.validateCitation(citation);
            validatedCitations.push(validation);
        }

        return {
            totalCitations: citations.length,
            validCitations: validatedCitations.filter(c => c.isValid).length,
            invalidCitations: validatedCitations.filter(c => !c.isValid).length,
            confidenceScore: this.calculateConfidence(validatedCitations),
            reasoningDepth: this.estimateReasoningDepth(text),
            testCoverage: await this.estimateTestCoverage(text),
            runtimeValidation: await this.checkRuntimeBehavior(text)
        };
    }

    private async validateCitation(citation: Citation): Promise<ValidatedCitation> {
        switch (citation.type) {
            case 'file':
                const exists = await this.fileService.exists(URI.file(citation.path));
                if (exists) {
                    const content = await this.fileService.readFile(URI.file(citation.path));
                    const lineExists = this.checkLineExists(content, citation.line);
                    return { isValid: lineExists, citation, reason: lineExists ? 'Line verified' : 'Line not found' };
                }
                return { isValid: false, citation, reason: 'File not found' };
            
            case 'log':
                return { isValid: true, citation, reason: 'Log reference (assumed valid)' };
            
            case 'test':
                const testPassed = await this.runTest(citation.testId);
                return { isValid: testPassed, citation, reason: testPassed ? 'Test passed' : 'Test failed' };
        }
    }

    private async estimateTestCoverage(text: string): number {
        // Parse test-related citations and estimate coverage
        const testMentions = (text.match(/test|spec|verify|assert/gi) || []).length;
        return Math.min(testMentions * 0.05, 1.0);
    }

    private async checkRuntimeBehavior(text: string): Promise<boolean> {
        // If text mentions running a command, attempt to verify
        const commandMatch = text.match(/run[:\s]+(`[^`]+`|"[^"]+")/i);
        if (commandMatch) {
            const command = commandMatch[1].replace(/[`"]/g, '');
            return await this.executeCommand(command);
        }
        return true;
    }
}
```

**Testing**:
- Unit test: Verify file citations are validated correctly
- Integration test: Mock file system to test valid/invalid citations
- Regression test: Ensure scoring doesn't break with malformed input

#### B. Advanced Consensus with Confidence Intervals
**File**: `councilCoordinator.ts` (extend `ConsensusManager`)

```typescript
export interface ConfidenceInterval {
    lower: number;
    upper: number;
    confidence: number;
}

export class AdvancedConsensusManager extends ConsensusManager {
    public async resolveWithConfidence(
        contributions: Contribution[],
        profiles: Map<string, CouncilAgentProfile>
    ): Promise<ConsensusResultWithCI> {
        const scored = await Promise.all(
            contributions.map(async c => ({
                contribution: c,
                score: await this.scoreEvidence(c.content)
            }))
        );

        const weighted = scored.map(({ contribution, score }) => ({
            contribution,
            score,
            weightedScore: score.confidenceScore * (profiles.get(contribution.roleId)?.priorityWeight || 1),
            confidenceInterval: this.calculateCI(score)
        }));

        weighted.sort((a, b) => b.weightedScore - a.weightedScore);

        const winner = weighted[0];
        const overlap = this.checkIntervalOverlap(
            winner.confidenceInterval,
            weighted.slice(1).map(w => w.confidenceInterval)
        );

        return {
            decision: winner.contribution.content,
            rationale: `Evidence-weighted score: ${winner.weightedScore.toFixed(2)} (CI: [${winner.confidenceInterval.lower.toFixed(2)}, ${winner.confidenceInterval.upper.toFixed(2)}])`,
            confidence: winner.score.confidenceScore,
            confidenceInterval: winner.confidenceInterval,
            dissenters: weighted.slice(1).map(w => w.contribution.roleId),
            intervalOverlap: overlap,
            strategy: 'evidence-weighted-ci'
        };
    }

    private calculateCI(score: EvidenceScore): ConfidenceInterval {
        const n = score.totalCitations || 1;
        const p = score.confidenceScore;
        const z = 1.96; // 95% confidence
        const margin = z * Math.sqrt((p * (1 - p)) / n);
        
        return {
            lower: Math.max(0, p - margin),
            upper: Math.min(1, p + margin),
            confidence: 0.95
        };
    }
}
```

**Testing**:
- Unit test: CI calculation with various sample sizes
- Integration test: Overlap detection between intervals
- Regression test: Ensure CI doesn't break existing consensus logic

#### C. Debate Resolution Automation
**File**: `councilCoordinator.ts` (extend `DebateTracker`)

```typescript
export class AutomatedDebateResolver {
    constructor(
        @ILanguageModelsService private languageModelsService: ILanguageModelsService,
        @ILogService private logService: ILogService
    ) {}

    public async resolveDebateAutomatically(debate: DebateRecord): Promise<DebateResolution> {
        const resolutionPrompt = `
You are a Debate Resolver. Analyze the following debate and determine the best resolution.

Topic: ${debate.topic}

Positions:
${debate.positions.map(p => `- ${p.roleId}: ${p.position}`).join('\n')}

Evidence Scores:
${debate.positions.map(p => `- ${p.roleId}: ${p.evidence.confidenceScore.toFixed(2)}`).join('\n')}

Rules:
1. Favor positions with higher evidence scores
2. Consider specialist priority (security > architect for auth issues)
3. Look for common ground between positions
4. If no clear winner, recommend a hybrid approach

Provide a resolution with rationale.`;

        const response = await this.languageModelsService.sendChatRequest(
            // ... model invocation
        );

        return {
            resolution: response.text,
            rationale: 'Automated resolution based on evidence and specialist priority',
            confidence: 0.7
        };
    }
}
```

**Testing**:
- Unit test: Mock LLM response parsing
- Integration test: End-to-end debate resolution flow
- Regression test: Ensure manual resolution still works

#### D. Test Runner Integration
**File**: New `councilTestRunner.ts`

```typescript
export class CouncilTestRunner {
    constructor(
        @ITerminalService private terminalService: ITerminalService,
        @ITestService private testService: ITestService,
        @ILogService private logService: ILogService
    ) {}

    public async runTestsForContribution(contribution: string): Promise<TestResult> {
        // Parse test commands from contribution
        const testCommands = this.extractTestCommands(contribution);
        
        const results: TestExecution[] = [];
        for (const cmd of testCommands) {
            const result = await this.executeTest(cmd);
            results.push(result);
        }

        return {
            totalTests: results.length,
            passedTests: results.filter(r => r.passed).length,
            failedTests: results.filter(r => !r.passed).length,
            coverage: this.calculateCoverage(results),
            details: results
        };
    }

    private extractTestCommands(contribution: string): string[] {
        const patterns = [
            /run[:\s]+(`([^`]+)`|"([^"]+)")/gi,
            /execute[:\s]+(`([^`]+)`|"([^"]+)")/gi,
            /test[:\s]+(`([^`]+)`|"([^"]+)")/gi
        ];

        const commands: string[] = [];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(contribution)) !== null) {
                commands.push(match[2] || match[3]);
            }
        }
        return commands;
    }
}
```

**Testing**:
- Unit test: Command extraction patterns
- Integration test: Mock terminal execution
- Regression test: Ensure no false positives in command extraction

### 5.3 Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| Modify | `councilCoordinator.ts` | Add `EnhancedEvidenceScorer`, `AdvancedConsensusManager`, `AutomatedDebateResolver` |
| Create | `councilTestRunner.ts` | Test runner integration |
| Create | `test/councilCoordinator.phase2.test.ts` | Phase 2 tests |

### 5.4 Verification Steps
- [ ] Evidence validation checks file existence and line numbers
- [ ] Confidence intervals calculated correctly
- [ ] Debate resolution automation produces coherent results
- [ ] Test runner extracts and executes commands correctly
- [ ] All Phase 1 tests still pass

---

## 6. Phase 3: UI/UX Integration

### 6.1 Objectives
- Build Council Dashboard view
- Implement Debate View with interactive conflict resolution
- Add Agent Configuration UI in settings
- Create Council Session History panel

### 6.2 Implementation Steps

#### A. Council Dashboard View
**File**: New `councilDashboardView.ts`

```typescript
export class CouncilDashboardView extends ViewPane {
    static readonly ID = 'workbench.view.councilDashboard';
    static readonly TITLE = 'Agent Council Dashboard';

    private readonly tree: CouncilDashboardTree;
    private readonly sessionList: CouncilSession[] = [];

    constructor(
        options: IViewPaneOptions,
        @ICouncilOrchestrator private orchestrator: ICouncilOrchestrator,
        @IAgentProfileManager private profileManager: IAgentProfileManager,
        @IKeybindingService private keybindingService: IKeybindingService,
        @IContextMenuService private contextMenuService: IContextMenuService
    ) {
        super(options);
        this.tree = this._register(this.instantiationService.createInstance(CouncilDashboardTree));
    }

    protected renderBody(container: HTMLElement): void {
        container.classList.add('council-dashboard');

        const header = $('.council-dashboard-header');
        header.appendChild($('.council-dashboard-title', {}, 'Agent Council Sessions'));
        container.appendChild(header);

        this.tree.render(container);
        this.updateSessionList();
    }

    private updateSessionList(): void {
        this.sessionList.length = 0;
        this.sessionList.push(...this.orchestrator.getActiveSessions());
        this.tree.setSessions(this.sessionList);
    }
}
```

**Tree Data Provider**:
```typescript
export class CouncilDashboardTree extends WorkbenchAsyncDataTree<CouncilSessionGroup, CouncilSessionItem> {
    constructor(
        @IThemeService themeService: IThemeService,
        @IListService listService: IListService,
        @IContextKeyService contextKeyService: IContextKeyService
    ) {
        const delegate = new CouncilDashboardTreeDelegate();
        const renderers = [
            new CouncilSessionGroupRenderer(),
            new CouncilSessionItemRenderer()
        ];

        super(
            'CouncilDashboard',
            delegate,
            renderers,
            {
                identityProvider: { getId: (item) => item.id },
                accessibilityProvider: { getAriaLabel: (item) => item.label }
            }
        );
    }
}
```

**Testing**:
- Unit test: Tree data provider returns correct items
- Integration test: View renders with session data
- Regression test: Ensure view doesn't break existing chat views

#### B. Debate View with Interactive Resolution
**File**: Extend `councilSessionWidget.ts`

```typescript
export class InteractiveDebateView extends Disposable {
    public readonly domNode: HTMLElement;
    private readonly debateList: HTMLElement;

    constructor(
        private session: CouncilSession,
        @IInstantiationService private instantiationService: IInstantiationService
    ) {
        super();
        this.domNode = $('.council-debate-view');
        this.debateList = $('.council-debate-list');
        this.domNode.appendChild(this.debateList);
        this.renderDebates();
    }

    private renderDebates(): void {
        for (const debate of this.session.debateRecords) {
            const debateCard = this.createDebateCard(debate);
            this.debateList.appendChild(debateCard);
        }
    }

    private createDebateCard(debate: DebateRecord): HTMLElement {
        const card = $('.council-debate-card');
        
        const header = $('.council-debate-card-header');
        header.appendChild($('.council-debate-topic', {}, debate.topic));
        
        const statusBadge = $('.council-debate-status', {
            class: debate.resolved ? 'resolved' : 'unresolved'
        }, debate.resolved ? 'Resolved' : 'Unresolved');
        header.appendChild(statusBadge);
        
        card.appendChild(header);

        for (const position of debate.positions) {
            const positionCard = this.createPositionCard(position);
            card.appendChild(positionCard);
        }

        if (!debate.resolved) {
            const resolveButton = $('.council-debate-resolve-btn', {}, 'Resolve Debate');
            this.localStore.add(addDisposableListener(resolveButton, 'click', () => {
                this.resolveDebate(debate);
            }));
            card.appendChild(resolveButton);
        }

        return card;
    }

    private async resolveDebate(debate: DebateRecord): Promise<void> {
        const resolver = this.instantiationService.createInstance(AutomatedDebateResolver);
        const resolution = await resolver.resolveDebateAutomatically(debate);
        
        debate.resolution = resolution.resolution;
        debate.rationale = resolution.rationale;
        debate.resolved = true;
        
        this.renderDebates();
    }
}
```

**Testing**:
- Unit test: Debate card renders correctly
- Integration test: Resolution button triggers automated resolver
- Regression test: Ensure debate view doesn't break session widget

#### C. Agent Configuration UI in Settings
**File**: Extend `councilConfigurationPanel.ts`

```typescript
export class AdvancedAgentConfiguration extends Disposable {
    public readonly domNode: HTMLElement;

    constructor(
        @IAgentProfileManager private profileManager: IAgentProfileManager,
        @IConfigurationService private configurationService: IConfigurationService
    ) {
        super();
        this.domNode = $('.council-advanced-config');
        this.render();
    }

    private render(): void {
        this.renderProfileEditor();
        this.renderModelSelector();
        this.renderToolConfiguration();
    }

    private renderProfileEditor(): void {
        const section = $('.council-config-section');
        section.appendChild($('.council-config-section-title', {}, 'Custom Agent Profiles'));

        const profiles = this.profileManager.getAllProfiles();
        for (const profile of profiles) {
            const profileCard = this.createProfileCard(profile);
            section.appendChild(profileCard);
        }

        const addProfileBtn = $('.council-add-profile-btn', {}, '+ Add Custom Profile');
        this.localStore.add(addDisposableListener(addProfileBtn, 'click', () => {
            this.showProfileCreationDialog();
        }));
        section.appendChild(addProfileBtn);

        this.domNode.appendChild(section);
    }

    private renderModelSelector(): void {
        const section = $('.council-config-section');
        section.appendChild($('.council-config-section-title', {}, 'Model Assignment'));

        const models = this.languageModelsService.getLanguageModelIds();
        for (const profile of this.profileManager.getAllProfiles()) {
            const row = $('.council-model-row');
            row.appendChild($('.council-model-label', {}, profile.displayName));
            
            const select = new SelectBox(
                models,
                models.indexOf(profile.modelOverride || ''),
                { contextViewProvider: this.contextViewService }
            );
            
            this.localStore.add(select.onDidSelect(e => {
                this.updateProfileModel(profile.roleId, models[e.index]);
            }));
            
            row.appendChild(select.domNode);
            section.appendChild(row);
        }

        this.domNode.appendChild(section);
    }
}
```

**Testing**:
- Unit test: Profile editor CRUD operations
- Integration test: Model selector updates profile configuration
- Regression test: Ensure settings UI doesn't break existing settings

#### D. Council Session History Panel
**File**: New `councilSessionHistory.ts`

```typescript
export class CouncilSessionHistory extends Disposable {
    private readonly history: CouncilSessionRecord[] = [];
    private readonly storageKey = 'council.sessionHistory';

    constructor(
        @IStorageService private storageService: IStorageService,
        @ILogService private logService: ILogService
    ) {
        super();
        this.loadHistory();
    }

    public addSession(record: CouncilSessionRecord): void {
        this.history.unshift(record);
        if (this.history.length > 50) {
            this.history.pop();
        }
        this.saveHistory();
    }

    public getHistory(): CouncilSessionRecord[] {
        return this.history;
    }

    public getSession(sessionId: string): CouncilSessionRecord | undefined {
        return this.history.find(s => s.sessionId === sessionId);
    }

    private loadHistory(): void {
        const stored = this.storageService.get(this.storageKey, StorageScope.WORKSPACE, '[]');
        try {
            this.history.push(...JSON.parse(stored));
        } catch (e) {
            this.logService.warn(`Failed to load council session history: ${e}`);
        }
    }

    private saveHistory(): void {
        this.storageService.store(this.storageKey, JSON.stringify(this.history), StorageScope.WORKSPACE, StorageTarget.USER);
    }
}
```

**Testing**:
- Unit test: History persistence across sessions
- Integration test: Session record added after execution
- Regression test: Ensure storage doesn't corrupt existing data

### 6.3 Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| Create | `councilDashboardView.ts` | Dashboard view with session tree |
| Create | `councilDashboardTree.ts` | Tree data provider and renderers |
| Modify | `councilSessionWidget.ts` | Add interactive debate view |
| Modify | `councilConfigurationPanel.ts` | Add advanced configuration |
| Create | `councilSessionHistory.ts` | Session history persistence |
| Create | `councilDashboard.css` | Dashboard-specific styling |
| Create | `test/councilUI.test.ts` | UI component tests |

### 6.4 Verification Steps
- [ ] Dashboard view shows active sessions
- [ ] Debate view renders with interactive resolution
- [ ] Agent configuration UI allows profile editing
- [ ] Session history persists across restarts
- [ ] All Phase 1-2 tests still pass

---

## 7. Phase 4: Advanced Capabilities

### 7.1 Objectives
- MCP server integration for persistent memory
- Red Team Agent for adversarial testing
- Autonomous CI failure resolution
- Long-term project memory graph

### 7.2 Implementation Steps

#### A. MCP Server Integration
**File**: New `councilMCPIntegration.ts`

```typescript
export class CouncilMCPIntegration extends Disposable {
    private mcpServer: IMCPServer | undefined;

    constructor(
        @IMCPService private mcpService: IMCPService,
        @ILogService private logService: ILogService
    ) {
        super();
        this.initializeMCPServer();
    }

    private async initializeMCPServer(): Promise<void> {
        this.mcpServer = await this.mcpService.createServer({
            name: 'council-coordinator',
            command: 'node',
            args: ['council-mcp-server.js'],
            env: {
                COUNCIL_SESSION_ID: generateUuid()
            }
        });

        await this.mcpServer.start();
        this.logService.info('[Council] MCP server initialized');
    }

    public async storeSessionState(session: CouncilSession): Promise<void> {
        if (!this.mcpServer) return;

        await this.mcpServer.callTool('store_session', {
            sessionId: session.sessionId,
            tasks: session.activeTaskGraph,
            contributions: Array.from(session.contributions.entries()),
            scratchpad: session.sharedScratchpad
        });
    }

    public async loadSessionState(sessionId: string): Promise<CouncilSession | undefined> {
        if (!this.mcpServer) return undefined;

        const result = await this.mcpServer.callTool('load_session', { sessionId });
        if (!result) return undefined;

        return {
            sessionId: result.sessionId,
            activeTaskGraph: result.tasks,
            contributions: new Map(result.contributions),
            sharedScratchpad: result.scratchpad,
            startTime: Date.now(),
            status: 'completed'
        };
    }

    public async shareArtifact(artifact: CouncilArtifact): Promise<void> {
        if (!this.mcpServer) return;

        await this.mcpServer.callTool('share_artifact', {
            type: artifact.type,
            content: artifact.content,
            metadata: artifact.metadata
        });
    }
}
```

**Testing**:
- Unit test: MCP server initialization
- Integration test: Session state persistence
- Regression test: Ensure MCP integration doesn't break existing chat

#### B. Red Team Agent
**File**: Extend `agentProfileManager.ts`

```typescript
export const RED_TEAM_PROFILE: CouncilAgentProfile = {
    roleId: 'redteam',
    displayName: 'Red Team Agent',
    baseSystemPrompt: `You are a Red Team Security Specialist. Your role is to:
1. Find security vulnerabilities in proposed implementations
2. Identify attack vectors and edge cases
3. Test for common vulnerabilities (OWASP Top 10)
4. Simulate adversarial attacks
5. Provide exploitation scenarios

Be highly critical and adversarial in your approach. Assume the implementation is vulnerable until proven otherwise.`,
    reasoningStyle: 'adversarial',
    priorityWeight: 15,
    preferredTools: ['runSubagentTool'],
    excludedTools: ['editFileTool'],
    focusModes: ['security', 'vulnerability', 'attack-simulation'],
    modelOverride: undefined
};

export class RedTeamAgent extends Disposable {
    constructor(
        @ICouncilOrchestrator private orchestrator: ICouncilOrchestrator,
        @IAgentProfileManager private profileManager: IAgentProfileManager
    ) {
        super();
        this.profileManager.registerProfile(RED_TEAM_PROFILE);
    }

    public async runRedTeamReview(proposal: string): Promise<RedTeamReport> {
        const vulnerabilities: Vulnerability[] = [];
        
        // Check for common vulnerabilities
        vulnerabilities.push(...await this.checkSQLInjection(proposal));
        vulnerabilities.push(...await this.checkXSS(proposal));
        vulnerabilities.push(...await this.checkAuthBypass(proposal));
        vulnerabilities.push(...await this.checkDataExposure(proposal));

        return {
            vulnerabilities,
            riskScore: this.calculateRiskScore(vulnerabilities),
            recommendations: this.generateRecommendations(vulnerabilities)
        };
    }

    private async checkSQLInjection(proposal: string): Promise<Vulnerability[]> {
        const sqlPatterns = [
            /SELECT.*FROM.*WHERE/i,
            /INSERT.*INTO/i,
            /UPDATE.*SET/i,
            /DELETE.*FROM/i
        ];

        const vulnerabilities: Vulnerability[] = [];
        for (const pattern of sqlPatterns) {
            if (pattern.test(proposal)) {
                vulnerabilities.push({
                    type: 'SQL Injection',
                    severity: 'High',
                    description: 'Potential SQL injection vulnerability detected',
                    recommendation: 'Use parameterized queries or prepared statements'
                });
            }
        }
        return vulnerabilities;
    }
}
```

**Testing**:
- Unit test: Vulnerability detection patterns
- Integration test: Red team review produces actionable reports
- Regression test: Ensure red team doesn't break normal council flow

#### C. Autonomous CI Failure Resolution
**File**: New `councilCIRunner.ts`

```typescript
export class CouncilCIRunner extends Disposable {
    constructor(
        @ICouncilOrchestrator private orchestrator: ICouncilOrchestrator,
        @ITerminalService private terminalService: ITerminalService,
        @ILogService private logService: ILogService
    ) {
        super();
    }

    public async resolveCIFailure(failureLog: string): Promise<CIFixResult> {
        this.logService.info('[Council] Starting autonomous CI failure resolution');

        // Step 1: Analyze failure
        const analysis = await this.analyzeFailure(failureLog);
        
        // Step 2: Spawn council to fix
        const fixResult = await this.orchestrator.executeSession(
            `Fix the following CI failure:\n\n${failureLog}\n\nAnalysis: ${analysis.summary}`
        );

        // Step 3: Apply fix
        const applied = await this.applyFix(fixResult);
        
        // Step 4: Re-run CI
        const ciResult = await this.runCI();

        return {
            analysis,
            fixResult,
            applied,
            ciResult,
            success: ciResult.passed
        };
    }

    private async analyzeFailure(failureLog: string): Promise<FailureAnalysis> {
        const errorPatterns = [
            { pattern: /error TS\d+:/g, type: 'TypeScript Error' },
            { pattern: /eslint.*error/gi, type: 'ESLint Error' },
            { pattern: /test.*failed/gi, type: 'Test Failure' },
            { pattern: /build.*failed/gi, type: 'Build Failure' }
        ];

        const errors: CIError[] = [];
        for (const { pattern, type } of errorPatterns) {
            const matches = failureLog.match(pattern);
            if (matches) {
                errors.push({ type, count: matches.length, details: matches[0] });
            }
        }

        return {
            errors,
            summary: `Found ${errors.length} error types: ${errors.map(e => e.type).join(', ')}`,
            severity: errors.length > 3 ? 'critical' : errors.length > 1 ? 'moderate' : 'simple'
        };
    }

    private async applyFix(fixResult: CouncilResult): Promise<boolean> {
        // Parse fix result for code changes
        const changes = this.parseCodeChanges(fixResult.finalResponse);
        
        for (const change of changes) {
            await this.applyCodeChange(change);
        }

        return changes.length > 0;
    }

    private async runCI(): Promise<CIResult> {
        const output = await this.terminalService.runCommand('npm run ci');
        return {
            passed: output.exitCode === 0,
            output: output.stdout,
            errors: output.stderr
        };
    }
}
```

**Testing**:
- Unit test: Failure analysis pattern matching
- Integration test: End-to-end CI resolution flow
- Regression test: Ensure CI runner doesn't break existing terminal

#### D. Long-Term Project Memory Graph
**File**: New `councilMemoryGraph.ts`

```typescript
export interface MemoryNode {
    id: string;
    type: 'decision' | 'bug' | 'pattern' | 'lesson';
    content: string;
    timestamp: number;
    sessionId: string;
    tags: string[];
    confidence: number;
}

export interface MemoryEdge {
    from: string;
    to: string;
    type: 'related-to' | 'caused-by' | 'resolved-by' | 'depends-on';
    weight: number;
}

export class CouncilMemoryGraph extends Disposable {
    private nodes: Map<string, MemoryNode> = new Map();
    private edges: MemoryEdge[] = [];
    private readonly storageKey = 'council.memoryGraph';

    constructor(
        @IStorageService private storageService: IStorageService,
        @ILogService private logService: ILogService
    ) {
        super();
        this.loadGraph();
    }

    public addDecision(sessionId: string, decision: string, tags: string[], confidence: number): void {
        const node: MemoryNode = {
            id: generateUuid(),
            type: 'decision',
            content: decision,
            timestamp: Date.now(),
            sessionId,
            tags,
            confidence
        };
        this.nodes.set(node.id, node);
        this.saveGraph();
    }

    public addBug(sessionId: string, bug: string, tags: string[]): void {
        const node: MemoryNode = {
            id: generateUuid(),
            type: 'bug',
            content: bug,
            timestamp: Date.now(),
            sessionId,
            tags,
            confidence: 1.0
        };
        this.nodes.set(node.id, node);
        this.saveGraph();
    }

    public queryMemory(query: string, maxResults: number = 5): MemoryNode[] {
        const queryTerms = query.toLowerCase().split(' ');
        
        const scored = Array.from(this.nodes.values()).map(node => {
            const contentLower = node.content.toLowerCase();
            const tagsLower = node.tags.map(t => t.toLowerCase());
            
            let score = 0;
            for (const term of queryTerms) {
                if (contentLower.includes(term)) score += 2;
                if (tagsLower.some(t => t.includes(term))) score += 3;
            }
            
            return { node, score: score * node.confidence };
        });

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map(s => s.node);
    }

    public getRelatedMemory(nodeId: string): MemoryNode[] {
        const relatedIds = this.edges
            .filter(e => e.from === nodeId || e.to === nodeId)
            .map(e => e.from === nodeId ? e.to : e.from);

        return relatedIds
            .map(id => this.nodes.get(id))
            .filter((n): n is MemoryNode => n !== undefined);
    }

    private loadGraph(): void {
        const stored = this.storageService.get(this.storageKey, StorageScope.WORKSPACE, '{}');
        try {
            const data = JSON.parse(stored);
            data.nodes.forEach((n: MemoryNode) => this.nodes.set(n.id, n));
            this.edges = data.edges || [];
        } catch (e) {
            this.logService.warn(`Failed to load council memory graph: ${e}`);
        }
    }

    private saveGraph(): void {
        this.storageService.store(
            this.storageKey,
            JSON.stringify({
                nodes: Array.from(this.nodes.values()),
                edges: this.edges
            }),
            StorageScope.WORKSPACE,
            StorageTarget.USER
        );
    }
}
```

**Testing**:
- Unit test: Memory node addition and querying
- Integration test: Graph persistence across sessions
- Regression test: Ensure memory graph doesn't corrupt storage

### 7.3 Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| Create | `councilMCPIntegration.ts` | MCP server integration |
| Modify | `agentProfileManager.ts` | Add Red Team profile |
| Create | `councilCIRunner.ts` | Autonomous CI resolution |
| Create | `councilMemoryGraph.ts` | Long-term project memory |
| Create | `test/councilAdvanced.test.ts` | Advanced capability tests |

### 7.4 Verification Steps
- [ ] MCP server stores and loads session state
- [ ] Red Team agent detects vulnerabilities
- [ ] CI runner resolves failures autonomously
- [ ] Memory graph persists and queries correctly
- [ ] All Phase 1-3 tests still pass

---

## 8. Phase 5: Enterprise Features

### 8.1 Objectives
- Organization-wide engineering policies
- Company-specific coding standards
- Autonomous PR review boards
- Deployment governance councils

### 8.2 Implementation Steps

#### A. Organization Engineering Policies
**File**: New `councilPolicies.ts`

```typescript
export interface EngineeringPolicy {
    id: string;
    name: string;
    description: string;
    rules: PolicyRule[];
    severity: 'warning' | 'error';
    enabled: boolean;
}

export interface PolicyRule {
    pattern: string;
    message: string;
    fix?: string;
}

export class CouncilPolicyEngine extends Disposable {
    private policies: EngineeringPolicy[] = [];

    constructor(
        @IFileService private fileService: IFileService,
        @ILogService private logService: ILogService
    ) {
        super();
        this.loadPolicies();
    }

    public async evaluateContribution(contribution: string): Promise<PolicyEvaluation> {
        const violations: PolicyViolation[] = [];

        for (const policy of this.policies) {
            if (!policy.enabled) continue;

            for (const rule of policy.rules) {
                const regex = new RegExp(rule.pattern, 'gi');
                if (regex.test(contribution)) {
                    violations.push({
                        policy: policy.name,
                        rule: rule.pattern,
                        message: rule.message,
                        severity: policy.severity,
                        fix: rule.fix
                    });
                }
            }
        }

        return {
            passed: violations.length === 0,
            violations,
            score: this.calculatePolicyScore(violations)
        };
    }

    private async loadPolicies(): Promise<void> {
        const policyPath = URI.file(process.cwd()).with({ path: '/.vscode/council-policies.json' });
        if (await this.fileService.exists(policyPath)) {
            const content = await this.fileService.readFile(policyPath);
            this.policies = JSON.parse(content.value.toString());
        }
    }
}
```

#### B. Autonomous PR Review Board
**File**: New `councilPRReview.ts`

```typescript
export class CouncilPRReviewBoard extends Disposable {
    constructor(
        @ICouncilOrchestrator private orchestrator: ICouncilOrchestrator,
        @IAgentProfileManager private profileManager: IAgentProfileManager,
        @IGitService private gitService: IGitService
    ) {
        super();
    }

    public async reviewPR(prNumber: number): Promise<PRReviewResult> {
        const diff = await this.gitService.getPRDiff(prNumber);
        
        const review = await this.orchestrator.executeSession(
            `Review this PR #${prNumber}:\n\n${diff}`,
            ['security', 'backend', 'qa', 'performance']
        );

        return {
            prNumber,
            review,
            approval: this.calculateApproval(review),
            comments: this.generateComments(review)
        };
    }
}
```

### 8.3 Files to Create/Modify
| Action | File | Purpose |
|--------|------|---------|
| Create | `councilPolicies.ts` | Engineering policy engine |
| Create | `councilPRReview.ts` | Autonomous PR review |
| Create | `test/councilEnterprise.test.ts` | Enterprise feature tests |

---

## 9. Testing Strategy

### 9.1 Test Pyramid

```
                    ┌─────────────┐
                    │   E2E Tests │ (5%)
                    └─────────────┘
                ┌─────────────────────┐
                │ Integration Tests   │ (20%)
                └─────────────────────┘
        ┌─────────────────────────────────┐
        │       Unit Tests                │ (75%)
        └─────────────────────────────────┘
```

### 9.2 Unit Tests (75%)

#### Profile Manager Tests
| Test | Description | Expected |
|------|-------------|----------|
| `loads default profiles` | Verify 6 default profiles load | 6 profiles in registry |
| `builds system prompt` | Verify prompt includes protocol | Contains council protocol |
| `throws on missing profile` | Verify error on invalid role | Error thrown |
| `validates empty roleId` | Verify validation rejects empty | ProfileValidationError |
| `validates invalid reasoningStyle` | Verify validation rejects invalid | ProfileValidationError |
| `registers valid custom profile` | Verify custom profile added | Profile count +1 |
| `builds tool filter` | Verify allowed/excluded tools | Correct arrays |
| `cannot unregister default` | Verify default profiles protected | Error thrown |
| `can unregister custom` | Verify custom profiles removable | Profile count -1 |
| `loads user profiles` | Verify user profiles merge | User profiles override defaults |

#### Orchestrator Tests
| Test | Description | Expected |
|------|-------------|----------|
| `decomposes request` | Verify task graph generation | Valid DAG |
| `validates DAG` | Verify cycle detection | Error on cycle |
| `executes in order` | Verify topological execution | Dependencies first |
| `respects cancellation` | Verify cancellation propagation | CancellationError |
| `handles task failure` | Verify partial success | Some tasks completed |
| `synthesizes result` | Verify final response | Contains contributions |

#### Coordinator Tests
| Test | Description | Expected |
|------|-------------|----------|
| `scores evidence` | Verify citation counting | Correct count |
| `resolves conflict` | Verify priority weighting | Higher priority wins |
| `iteration guard` | Verify loop prevention | Blocks after max |
| `records debate` | Verify debate tracking | Debate in history |
| `resolves debate` | Verify debate resolution | Resolved flag true |

### 9.3 Integration Tests (20%)

| Test | Description | Expected |
|------|-------------|----------|
| `Multi-Agent Parallel Execution` | Verify independent tasks run in parallel | Start times within 100ms |
| `Context Threading` | Verify dependency context passed | t2 sees t1 result |
| `Role Conflict` | Verify different perspectives captured | Multiple viewpoints |
| `Evidence Validation` | Verify file citations checked | Valid/invalid counts |
| `Debate Resolution` | Verify automated resolution | Coherent resolution |
| `Session Persistence` | Verify MCP state storage | State loaded correctly |
| `CI Resolution` | Verify autonomous fix | CI passes after fix |
| `Memory Query` | Verify graph search | Relevant nodes returned |

### 9.4 E2E Tests (5%)

| Test | Description | Expected |
|------|-------------|----------|
| `Council Chat Flow` | End-to-end chat with council | Response with contributions |
| `Configuration UI` | Settings UI interaction | Configuration saved |
| `Dashboard View` | Session list rendering | Sessions displayed |
| `Debate View` | Interactive resolution | Debate resolved |
| `Profile Customization` | Custom profile creation | Profile appears in list |

### 9.5 Test Execution

```bash
# Run all council tests
npm run test -- --grep "Council"

# Run specific phase tests
npm run test -- --grep "Council.*Phase1"
npm run test -- --grep "Council.*Phase2"

# Run with coverage
npm run test:coverage -- --grep "Council"
```

---

## 10. Risk Mitigation

### 10.1 Identified Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Token Explosion** | High | High | Context windowing, summarization, per-agent budgets |
| **Infinite Loops** | Medium | Medium | Iteration guard with hard caps |
| **Latency** | High | High | Parallel execution, speculative spawning |
| **Role Drift** | Medium | Medium | Identity reinforcement, post-processing validation |
| **Decision Paralysis** | Medium | Low | Coordinator override mechanism |
| **Context Contamination** | High | Medium | Session isolation, scoped scratchpads |
| **Model Incompatibility** | Medium | Low | Fallback to default decomposition |
| **Storage Corruption** | Low | Low | Validation on load, graceful degradation |

### 10.2 Mitigation Implementation

#### Token Explosion Prevention
```typescript
private summarizeForContext(text: string, maxTokens: number): string {
    if (this.tokenCounter.count(text) <= maxTokens) return text;
    
    // Phase 1: Simple truncation
    // Phase 2: LLM-based summarization
    return text.substring(0, maxTokens) + '\n...[summarized]';
}
```

#### Latency Reduction
```typescript
private async speculativeSpawn(
    session: CouncilSession,
    predictedNextTasks: CouncilTask[]
): Promise<void> {
    // Start agents that are 80% likely to be needed
    // Cancel if prediction was wrong
    const cts = new CancellationTokenSource();
    
    for (const task of predictedNextTasks) {
        this.executeTask(session, task, cts.token).catch(() => {
            // Prediction was wrong, cancel
            cts.cancel();
        });
    }
}
```

#### Role Drift Prevention
```typescript
private validateRoleAdherence(response: string, expectedRole: string): boolean {
    return response.includes(`<role_id>${expectedRole}</role_id>`);
}

// Post-processing filter
if (!this.validateRoleAdherence(result, profile.roleId)) {
    this.logService.warn(`Role drift detected for ${profile.roleId}`);
    // Request regeneration or apply fallback
}
```

---

## 11. Migration Path

### 11.1 Phase Rollout

| Phase | Timeline | Features | Risk Level |
|-------|----------|----------|------------|
| **Phase 1** | Complete | Foundation, profiles, orchestrator, coordinator | Low |
| **Phase 2** | Week 1-2 | Enhanced evidence, confidence intervals, test runner | Medium |
| **Phase 3** | Week 3-4 | Dashboard, debate view, configuration UI, history | Medium |
| **Phase 4** | Week 5-6 | MCP integration, red team, CI runner, memory graph | High |
| **Phase 5** | Week 7-8 | Policies, PR review, deployment governance | High |

### 11.2 Backward Compatibility

- **Opt-In**: Council is disabled by default; users enable via `chat.council.enabled`
- **Fallback**: If council fails, falls back to single-agent flow
- **Migration**: Existing chat sessions unaffected
- **Deprecation**: No existing features deprecated

### 11.3 Feature Flags

```typescript
export const COUNCIL_FEATURE_FLAGS = {
    ENABLED: 'chat.council.enabled',
    EVIDENCE_VALIDATION: 'chat.council.evidenceValidation',
    DEBATE_VIEW: 'chat.council.enableDebateView',
    MCP_INTEGRATION: 'chat.council.mcpIntegration',
    RED_TEAM: 'chat.council.redTeam',
    CI_RUNNER: 'chat.council.ciRunner',
    MEMORY_GRAPH: 'chat.council.memoryGraph'
};
```

---

## 12. File Inventory

### 12.1 Created Files

| File | Phase | Purpose | Status |
|------|-------|---------|--------|
| `agentProfileManager.ts` | 1 | Profile registry, validation, prompt building | ✅ Complete |
| `councilOrchestrator.ts` | 1 | Task decomposition, execution, synthesis | ✅ Complete |
| `councilCoordinator.ts` | 1 | Evidence scoring, consensus, debate tracking | ✅ Complete |
| `councilParticipant.ts` | 1 | Chat participant integration | ✅ Complete |
| `councilConfiguration.ts` | 1 | VS Code settings registration | ✅ Complete |
| `council.ts` | 1 | Barrel exports | ✅ Complete |
| `councilServiceRegistration.ts` | 1 | DI service registration | ✅ Complete |
| `councilSessionWidget.ts` | 1 | UI session widget | ✅ Complete |
| `councilConfigurationPanel.ts` | 1 | UI configuration panel | ✅ Complete |
| `council.css` | 1 | Styling | ✅ Complete |
| `test/agentProfileManager.test.ts` | 1 | Profile manager tests | ✅ Complete |
| `test/councilCoordinator.test.ts` | 1 | Coordinator tests | ✅ Complete |
| `councilMCPIntegration.ts` | 4 | MCP server integration | 📋 Planned |
| `councilCIRunner.ts` | 4 | Autonomous CI resolution | 📋 Planned |
| `councilMemoryGraph.ts` | 4 | Long-term project memory | 📋 Planned |
| `councilDashboardView.ts` | 3 | Dashboard view | 📋 Planned |
| `councilDashboardTree.ts` | 3 | Tree data provider | 📋 Planned |
| `councilSessionHistory.ts` | 3 | Session history | 📋 Planned |
| `councilPolicies.ts` | 5 | Engineering policies | 📋 Planned |
| `councilPRReview.ts` | 5 | PR review board | 📋 Planned |

### 12.2 Modified Files

| File | Phase | Change | Status |
|------|-------|--------|--------|
| `chat.contribution.ts` | 1 | Added service registrations, participant, configuration | ✅ Complete |

### 12.3 Directory Structure

```
src/vs/workbench/contrib/chat/
├── common/
│   └── council/
│       ├── agentProfileManager.ts
│       ├── councilOrchestrator.ts
│       ├── councilCoordinator.ts
│       ├── councilParticipant.ts
│       ├── councilConfiguration.ts
│       ├── council.ts
│       ├── councilServiceRegistration.ts
│       └── test/
│           ├── agentProfileManager.test.ts
│           └── councilCoordinator.test.ts
└── browser/
    ├── chat.contribution.ts (modified)
    ├── widget/
    │   └── councilSessionWidget.ts
    ├── councilConfigurationPanel.ts
    └── media/
        └── council.css
```

---

## Appendix A: Configuration Reference

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `chat.council.enabled` | boolean | `true` | Enable the Agent Council system |
| `chat.council.defaultStrategy` | enum | `evidence-weighted` | Consensus strategy |
| `chat.council.maxIterations` | number | `3` | Max review iterations |
| `chat.council.enableDebateView` | boolean | `true` | Show debate view |
| `chat.council.autoActivate` | boolean | `false` | Auto-activate on keywords |
| `chat.council.autoActivateKeywords` | string[] | `['architecture', 'refactor', ...]` | Trigger keywords |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/council /plan` | Plan a multi-agent workflow |
| `/council /review` | Review code with multiple specialists |
| `/council /architect` | Architecture discussion with council |
| `/council /security` | Security audit with council |

### Request Parameters

| Parameter | Format | Description |
|-----------|--------|-------------|
| `--roles` | `--roles architect,security` | Select specific agents |
| `--strategy` | `--strategy evidence-weighted` | Override consensus strategy |

---

## Appendix B: Agent Profile Reference

### Default Profiles

| Role | Reasoning Style | Priority | Focus Modes |
|------|-----------------|----------|-------------|
| Architect | Pragmatic | 10 | architecture, design, maintainability |
| Backend | Pragmatic | 8 | implementation, performance, reliability |
| Security | Critical | 12 | security, compliance, vulnerability |
| QA | Critical | 9 | testing, verification, regression |
| DevOps | Pragmatic | 9 | deployment, infrastructure, observability |
| Performance | Optimistic | 8 | performance, optimization, scalability |

### Custom Profile Schema

```json
{
  "roleId": "string (required, unique)",
  "displayName": "string (required)",
  "baseSystemPrompt": "string (required)",
  "reasoningStyle": "critical | pragmatic | optimistic | adversarial",
  "priorityWeight": "number (1-20)",
  "preferredTools": "string[]",
  "excludedTools": "string[] (optional)",
  "maxTokens": "number (optional)",
  "temperature": "number (optional)",
  "focusModes": "string[]",
  "modelOverride": "string (optional)"
}
```

---

## Appendix C: Consensus Strategy Reference

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `evidence-weighted` | Scores based on citations × priority | General purpose |
| `majority` | Most agents agreeing | Non-critical decisions |
| `specialist-priority` | Domain expert overrides | Security, deployment issues |
| `coordinator-override` | Manual selection | Emergency situations |

---

## Appendix D: Evidence Citation Format

| Type | Format | Example |
|------|--------|---------|
| File | `[File:path:line]` | `[File:src/auth.ts:45]` |
| Log | `[Log:identifier]` | `[Log:ci-error-2024]` |
| Test | `[Test:testId]` | `[Test:auth-login-test]` |

---

## Appendix E: Debate Resolution Flow

```
Debate Detected
    ↓
Record Positions
    ↓
Score Evidence
    ↓
Apply Strategy
    ↓
Resolution Generated
    ↓
Record Rationale
    ↓
Update Session State
```

---

## Appendix F: Session Lifecycle

```
Created → Planning → Executing → Reviewing → Completed
                                    ↓
                                 Failed/Cancelled
```

---

*This document is the single source of truth for the Agent Council implementation. All changes should be reflected here.*
