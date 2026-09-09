/**
 * Agent 生成注册表 — 浏览器刷新/关标签页的断流恢复核心（可恢复流服务端侧）
 *
 * 背景（2026-09-09）：/chat/stream 此前在客户端断开时立即 abort LLM 调用，
 * 刷新页面/关闭标签页即丢失正在生成的回答。现改为：
 *   1. 客户端断开只「摘除连接」（detach），生成在服务端后台续跑直至自然结束或超时；
 *   2. 路由层把 UIMessageStream 字节喂给 tracker，tracker 解析 text-delta /
 *      reasoning-delta 增量累积文本，首次出现文本时创建 status='processing' 的
 *      QAMessage 行并按 2s 节流回写——即使进程崩溃，已生成的部分也留档；
 *   3. 前端刷新后经 GET /generation/status 轮询恢复在途文本，结束后 reload 历史；
 *   4. 用户点「停止」→ POST /generation/cancel 真正中止（abort 只由超时/主动取消触发）。
 *
 * 一致性要点：onFinish（agent.service persistAssistantFromSteps）与 tracker 都会
 * 落库 assistant——通过 takePersistTarget/hasPersistTarget 协调：注册表中已有
 * 本会话的 processing 行时 onFinish 改走 updateAssistantMessage，避免重复行。
 *
 * 限制：注册表在 api 进程内存中（单 backend 容器部署成立）；进程重启后在途
 * 生成丢失，但 DB 中 processing 行的已累积文本保留，前端照常展示部分内容。
 */

import { QASessionService } from './qa-session.service';

/** 前端可见的生成快照 */
export interface GenerationSnapshot {
  sessionId: string;
  /** 注册表中是否仍在途（false = 已结束/不存在） */
  active: boolean;
  status: 'streaming' | 'completed' | 'failed';
  /** 已累积的 assistant 文本（active 时为节流回写粒度，最多落后 2s） */
  text: string;
  /** 已累积的思考文本 */
  reasoning: string;
  /** 对应 QAMessage 行 ID（尚无文本输出时为 null） */
  messageId: string | null;
  startedAt: string;
}

interface TrackedGeneration {
  sessionId: string;
  userId: string;
  /** 每次生成的唯一令牌：onFinish 落库去重时凭 token 匹配，防同会话新旧两代生成互串 */
  token: string;
  startedAt: Date;
  text: string;
  reasoning: string;
  messageId: string | null;
  /** finish 后为最终状态；在途恒为 'streaming' */
  status: 'streaming' | 'completed' | 'failed';
  /** 客户端已断开（后台续跑中） */
  detached: boolean;
  controller: AbortController;
  lastPersistAt: number;
  /** 首条文本已落库标记 */
  rowCreated: boolean;
  /** 首行创建 promise：finish 与 onFinish 去重都需等待它，避免行未建好时重复建行 */
  rowCreatePromise: Promise<void> | null;
  /** 用户已请求取消（幂等标记，重复 cancel 不再返回 true） */
  cancelRequested: boolean;
  /** finish 后的宽限清理定时器 */
  cleanupTimer: NodeJS.Timeout | null;
}

/** 结束后保留快照的宽限期：客户端恰在完成瞬间刷新仍能拿到最终状态 */
const GRACE_MS = 60_000;
/** 增量落库节流间隔 */
const PERSIST_INTERVAL_MS = 2_000;
/** 注册表容量上限（防泄漏兜底；正常单用户单活跃会话，远达不到） */
const MAX_ENTRIES = 500;

const registry = new Map<string, TrackedGeneration>();

/** SSE 行缓冲：字节块可能切断帧，跨 chunk 拼行 */
class SseLineBuffer {
  private buf = '';

  /** 喂入原始文本，返回其中完整的行（不含换行） */
  push(raw: string): string[] {
    this.buf += raw;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    return lines;
  }
}

/**
 * 解析 UIMessageStream SSE 行，返回 (kind, delta) 增量。
 * 关心的帧（data: {json}）：
 *   - text-delta      → { kind: 'text', delta }
 *   - reasoning-delta → { kind: 'reasoning', delta }
 */
