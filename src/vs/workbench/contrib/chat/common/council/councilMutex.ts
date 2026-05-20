/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class CouncilMutex {
	private locked = false;
	private readonly queue: Array<() => void> = [];

	public async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}

		return new Promise<void>(resolve => {
			this.queue.push(resolve);
		});
	}

	public release(): void {
		if (this.queue.length > 0) {
			const next = this.queue.shift()!;
			next();
		} else {
			this.locked = false;
		}
	}

	public async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}
}

export class CouncilReadWriteLock {
	private readCount = 0;
	private writeLocked = false;
	private readonly readQueue: Array<() => void> = [];
	private readonly writeQueue: Array<() => void> = [];

	public async acquireRead(): Promise<void> {
		if (!this.writeLocked) {
			this.readCount++;
			return;
		}

		return new Promise<void>(resolve => {
			this.readQueue.push(resolve);
		});
	}

	public releaseRead(): void {
		this.readCount--;
		if (this.readCount === 0 && this.writeQueue.length > 0) {
			this.writeLocked = true;
			const next = this.writeQueue.shift()!;
			next();
		}
	}

	public async acquireWrite(): Promise<void> {
		if (this.readCount === 0 && !this.writeLocked) {
			this.writeLocked = true;
			return;
		}

		return new Promise<void>(resolve => {
			this.writeQueue.push(resolve);
		});
	}

	public releaseWrite(): void {
		if (this.readQueue.length > 0) {
			this.writeLocked = false;
			while (this.readQueue.length > 0) {
				this.readCount++;
				const next = this.readQueue.shift()!;
				next();
			}
		} else if (this.writeQueue.length > 0) {
			const next = this.writeQueue.shift()!;
			next();
		} else {
			this.writeLocked = false;
		}
	}

	public async runRead<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquireRead();
		try {
			return await fn();
		} finally {
			this.releaseRead();
		}
	}

	public async runWrite<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquireWrite();
		try {
			return await fn();
		} finally {
			this.releaseWrite();
		}
	}
}
