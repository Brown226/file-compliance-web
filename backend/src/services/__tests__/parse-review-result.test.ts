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