function extractDeltas(line: string): Array<{ kind: 'text' | 'reasoning'; delta: string }> {
  const out: Array<{ kind: 'text' | 'reasoning'; delta: string }> = [];
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return out;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return out;
  try {
    const evt = JSON.parse(payload);
    if (evt?.type === 'text-delta' && typeof evt.delta === 'string' && evt.delta) {
      out.push({ kind: 'text', delta: evt.delta });
    } else if (evt?.type === 'reasoning-delta' && typeof evt.delta === 'string' && evt.delta) {
      out.push({ kind: 'reasoning', delta: evt.delta });
    }
  } catch {
    // 非 JSON 帧（注释/心跳）忽略
  }
  return out;
}

/** 节流落库：把当前累积文本回写 QAMessage（失败仅告警，不影响生成） */
function persistPartial(gen: TrackedGeneration, force = false): void {
  if (!gen.messageId) return;
  const now = Date.now();
  if (!force && now - gen.lastPersistAt < PERSIST_INTERVAL_MS) return;
  gen.lastPersistAt = now;
  QASessionService.updateAssistantMessage(
    gen.messageId,
    gen.text,
    'processing',
  ).catch((e: Error) => {
    console.warn(`[Agent:Gen] 增量回写失败: sessionId=${gen.sessionId}`, e.message);
  });
}

