/**
 * runRAGReviewAgent 单元测试（一期 A 知识库审查 Agent 化）
 *
 * 覆盖：
 * - 疑点抽取 → 无知识库命中 → UNVERIFIED（不编造引用）
 * - 疑点抽取 → 命中 → 判定 → KB_VERIFIED + sourceReferences 真实绑定
 * - 无疑点 → 空结果
 * - 分片处理失败 → 降级不崩
 *
 * 通过 mock LlmService / RagflowProvider / system-config 隔离外部依赖，
 * RAGService.retrieve 用 vi.spyOn 注入（同 class 静态方法）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const splitTextMock = vi.fn();
const reviewTextMock = vi.fn();
const mergeRetrievedChunksMock = vi.fn();
const ragflowRetrieveMock = vi.fn();

vi.mock('../../llm/llm.service', () => ({
  LlmService: {
    splitText: (...args: any[]) => splitTextMock(...args),
    reviewText: (...args: any[]) => reviewTextMock(...args),
    chat: vi.fn(),
  },
}));

vi.mock('../ragflow.service', () => ({
  RagflowProvider: {
    retrieve: (...args: any[]) => ragflowRetrieveMock(...args),
    mergeRetrievedChunks: (...args: any[]) => mergeRetrievedChunksMock(...args),
    getKnowledgeTree: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../maxkb.service', () => ({ MaxKBService: {} }));
vi.mock('../../llm/prompt-template.service', () => ({ PromptTemplateService: {} }));
vi.mock('../../system/cache.service', () => ({ CacheService: {} }));
vi.mock('../../../utils/parallel', () => ({ parallelLimit: (items: any[], _limit: number, fn: any) => Promise.all(items.map((it: any, i: number) => fn(it, i))) }));
vi.mock('../../../utils/system-config', () => ({ getChunkConcurrency: vi.fn().mockResolvedValue(2) }));

import { RAGService } from '../rag.service';

const RETRIEVED: any[] = [
  {
    id: 'chunk-1',
    content: '接地电阻不应大于 1 欧姆',
    document_name: 'GB/T 50065',
    knowledge_name: '标准库',
    similarity: 0.82,
    comprehensive_score: 0.8,
  },
];

let retrieveSpy: any;

beforeEach(() => {
  splitTextMock.mockReset();
  reviewTextMock.mockReset();
  mergeRetrievedChunksMock.mockReset();
  ragflowRetrieveMock.mockReset();

  splitTextMock.mockReturnValue(['分片内容']);
  reviewTextMock.mockResolvedValue([]); // 默认无疑点
  mergeRetrievedChunksMock.mockResolvedValue(RETRIEVED);
  // 默认走 MaxKB 源（非 ragflow: 前缀）
  retrieveSpy = vi.spyOn(RAGService, 'retrieve').mockResolvedValue([]);
});

afterEach(() => {
  retrieveSpy?.mockRestore();
});

const opts = { chunkSize: 4000, topK: 3, llmMaxTokens: 2048, llmTimeout: 120, scene: 'doc_review' };

describe('疑点驱动检索闭环', () => {
  it('无命中 → 标记 UNVERIFIED（不编造引用）', async () => {
    // 疑点抽取返回 1 个疑点；检索无命中（mergeRetrievedChunks 返回空）
    reviewTextMock.mockResolvedValueOnce([
      { question: '接地电阻值是否符合规范', snippet: '接地电阻 1 欧姆' },
    ]);
    mergeRetrievedChunksMock.mockResolvedValueOnce([]);

    const result = await RAGService.runRAGReviewAgent('待审文本', ['kb-1'], opts);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].ruleCode).toBe('UNVERIFIED');
    expect(result.issues[0].standardRef).toBeNull();
    expect(result.sourceReferences).toHaveLength(0);
  });

  it('命中 → 判定为违规并绑定真实 sourceReferences', async () => {
    reviewTextMock
      .mockResolvedValueOnce([
        { question: '接地电阻值是否符合规范', snippet: '接地电阻 1 欧姆' },
      ]) // 疑点抽取
      .mockResolvedValueOnce([
        { issueType: 'VIOLATION', originalText: '接地电阻 1 欧姆', suggestedText: '改为不大于 1 欧姆', description: '不满足要求' },
      ]); // 判定

    const result = await RAGService.runRAGReviewAgent('待审文本', ['kb-1'], opts);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].ruleCode).toBe('KB_VERIFIED');
    expect(result.issues[0].sourceReferences).toBeDefined();
    expect(result.issues[0].sourceReferences![0]).toMatchObject({ document_name: 'GB/T 50065' });
    // retrieve 以疑点本身作为 query 定向检索
    expect(retrieveSpy).toHaveBeenCalledWith('kb-1', expect.stringContaining('接地电阻'), expect.objectContaining({ topNumber: 3 }));
  });

  it('无疑点 → 空结果', async () => {
    reviewTextMock.mockResolvedValueOnce([]);
    const result = await RAGService.runRAGReviewAgent('待审文本', ['kb-1'], opts);
    expect(result.issues).toEqual([]);
    expect(retrieveSpy).not.toHaveBeenCalled();
  });

  it('分片处理异常 → 降级返回空（不崩）', async () => {
    reviewTextMock.mockRejectedValueOnce(new Error('llm down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await RAGService.runRAGReviewAgent('待审文本', ['kb-1'], opts);
      expect(result.issues).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
