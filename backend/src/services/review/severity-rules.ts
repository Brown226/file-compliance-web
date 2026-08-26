/**
 * OPT-022: AI severity 合理性校验
 *
 * LLM 输出的 severity 由模型自主判定，可能不合理（如 TYPO 标为 error）。
 * 本模块定义 issueType → allowedSeverities 映射表，在入库前校验并修正。
 */

type Severity = 'error' | 'warning' | 'info';

interface SeverityRule {
  /** 该 issueType 允许的 severity 列表（按严重度升序：info < warning < error） */
  allowed: Severity[];
  /** 当 LLM 未输出 severity 时的默认值 */
  default: Severity;
}

/**
 * issueType → severity 约束映射表
 *
 * 设计原则：
 * - 文字层面问题（TYPO/FLUENCY）最高 warning，不允许 error
 * - 格式/排版类问题（FORMAT/LAYOUT/NAMING/ENCODING/ATTRIBUTE/HEADER/PAGE）最高 warning
 * - 实质性问题（VIOLATION/COMPLETENESS/CONSISTENCY/CROSS_REFERENCE）允许 error
 */
export const SEVERITY_RULES: Record<string, SeverityRule> = {
  TYPO:           { allowed: ['info', 'warning'], default: 'warning' },
  FLUENCY:        { allowed: ['info'], default: 'info' },
  FORMAT:         { allowed: ['info', 'warning'], default: 'warning' },
  LAYOUT:         { allowed: ['info', 'warning'], default: 'warning' },
  NAMING:         { allowed: ['info', 'warning'], default: 'warning' },
  ENCODING:       { allowed: ['info', 'warning'], default: 'warning' },
  ATTRIBUTE:      { allowed: ['info', 'warning'], default: 'warning' },
  HEADER:         { allowed: ['info', 'warning'], default: 'warning' },
  PAGE:           { allowed: ['info', 'warning'], default: 'warning' },
  VIOLATION:      { allowed: ['warning', 'error'], default: 'error' },
  COMPLETENESS:   { allowed: ['warning', 'error'], default: 'warning' },
  CONSISTENCY:    { allowed: ['info', 'warning', 'error'], default: 'warning' },
  CROSS_REFERENCE:{ allowed: ['info', 'warning', 'error'], default: 'warning' },
};

/** 未知 issueType 的兜底规则 */
const FALLBACK_RULE: SeverityRule = { allowed: ['info', 'warning', 'error'], default: 'warning' };

/** 统计：被修正的 severity 计数（用于日志/调优） */
let correctedCount = 0;

/** 严重度数值刻度（info=1 < warning=2 < error=3），用于钳制时计算最近合法值 */
const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, error: 3 };

/**
 * 校验并修正 severity
 *
 * @param issueType 问题类型
 * @param severity LLM 输出的 severity（可能为 undefined/null/非法值）
 * @returns 修正后的合法 severity
 */
export function validateSeverity(issueType: string, severity: string | undefined | null): Severity {
  const rule = SEVERITY_RULES[issueType] || FALLBACK_RULE;

  // 无 severity 时使用默认值
  if (!severity || !['error', 'warning', 'info'].includes(severity)) {
    return rule.default;
  }

  const sev = severity as Severity;

  // 在允许范围内，直接通过
  if (rule.allowed.includes(sev)) {
    return sev;
  }

  // 不在允许范围内：钳制到"距离最近"的合法严重度（同距取更轻者）。
  // 修复 P0：旧实现固定取 allowed 末位（最严重值），导致 VIOLATION/COMPLETENESS
  // 的 info 被强升为 error——LLM 判轻的问题被系统抬高严重级，error 统计虚高。
  correctedCount++;
  let corrected = rule.allowed[0];
  for (const candidate of rule.allowed) {
    if (Math.abs(SEVERITY_RANK[candidate] - SEVERITY_RANK[sev])
      < Math.abs(SEVERITY_RANK[corrected] - SEVERITY_RANK[sev])) {
      corrected = candidate;
    }
  }
  if (correctedCount % 50 === 1) {
    console.log(`[SeverityRules] 已修正 ${correctedCount} 次不合理 severity（最近: ${issueType} ${severity}→${corrected}）`);
  }
  return corrected;
}

/**
 * 获取修正统计（用于健康检查/日志）
 */
export function getSeverityCorrectionCount(): number {
  return correctedCount;
}

/**
 * 重置统计（测试用）
 */
export function resetSeverityCorrectionCount(): void {
  correctedCount = 0;
}
