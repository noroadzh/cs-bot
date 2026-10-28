import { describe, it, expect } from '@jest/globals';
import { ImageTaskQueue } from '../src/media/image-task-queue.js';

describe('ImageTaskQueue', () => {
  it('runs tasks serially and deduplicates keys', async () => {
    const q = new ImageTaskQueue();
    const order: string[] = [];
    expect(q.enqueue('a', async () => { order.push('a1'); })).toBe('accepted');
    expect(q.enqueue('a', async () => { order.push('a2'); })).toBe('duplicate');
    expect(q.enqueue('b', async () => { order.push('b'); })).toBe('accepted');
    await q.onIdle();
    expect(order).toEqual(['a1', 'b']);
  });

  it('rejects when the queue is full', async () => {
    const q = new ImageTaskQueue(1);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    expect(q.enqueue('a', async () => { await gate; })).toBe('accepted');
    expect(q.enqueue('b', async () => undefined)).toBe('full');
    release();
    await q.onIdle();
  });
});
