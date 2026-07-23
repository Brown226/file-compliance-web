/**
 * OPT-036: 评测基座 - 审查质量回归测试
 *
 * 用于 CI 门禁：确保审查口径变更不会导致精度/召回率回归。
 * 运行方式: npx vitest run eval/
 *
 * 黄金样本格式 (golden/*.jsonl):
 * { "text": "待审文本", "expectedIssues": [{"issueType": "TYPO", "originalText": "..."}], "mode": "LIBRARY_REVIEW" }
 */
import { describe, it, expect } from 'vitest';
import { LlmService } from '../src/services/llm/llm.service';

describe('审查质量回归基座', () => {

  describe('parseReviewResult 稳定性', () => {
    it('标准 JSON 格式解析不退化', () => {
      const input = JSON.stringify([
        { issueType: 'TYPO', originalText: '帐号', suggestedText: '账号', severity: 'warning' },
        { issueType: 'VIOLATION', originalText: '缺少签名', severity: 'error' },
        { issueType: 'COMPLETENESS', originalText: '缺少目录', severity: 'warning' },
      ]);
      const result = LlmService.parseReviewResult(input);
      expect(result).toHaveLength(3);
      expect(result[0].issueType).toBe('TYPO');
      expect(result[1].issueType).toBe('VIOLATION');
      expect(result[2].issueType).toBe('COMPLETENESS');
    });

    it('合同审查格式解析不退化', () => {
      const input = JSON.stringify([
        { riskLevel: 'HIGH', originalText: '单方解除权', description: '高风险', clauseType: 'change' },
        { riskLevel: 'LOW', originalText: '通知条款', description: '低风险', clauseType: 'other' },
      ]);
      const result = LlmService.parseReviewResult(input);
      expect(result).toHaveLength(2);
      expect(result[0].issueType).toBe('VIOLATION');
      expect(result[0].severity).toBe('error');
      expect(result[1].issueType).toBe('CONSISTENCY');
      expect(result[1].severity).toBe('info');
    });

    it('severity 校验不退化（TYPO 不允许 error）', () => {
      const input = JSON.stringify([
        { issueType: 'TYPO', originalText: '错字', severity: 'error' },
        { issueType: 'FLUENCY', originalText: '不通顺', severity: 'warning' },
        { issueType: 'VIOLATION', originalText: '违规', severity: 'error' },
      ]);
      const result = LlmService.parseReviewResult(input);
      expect(result[0].severity).toBe('warning');  // TYPO: error → warning
      expect(result[1].severity).toBe('info');     // FLUENCY: warning → info
      expect(result[2].severity).toBe('error');    // VIOLATION: error 保持
    });

    it('过滤逻辑不退化（originalText=suggestedText 被过滤）', () => {
      const input = JSON.stringify([
        { issueType: 'TYPO', originalText: '相同', suggestedText: '相同' },
        { issueType: 'TYPO', originalText: '不同', suggestedText: '修正' },
      ]);
      const result = LlmService.parseReviewResult(input);
      expect(result).toHaveLength(1);
      expect(result[0].originalText).toBe('不同');
    });
  });

  describe('splitText + enrichChunksWithContext 稳定性', () => {
    it('分片带位置信息且上下文注入正常', () => {
      const text = '第一章 总则\n\n本规范适用于核电站设计。\n\n第二章 术语\n\n2.1 安全壳\n\n指防止放射性物质泄漏的构筑物。'.repeat(20);
      const chunks = LlmService.splitText(text, 200, true, 50);
      expect(chunks.length).toBeGreaterThan(1);

      // 验证位置信息
      for (const chunk of chunks) {
        expect(chunk.startIndex).toBeGreaterThanOrEqual(0);
        expect(chunk.endIndex).toBeGreaterThan(chunk.startIndex);
        expect(chunk.text.length).toBeGreaterThan(0);
      }

      // 验证上下文注入
      LlmService.enrichChunksWithContext(chunks, text);
      // 第二个 chunk 应有 prevChunkTail
      if (chunks.length > 1) {
        expect(chunks[1].context?.prevChunkTail).toBeDefined();
      }
    });

    it('章节标题检测正常', () => {
      const text = '# 概述\n\n这是概述内容。\n\n## 1.1 背景\n\n这是背景内容。\n\n第2章 设计要求\n\n这是设计要求。'.repeat(10);
      const chunks = LlmService.splitText(text, 100, true, 20);
      LlmService.enrichChunksWithContext(chunks, text);

      // 至少有一个 chunk 检测到章节标题
      const withSection = chunks.filter(c => c.context?.sectionTitle);
      expect(withSection.length).toBeGreaterThan(0);
    });
  });

  describe('文本归一化稳定性', () => {
    it('normalizeForSemanticCompare 消除格式差异', async () => {
      const { normalizeForSemanticCompare, isSubstantiallySame } = await import('../src/services/file/text-normalization.service');

      expect(normalizeForSemanticCompare('你好，世界！')).toBe(normalizeForSemanticCompare('你好,世界!'));
      expect(isSubstantiallySame('设备 安装 完成', '设备安装完成')).toBe(true);
      expect(isSubstantiallySame('完全不同的文本', '另一段文本')).toBe(false);
    });
  });

  describe('originalText 忠实度校验稳定性', () => {
    it('精确匹配和模糊匹配正常', async () => {
      const { validateOriginalText } = await import('../src/services/knowledge/text-fidelity.service');

      const fullText = '本核电站位于深圳市大鹏新区，设计寿命为60年。';

      // 精确匹配
      const exact = validateOriginalText('深圳市大鹏新区', fullText);
      expect(exact.confidence).toBe('exact');

      // 未找到
      const notFound = validateOriginalText('完全不存在的文本片段', fullText);
      expect(notFound.confidence).toBe('not_found');
    });
  });
});
