/**
 * 标准审查流水线（能力驱动）
 *
 * 重构说明（2026-04-19）：
 * 原先 LIBRARY_REVIEW / CONSISTENCY / FULL_REVIEW / CUSTOM_RULE 四个 Pipeline
 * 的 execute() / runFastPhase() / runSlowPhase() 逻辑几乎一模一样，
 * 仅在"是否启用 AI / 标准引用 / 跨文件检查"上有差异。
 *
 * 重构后合并为一个 StandardPipeline，通过 ModeCapabilities 配置区分行为：
 * - LIBRARY_REVIEW: rules=on, stdRef=on, ai=standard, crossFile=off
 * - CONSISTENCY:    rules=on, stdRef=on, ai=standard, crossFile=on
 * - FULL_REVIEW:    rules=on, stdRef=on, ai=standard, crossFile=on  (等同于 CONSISTENCY)
 * - CUSTOM_RULE:    rules=on, stdRef=config, ai=off, crossFile=off
 *
 * BasePipeline 已实现能力驱动的 runFastPhase/runSlowPhase/execute，
 * 本类无需覆盖任何方法，仅需声明对应的 capabilities 即可。
 */

import { BasePipeline } from './base-pipeline';
import { PipelineContext, PipelineResult, ReviewModeType } from './types';
import { ModeCapabilities, getModeCapabilities } from './mode-config';

export class StandardPipeline extends BasePipeline {
  readonly mode: ReviewModeType;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: ModeCapabilities;

  constructor(mode: ReviewModeType, runtimeCapabilities?: ModeCapabilities) {
    super();
    this.mode = mode;
    // 优先使用运行时配置（来自 DB），否则使用默认配置
    this.capabilities = runtimeCapabilities || getModeCapabilities(mode);

    // 根据模式设置显示信息
    const modeInfo: Record<ReviewModeType, { name: string; desc: string }> = {
      LIBRARY_REVIEW: { name: '以库审文', desc: '使用标准库+规则引擎+AI进行合规审查' },
      CONSISTENCY: { name: '全文一致性', desc: '单文件内一致性检查 + 跨文件参数一致性检查' },
      FULL_REVIEW: { name: '全量审查', desc: '执行所有规则、标准引用、AI和跨文件一致性检查' },
      CUSTOM_RULE: { name: '自定义规则', desc: '用户自定义规则审查（仅执行启用的规则，无AI）' },
      // 以下两个不会实际用到（DocReview/Multimodal/TypoGrammar 有各自 Pipeline），
      // 保留声明以防 factory 误传
      DOC_REVIEW: { name: '以文审文', desc: '使用参照文件比对审查' },
      TYPO_GRAMMAR: { name: '错别字/语法', desc: '轻量级错别字和语法检查' },
      MULTIMODAL: { name: '多模态识别', desc: '表格结构化、公式识别、图纸智能分析' },
    };

    const info = modeInfo[mode];
    this.displayName = info.name;
    this.description = info.desc;
  }

  /**
   * StandardPipeline 完全使用 BasePipeline 的能力驱动编排，
   * 无需覆盖 execute / runFastPhase / runSlowPhase。
   * 所有差异化行为已通过 capabilities 配置声明。
   */
}
