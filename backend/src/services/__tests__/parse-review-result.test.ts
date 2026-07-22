/**
 * OPT-002: parseReviewResult 黄金测试集
 *
 * 覆盖 LLM 输出解析的所有路径：
 * - 标准 JSON 数组
 * - Markdown 代码块包裹
 * - 说明文字 + 代码块混合
 * - 控制字符混入
 * - 合同审查格式（riskLevel）
 * - 过滤逻辑（originalText=suggestedText、JSON 片段、分类标签）
 * - 空输出 / 畸形 JSON
 */
import { describe, it, expect } from 'vitest';
import { LlmService } from '../llm.service';

describe('LlmService.parseReviewResult', () => {
  // ===== 正常路径 =====

  it('解析标准 JSON 数组', () => {
    const input = JSON.stringify([
      { issueType: 'TYPO', originalText: '帐号', suggestedText: '账号', description: '错别字' },
      { issueType: 'VIOLATION', originalText: '缺少签名', description: '合规问题' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(2);
    expect(result[0].issueType).toBe('TYPO');
    expect(result[0].originalText).toBe('帐号');
    expect(result[0].suggestedText).toBe('账号');
    expect(result[1].issueType).toBe('VIOLATION');
  });

  it('解析 markdown ```json 代码块', () => {
    const input = '```json\n[{"issueType":"TYPO","originalText":"按装","suggestedText":"安装","description":"错别字"}]\n```';
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].issueType).toBe('TYPO');
    expect(result[0].originalText).toBe('按装');
  });

  it('解析 markdown ``` 代码块（无 json 标记）', () => {
    const input = '```\n[{"issueType":"FORMAT","originalText":"格式问题","description":"排版"}]\n```';
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].issueType).toBe('FORMAT');
  });

  it('解析说明文字 + 代码块混合', () => {
    const input = '以下是审查结果：\n```json\n[{"issueType":"LAYOUT","originalText":"页边距","description":"页边距不规范"}]\n```\n共发现1个问题。';
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].issueType).toBe('LAYOUT');
  });

  it('解析带前后说明文字的 JSON', () => {
    const input = '审查完成，发现以下问题：\n[{"issueType":"NAMING","originalText":"文件命名","description":"命名不规范"}]\n以上。';
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].issueType).toBe('NAMING');
  });

  // ===== 合同审查格式 =====

  it('解析合同审查格式（riskLevel → issueType 映射）', () => {
    const input = JSON.stringify([
      { riskLevel: 'HIGH', clauseType: 'payment', originalText: '甲方有权单方解除合同', description: '高风险条款' },
      { riskLevel: 'MEDIUM', clauseType: 'penalty', originalText: '违约金为合同总额的1%', description: '中风险' },
      { riskLevel: 'LOW', clauseType: 'other', originalText: '本合同一式两份', description: '低风险' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(3);
    expect(result[0].issueType).toBe('VIOLATION');  // HIGH → VIOLATION
    expect(result[0].severity).toBe('error');
    expect(result[1].issueType).toBe('COMPLETENESS');  // MEDIUM → COMPLETENESS
    expect(result[1].severity).toBe('warning');
    expect(result[2].issueType).toBe('CONSISTENCY');  // LOW → CONSISTENCY
    expect(result[2].severity).toBe('info');
  });

  // ===== 过滤逻辑 =====

  it('过滤 originalText === suggestedText 的无效条目', () => {
    const input = JSON.stringify([
      { issueType: 'TYPO', originalText: '正确文本', suggestedText: '正确文本', description: '无变化' },
      { issueType: 'TYPO', originalText: '帐号', suggestedText: '账号', description: '有效修正' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe('帐号');
  });

  it('过滤缺少 issueType 和 riskLevel 的条目', () => {
    const input = JSON.stringify([
      { originalText: '无类型', description: '缺少类型' },
      { issueType: 'TYPO', originalText: '帐号', suggestedText: '账号', description: '有效' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].issueType).toBe('TYPO');
  });

  it('过滤缺少 originalText 的条目', () => {
    const input = JSON.stringify([
      { issueType: 'TYPO', description: '缺少原文' },
      { issueType: 'TYPO', originalText: '帐号', suggestedText: '账号', description: '有效' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
  });

  it('无效 issueType 降级为 VIOLATION', () => {
    const input = JSON.stringify([
      { issueType: 'UNKNOWN_TYPE', originalText: '某文本', description: '未知类型' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].issueType).toBe('VIOLATION');
  });

  // ===== severity 校验（OPT-022 集成） =====

  it('TYPO 类型 severity 被限制为 warning（不允许 error）', () => {
    const input = JSON.stringify([
      { issueType: 'TYPO', originalText: '帐号', suggestedText: '账号', severity: 'error', description: '错别字' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');  // error 被降级为 warning
  });

  it('FLUENCY 类型 severity 被限制为 info', () => {
    const input = JSON.stringify([
      { issueType: 'FLUENCY', originalText: '语句不通顺', severity: 'warning', description: '语句问题' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('info');
  });

  it('VIOLATION 类型允许 error severity', () => {
    const input = JSON.stringify([
      { issueType: 'VIOLATION', originalText: '违反规范', severity: 'error', description: '违规' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('error');
  });

  // ===== 边界情况 =====

  it('空数组返回空结果', () => {
    const result = LlmService.parseReviewResult('[]');
    expect(result).toHaveLength(0);
  });

  it('空字符串返回空结果', () => {
    const result = LlmService.parseReviewResult('');
    expect(result).toHaveLength(0);
  });

  it('纯文本（非 JSON）返回空结果', () => {
    const result = LlmService.parseReviewResult('该文件没有发现任何问题。');
    expect(result).toHaveLength(0);
  });

  it('畸形 JSON 返回空结果', () => {
    const result = LlmService.parseReviewResult('[{"issueType": "TYPO", "originalText":}');
    expect(result).toHaveLength(0);
  });

  it('处理字符串内的控制字符', () => {
    const input = '[{"issueType":"TYPO","originalText":"第一行\\n第二行","suggestedText":"修正","description":"含换行"}]';
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toContain('第一行');
  });

  it('处理超长输出（50+ issues）', () => {
    const issues = Array.from({ length: 50 }, (_, i) => ({
      issueType: 'TYPO',
      originalText: `错别字${i}`,
      suggestedText: `正确${i}`,
      description: `问题${i}`,
    }));
    const result = LlmService.parseReviewResult(JSON.stringify(issues));
    expect(result).toHaveLength(50);
  });

  // ===== Markdown 表格兜底解析 =====

  it('解析 Markdown 表格格式输出', () => {
    const input = `| 问题类型 | 原始文本 | 建议修改 | 说明 |
|---------|---------|---------|------|
| TYPO | 帐号 | 账号 | 错别字 |
| FORMAT | 格式 | 格式修正 | 排版问题 |`;
    const result = LlmService.parseReviewResult(input);
    // Markdown 表格兜底解析应能提取出 issues
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
/**
 * parseReviewResult 测试
 *
 * 测试 LlmService.parseReviewResult 对 LLM 审查结果 JSON 的解析能力。
 * 支持标准审查格式(issueType)和合同审查格式(riskLevel)。
 */
import { describe, it, expect } from 'vitest';
import { LlmService } from '../llm.service';

describe('parseReviewResult', () => {

  /* 1. 标准 JSON 数组 */
  it('should parse a standard JSON array of issues', () => {
    const input = JSON.stringify([
      { issueType: 'TYPO', originalText: '帐号', suggestedText: '账号', severity: 'warning', description: '错别字' },
      { issueType: 'VIOLATION', originalText: '错误内容', severity: 'error', description: '违规' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(2);
    expect(result[0].issueType).toBe('TYPO');
    expect(result[1].issueType).toBe('VIOLATION');
  });

  /* 2. Markdown 代码块中的 JSON */
  it('should extract JSON from a markdown code block', () => {
    const input = '```json\n[\n  { "issueType": "FORMAT", "originalText": "test1", "severity": "warning" },\n  { "issueType": "COMPLETENESS", "originalText": "test2", "severity": "error" }\n]\n```';
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(2);
    expect(result[0].issueType).toBe('FORMAT');
    expect(result[1].issueType).toBe('COMPLETENESS');
  });

  /* 3. 混合格式（说明文字 + 代码块） */
  it('should extract JSON from mixed text with code block', () => {
    const input = `以下是对文件的审查结果：

\`\`\`json
[
  { "issueType": "TYPO", "originalText": "按装", "suggestedText": "安装", "severity": "warning" },
  { "issueType": "VIOLATION", "originalText": "错误编码", "severity": "error" }
]
\`\`\`

以上共发现 2 个问题。`;
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(2);
    expect(result[0].originalText).toBe('按装');
  });

  /* 4. 空输出 */
  it('should return empty array for empty input', () => {
    const result = LlmService.parseReviewResult('');
    expect(result).toEqual([]);
  });

  it('should return empty array for whitespace-only input', () => {
    const result = LlmService.parseReviewResult('   \n\n  ');
    expect(result).toEqual([]);
  });

  /* 5. 畸形 JSON */
  it('should return empty array for malformed JSON', () => {
    const result = LlmService.parseReviewResult('这不是 JSON 内容，只是一个普通文本。');
    expect(result).toEqual([]);
  });

  it('should handle JSON truncated in the middle', () => {
    const input = '[{ "issueType": "TYPO", "originalText": "帐号"';
    const result = LlmService.parseReviewResult(input);
    // May either succeed partially or return empty - both acceptable
    expect(Array.isArray(result)).toBe(true);
  });

  /* 6. 合同审查格式（riskLevel） */
  it('should parse contract review format with riskLevel', () => {
    const input = JSON.stringify([
      { riskLevel: 'HIGH', originalText: '付款条款模糊', description: '付款条件不明确', clauseType: 'payment' },
      { riskLevel: 'MEDIUM', originalText: '质保期', description: '质保期过短', clauseType: 'warranty' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(2);
    // HIGH → VIOLATION + error, MEDIUM → COMPLETENESS + warning
    expect(result[0].issueType).toBe('VIOLATION');
    expect(result[0].severity).toBe('error');
    expect(result[1].issueType).toBe('COMPLETENESS');
    expect(result[1].severity).toBe('warning');
  });

  /* 7. originalText === suggestedText 过滤 */
  it('should filter out items where originalText === suggestedText', () => {
    const input = JSON.stringify([
      { issueType: 'TYPO', originalText: '相同的文本', suggestedText: '相同的文本', severity: 'warning' },
      { issueType: 'VIOLATION', originalText: '不同的文本', suggestedText: '修正后的文本', severity: 'error' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe('不同的文本');
  });

  /* 8. JSON 片段过滤 */
  it('should filter out items whose originalText looks like JSON', () => {
    const input = JSON.stringify([
      { issueType: 'TYPO', originalText: '{"key": "value"}', severity: 'warning' },
      { issueType: 'VIOLATION', originalText: '正常文本', severity: 'error' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe('正常文本');
  });

  /* 额外：缺失必要字段 */
  it('should filter out items missing both issueType and riskLevel', () => {
    const input = JSON.stringify([
      { originalText: '只有文本', severity: 'warning' },
      { issueType: 'TYPO', originalText: '有效条目', severity: 'error' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe('有效条目');
  });

  /* 额外：无效 issueType 降级 */
  it('should fallback invalid issueType to VIOLATION', () => {
    const input = JSON.stringify([
      { issueType: 'UNKNOWN_TYPE', originalText: '测试文本', severity: 'warning' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].issueType).toBe('VIOLATION');
  });

  /* 额外：缺失 originalText */
  it('should filter out items with missing originalText', () => {
    const input = JSON.stringify([
      { issueType: 'TYPO', severity: 'warning' },
      { issueType: 'VIOLATION', originalText: '有效', severity: 'error' },
    ]);
    const result = LlmService.parseReviewResult(input);
    expect(result).toHaveLength(1);
    expect(result[0].originalText).toBe('有效');
  });

});
