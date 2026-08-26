import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../../../utils/redis';

/** 一条 steering 干预指令 */
export interface SteeringInstruction {
  id: string;
  message: string;
  createdAt: Date;
  consumed: boolean;
}

const KEY_PREFIX = 'agent:steer:';
const MAX_QUEUE = 10;
const TTL = 600;

export class SteeringService {
  /**
   * 注入一条 steering 指令到 Redis FIFO 队列。
   * 队列最多保留 MAX_QUEUE 条，超出的旧数据自动被 LTRIM 丢弃。
   * 返回生成的指令 id。
   */
  static async inject(sessionId: string, message: string): Promise<string> {
    const id = uuidv4();
    const instruction: SteeringInstruction = {
      id,
      message,
      createdAt: new Date(),
      consumed: false,
    };
    const key = `${KEY_PREFIX}${sessionId}`;
    const raw = redisClient.getClient();
    await raw
      .multi()
      .rpush(key, JSON.stringify(instruction))
      .ltrim(key, -MAX_QUEUE, -1)
      .expire(key, TTL)
      .exec();
    return id;
  }

  /**
   * 获取所有未消费（consumed === false）的 steering 指令。
   */
  static async getPending(sessionId: string): Promise<SteeringInstruction[]> {
    const key = `${KEY_PREFIX}${sessionId}`;
    const raw = redisClient.getClient();
    const items: string[] = await raw.lrange(key, 0, -1);
    return items
      .map((item) => {
        const parsed = JSON.parse(item) as Record<string, unknown>;
        return {
          ...parsed,
          createdAt: new Date(parsed.createdAt as string),
        } as SteeringInstruction;
      })
      .filter((inst) => !inst.consumed);
  }

  /**
   * 标记 session 下所有 steering 指令为已消费。
   * 使用 Lua 脚本原子性地将列表中每条指令的 consumed 字段置为 true。
   *
   * 修复（2026-08-26）：原替换串写成了 '"(consumed)":true'——Lua gsub 的替换串里
   * 括号是字面量（捕获引用是 %1），实际把 JSON 键名改成了带括号的 "(consumed)"。
   * 后果：getPending 解析后 consumed 恒为 undefined → 过滤器认为未消费，
   * 同一条干预指令在 TTL 内每轮对话都被重复注入且永远无法清除。
   */
  static async markConsumed(sessionId: string): Promise<void> {
    const key = `${KEY_PREFIX}${sessionId}`;
    const raw = redisClient.getClient();
    const lua = `
      local key = KEYS[1]
      local items = redis.call('LRANGE', key, 0, -1)
      for i, item in ipairs(items) do
        local updated = string.gsub(item, '"(consumed)":false', '"%1":true', 1)
        if updated ~= item then
          redis.call('LSET', key, i - 1, updated)
        end
      end
      return #items
    `;
    await raw.eval(lua, 1, key);
  }

  /**
   * 将 SteeringInstruction 数组渲染为 system prompt 中的段落。
   * 若无指令则返回空字符串。
   */
  static buildSystemPromptSection(
    instructions: SteeringInstruction[],
  ): string {
    if (!instructions || instructions.length === 0) return '';
    const lines = instructions.map(
      (inst) => `[Steering: ${inst.message}]`,
    );
    return (
      `\n## 人工干预指令\n以下是由人工注入的干预指令，请在回复中遵守：\n${lines.join('\n')}\n`
    );
  }
}
