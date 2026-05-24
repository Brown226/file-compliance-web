/**
 * 标准审查流水线（能力驱动）
 *
 * 重构说明（2026-04-19）：
 * 原先 LIBRARY_REVIEW / CONSISTENCY / CUSTOM_RULE 三个 Pipeline
 * 的 execute() / runFastPhase() / runSlowPhase() 逻辑几乎一模一样，
 * 仅在"是否启用 AI / 标准引用 / 跨文件检查"上有差异。
 *
 * 重构后合并为一个 StandardPipeline，通过 ModeCapabilities 配置区分行为：
 * - LIBRARY_REVIEW: rules=on, stdRef=on, ai=standard, crossFile=off
 * - CONSISTENCY:    rules=on, stdRef=on, ai=standard, crossFile=on
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
    const modeInfo: Partial<Record<ReviewModeType, { name: string; desc: string }>> = {
      LIBRARY_REVIEW: { name: '以库审文', desc: '使用标准库+规则引擎+AI进行合规审查' },
      CONSISTENCY: { name: '全文一致性', desc: '单文件内一致性检查 + 跨文件参数一致性检查' },
      CUSTOM_RULE: { name: '自定义规则', desc: '用户自定义规则审查（仅执行启用的规则，无AI）' },
    };

    const info = modeInfo[mode] || { name: mode, desc: '' };
    this.displayName = info.name;
    this.description = info.desc;
  }

  /**
   * StandardPipeline 完全使用 BasePipeline 的能力驱动编排，
   * 无需覆盖 execute / runFastPhase / runSlowPhase。
   * 所有差异化行为已通过 capabilities 配置声明。
   */
}
