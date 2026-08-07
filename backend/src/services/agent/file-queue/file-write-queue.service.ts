/**
 * FileWriteQueueService — Agent 文件写队列（P2-⑲）
 *
 * 对同一文件路径的写操作做串行化（promise 链），防止并发写冲突
 * （如 Agent 多步工具调用同时写同一报告/同一被编辑文件）。
 *
 * 对齐 pi 引擎 file-mutation-queue：同文件串行，不同文件可并行。
 *
 * 用法：
 *   await FileWriteQueueService.enqueue(filePath, async () => {
 *     await fs.promises.writeFile(filePath, content);
 *   });
 *
 * 设计：
 * - 内部 Map<filePath, Promise> 维护每文件的最新尾任务
 * - enqueue 把新任务链到尾部（prev.then(task)），返回该任务结果
 * - 链中断（task 抛错）不污染后续：用 catch 接住并把结果 reject 给调用方，
 *   但尾部指针仍指向 catch 后的 promise，后续任务正常排队
 */

export class FileWriteQueueService {
  private static tails = new Map<string, Promise<unknown>>();

  /**
   * 排队执行写任务（同文件串行）
   * @param filePath 文件路径（按规范化后路径分队列）
   * @param task 写操作，必须是纯写（读改写需在 task 内部读最新内容）
   * @returns task 的返回值（task 抛错则 reject）
   */
  static enqueue<T>(filePath: string, task: () => Promise<T>): Promise<T> {
    // 键归一化：统一分隔符 + 小写（Windows 路径大小写不敏感，
    // 原实现仅 \→/ 转换，同一文件的大小写变体可绕过写串行化）
    const key = filePath.replace(/\\/g, '/').toLowerCase();
    const prev = this.tails.get(key) || Promise.resolve();
    const run = prev.then(() => task());
    // 尾部指针指向 catch 后的 promise：即使 task 失败，后续任务也能继续排队
    const tail = run.catch(() => undefined);
    this.tails.set(key, tail);
    // 清理：run settle 后若仍是最新尾，删除条目避免 Map 膨胀（setImmediate 让后续任务先入队再清理，
    // 避免清理过早导致「新任务已基于旧 tail 入队、旧 tail 又被删」的竞态）
    const cleanup = () => {
      setImmediate(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    };
    run.then(cleanup, cleanup);
    return run;
  }

  /** 当前排队中的文件数（诊断用） */
  static pendingCount(): number {
    return this.tails.size;
  }

  /** 清空队列（测试/重置用） */
  static reset(): void {
    this.tails.clear();
  }
}
