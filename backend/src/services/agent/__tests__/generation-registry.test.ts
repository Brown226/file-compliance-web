/**
 * generation-registry 单元测试（断流恢复核心）
 *
 * 覆盖：
 * - create + onChunk：SSE 跨字节块切帧解析，text-delta 增量累积，首个文本创建
 *   status='processing' 的 QAMessage 行
 * - 增量回写节流（2s 内不重复落库）与终态回写（finish 幂等）
 * - get 快照：在途/结束状态、归属隔离（他人会话返回 null）
 * - getInFlightMessageId：token 匹配（防同会话新旧两代生成互串）
 * - cancel：abort 本代生成的 controller
 * - 同会话并发保护：已有在途生成时 create 返回 null
 *
 * 按 qa-session.test.ts 样板 mock QASessionService（registry 唯一外部依赖）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { persistAssistantMessageMock, updateAssistantMessageMock } = vi.hoisted(() => ({
  persistAssistantMessageMock: vi.fn(),
  updateAssistantMessageMock: vi.fn(),
}));

vi.mock('../qa-session.service', () => ({
  __esModule: true,
  QASessionService: {
    persistAssistantMessage: persistAssistantMessageMock,
    updateAssistantMessage: updateAssistantMessageMock,
  },
}));

import { generationRegistry } from '../generation-registry';

const encoder = new TextEncoder();
function sseFrame(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

beforeEach(() => {
  generationRegistry.__reset();
  persistAssistantMessageMock.mockReset().mockResolvedValue('msg-1');
  updateAssistantMessageMock.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  generationRegistry.__reset();
});

describe('generationRegistry（断流恢复）', () => {
  it('onChunk 累积 text-delta：跨块切帧不丢字，首个文本创建 processing 行', async () => {
    const tracker = generationRegistry.create('s-1', 'u-1', 'tok-1', new AbortController());
    expect(tracker).not.toBeNull();

    // 第一块被切成两半（帧跨字节块）
    const frame = sseFrame({ type: 'text-delta', id: 't1', delta: '你好，' });
    const half = Math.floor(frame.byteLength / 2);
    tracker!.onChunk(frame.slice(0, half));
    tracker!.onChunk(frame.slice(half));
    tracker!.onChunk(sseFrame({ type: 'text-delta', id: 't1', delta: '世界' }));
    tracker!.onChunk(sseFrame({ type: 'start', messageId: 'x' })); // 非 delta 帧忽略

    // 等待 persistAssistantMessage（fire-and-forget）落地。
    // 注意：行创建发生在首个 delta 时刻，首行内容为当时的部分文本（后续由
    // 节流回写与终态回写补全）——这是设计行为。
    await vi.waitFor(() => expect(persistAssistantMessageMock).toHaveBeenCalledTimes(1));
    expect(persistAssistantMessageMock.mock.calls[0][2]).toBe('你好，');

    const snap = generationRegistry.get('s-1', 'u-1');
    expect(snap?.active).toBe(true);
    expect(snap?.text).toBe('你好，世界');
    expect(snap?.messageId).toBe('msg-1');

    // 结束后终态回写补全全文
    tracker!.finish('completed');
    await vi.waitFor(() => expect(updateAssistantMessageMock).toHaveBeenCalledWith('msg-1', '你好，世界', 'completed'));
  });

  it('finish(completed) 幂等回写终态；结束后 get 返回 active=false', async () => {
    const tracker = generationRegistry.create('s-2', 'u-2', 'tok-2', new AbortController());
    tracker!.onChunk(sseFrame({ type: 'text-delta', id: 't', delta: '部分内容' }));
    await vi.waitFor(() => expect(persistAssistantMessageMock).toHaveBeenCalled());

    tracker!.finish('completed');
    tracker!.finish('completed'); // 幂等
    // 两次回写：①首行建好后的 force 增量回写（processing）②终态回写（completed）
    await vi.waitFor(() => expect(updateAssistantMessageMock).toHaveBeenCalledTimes(2));
    expect(updateAssistantMessageMock.mock.calls[0]).toEqual(['msg-1', '部分内容', 'processing']);
    expect(updateAssistantMessageMock.mock.calls[1]).toEqual(['msg-1', '部分内容', 'completed']);

    const snap = generationRegistry.get('s-2', 'u-2');
    expect(snap?.active).toBe(false);
    expect(snap?.status).toBe('completed');
  });

  it('finish 时文本未落库（messageId=null）→ 直接落终态新行', async () => {
    const tracker = generationRegistry.create('s-3', 'u-3', 'tok-3', new AbortController());
    // 不触发 onChunk 直接 finish —— 无文本不落库
    tracker!.finish('failed');
    await Promise.resolve();
    expect(persistAssistantMessageMock).not.toHaveBeenCalled();

    // 有文本但行未建好：补建终态行
    const tracker2 = generationRegistry.create('s-3', 'u-3', 'tok-3b', new AbortController());
    tracker2!.onChunk(encoder.encode('data: {"type":"text-delta","id":"t","delta":"迟到"}\n\n'));
    tracker2!.finish('failed');
    // persistAssistantMessage 尚未 resolve → messageId 仍 null → 终态走补建分支
    await vi.waitFor(() => expect(persistAssistantMessageMock).toHaveBeenCalledTimes(1));
  });

  it('get 归属隔离：他人查询返回 null', () => {
    generationRegistry.create('s-4', 'u-4', 'tok-4', new AbortController());
    expect(generationRegistry.get('s-4', 'u-4')).not.toBeNull();
    expect(generationRegistry.get('s-4', 'u-other')).toBeNull();
    expect(generationRegistry.get('s-none', 'u-4')).toBeNull();
  });

  it('getInFlightMessageId：token 匹配才返回，防同会话新旧两代生成互串', async () => {
    const tracker = generationRegistry.create('s-5', 'u-5', 'tok-5', new AbortController());
    tracker!.onChunk(sseFrame({ type: 'text-delta', id: 't', delta: 'x' }));
    await vi.waitFor(() => expect(persistAssistantMessageMock).toHaveBeenCalled());

    // 本代 token 匹配 → 返回 messageId（异步：等待首行 create 落定）
    await expect(generationRegistry.getInFlightMessageId('s-5', 'tok-5')).resolves.toBe('msg-1');
    // token 不匹配（新一代接管场景）/未传 → null
    await expect(generationRegistry.getInFlightMessageId('s-5', 'tok-NEW')).resolves.toBeNull();
    await expect(generationRegistry.getInFlightMessageId('s-5', undefined)).resolves.toBeNull();

    // 结束后不再返回
    tracker!.finish('completed');
    await expect(generationRegistry.getInFlightMessageId('s-5', 'tok-5')).resolves.toBeNull();
  });

  it('cancel：abort 本代 controller；同会话并发生成时 create 返回 null', () => {
    const controller = new AbortController();
    const tracker = generationRegistry.create('s-6', 'u-6', 'tok-6', controller);
    expect(tracker).not.toBeNull();

    // 并发保护：同会话已有在途生成
    expect(generationRegistry.create('s-6', 'u-6', 'tok-6b', new AbortController())).toBeNull();

    expect(generationRegistry.cancel('s-6', 'u-6')).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    // 重复取消：幂等返回 false
    expect(generationRegistry.cancel('s-6', 'u-6')).toBe(false);

    // 路由层 catch 后会调 finish（模拟）：结束后注册表可被新一代生成接管
    tracker!.finish('failed');
    expect(generationRegistry.create('s-6', 'u-6', 'tok-6c', new AbortController())).not.toBeNull();
  });

  it('cancel 归属校验：他人无法取消我的生成', () => {
    const controller = new AbortController();
    generationRegistry.create('s-7', 'u-7', 'tok-7', controller);
    expect(generationRegistry.cancel('s-7', 'u-other')).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  it('detach 标记客户端断开，生成状态不受影响', async () => {
    const tracker = generationRegistry.create('s-8', 'u-8', 'tok-8', new AbortController());
    tracker!.onChunk(sseFrame({ type: 'text-delta', id: 't', delta: '续跑中' }));
    tracker!.detach();
    tracker!.onChunk(sseFrame({ type: 'text-delta', id: 't', delta: '的内容' }));
    await vi.waitFor(() => expect(persistAssistantMessageMock).toHaveBeenCalled());
    const snap = generationRegistry.get('s-8', 'u-8');
    expect(snap?.active).toBe(true);
    expect(snap?.text).toBe('续跑中的内容');
  });

  it('reasoning-delta 单独累积，不触发落库行创建', async () => {
    const tracker = generationRegistry.create('s-9', 'u-9', 'tok-9', new AbortController());
    tracker!.onChunk(sseFrame({ type: 'reasoning-delta', id: 'r', delta: '思考...' }));
    await Promise.resolve();
    expect(persistAssistantMessageMock).not.toHaveBeenCalled();
    const snap = generationRegistry.get('s-9', 'u-9');
    expect(snap?.reasoning).toBe('思考...');
    expect(snap?.text).toBe('');
  });
});
