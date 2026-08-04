/**
 * ToolHookService — Agent 工具执行前后拦截钩子（P1-⑫）
 *
 * 与 pi 引擎的 beforeToolCall / afterToolCall 对齐，提供「可阻塞 / 可改写」能力，
 * 区别于已有的只读观测回调（onToolExecutionStart/End 仅记录）。
 *
 * 用途示例：
 * - 结果后校验 / 自动修复：afterToolCall 检查某工具输出，不符合预期则改写
 * - 参数规范化：beforeToolCall 修正 LLM 传参（如路径规范化、默认值补全）
 * - 审计 / 计数：beforeToolCall 记录调用次数、afterToolCall 记录耗时分布
 * - 策略拦截：beforeToolCall 直接抛错拒绝执行（如超出配额）
 *
 * 设计：
 * - 按工具名注册多个钩子（模块级注册表，进程内共享）
 * - 每个钩子签名：before(ctx) => args | void；after(ctx) => result | void
 * - 钩子抛错不阻断主流程（console.warn 降级），保证 Agent 可用性优先
 * - 提供 clearToolHooks() 便于测试/热更新清理
 */

export interface BeforeToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  sessionId: string;
}

export interface AfterToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  userId: string;
  sessionId: string;
  /** 工具实际执行耗时（毫秒，钩子自身耗时不计） */
  durationMs: number;
}

export type BeforeToolCallHook = (ctx: BeforeToolCallContext) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
export type AfterToolCallHook = (ctx: AfterToolCallContext) => unknown | void | Promise<unknown | void>;

interface RegisteredHook {
  before?: BeforeToolCallHook;
  after?: AfterToolCallHook;
}

const hooksRegistry = new Map<string, RegisteredHook[]>();

/**
 * 注册工具钩子（按工具名）
 * @param toolName 工具名（如 'edit_file'），可用 '*' 匹配全部工具
 * @param hook 钩子对象（before / after 至少一个）
 */
export function registerToolHooks(toolName: string, hook: RegisteredHook): void {
  const list = hooksRegistry.get(toolName) || [];
  list.push(hook);
  hooksRegistry.set(toolName, list);
}

/** 注销指定工具名的全部钩子（测试/热更新用） */
export function clearToolHooks(toolName?: string): void {
  if (toolName) hooksRegistry.delete(toolName);
  else hooksRegistry.clear();
}

/** 获取某工具的钩子列表（含 '*' 通配钩子，具体工具钩子优先在前） */
function hooksFor(toolName: string): RegisteredHook[] {
  const specific = hooksRegistry.get(toolName) || [];
  const wildcard = hooksRegistry.get('*') || [];
  return [...specific, ...wildcard];
}

/**
 * 执行 before 钩子链：依次调用，返回值作为改写后的 args 透传给下一个钩子。
 * 返回最终 args（无钩子或无改写则原样）。
 */
export async function runBeforeToolHooks(ctx: BeforeToolCallContext): Promise<Record<string, unknown>> {
  let args = ctx.args;
  for (const hook of hooksFor(ctx.toolName)) {
    if (!hook.before) continue;
    try {
      const result = await hook.before({ ...ctx, args });
      if (result && typeof result === 'object') {
        args = result as Record<string, unknown>;
      }
    } catch (err) {
      // 钩子抛错降级：不阻断工具执行，仅记录
      console.warn(`[ToolHook] beforeToolCall(${ctx.toolName}) 执行异常，忽略该钩子: ${(err as Error).message}`);
    }
  }
  return args;
}

/**
 * 执行 after 钩子链：依次调用，返回值作为改写后的 result 透传给下一个钩子。
 * 返回最终 result（无钩子或无改写则原样）。
 */
export async function runAfterToolHooks(ctx: AfterToolCallContext): Promise<unknown> {
  let result = ctx.result;
  for (const hook of hooksFor(ctx.toolName)) {
    if (!hook.after) continue;
    try {
      const next = await hook.after({ ...ctx, result });
      if (next !== undefined) {
        result = next;
      }
    } catch (err) {
      console.warn(`[ToolHook] afterToolCall(${ctx.toolName}) 执行异常，忽略该钩子: ${(err as Error).message}`);
    }
  }
  return result;
}
