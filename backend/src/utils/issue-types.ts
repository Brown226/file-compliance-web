/**
 * ReviewIssue 合法 issueType 枚举 — 全项目唯一权威源
 *
 * 此前该列表在 LlmService.parseReviewResult、StructuredConsistencyService、
 * format_issues 工具中各有拷贝（数组×2 + Set×1），新增类型需同步三处易漏。
 * 统一导出数组与 Set 两种形态，供各调用方按使用习惯引用：
 *   - 数组：VALID_ISSUE_TYPES.includes(type)
 *   - Set：VALID_ISSUE_TYPES_SET.has(type)
 */
export const VALID_ISSUE_TYPES = [
  'TYPO',
  'VIOLATION',
  'FORMAT',
  'COMPLETENESS',
  'CONSISTENCY',
  'LAYOUT',
  'NAMING',
  'ENCODING',
  'ATTRIBUTE',
  'HEADER',
  'PAGE',
  'FLUENCY',
  'CROSS_REFERENCE',
] as const;

export const VALID_ISSUE_TYPES_SET = new Set<string>(VALID_ISSUE_TYPES);