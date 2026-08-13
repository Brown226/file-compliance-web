// DEC 审查策略编排核心测试（双分支并行 + 3 层复核 + 规则兜底）
// - 双分支结果合并与 reviewSource 标记
// - 完整性分支失败容错
// - 规则兜底去重（AI 已发现的问题不重复产出）
// - checkpoints 按 auditDimension 分流
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecReviewService } from '../dec-review.service';
import { CompletenessReviewService } from '../completeness-review.service';
import { FactCheckService } from '../fact-check.service';
import { TextStyleCheckService } from '../text-style-check.service';
import { StandardClauseCheckService } from '../../standard/standard-clause-check.service';
import { SmartJudgeService } from '../cross-review/smart-judge.service';
import { ImageTextCheckService } from '../cross-review/image-text-check.service';
import { TextCrossCheckService } from '../cross-review/text-cross-check.service';
import * as rulesModule from '../../rules';
import type { ReviewIssue } from '../../llm/llm.service';

function makeIssue(partial: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    issueType: 'VIOLATION',
    originalText: '原文内容',
    severity: 'warning',
    description: '问题描述',
    ...partial,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    fileId: 'file-1',
    fileName: '设计说明.docx',
    filePath: '/tmp/设计说明.docx',
    fileType: 'docx',
    extractedText: '',
    reviewMode: 'DEC_REVIEW',
    ...overrides,
  } as any;
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    chunkSize: 4000,
    llmMaxTokens: 4096,
    llmTimeout: 180,
    ...overrides,
  } as any;
}

const COMPLIANCE_CP = { id: 'cp-1', clauseCode: 'C-01', clauseText: '须符合规范', mandatory: '1', auditDimension: 'compliance', checkPrompt: null };
const FACT_CP = { id: 'cp-2', clauseCode: 'F-01', clauseText: '参数须一致', mandatory: '1', auditDimension: 'fact', checkPrompt: null };
const TEXT_CP = { id: 'cp-3', clauseCode: 'T-01', clauseText: '行文须统一', mandatory: '1', auditDimension: 'text', checkPrompt: null };

