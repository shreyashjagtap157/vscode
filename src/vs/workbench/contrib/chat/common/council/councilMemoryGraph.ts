/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';

export const ICouncilMemoryGraph = createDecorator<ICouncilMemoryGraph>('councilMemoryGraph');

export enum MemoryNodeType {
	Decision = 'decision',
	Bug = 'bug',
	Pattern = 'pattern',
	Lesson = 'lesson',
	Architecture = 'architecture',
	Configuration = 'configuration',
	Dependency = 'dependency'
}

export enum MemoryEdgeType {
	RelatedTo = 'related-to',
	CausedBy = 'caused-by',
	ResolvedBy = 'resolved-by',
	DependsOn = 'depends-on',
	ConflictsWith = 'conflicts-with',
	Implements = 'implements',
	Refactors = 'refactors'
}

export interface MemoryNode {
	id: string;
	type: MemoryNodeType;
	title: string;
	content: string;
	timestamp: number;
	sessionId: string;
	createdBy: string;
	tags: string[];
	confidence: number;
	metadata: Record<string, any>;
}

export interface MemoryEdge {
	id: string;
	from: string;
	to: string;
	type: MemoryEdgeType;
	weight: number;
	description?: string;
	timestamp: number;
}

export interface MemoryQuery {
	nodeTypes?: MemoryNodeType[];
	tags?: string[];
	sessionId?: string;
	timeRange?: { start: number; end: number };
	minConfidence?: number;
	limit?: number;
}

export interface MemoryGraphStats {
	totalNodes: number;
	totalEdges: number;
	nodeTypeDistribution: Record<MemoryNodeType, number>;
	averageConfidence: number;
	mostCommonTags: Array<{ tag: string; count: number }>;
}

export interface ICouncilMemoryGraph extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onNodeAdded: Event<MemoryNode>;
	readonly onEdgeAdded: Event<MemoryEdge>;

	addNode(node: Omit<MemoryNode, 'id' | 'timestamp'>): MemoryNode;
	addEdge(edge: Omit<MemoryEdge, 'id' | 'timestamp'>): MemoryEdge;
	getNode(nodeId: string): MemoryNode | undefined;
	getEdge(edgeId: string): MemoryEdge | undefined;

	queryMemory(query: MemoryQuery): MemoryNode[];
	getRelatedNodes(nodeId: string): MemoryNode[];
	getNodeHistory(nodeId: string): MemoryNode[];

	getStats(): MemoryGraphStats;
	getRecentNodes(limit?: number): MemoryNode[];
	getNodesByTag(tag: string): MemoryNode[];
	getNodesByType(type: MemoryNodeType): MemoryNode[];
	getNodesBySession(sessionId: string): MemoryNode[];

	exportGraph(): { nodes: MemoryNode[]; edges: MemoryEdge[] };
	importGraph(data: { nodes: MemoryNode[]; edges: MemoryEdge[] }): void;
	clearGraph(): void;
}

export class CouncilMemoryGraph extends Disposable implements ICouncilMemoryGraph {
	declare readonly _serviceBrand: undefined;

	private readonly _onNodeAdded = this._register(new Emitter<MemoryNode>());
	readonly onNodeAdded: Event<MemoryNode> = this._onNodeAdded.event;

	private readonly _onEdgeAdded = this._register(new Emitter<MemoryEdge>());
	readonly onEdgeAdded: Event<MemoryEdge> = this._onEdgeAdded.event;

	private readonly nodes = new Map<string, MemoryNode>();
	private readonly edges = new Map<string, MemoryEdge>();
	private readonly adjacencyList = new Map<string, Set<string>>();