export const generationRegistry = {
  /**
   * 为一次 /chat/stream 生成注册跟踪器。同会话已有在途生成时返回 null
   * （并发保护：不重复跟踪、不重复落库）。
   *
   * @param controller 路由层的 AbortController——仅 600s 超时与主动取消时 abort
   */
  create(
    sessionId: string,
    userId: string,
    token: string,
    controller: AbortController,
  ): {
    /** 喂入响应流的原始字节块（tracker 自行做 SSE 帧解析与增量提取） */
    onChunk: (raw: Uint8Array) => void;
    /** 客户端断开：仅标记 detached，生成继续（落库与快照照常） */
    detach: () => void;
    /** 生成结束（路由读流循环退出/异常时调用；幂等）。status 决定最终落库状态 */
    finish: (status: 'completed' | 'failed') => void;
  } | null {
    const existing = registry.get(sessionId);
    if (existing && existing.status === 'streaming') {
      console.warn(`[Agent:Gen] 会话已有在途生成，跳过重复跟踪: sessionId=${sessionId.slice(0, 8)}`);
      return null;
    }
    if (registry.size >= MAX_ENTRIES) {
      // 淘汰最早结束的条目兜底
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, v] of registry) {
        if (v.status !== 'streaming' && v.startedAt.getTime() < oldestAt) {
          oldestAt = v.startedAt.getTime();
          oldestKey = k;
        }
      }
      if (oldestKey) {
        if (registry.get(oldestKey)?.cleanupTimer) clearTimeout(registry.get(oldestKey)!.cleanupTimer!);
        registry.delete(oldestKey);
      }
    }

    const gen: TrackedGeneration = {
      sessionId,
      userId,
      token,
      startedAt: new Date(),
      text: '',
      reasoning: '',
      messageId: null,
      status: 'streaming',
      detached: false,
      controller,
      lastPersistAt: 0,
      rowCreated: false,
      rowCreatePromise: null,
      cancelRequested: false,
      cleanupTimer: null,
    };
    registry.set(sessionId, gen);
    console.log(`[Agent:Gen] 注册生成跟踪: sessionId=${sessionId.slice(0, 8)} userId=${userId}`);

    const lineBuf = new SseLineBuffer();
    const decoder = new TextDecoder();

    const ensureRow = (): void => {
      if (gen.rowCreated || !gen.text) return;
      gen.rowCreated = true;
      gen.lastPersistAt = Date.now();
      // 保存 promise：finish/onFinish 去重都需等待首行落库完成再决策，避免竞争建双行
      gen.rowCreatePromise = QASessionService.persistAssistantMessage(gen.sessionId, gen.userId, gen.text, 'processing')
        .then((id) => {
          gen.messageId = id;
          if (id) persistPartial(gen, true);
        })
        .catch((e: Error) => {
          console.warn(`[Agent:Gen] 创建 processing 行失败: sessionId=${gen.sessionId}`, e.message);
        });
    };

    return {
      onChunk(raw: Uint8Array): void {
        if (gen.status !== 'streaming') return;
        let lines: string[];
        try {
          lines = lineBuf.push(decoder.decode(raw, { stream: true }));
        } catch {
          return;
        }
        for (const line of lines) {
          for (const d of extractDeltas(line)) {
            if (d.kind === 'text') {
              gen.text += d.delta;
              if (!gen.rowCreated) {
                ensureRow();
              } else {
                persistPartial(gen);
              }
            } else {
              gen.reasoning += d.delta;
            }
          }
        }
      },

      detach(): void {
        gen.detached = true;
        console.log(`[Agent:Gen] 客户端断开，后台续跑: sessionId=${sessionId.slice(0, 8)}`);
      },

      finish(status: 'completed' | 'failed'): void {
        if (gen.status !== 'streaming') return;
        gen.status = status;
        // 最终落库（异步完成）：先等首行 create 落定，再决定「更新该行」还是「补建终态行」
        void (async () => {
          if (gen.rowCreatePromise) {
            try { await gen.rowCreatePromise; } catch { /* 已在 catch 内告警 */ }
          }
          if (gen.messageId) {
            QASessionService.updateAssistantMessage(
              gen.messageId,
              gen.text,
              status,
            ).catch((e: Error) => {
              console.warn(`[Agent:Gen] 终态回写失败: sessionId=${gen.sessionId}`, e.message);
            });
          } else if (gen.text) {
            QASessionService.persistAssistantMessage(
              gen.sessionId,
              gen.userId,
              gen.text,
              status,
            ).catch((e: Error) => {
              console.warn(`[Agent:Gen] 终态落库失败: sessionId=${gen.sessionId}`, e.message);
            });
          }
        })().catch((e: Error) => {
          // 兜底：终态落库链路上任何同步异常（如依赖服务缺方法/字段）不得外逸为 unhandled rejection
          console.warn(`[Agent:Gen] 终态落库异常: sessionId=${gen.sessionId}`, e.message);
        });
        console.log(`[Agent:Gen] 生成结束(${status}) textLen=${gen.text.length} detached=${gen.detached} sessionId=${sessionId.slice(0, 8)}`);
        gen.cleanupTimer = setTimeout(() => {
          registry.delete(sessionId);
        }, GRACE_MS);
      },
    };
  },

  /**
   * 查询会话生成状态（含归属校验）。三种结果：
   *   - active=true：在途，text 为已累积文本（轮询恢复用）
   *   - active=false：已结束/不存在（finished 快照在宽限期内仍可见最终文本）
   *   - null：从未跟踪且非本人会话（越权）——注意「未跟踪」与「越权」无法从
   *     注册表区分，归属由调用方用 sessionStore/QASessionService 校验
   */
  get(sessionId: string, userId: string): GenerationSnapshot | null {
    const gen = registry.get(sessionId);
    if (!gen) return null;
    if (gen.userId !== userId) return null; // 越权：按不存在处理
    return {
      sessionId,
      active: gen.status === 'streaming',
      status: gen.status,
      text: gen.text,
      reasoning: gen.reasoning,
      messageId: gen.messageId,
      startedAt: gen.startedAt.toISOString(),
    };
  },

  /**
   * 用户主动取消（前端「停止」按钮在断开连接后调用）。
   * 返回是否成功触发（存在在途生成且属于该用户）。
   */
  cancel(sessionId: string, userId: string): boolean {
    const gen = registry.get(sessionId);
    if (!gen || gen.userId !== userId || gen.status !== 'streaming') return false;
    if (gen.cancelRequested) return false;
    gen.cancelRequested = true;
    gen.controller.abort();
    return true;
  },

  /**
   * persistAssistantFromSteps 去重协调（onFinish 落库前调用）。
   *
   * 「本代生成」仍在途时等待首行 create 落定（最多 5s 兕底），返回其 messageId
   * ——调用方改走 update，避免与 tracker 重复建行。以下情况返回 null（调用方走
   * 正常新建）：无跟踪记录 / token 不匹配（同会话新一代已接管）/ 生成已结束 /
   * 等待超时仍无行。
   */
  async getInFlightMessageId(sessionId: string, token: string | null | undefined): Promise<string | null> {
    const gen = registry.get(sessionId);
    if (!gen || gen.status !== 'streaming') return null;
    if (!token || gen.token !== token) return null;
    if (gen.rowCreatePromise) {
      const timeout = new Promise<void>((r) => setTimeout(r, 5_000));
      await Promise.race([gen.rowCreatePromise, timeout]);
    }
    return gen.messageId;
  },

  /** 测试辅助：清空注册表 */
  __reset(): void {
    for (const gen of registry.values()) {
      if (gen.cleanupTimer) clearTimeout(gen.cleanupTimer);
    }
    registry.clear();
  },
};
