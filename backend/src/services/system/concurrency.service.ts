import { redisClient } from '../../utils/redis';
import { WebSocketService } from './websocket.service';
import { EventEmitter } from 'events';

const GLOBAL_CONCURRENCY_KEY = 'review:global:concurrency';
const GLOBAL_QUEUE_KEY = 'review:global:queue';
const RELEASE_CHANNEL = 'review:global:release';   // 槽位释放事件频道（跨进程唤醒等待者）
const DEFAULT_GLOBAL_LIMIT = 15;
const SAFETY_POLL_MS = 10000;   // 兜底轮询间隔：万一漏收释放信号，最长 10s 重试一次（以事件驱动为主）
const MAX_WAIT_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟最大等待时间

/**
 * 全局并发控制服务
 * 使用 Redis 管理跨用户的全局审查任务并发上限 + 排队机制
 */
export class ConcurrencyService {
  // 事件驱动唤醒：本进程内的释放事件总线 + Redis 订阅（跨进程）
  private static releaseEmitter = new EventEmitter();
  private static subInitialized = false;
  private static subClient: ReturnType<typeof redisClient.getClient> | null = null;

  /**
   * 确保已订阅释放频道：收到任一进程的 releaseSlot 信号后，唤醒本进程的等待者。
   * 使用独立订阅连接（ioredis 订阅模式下不能再执行普通命令）。
   */
  private static ensureSubscriber(): void {
    if (this.subInitialized) return;
    this.subInitialized = true;
    this.releaseEmitter.setMaxListeners(0); // 等待者可能较多，禁用监听器上限告警
    try {
      this.subClient = redisClient.getClient().duplicate();
      this.subClient.subscribe(RELEASE_CHANNEL, (err) => {
        if (err) {
          this.subInitialized = false;
          console.error('[Concurrency] 订阅释放频道失败，退化为定时轮询:', err.message);
        }
      });
      this.subClient.on('message', () => this.releaseEmitter.emit('release'));
    } catch (e) {
      this.subInitialized = false;
      console.warn('[Concurrency] 释放信号订阅初始化失败，退化为定时轮询:', (e as Error).message);
    }
  }

