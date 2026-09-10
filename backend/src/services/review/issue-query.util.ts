/**
 * 审查结果查询条件工具（2026-09-10）
 *
 * 背景（一次真实的数据不一致缺陷）：
 * 任务列表的「问题数」与详情页条数对不上（如列表 1、详情 64）。
 * 根因是 SQL 三值逻辑：原先各处写 `{ ruleCode: { not: 'NO_RESULT' } }`，
 * Prisma 生成 `ruleCode <> 'NO_RESULT'`，而 **NULL <> 'NO_RESULT' 结果为 NULL（非 TRUE）**，
 * 于是 ruleCode 为 NULL 的行被静默排除。
 *
 * 而 ruleCode 可空（schema: `ruleCode String?`），AI 兜底解析出的条目
 * （Markdown 兜底条目、解析失败提示等）常常没有规则编号 → 数量被系统性少算。
 *
 * 本模块统一「真实问题条目」的口径，所有计数/查询一律走这里，避免各处再写漏 NULL。
 */

/** NO_RESULT：规则引擎与 AI 均未产出问题时写入的占位/说明行，非真实问题 */
export const NO_RESULT_RULE_CODE = 'NO_RESULT';

/**
 * 「真实问题条目」的 Prisma where 片段：排除 NO_RESULT 占位行，但**保留 ruleCode 为 NULL 的条目**。
 *
 * 等价 SQL：`ruleCode IS NULL OR ruleCode <> 'NO_RESULT'`
 * （注意不能只写 `not: 'NO_RESULT'`，那会连同 NULL 一起漏掉——见文件头说明）
 */
export function realIssueWhere(extra: Record<string, any> = {}): Record<string, any> {
  return {
    OR: [
      { ruleCode: null },
      { ruleCode: { not: NO_RESULT_RULE_CODE } },
    ],
    ...extra,
  };
}
