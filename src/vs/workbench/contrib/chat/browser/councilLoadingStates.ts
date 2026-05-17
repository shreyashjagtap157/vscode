/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { $, append, clearNode } from '../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';

export interface LoadingState {
	readonly isLoading: boolean;
	readonly message?: string;
	readonly progress?: number;
}

export class LoadingIndicator extends Disposable {
	readonly domNode: HTMLElement;

	private readonly spinner: HTMLElement;
	private readonly messageNode: HTMLElement;
	private readonly progressBar: HTMLElement;
	private readonly _onComplete = this._register(new Emitter<void>());
	readonly onComplete = this._onComplete.event;

	private state: LoadingState = { isLoading: false };

	constructor(container: HTMLElement) {
		super();

		this.domNode = append(container, $('.council-loading-indicator'));
		this.domNode.style.display = 'none';
		this.domNode.style.flexDirection = 'column';
		this.domNode.style.alignItems = 'center';
		this.domNode.style.justifyContent = 'center';
		this.domNode.style.padding = '20px';
		this.domNode.style.gap = '12px';

		this.spinner = append(this.domNode, $('.council-loading-spinner'));
		this.spinner.innerHTML = '<div class="council-spinner-dot"></div><div class="council-spinner-dot"></div><div class="council-spinner-dot"></div>';

		this.messageNode = append(this.domNode, $('.council-loading-message', {}, ''));
		this.messageNode.style.fontSize = '13px';
		this.messageNode.style.color = 'var(--vscode-descriptionForeground)';

		this.progressBar = append(this.domNode, $('.council-loading-progress-bar'));
		this.progressBar.style.width = '100%';
		this.progressBar.style.height = '4px';
		this.progressBar.style.borderRadius = '2px';
		this.progressBar.style.overflow = 'hidden';

		const progressFill = append(this.progressBar, $('.council-progress-fill'));
		progressFill.style.width = '0%';
		progressFill.style.height = '100%';
		progressFill.style.background = 'var(--vscode-progressBar-background)';
		progressFill.style.transition = 'width 0.3s ease';
	}

	public show(message?: string, progress?: number): void {
		this.state = { isLoading: true, message, progress };
		this.domNode.style.display = 'flex';
		this.messageNode.textContent = message ?? 'Loading...';

		if (progress !== undefined) {
			const fill = this.progressBar.querySelector('.council-progress-fill') as HTMLElement;
			if (fill) {
				fill.style.width = `${progress}%`;
			}
		}
	}

	public hide(): void {
		this.state = { isLoading: false };
		this.domNode.style.display = 'none';
		this._onComplete.fire();
	}

	public updateProgress(progress: number): void {
		const fill = this.progressBar.querySelector('.council-progress-fill') as HTMLElement;
		if (fill) {
			fill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
		}
	}

	public updateMessage(message: string): void {
		this.messageNode.textContent = message;
	}

	public getState(): LoadingState {
		return this.state;
	}
}

export class ErrorBoundary extends Disposable {
	readonly domNode: HTMLElement;

	private readonly errorIcon: HTMLElement;
	private readonly titleNode: HTMLElement;
	private readonly messageNode: HTMLElement;
	private readonly actionNode: HTMLElement;
	private readonly retryButton: HTMLElement;
	private readonly detailsNode: HTMLElement;

	private onRetry?: () => void;

	constructor(container: HTMLElement) {
		super();

		this.domNode = append(container, $('.council-error-boundary'));
		this.domNode.style.display = 'none';
		this.domNode.style.flexDirection = 'column';
		this.domNode.style.alignItems = 'center';
		this.domNode.style.justifyContent = 'center';
		this.domNode.style.padding = '24px';
		this.domNode.style.gap = '16px';
		this.domNode.style.textAlign = 'center';

		this.errorIcon = append(this.domNode, $('.council-error-icon'));
		this.errorIcon.style.fontSize = '32px';
		this.errorIcon.textContent = '⚠️';

		this.titleNode = append(this.domNode, $('.council-error-title', {}, ''));
		this.titleNode.style.fontSize = '14px';
		this.titleNode.style.fontWeight = '600';
		this.titleNode.style.color = 'var(--vscode-errorForeground)';

		this.messageNode = append(this.domNode, $('.council-error-message', {}, ''));
		this.messageNode.style.fontSize = '13px';
		this.messageNode.style.color = 'var(--vscode-descriptionForeground)';
		this.messageNode.style.maxWidth = '400px';

		this.actionNode = append(this.domNode, $('.council-error-action', {}, ''));
		this.actionNode.style.fontSize = '12px';
		this.actionNode.style.color = 'var(--vscode-textLink-foreground)';
		this.actionNode.style.marginTop = '8px';

		this.retryButton = append(this.domNode, $('button.council-error-retry-btn', {}, 'Retry'));
		this.retryButton.style.padding = '6px 16px';
		this.retryButton.style.borderRadius = '4px';
		this.retryButton.style.border = '1px solid var(--vscode-button-border)';
		this.retryButton.style.background = 'var(--vscode-button-background)';
		this.retryButton.style.color = 'var(--vscode-button-foreground)';
		this.retryButton.style.cursor = 'pointer';
		this.retryButton.style.marginTop = '12px';

		this._register(this.domNode.addEventListener('click', (e) => {
			if (e.target === this.retryButton && this.onRetry) {
				this.onRetry();
			}
		}));

		this.detailsNode = append(this.domNode, $('.council-error-details', {}, ''));
		this.detailsNode.style.fontSize = '11px';
		this.detailsNode.style.color = 'var(--vscode-descriptionForeground)';
		this.detailsNode.style.marginTop = '8px';
		this.detailsNode.style.display = 'none';
	}

	public show(title: string, message: string, actionableSuggestion?: string, onRetry?: () => void): void {
		this.domNode.style.display = 'flex';
		this.titleNode.textContent = title;
		this.messageNode.textContent = message;

		if (actionableSuggestion) {
			this.actionNode.textContent = `💡 ${actionableSuggestion}`;
			this.actionNode.style.display = 'block';
		} else {
			this.actionNode.style.display = 'none';
		}

		this.onRetry = onRetry;
		this.retryButton.style.display = onRetry ? 'block' : 'none';
	}

	public hide(): void {
		this.domNode.style.display = 'none';
	}

	public showDetails(details: string): void {
		this.detailsNode.textContent = details;
		this.detailsNode.style.display = 'block';
	}
}

export class SkeletonLoader extends Disposable {
	readonly domNode: HTMLElement;

	private readonly items: HTMLElement[];

	constructor(container: HTMLElement, itemCount: number = 3) {
		super();

		this.domNode = append(container, $('.council-skeleton-loader'));
		this.domNode.style.display = 'flex';
		this.domNode.style.flexDirection = 'column';
		this.domNode.style.gap = '12px';
		this.domNode.style.padding = '16px';

		this.items = [];
		for (let i = 0; i < itemCount; i++) {
			const item = append(this.domNode, $('.council-skeleton-item'));
			item.style.height = `${20 + Math.random() * 30}px`;
			item.style.borderRadius = '4px';
			item.style.background = 'linear-gradient(90deg, var(--vscode-editor-background) 25%, var(--vscode-editor-lineHighlightBackground) 50%, var(--vscode-editor-background) 75%)';
			item.style.backgroundSize = '200% 100%';
			item.style.animation = 'council-skeleton-pulse 1.5s ease-in-out infinite';
			this.items.push(item);
		}
	}

	public hide(): void {
		this.domNode.style.display = 'none';
	}

	public show(): void {
		this.domNode.style.display = 'flex';
	}
}