describe('DecReviewService（DEC 双分支审查编排）', () => {
  let completenessSpy: ReturnType<typeof vi.spyOn>;
  let factSpy: ReturnType<typeof vi.spyOn>;
  let textStyleSpy: ReturnType<typeof vi.spyOn>;
  let checkClausesSpy: ReturnType<typeof vi.spyOn>;
  let toReviewIssueSpy: ReturnType<typeof vi.spyOn>;
  let judgeSpy: ReturnType<typeof vi.spyOn>;
  let imageTextSpy: ReturnType<typeof vi.spyOn>;
  let crossCheckSpy: ReturnType<typeof vi.spyOn>;
  let runAllRulesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    completenessSpy = vi.spyOn(CompletenessReviewService, 'check').mockResolvedValue({
      issues: [makeIssue({ originalText: '完整性缺失', issueType: 'COMPLETENESS' })],
    });
    factSpy = vi.spyOn(FactCheckService, 'check').mockResolvedValue([makeIssue({ originalText: '事实问题' })]);
    textStyleSpy = vi.spyOn(TextStyleCheckService, 'check').mockResolvedValue([makeIssue({ originalText: '文本问题' })]);
    checkClausesSpy = vi.spyOn(StandardClauseCheckService, 'checkClauses').mockResolvedValue({
      results: [
        {
          clauseId: 'cp-1', clauseCode: 'C-01', clauseTitle: 'C-01', clauseContent: '须符合规范',
          status: 'NON_COMPLIANT', description: '违反条文', suggestion: '修改', originalText: '原文',
        },
      ],
      compliant: 0, nonCompliant: 1, unverified: 0,
    });
    toReviewIssueSpy = vi.spyOn(StandardClauseCheckService, 'toReviewIssue').mockReturnValue(
      makeIssue({ originalText: '合规问题', ruleCode: 'STD_C-01' }),
    );
    judgeSpy = vi.spyOn(SmartJudgeService, 'judge').mockImplementation(async (issues) => issues);
    imageTextSpy = vi.spyOn(ImageTextCheckService, 'check').mockImplementation(async (issues) => issues);
    crossCheckSpy = vi.spyOn(TextCrossCheckService, 'check').mockImplementation(async (issues) => issues);
    runAllRulesSpy = vi.spyOn(rulesModule, 'runAllRules').mockResolvedValue([]);
  });

  afterEach(() => {
    completenessSpy.mockRestore();
    factSpy.mockRestore();
    textStyleSpy.mockRestore();
    checkClausesSpy.mockRestore();
    toReviewIssueSpy.mockRestore();
    judgeSpy.mockRestore();
    imageTextSpy.mockRestore();
    crossCheckSpy.mockRestore();
    runAllRulesSpy.mockRestore();
  });

  it('双分支并行执行，结果合并且 reviewSource 正确标记', async () => {
    const result = await DecReviewService.runDecStrategy('设计文本', makeCtx({ checkpoints: [COMPLIANCE_CP] }), makeConfig());
    const sources = result.issues.map(i => (i as any).reviewSource as string);
    expect(sources).toContain('COMPLETENESS');   // 完整性分支
    expect(sources).toContain('COMPLIANCE');     // 遵从性分支
    expect(result.engine).toBe('dec-review');
    expect(completenessSpy).toHaveBeenCalledTimes(1);
    expect(checkClausesSpy).toHaveBeenCalledTimes(1);
  });

  it('完整性分支失败时返回空结果，不影响遵从性分支', async () => {
    completenessSpy.mockRejectedValue(new Error('完整性服务崩溃'));
    const result = await DecReviewService.runDecStrategy('设计文本', makeCtx({ checkpoints: [COMPLIANCE_CP] }), makeConfig());
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
    expect(result.issues.every(i => (i as any).reviewSource !== 'COMPLETENESS')).toBe(true);
  });

  it('checkpoints 按 auditDimension 分流：compliance→条文校验，fact→事实校验，text→文本校验', async () => {
    const ctx = makeCtx({ checkpoints: [COMPLIANCE_CP, FACT_CP, TEXT_CP] });
    await DecReviewService.runDecStrategy('设计文本', ctx, makeConfig());

    // compliance 审点传入 checkClauses
    const clausesArg = checkClausesSpy.mock.calls[0][0] as Array<{ code: string; category: string }>;
    expect(clausesArg).toHaveLength(1);
    expect(clausesArg[0].code).toBe('C-01');
    expect(clausesArg[0].category).toBe('compliance');

    // fact 审点传入 FactCheckService
    expect(factSpy).toHaveBeenCalledTimes(1);
    const factArgs = factSpy.mock.calls[0];
    expect((factArgs[2] as any[])[0].id).toBe('cp-2');

    // text 审点传入 TextStyleCheckService
    expect(textStyleSpy).toHaveBeenCalledTimes(1);
    const textArgs = textStyleSpy.mock.calls[0];
    expect((textArgs[2] as any[])[0].id).toBe('cp-3');
  });

  it('无审点时跳过 LLM 审查服务（空分支短路）', async () => {
    const result = await DecReviewService.runDecStrategy('设计文本', makeCtx({ checkpoints: [] }), makeConfig());
    expect(checkClausesSpy).not.toHaveBeenCalled();
    expect(factSpy).not.toHaveBeenCalled();
    expect(textStyleSpy).not.toHaveBeenCalled();
    expect(result.issues.length).toBeGreaterThanOrEqual(0);
  });

  it('第二层交叉复核：智能判标 → 图文复核 → 文本复核串联执行', async () => {
    await DecReviewService.runDecStrategy('设计文本', makeCtx({ checkpoints: [COMPLIANCE_CP] }), makeConfig());
    expect(judgeSpy).toHaveBeenCalledTimes(1);
    expect(imageTextSpy).toHaveBeenCalledTimes(1);
    expect(crossCheckSpy).toHaveBeenCalledTimes(1);
    // 顺序：judge 先于 imageText，imageText 先于 crossCheck
    const judgeOrder = judgeSpy.mock.invocationCallOrder[0];
    const imageTextOrder = imageTextSpy.mock.invocationCallOrder[0];
    const crossCheckOrder = crossCheckSpy.mock.invocationCallOrder[0];
    expect(judgeOrder).toBeLessThan(imageTextOrder);
    expect(imageTextOrder).toBeLessThan(crossCheckOrder);
  });

  it('图文复核收到设计文本与上下文（含 dwgStructure 时执行结构化比对）', async () => {
    await DecReviewService.runDecStrategy('设计文本', makeCtx({ checkpoints: [COMPLIANCE_CP] }), makeConfig());
    const [issuesArg, ctxArg, textArg] = imageTextSpy.mock.calls[0];
    expect(textArg).toBe('设计文本');
    expect(ctxArg.taskId).toBe('task-1');
    expect(Array.isArray(issuesArg)).toBe(true);
  });

  it('规则兜底：AI 已发现的问题（originalText 相同）不重复产出，新增的带 RULE_FALLBACK 标记', async () => {
    runAllRulesSpy.mockResolvedValue([
      { issueType: 'TYPO', originalText: '合规问题', ruleCode: 'TYPO-1', severity: 'warning' },
      { issueType: 'TYPO', originalText: '新增规则问题', ruleCode: 'TYPO-2', severity: 'error' },
    ] as any);
    const result = await DecReviewService.runDecStrategy('设计文本', makeCtx({ checkpoints: [COMPLIANCE_CP] }), makeConfig());
    const ruleFallbackIssues = result.issues.filter(i => (i as any).reviewSource === 'RULE_FALLBACK');
    expect(ruleFallbackIssues).toHaveLength(1);
    expect(ruleFallbackIssues[0].originalText).toBe('新增规则问题');
  });

  it('规则兜底失败时返回空，不影响整体结果', async () => {
    runAllRulesSpy.mockRejectedValue(new Error('规则引擎崩溃'));
    const result = await DecReviewService.runDecStrategy('设计文本', makeCtx({ checkpoints: [COMPLIANCE_CP] }), makeConfig());
    expect(result.issues.length).toBeGreaterThanOrEqual(1);
  });
});
