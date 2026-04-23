/**
 * 规则引擎公共类型定义
 */

export interface RuleIssue {
  issueType: string;       // NAMING | ENCODING | ATTRIBUTE | HEADER | PAGE
                           // + FORMAT | COMPLETENESS | CONSISTENCY | LAYOUT | TYPO(确定性)
                           // + DWG (DWG 图纸专用)
  ruleCode: string;        // NAME_001, CODE_001, ..., FORMAT_001, COMPL_001, CONSIST_001, LAYOUT_001, TYPO_001
                           // + DWG_TITLE_001, DWG_LAYER_001, DWG_DIM_001, DWG_STDREF_001, DWG_SCALE_001, DWG_OVERLAP_001
  severity: 'error' | 'warning' | 'info';
  originalText: string;
  suggestedText?: string;
  description: string;
  /** CAD 图元 Handle ID（用于前端 CAD 定位，仅 DWG 规则使用） */
  cadHandleId?: string;
}

export interface FileContext {
  fileName: string;         // 原始文件名
  filePath: string;         // 文件路径
  fileType: string;         // dwg, doc, docx, xls, xlsx, pdf, ppt, pptx
  extractedText?: string;   // 解析后的文本
  pdfPages?: string[];      // PDF 逐页文本（用于页眉/页码检查）
  reviewMode?: string;      // 审查模式（LIBRARY_REVIEW, DOC_REVIEW, CONSISTENCY, TYPO_GRAMMAR, MULTIMODAL, CUSTOM_RULE, FULL_REVIEW）
  /** Python 解析服务的结构化结果（DWG 图层/标注/图元等元数据） */
  parseResult?: import('../python-parser.service').ParseResult | null;
}

/**
 * 规则配置项 — 来自 review_rules 数据库表
 */
export interface RuleConfig {
  enabled: boolean;         // 是否启用
  severity: string;         // 严重度覆盖: 'error' | 'warning' | 'info'
  config?: any;             // 规则参数（正则、阈值等，支持高级定制）
}

/**
 * runAllRules 的配置选项
 */
export interface RunRulesOptions {
  /** 仅执行这些 ruleCode 对应的规则（Set 中的值为规则前缀，如 'NAME' 匹配 NAME_001~010） */
  enabledRulePrefixes?: Set<string>;
  /** 每个 ruleCode 的严重度覆盖 */
  severityMap?: Map<string, string>;
  /** 每个 ruleCode 的配置参数 */
  configMap?: Map<string, any>;
}
