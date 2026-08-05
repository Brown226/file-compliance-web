/**
 * tool-hook 单元测试（P1-⑫ 工具拦截钩子）
 *
 * 覆盖：
 * - before 钩子改写 args 并透传
 * - after 钩子改写 result 并透传
 * - '*' 通配钩子匹配全部工具，具体工具钩子优先执行
 * - 钩子抛错降级（console.warn，不阻断主流程）
 * - registerDefaultToolHooks 的 llm_review_chunk 去重用例（同问题只上报一次）
 *
 * 注意：hooksRegistry 是模块级共享状态，afterEach 必须 clearToolHooks() 防串扰。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerToolHooks,
  clearToolHooks,
  runBeforeToolHooks,
  runAfterToolHooks,
} from '../tool-hook.service';
import { registerDefaultToolHooks } from '../register-tool-hooks';
import type { ReviewIssue } from '../../../llm/llm.service';

const ctx = (toolName: string, args: Record<string, unknown> = {}, result: unknown = { ok: true }) => ({
  toolName,
  args,
  result,
  userId: 'u1',
  sessionId: 's1',
});

beforeEach(() => clearToolHooks());
afterEach(() => clearToolHooks());

describe('before 钩子', () => {
  it('改写 args 并透传给下一个钩子', async () => {
    const order: string[] = [];
    registerToolHooks('extract_text', {
      before: (c) => {
        order.push('hook1');
        return { ...c.args, strategy: 'by_section' };
      },
    });
    registerToolHooks('extract_text', {
      before: (c) => {
        order.push('hook2');
        expect(c.args).toMatchObject({ strategy: 'by_section' });
        return undefined; // 不改写，保持上一个钩子的结果
      },
    });

    const out = await runBeforeToolHooks(ctx('extract_text', { filePath: '/a.txt' }));
    expect(out).toEqual({ filePath: '/a.txt', strategy: 'by_section' });
    expect(order).toEqual(['hook1', 'hook2']);
  });

  it('无钩子时原样返回 args', async () => {
    const out = await runBeforeToolHooks(ctx('unknown_tool', { a: 1 }));
    expect(out).toEqual({ a: 1 });
  });

  it('钩子抛错降级：不阻断执行，返回原 args', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerToolHooks('edit_file', {
      before: () => {
        throw new Error('hook boom');
      },
    });
    try {
      const out = await runBeforeToolHooks(ctx('edit_file', { filePath: '/x' }));
      expect(out).toEqual({ filePath: '/x' });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('beforeToolCall(edit_file)'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('after 钩子', () => {
  it('改写 result 并透传', async () => {
    registerToolHooks('search_knowledge', {
      after: (c) => {
        const arr = c.result as Array<{ similarity: number }>;
        return arr.filter((x) => x.similarity >= 0.5);
      },
    });
    const out = await runAfterToolHooks(
      ctx('search_knowledge', {}, [{ similarity: 0.9 }, { similarity: 0.2 }]),
    );
    expect(out).toEqual([{ similarity: 0.9 }]);
  });

  it('返回 undefined 不改写 result', async () => {
    registerToolHooks('read_file', {
      after: () => undefined,
    });
    const out = await runAfterToolHooks(ctx('read_file', {}, '原始内容'));
    expect(out).toBe('原始内容');
  });

  it('钩子抛错降级：返回原 result 并告警', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerToolHooks('write_report', {
      after: () => {
        throw new Error('after boom');
      },
    });
    try {
      const out = await runAfterToolHooks(ctx('write_report', {}, { done: true }));
      expect(out).toEqual({ done: true });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('afterToolCall(write_report)'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('通配符与优先级', () => {
  it("'*' 通配钩子作用于所有工具", async () => {
    registerToolHooks('*', {
      before: (c) => ({ ...c.args, audited: true }),
    });
    const out = await runBeforeToolHooks(ctx('any_tool', { x: 1 }));
    expect(out).toEqual({ x: 1, audited: true });
  });

  it('具体工具钩子优先于通配钩子执行', async () => {
    const order: string[] = [];
    registerToolHooks('*', { before: () => (order.push('wildcard'), { w: 1 }) });
    registerToolHooks('llm_review_chunk', { before: () => (order.push('specific'), { s: 1 }) });

    await runBeforeToolHooks(ctx('llm_review_chunk', { t: 1 }));
    expect(order).toEqual(['specific', 'wildcard']);
    // 具体工具改写结果优先，通配后执行会覆盖 → 最终 = 通配结果
  });

  it('before 链末端以最后执行的钩子改写为准（通配后执行则覆盖具体钩子）', async () => {
    registerToolHooks('llm_review_chunk', { before: () => ({ source: 'specific' }) });
    registerToolHooks('*', { before: () => ({ source: 'wildcard' }) });
    const out = await runBeforeToolHooks(ctx('llm_review_chunk', {}));
    // hooksFor 顺序 = [specific, wildcard]，wildcard 后执行覆盖
    expect(out).toEqual({ source: 'wildcard' });
  });
});

describe('registerDefaultToolHooks — llm_review_chunk 去重用例', () => {
  it('同一问题在两个 chunk 中只上报一次（dedupIssues 生效）', async () => {
    registerDefaultToolHooks();
    const issues: ReviewIssue[] = [
      { issueType: 'TYPO', originalText: '帐号' },
      { issueType: 'TYPO', originalText: '帐号' }, // 精确重复
      { issueType: 'TYPO', originalText: '帐户' }, // 相似但不同 → 模糊去重阈值内
      { issueType: 'VIOLATION', originalText: '缺少签名' },
    ];
    const out = await runAfterToolHooks({
      toolName: 'llm_review_chunk',
      args: { text: 'x' },
      result: issues,
      userId: 'u1',
      sessionId: 's1',
      durationMs: 10,
    });
    const result = out as ReviewIssue[];
    // 精确重复去重；模糊阈值 fuzzyThreshold=2 内 '帐号'/'帐户' 可能合并
    expect(result.length).toBeLessThanOrEqual(3);
    expect(result.some((i) => i.originalText === '缺少签名')).toBe(true);
  });

  it('非数组结果（如错误对象）不改写', async () => {
    registerDefaultToolHooks();
    const out = await runAfterToolHooks({
      toolName: 'llm_review_chunk',
      args: {},
      result: { error: 'llm down', failed: true },
      userId: 'u1',
      sessionId: 's1',
      durationMs: 5,
    });
    expect(out).toEqual({ error: 'llm down', failed: true });
  });

  it('其他工具不受默认钩子影响', async () => {
    registerDefaultToolHooks();
    const out = await runAfterToolHooks(ctx('extract_text', {}, { text: 'x' }));
    expect(out).toEqual({ text: 'x' });
  });
});
