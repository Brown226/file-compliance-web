/**
 * 默认工具钩子注册 — P1-⑫ 工具拦截钩子机制的「首个业务用例」
 *
 * 背景：tool-hook.service.ts 提供了完整的 before/after 钩子框架，但此前
 * 全库零注册（机制"已接线但休眠"）。本文件是第一个实际注册的钩子集合，
 * 由 tools/index.ts 模块加载时调用 registerDefaultToolHooks() 完成注册。
 *
 * 用例：llm_review_chunk 审查结果去重
 * - 场景：同一个问题在两个 chunk 中反复被 LLM 上报（原文相似），
 *   直接落库会造成重复告警。
 * - 方案：afterToolCall 钩子在 llm_review_chunk 返回 ReviewIssue[] 后，
 *   经 issue-dedup（精确 + Levenshtein 模糊去重）过滤，再交回工具链。
 * - 收益：对 llm_review_chunk 工具本身零侵入（不在工具内部改逻辑），
 *   去重策略可热插拔（钩子注册/注销即可开关）。
 *
 * 设计：
 * - 钩子抛错不阻断主流程（tool-hook.service 内部 try/catch 降级，
 *   这里也尽量自吞异常，保证 Agent 可用性优先）
 * - 只处理 result 是数组的情况（ReviewIssue[]），非数组原样不改写
 */

import { registerToolHooks } from './tool-hook.service';
import { dedupIssues } from '../../../utils/issue-dedup';
import type { ReviewIssue } from '../../llm/llm.service';

/**
 * 注册全部默认工具钩子（幂等：重复调用会重复注册，仅用于进程启动时调用一次）
 *
 * 目前包含：
 * 1. llm_review_chunk after → 审查结果去重（同问题只上报一次）
 */
export function registerDefaultToolHooks(): void {
  registerToolHooks('llm_review_chunk', {
    after: (ctx) => {
      try {
        const result = ctx.result;
        // llm_review_chunk 的 execute 返回 ReviewIssue[]（hookWrapper 在
        // injectionGuardWrapper 内层，此处拿到的是原始数组而非 <tool_result> 包裹串）
        if (!Array.isArray(result)) return undefined; // 非数组不改写
        const issues = result as ReviewIssue[];
        const deduped = dedupIssues(issues);
        if (deduped.length !== issues.length) {
          console.warn(
            `[ToolHook] llm_review_chunk 去重: ${issues.length} → ${deduped.length} 条（${issues.length - deduped.length} 条重复被过滤）`,
          );
        }
        return deduped;
      } catch (e) {
        // 去重失败不阻断工具结果，仅记录（与 tool-hook.service 的降级语义一致）
        console.warn('[ToolHook] llm_review_chunk 去重钩子执行异常:', (e as Error).message);
        return undefined;
      }
    },
  });
}