	private readonly storageKey = 'council.memoryGraph';
	private readonly MAX_NODES = 1000;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this.loadGraph();
		this.logService.info(`[CouncilMemoryGraph] Initialized with ${this.nodes.size} nodes and ${this.edges.size} edges`);
	}

	public addNode(node: Omit<MemoryNode, 'id' | 'timestamp'>): MemoryNode {
		const fullNode: MemoryNode = {
			...node,
			id: generateUuid(),
			timestamp: Date.now()
		};

		if (this.nodes.size >= this.MAX_NODES) {
			this.evictOldestNode();
		}

		this.nodes.set(fullNode.id, fullNode);
		if (!this.adjacencyList.has(fullNode.id)) {
			this.adjacencyList.set(fullNode.id, new Set());
		}

		this._onNodeAdded.fire(fullNode);
		this.saveGraph();

		this.logService.debug(`[CouncilMemoryGraph] Added node: ${fullNode.title} (${fullNode.type})`);

		return fullNode;
	}

	public addEdge(edge: Omit<MemoryEdge, 'id' | 'timestamp'>): MemoryEdge {
		const fullEdge: MemoryEdge = {
			...edge,
			id: generateUuid(),
			timestamp: Date.now()
		};

		if (!this.nodes.has(fullEdge.from) || !this.nodes.has(fullEdge.to)) {
			this.logService.warn(`[CouncilMemoryGraph] Cannot add edge: node not found`);
			return fullEdge;
		}

		this.edges.set(fullEdge.id, fullEdge);

		if (!this.adjacencyList.has(fullEdge.from)) {
			this.adjacencyList.set(fullEdge.from, new Set());
		}
		this.adjacencyList.get(fullEdge.from)!.add(fullEdge.to);

		this._onEdgeAdded.fire(fullEdge);
		this.saveGraph();

		this.logService.debug(`[CouncilMemoryGraph] Added edge: ${fullEdge.from} -> ${fullEdge.to} (${fullEdge.type})`);

		return fullEdge;
	}

	public getNode(nodeId: string): MemoryNode | undefined {
		return this.nodes.get(nodeId);
	}

	public getEdge(edgeId: string): MemoryEdge | undefined {
		return this.edges.get(edgeId);
	}

	public queryMemory(query: MemoryQuery): MemoryNode[] {
		let results = Array.from(this.nodes.values());

		if (query.nodeTypes && query.nodeTypes.length > 0) {
			results = results.filter(n => query.nodeTypes!.includes(n.type));
		}

		if (query.tags && query.tags.length > 0) {
			results = results.filter(n => query.tags!.some(t => n.tags.includes(t)));
		}

		if (query.sessionId) {
			results = results.filter(n => n.sessionId === query.sessionId);
		}

		if (query.timeRange) {
			results = results.filter(n =>
				n.timestamp >= query.timeRange!.start && n.timestamp <= query.timeRange!.end
			);
		}

		if (query.minConfidence !== undefined) {
			results = results.filter(n => n.confidence >= query.minConfidence!);
		}

		results.sort((a, b) => b.timestamp - a.timestamp);

		if (query.limit) {
			results = results.slice(0, query.limit);
		}

		return results;
	}

	public getRelatedNodes(nodeId: string): MemoryNode[] {
		const relatedIds = this.adjacencyList.get(nodeId) || new Set();
		const related: MemoryNode[] = [];

		for (const edge of this.edges.values()) {
			if (edge.from === nodeId) {
				const node = this.nodes.get(edge.to);
				if (node) related.push(node);
			}
			if (edge.to === nodeId) {
				const node = this.nodes.get(edge.from);
				if (node) related.push(node);
			}
		}

		return related;
	}

	public getNodeHistory(nodeId: string): MemoryNode[] {
		return Array.from(this.nodes.values())
			.filter(n => n.id === nodeId || this.getRelatedNodes(n.id).some(r => r.id === nodeId))
			.sort((a, b) => b.timestamp - a.timestamp);
	}

	public getStats(): MemoryGraphStats {
		const nodeTypeDistribution = {} as Record<MemoryNodeType, number>;
		for (const type of Object.values(MemoryNodeType)) {
			nodeTypeDistribution[type] = 0;
		}

		const tagCounts = new Map<string, number>();
		let totalConfidence = 0;

		for (const node of this.nodes.values()) {
			nodeTypeDistribution[node.type]++;
			totalConfidence += node.confidence;

			for (const tag of node.tags) {
				tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
			}
		}

		const mostCommonTags = Array.from(tagCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([tag, count]) => ({ tag, count }));

		return {
			totalNodes: this.nodes.size,
			totalEdges: this.edges.size,
			nodeTypeDistribution,
			averageConfidence: this.nodes.size > 0 ? totalConfidence / this.nodes.size : 0,
			mostCommonTags
		};
	}

	public getRecentNodes(limit: number = 10): MemoryNode[] {
		return Array.from(this.nodes.values())
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, limit);
	}

	public getNodesByTag(tag: string): MemoryNode[] {
		return Array.from(this.nodes.values()).filter(n => n.tags.includes(tag));
	}

	public getNodesByType(type: MemoryNodeType): MemoryNode[] {
		return Array.from(this.nodes.values()).filter(n => n.type === type);
	}

	public getNodesBySession(sessionId: string): MemoryNode[] {
		return Array.from(this.nodes.values()).filter(n => n.sessionId === sessionId);
	}

	public exportGraph(): { nodes: MemoryNode[]; edges: MemoryEdge[] } {
		return {
			nodes: Array.from(this.nodes.values()),
			edges: Array.from(this.edges.values())
		};
	}

	public importGraph(data: { nodes: MemoryNode[]; edges: MemoryEdge[] }): void {
		this.nodes.clear();
		this.edges.clear();
		this.adjacencyList.clear();

		for (const node of data.nodes) {
			this.nodes.set(node.id, node);
			if (!this.adjacencyList.has(node.id)) {
				this.adjacencyList.set(node.id, new Set());
			}
		}

		for (const edge of data.edges) {
			this.edges.set(edge.id, edge);
			if (!this.adjacencyList.has(edge.from)) {
				this.adjacencyList.set(edge.from, new Set());
			}
			this.adjacencyList.get(edge.from)!.add(edge.to);
		}

		this.saveGraph();
		this.logService.info(`[CouncilMemoryGraph] Imported ${data.nodes.length} nodes and ${data.edges.length} edges`);
	}

	public clearGraph(): void {
		this.nodes.clear();
		this.edges.clear();
		this.adjacencyList.clear();
		this.saveGraph();
		this.logService.info('[CouncilMemoryGraph] Graph cleared');
	}

	public addDecision(sessionId: string, title: string, content: string, tags: string[], confidence: number, createdBy: string): MemoryNode {
		return this.addNode({
			type: MemoryNodeType.Decision,
			title,
			content,
			sessionId,
			createdBy,
			tags,
			confidence,
			metadata: {}
		});
	}

	public addBug(sessionId: string, title: string, content: string, tags: string[], createdBy: string): MemoryNode {
		return this.addNode({
			type: MemoryNodeType.Bug,
			title,
			content,
			sessionId,
			createdBy,
			tags,
			confidence: 1.0,
			metadata: {}
		});
	}

	public addLesson(sessionId: string, title: string, content: string, tags: string[], confidence: number, createdBy: string): MemoryNode {
		return this.addNode({
			type: MemoryNodeType.Lesson,
			title,
			content,
			sessionId,
			createdBy,
			tags,
			confidence,
			metadata: {}
		});
	}

	private evictOldestNode(): void {
		let oldest: MemoryNode | undefined;
		for (const node of this.nodes.values()) {
			if (!oldest || node.timestamp < oldest.timestamp) {
				oldest = node;
			}
		}

		if (oldest) {
			this.nodes.delete(oldest.id);
			this.adjacencyList.delete(oldest.id);

			for (const [edgeId, edge] of this.edges.entries()) {
				if (edge.from === oldest.id || edge.to === oldest.id) {
					this.edges.delete(edgeId);
				}
			}

			this.logService.debug(`[CouncilMemoryGraph] Evicted oldest node: ${oldest.title}`);
		}
	}

	private loadGraph(): void {
		try {
			const stored = this.storageService.get(this.storageKey, StorageScope.WORKSPACE, '{}');
			const data = JSON.parse(stored);

			if (data.nodes) {
				for (const node of data.nodes) {
					this.nodes.set(node.id, node);
					if (!this.adjacencyList.has(node.id)) {
						this.adjacencyList.set(node.id, new Set());
					}
				}
			}

			if (data.edges) {
				for (const edge of data.edges) {
					this.edges.set(edge.id, edge);
					if (!this.adjacencyList.has(edge.from)) {
						this.adjacencyList.set(edge.from, new Set());
					}
					this.adjacencyList.get(edge.from)!.add(edge.to);
				}
			}
		} catch (error) {
			this.logService.warn(`[CouncilMemoryGraph] Failed to load graph: ${error}`);
		}
	}

	private saveGraph(): void {
		try {
			const data = {
				nodes: Array.from(this.nodes.values()),
				edges: Array.from(this.edges.values())
			};
			this.storageService.store(
				this.storageKey,
				JSON.stringify(data),
				StorageScope.WORKSPACE,
				StorageTarget.USER
			);
		} catch (error) {
			this.logService.warn(`[CouncilMemoryGraph] Failed to save graph: ${error}`);
		}
	}
}
