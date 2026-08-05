/**
 * file-write-queue 单元测试（P2-⑲ 文件写队列）
 *
 * 覆盖：
 * - 同一文件路径的写任务串行执行（顺序保证）
 * - 前序任务失败不污染后续任务（错误隔离）
 * - 不同文件路径并行执行（互不等待）
 * - pendingCount / reset 生命周期
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWriteQueueService } from '../file-write-queue.service';

/** 可控 deferred：手动 resolve/reject，用于精确控制任务时序 */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => FileWriteQueueService.reset());
afterEach(() => FileWriteQueueService.reset());

describe('同文件串行', () => {
  it('第二个任务等第一个完成后才执行', async () => {
    const order: string[] = [];
    const gate = deferred();

    const first = FileWriteQueueService.enqueue('/reports/a.md', async () => {
      order.push('task1-start');
      await gate.promise;
      order.push('task1-end');
      return 1;
    });

    const second = FileWriteQueueService.enqueue('/reports/a.md', async () => {
      order.push('task2');
      return 2;
    });

    // 微任务让两个 enqueue 都入队，此时 task1 尚未完成
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['task1-start']);

    gate.resolve();
    const [v1, v2] = await Promise.all([first, second]);
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(order).toEqual(['task1-start', 'task1-end', 'task2']);
  });

  it('Windows 与 Unix 路径分隔符归一为同一队列', async () => {
    const order: string[] = [];
    const gate = deferred();
    const first = FileWriteQueueService.enqueue('C:\\dir\\a.md', async () => {
      order.push('t1');
      await gate.promise;
    });
    const second = FileWriteQueueService.enqueue('C:/dir/a.md', async () => {
      order.push('t2');
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['t1']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['t1', 't2']);
  });
});

describe('错误隔离', () => {
  it('前序任务抛错，后续任务仍正常执行', async () => {
    const first = FileWriteQueueService.enqueue('/x.txt', async () => {
      throw new Error('write failed');
    });
    const second = FileWriteQueueService.enqueue('/x.txt', async () => 'ok');

    await expect(first).rejects.toThrow('write failed');
    await expect(second).resolves.toBe('ok');
  });

  it('失败后再次入队仍可执行（尾部指针未被污染）', async () => {
    await expect(
      FileWriteQueueService.enqueue('/y.txt', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(FileWriteQueueService.enqueue('/y.txt', async () => 'after-fail')).resolves.toBe('after-fail');
  });
});

describe('不同文件并行', () => {
  it('两个不同路径的任务并发执行，互不等待', async () => {
    const gateA = deferred();
    const gateB = deferred();
    let aRunning = false;
    let bRunning = false;
    let bothRunning = false;

    const a = FileWriteQueueService.enqueue('/a.md', async () => {
      aRunning = true;
      await gateA.promise;
      aRunning = false;
    });
    const b = FileWriteQueueService.enqueue('/b.md', async () => {
      bRunning = true;
      if (aRunning) bothRunning = true;
      await gateB.promise;
      bRunning = false;
    });

    await new Promise((r) => setTimeout(r, 20));
    // 若并行，b 启动时 a 仍在运行（aRunning=true）
    gateA.resolve();
    gateB.resolve();
    await Promise.all([a, b]);
    expect(bothRunning).toBe(true);
  });
});

describe('生命周期', () => {
  it('pendingCount 统计待处理文件数，完成后清零（setImmediate 后）', async () => {
    const gate = deferred();
    const run = FileWriteQueueService.enqueue('/z.md', async () => {
      await gate.promise;
    });
    expect(FileWriteQueueService.pendingCount()).toBeGreaterThanOrEqual(1);
    gate.resolve();
    await run;
    // 清理是 setImmediate 异步执行
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));
    expect(FileWriteQueueService.pendingCount()).toBe(0);
  });

  it('reset 清空队列', () => {
    const gate = deferred();
    void FileWriteQueueService.enqueue('/w.md', async () => {
      await gate.promise;
    });
    FileWriteQueueService.reset();
    expect(FileWriteQueueService.pendingCount()).toBe(0);
  });
});
