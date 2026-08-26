/**
 * SteeringService 单测（2026-08-26 markConsumed Lua 替换串回归）
 *
 * 背景：原 markConsumed 的 gsub 替换串写成 '"(consumed)":true'——Lua 替换串里
 * 括号是字面量，实际把 JSON 键名改成 "(consumed)"，导致 consumed 永远读不到、
 * 干预指令在 TTL 内每轮重复注入。本文件钉住两点：
 *   1. 脚本契约：替换串必须用 %1 捕获引用
 *   2. 消费语义：按脚本真实替换行为模拟后，getPending 不再返回已消费指令
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// —— Redis mock：list 模拟 Redis list；eval 按脚本文本选择正确/旧行为 ——
const { redisState, rawClient } = vi.hoisted(() => {
  const redisState = {
    list: [] as string[],
    fail: false,
    evalScripts: [] as string[],
    multiOps: [] as Array<{ fn: string; args: any[] }>,
  };
  const rawClient = {
    // inject 用：multi 事务链
    multi: () => {
      const cmd: any = {};
      for (const fn of ['rpush', 'ltrim', 'expire']) {
        cmd[fn] = (...args: any[]) => {
          redisState.multiOps.push({ fn, args });
          return cmd;
        };
      }
      cmd.exec = async () => [];
      return cmd;
    },
    lrange: async (_key: string, _s: number, _e: number) => {
      if (redisState.fail) throw new Error('redis down');
      return [...redisState.list];
    },
    eval: async (script: string, _numKeys: number, _key: string) => {
      redisState.evalScripts.push(script);
      // 按脚本文本决定替换行为：含 %1 捕获引用 = 修复后脚本；
      // 否则复现旧缺陷的括号字面量替换，用于反向验证消费语义确实依赖脚本写法
      const fixed = script.includes('\'"%1":true\'');
      redisState.list = redisState.list.map((item) =>
        item.replace('"consumed":false', fixed ? '"consumed":true' : '"(consumed)":true'),
      );
      return redisState.list.length;
    },
  };
  return { redisState, rawClient };
});

vi.mock('../../../utils/redis', () => ({
  redisClient: {
    getClient: () => rawClient,
    set: async () => {
      if (redisState.fail) throw new Error('redis down');
    },
    get: async () => {
      if (redisState.fail) throw new Error('redis down');
      return null;
    },
    del: async () => {},
  },
}));

import { SteeringService } from '../steering/steering.service';

beforeEach(() => {
  redisState.list = [];
  redisState.fail = false;
  redisState.evalScripts = [];
  redisState.multiOps = [];
});

function seedPending(message = '重点关注付款条款'): void {
  redisState.list.push(JSON.stringify({
    id: 'st-1',
    message,
    createdAt: new Date().toISOString(),
    consumed: false,
  }));
}

describe('inject', () => {
  it('rpush + ltrim(-MAX_QUEUE) + expire(TTL=600) 且返回 id', async () => {
    const id = await SteeringService.inject('s1', '先看合同金额');
    expect(id).toBeTruthy();
    expect(redisState.multiOps.map((o) => o.fn)).toEqual(['rpush', 'ltrim', 'expire']);
    const rpush = redisState.multiOps[0];
    expect(rpush.args[0]).toBe('agent:steer:s1');
    expect(JSON.parse(rpush.args[1]).message).toBe('先看合同金额');
    expect(redisState.multiOps[1].args).toEqual(['agent:steer:s1', -10, -1]);
    expect(redisState.multiOps[2].args).toEqual(['agent:steer:s1', 600]);
  });
});

describe('markConsumed 脚本契约与消费语义', () => {
  it('脚本替换串使用 %1 捕获引用，不含括号字面量键名', async () => {
    await SteeringService.markConsumed('s1');
    expect(redisState.evalScripts).toHaveLength(1);
    const script = redisState.evalScripts[0];
    expect(script).toContain('\'"%1":true\'');
    expect(script).not.toContain('\'"(consumed)":true\'');
  });

  it('按脚本执行后 getPending 不再返回已消费指令（消费闭环）', async () => {
    seedPending();
    seedPending('第二条干预');
    await SteeringService.markConsumed('s1');
    const pending = await SteeringService.getPending('s1');
    expect(pending).toEqual([]);
    // 底层条目仍在（仅标记位翻转），JSON 键名未被破坏
    expect(redisState.list).toHaveLength(2);
    for (const item of redisState.list) {
      const parsed = JSON.parse(item);
      expect(parsed.consumed).toBe(true);
      expect(parsed.message).toBeTruthy();
    }
  });

  it('未执行 markConsumed 时 getPending 返回全部未消费指令', async () => {
    seedPending();
    const pending = await SteeringService.getPending('s1');
    expect(pending).toHaveLength(1);
    expect(pending[0].message).toBe('重点关注付款条款');
  });

  it('buildSystemPromptSection 渲染干预段落', () => {
    const section = SteeringService.buildSystemPromptSection([
      { id: 'a', message: '只审查第二章', createdAt: new Date(), consumed: false },
    ]);
    expect(section).toContain('人工干预指令');
    expect(section).toContain('[Steering: 只审查第二章]');
    expect(SteeringService.buildSystemPromptSection([])).toBe('');
  });
});

describe('Redis 不可用', () => {
  beforeEach(() => {
    redisState.fail = true;
  });

  it('getPending 不做内部降级，直接抛错（调用方 agent.service 以 .catch(() => []) 兜底）', async () => {
    await expect(SteeringService.getPending('s-mem')).rejects.toThrow('redis down');
  });
});
