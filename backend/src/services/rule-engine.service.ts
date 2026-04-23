/**
 * 规则引擎服务 - 确定性规则检查（不依赖 LLM）
 * 实现需求说明中的 8 大审查规则中可程序化执行的 10 项：
 *   1. 文件命名规范检查 (NAME_001~010)
 *   2. 编码一致性检查 (CODE_001~005, UNIT_001~005)
 *   3. 封面属性检查 (ATTR_001~011)
 *   4. 页眉内容检查 (HEADER_001~003)
 *   5. 连续页码检查 (PAGE_001~004)
 *   ---- 基于真实测试文件错误分析报告新增 ----
 *   6. 格式规范检查 (FORMAT_001~005)
 *   7. 数据完整性检查 (COMPL_001~003)
 *   8. 一致性检查 (CONSIST_001~002)
 *   9. 文本排版检查 (LAYOUT_001)
 *  10. 正文编码校验 (TYPO_001)
 *
 * 注意: 实际规则逻辑已拆分至 ./rules/ 目录下的独立模块，
 * 此文件仅作为向后兼容层，保持 RuleEngineService 类的导出接口不变。
 */

import { runAllRules, RunRulesOptions } from './rules';
export type { RuleIssue, FileContext, RunRulesOptions } from './rules';

/**
 * 规则引擎服务（向后兼容层）
 * 所有规则逻辑已迁移至 ./rules/ 目录下的独立模块
 */
export class RuleEngineService {
  /**
   * 执行所有规则检查（异步，从数据库读取配置）
   */
  static runAllRules = runAllRules;

  /**
   * 执行指定前缀的规则检查
   * @param ctx 文件上下文
   * @param prefixes 规则前缀列表，如 ['NAME', 'FORMAT', 'TYPO']
   */
  static async runSelectedRules(ctx: any, prefixes: string[]): Promise<any[]> {
    const options: RunRulesOptions = {
      enabledRulePrefixes: new Set(prefixes),
    };
    return runAllRules(ctx, options);
  }
}