  /**
   * 等待一次释放信号，或到达兜底超时（二者先到为准）。
   */
  private static waitForRelease(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const onRelease = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { this.releaseEmitter.off('release', onRelease); resolve(); }, timeoutMs);
      this.releaseEmitter.once('release', onRelease);
    });
  }

  /**
   * 获取全局并发上限（从 SystemConfig 或默认值）
   */
  static async getGlobalLimit(): Promise<number> {
    try {
      const prisma = (await import('../../config/db')).default;
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'basic_settings' } });
      if (cfg?.value && typeof cfg.value === 'object') {
        const limit = (cfg.value as any).globalConcurrencyLimit;
        if (typeof limit === 'number' && limit > 0) return limit;
      }
    } catch {}
    return DEFAULT_GLOBAL_LIMIT;
  }

  /**
   * 获取当前全局并发数
   */
  static async getCurrentCount(): Promise<number> {
    const val = await redisClient.get<string>(GLOBAL_CONCURRENCY_KEY);
    return parseInt(val as string || '0', 10) || 0;
  }

  /**
   * 尝试获取全局并发槽位
   * @returns true=获取成功, false=需要排队
   */
  static async acquireSlot(taskId: string, userId: string): Promise<boolean> {
    const limit = await this.getGlobalLimit();
    const client = redisClient.getClient();

    // 原子操作：检查并递增
    const current = await client.incr(GLOBAL_CONCURRENCY_KEY);
    if (current <= limit) {
      // 获取成功，设置过期时间兜底（防止泄漏）
      await client.expire(GLOBAL_CONCURRENCY_KEY, 3600);
      console.log(`[Concurrency] 任务 ${taskId} 获取全局槽位 (${current}/${limit})`);
      return true;
    }

    // 超出限制，递减并加入排队
    await client.decr(GLOBAL_CONCURRENCY_KEY);
    await this.enqueue(taskId, userId);
    return false;
  }

  /**
   * 释放全局并发槽位
   */
  static async releaseSlot(taskId: string): Promise<void> {
    const client = redisClient.getClient();
    const current = await client.decr(GLOBAL_CONCURRENCY_KEY);
    if (current < 0) {
      await client.set(GLOBAL_CONCURRENCY_KEY, '0');
    }
    console.log(`[Concurrency] 任务 ${taskId} 释放全局槽位 (剩余 ${Math.max(0, current)})`);

    // 通知队列中的下一个任务（WebSocket 提示）
    await this.notifyNextInQueue();

    // 发布释放信号：唤醒所有进程中正在等待槽位的任务（事件驱动，替代忙等轮询）
    try {
      await client.publish(RELEASE_CHANNEL, taskId);
    } catch (e) {
      console.warn('[Concurrency] 发布释放信号失败（不影响主流程）:', (e as Error).message);
    }
  }

  /**
   * 将任务加入排队
   */
  private static async enqueue(taskId: string, userId: string): Promise<void> {
    // 幂等：已在队列中则不重复入队（避免 waitForSlot 重试时产生重复条目、不断押到队尾）
    const existing = await this.getQueuePosition(taskId);
    if (existing > 0) return;
    const score = Date.now();
    await redisClient.getClient().zadd(GLOBAL_QUEUE_KEY, score, JSON.stringify({ taskId, userId, enqueuedAt: score }));
    const position = await this.getQueuePosition(taskId);
    console.log(`[Concurrency] 任务 ${taskId} 加入排队 (位置 ${position})`);

    // WebSocket 推送排队位置
    WebSocketService.emitTaskProgress(taskId, {
      type: 'queued',
      step: '排队中',
      progress: 0,
      message: `当前排队位置: ${position}`,
      timestamp: Date.now(),
    } as any);
  }

  /**
   * 获取任务在队列中的位置（1-based）
   */
  static async getQueuePosition(taskId: string): Promise<number> {
    const queue = await redisClient.getClient().zrange(GLOBAL_QUEUE_KEY, 0, -1);
    for (let i = 0; i < queue.length; i++) {
      try {
        const item = JSON.parse(queue[i]);
        if (item.taskId === taskId) return i + 1;
      } catch {}
    }
    return -1;
  }

  /**
   * 从队列中移除任务
   */
  static async dequeue(taskId: string): Promise<void> {
    const queue = await redisClient.getClient().zrange(GLOBAL_QUEUE_KEY, 0, -1);
    for (const item of queue) {
      try {
        const parsed = JSON.parse(item);
        if (parsed.taskId === taskId) {
          await redisClient.getClient().zrem(GLOBAL_QUEUE_KEY, item);
          break;
        }
      } catch {}
    }
  }

  /**
   * 通知队列中的下一个任务
   */
  private static async notifyNextInQueue(): Promise<void> {
    const limit = await this.getGlobalLimit();
    const current = await this.getCurrentCount();
    if (current >= limit) return;

    // 取队列第一个
    const items = await redisClient.getClient().zrange(GLOBAL_QUEUE_KEY, 0, 0);
    if (items.length === 0) return;

    try {
      const item = JSON.parse(items[0]);
      const position = 1;
      WebSocketService.emitTaskProgress(item.taskId, {
        type: 'queue_ready',
        step: '排队结束',
        progress: 0,
        message: '已获得处理槽位，即将开始审查',
        timestamp: Date.now(),
      } as any);
    } catch {}
  }

  /**
   * 等待获取全局槽位（带排队位置更新和超时保护）
   * @throws 超过最大等待时间时抛出错误
   */
  static async waitForSlot(taskId: string, userId: string): Promise<void> {
    // 先尝试直接获取
    if (await this.acquireSlot(taskId, userId)) return;

    // 确保已订阅释放频道（事件驱动唤醒）
    this.ensureSubscriber();

    const deadline = Date.now() + MAX_WAIT_TIMEOUT_MS;

    // 事件驱动等待：被释放信号唤醒后立即重试；兜底以 SAFETY_POLL_MS 周期重试，防漏信号
    while (Date.now() < deadline) {
      // 等待「释放信号」或「兜底超时」先到者
      const remaining = deadline - Date.now();
      await this.waitForRelease(Math.min(SAFETY_POLL_MS, Math.max(0, remaining)));

      try {
        // 更新排队位置
        const position = await this.getQueuePosition(taskId);
        if (position > 0) {
          WebSocketService.emitTaskProgress(taskId, {
            type: 'queue_update',
            step: '排队中',
            progress: 0,
            message: `排队位置: ${position}`,
            timestamp: Date.now(),
          } as any);
        }

        // 尝试获取
        if (await this.acquireSlot(taskId, userId)) {
          // 从队列中移除
          await this.dequeue(taskId);
          return;
        }
      } catch (e) {
        console.warn(`[Concurrency] 等待重试异常，继续等待: ${e}`);
      }
    }

    // 超时：清理队列并抛出错误
    await this.dequeue(taskId).catch(() => {});
    throw new Error(`任务 ${taskId} 等待全局并发槽位超时（${MAX_WAIT_TIMEOUT_MS / 60000} 分钟）`);
  }
}
