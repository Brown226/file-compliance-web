/**
 * P2-11b：cross-file LLM fileNames 归因回归测试
 *
 * 背景：LLM 比对已输出 fileNames（哪些文件涉及该不一致），但旧代码解析后丢弃该信号，
 * 改走启发式 findIssueSourceFile（fingerprint/原文匹配，兜底第一个文件），
 * 匹配失败或匹配到靠前文件时把 issue 高亮到错误的文件。
 *
 * 覆盖：
 * - orderCandidatesByFileNames 纯函数：精确匹配优先 / 包含匹配兜底 / 未命中剔除 / fileId 去重
 * - resolveIssueSourceFiles：fileNames 生效 → 归因到命名文件（不再是兜底第一个文件）
 * - fileNames 命中多文件且问题同时存在于多文件 → 每个命中文件各写一条（与 C2 路径
 *   "每个相关文件都写入一条" 口径一致）
 * - 无 fileNames → 完全退化为原启发式（兼容旧行为）
 * - 候选文件内未定位到原文 → 兜底原启发式 findIssueSourceFile
 * - parseCrossCompareResult：fileNames 数组正确解析（L790 生效路径）
 *
 * 全 mock 隔离：仅测纯函数/静态方法，不连 DB/Redis/LLM。
 */
import { describe, it, expect } from 'vitest';
import { CrossFileConsistencyService, orderCandidatesByFileNames, paramFingerprint } from '../cross-file-consistency.service';

// private 静态方法经 (Class as any) 访问（测试专用，与 structured-consistency.test.ts 同风格）
const Svc = CrossFileConsistencyService as any;

/** 构造最小 FileDimensionSummary（内部接口，测试侧用 any） */
function makeExtraction(overrides: Record<string, any>): any {
  return {
    fileId: 'id',
    fileName: 'file.pdf',
    text: '',
    params: [],
    codes: [],
    refs: [],
    meta: [],
    facts: [],
    ...overrides,
  };
}

/** 构造最小 DimensionItem */
function makeItem(overrides: Record<string, any>): any {
  return {
    content: 'x',
    fingerprint: '',
    fileName: 'file.pdf',
    fileId: 'id',
    position: 0,
    endPosition: 0,
    ...overrides,
  };
}

/** 两个文件同参数不同值：A.pdf=120℃，B.pdf=350℃（原始文本都含各自取值） */
function twoFileExtractions(): any[] {
  return [
    makeExtraction({
      fileId: 'A',
      fileName: 'A.pdf',
      text: '设计温度：120℃\n压力：1.6MPa',
      params: [makeItem({ content: '设计温度=120℃', fingerprint: '设计温度：120℃', fileName: 'A.pdf', fileId: 'A' })],
    }),
    makeExtraction({
      fileId: 'B',
      fileName: 'B.pdf',
      text: '设计温度：350℃\n压力：1.6MPa',
      params: [makeItem({ content: '设计温度=350℃', fingerprint: '设计温度：350℃', fileName: 'B.pdf', fileId: 'B' })],
    }),
  ];
}

describe('orderCandidatesByFileNames（纯函数：fileNames → 候选过滤排序）', () => {
  const files = [
    makeExtraction({ fileId: 'A', fileName: 'A.pdf' }),
    makeExtraction({ fileId: 'B', fileName: 'B.pdf' }),
    makeExtraction({ fileId: 'B2', fileName: 'B_副本.pdf' }),
    makeExtraction({ fileId: 'C', fileName: 'C.pdf' }),
  ];

  it('精确匹配优先：fileNames=["B.pdf"] → 只保留 B.pdf', () => {
    const r = orderCandidatesByFileNames(['B.pdf'], files);
    expect(r.map((f: any) => f.fileId)).toEqual(['B']);
  });

  it('包含匹配兜底：fileNames=["B"] 同时命中 B.pdf 与 B_副本.pdf（按原始顺序）', () => {
    const r = orderCandidatesByFileNames(['B'], files);
    expect(r.map((f: any) => f.fileId)).toEqual(['B', 'B2']);
  });

  it('精确优先于包含：fileNames=["B.pdf","B"] 时 B.pdf 只出现一次且在最前', () => {
    const r = orderCandidatesByFileNames(['B.pdf', 'B'], files);
    expect(r.map((f: any) => f.fileId)).toEqual(['B', 'B2']);
  });

  it('按 fileId 去重：别名重复命中不重复返回', () => {
    const r = orderCandidatesByFileNames(['B', 'B_副本', 'B.pdf'], files);
    const ids = r.map((f: any) => f.fileId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('未命中任何 fileName 的文件被剔除', () => {
    const r = orderCandidatesByFileNames(['B.pdf'], files);
    expect(r.some((f: any) => f.fileId === 'A' || f.fileId === 'C')).toBe(false);
  });

  it('无匹配 → 返回 []（调用方退化为原启发式）', () => {
    expect(orderCandidatesByFileNames(['Z.pdf'], files)).toEqual([]);
    expect(orderCandidatesByFileNames([], files)).toEqual([]);
    expect(orderCandidatesByFileNames(['  '], files)).toEqual([]);
  });
});

describe('resolveIssueSourceFiles：fileNames 归因生效（P2-11b 核心修复）', () => {
  it('fileNames=["B.pdf"] 且原文同时在 A、B 中 → 归因 B（旧启发式会命中靠前的 A）', () => {
    // 两个文件都包含 "1.6MPa" 片段，旧启发式按顺序命中 A；fileNames 明确指向 B
    const extractions = [
      makeExtraction({ fileId: 'A', fileName: 'A.pdf', text: '设计温度：120℃\n压力：1.6MPa' }),
      makeExtraction({ fileId: 'B', fileName: 'B.pdf', text: '设计温度：350℃\n压力：1.6MPa' }),
    ];
    const issue = { ruleCode: 'C3', originalText: '压力：1.6MPa', fileNames: ['B.pdf'] };

    const r = Svc.resolveIssueSourceFiles(issue, extractions);
    expect(r).toHaveLength(1);
    expect(r[0].fileId).toBe('B'); // 不再是兜底/靠前的 A
  });

  it('fileNames=["B.pdf"] 且原文仅在 B → 单条归因 B', () => {
    const issue = { ruleCode: 'C3', originalText: '设计温度：350℃', fileNames: ['B.pdf'] };
    const r = Svc.resolveIssueSourceFiles(issue, twoFileExtractions());
    expect(r.map((f: any) => f.fileId)).toEqual(['B']);
  });

  it('fileNames 命中多文件且问题同时存在 → 每个命中文件各写一条', () => {
    const extractions = [
      makeExtraction({
        fileId: 'A',
        fileName: 'A.pdf',
        text: '介质：水\n流量：100m³/h',
        meta: [makeItem({ content: '介质=水', fingerprint: '介质：水', fileName: 'A.pdf', fileId: 'A' })],
      }),
      makeExtraction({
        fileId: 'B',
        fileName: 'B.pdf',
        text: '介质：水\n流量：200m³/h',
        meta: [makeItem({ content: '介质=水', fingerprint: '介质：水', fileName: 'B.pdf', fileId: 'B' })],
      }),
      makeExtraction({
        fileId: 'C',
        fileName: 'C.pdf',
        text: '介质：油',
        meta: [makeItem({ content: '介质=油', fingerprint: '介质：油', fileName: 'C.pdf', fileId: 'C' })],
      }),
    ];
    const issue = { ruleCode: 'C5', originalText: '介质：水', fileNames: ['A.pdf', 'B.pdf'] };

    const r = Svc.resolveIssueSourceFiles(issue, extractions);
    expect(r.map((f: any) => f.fileId)).toEqual(['A', 'B']);
  });

  it('fileNames 命中多文件但原文仅存在于其中一文件 → 只写一条（不臆造）', () => {
    const issue = { ruleCode: 'C3', originalText: '设计温度：350℃', fileNames: ['A.pdf', 'B.pdf'] };
    const r = Svc.resolveIssueSourceFiles(issue, twoFileExtractions());
    expect(r.map((f: any) => f.fileId)).toEqual(['B']);
  });

  it('候选文件内未定位到原文 → 兜底原启发式 findIssueSourceFile', () => {
    // fileNames 指向 A，但原文只存在于 B：候选 A 无命中，回退启发式正确找到 B
    const issue = { ruleCode: 'C3', originalText: '设计温度：350℃', fileNames: ['A.pdf'] };
    const r = Svc.resolveIssueSourceFiles(issue, twoFileExtractions());
    expect(r.map((f: any) => f.fileId)).toEqual(['B']);
  });

  it('fileNames 指定的文件不存在 → 候选为空，退化为原启发式', () => {
    const issue = { ruleCode: 'C3', originalText: '设计温度：350℃', fileNames: ['不存在.pdf'] };
    const r = Svc.resolveIssueSourceFiles(issue, twoFileExtractions());
    expect(r.map((f: any) => f.fileId)).toEqual(['B']);
  });
});

describe('resolveIssueSourceFiles：无 fileNames 完全退化（兼容旧行为）', () => {
  it('无 fileNames，原文命中 → 启发式返回命中文件（单条）', () => {
    const issue = { ruleCode: 'C3', originalText: '设计温度：350℃' };
    const r = Svc.resolveIssueSourceFiles(issue, twoFileExtractions());
    expect(r.map((f: any) => f.fileId)).toEqual(['B']);
  });

  it('无 fileNames，原文无任何命中 → 兜底第一个文件（旧行为不变）', () => {
    const issue = { ruleCode: 'C3', originalText: '不存在的原文片段XYZ' };
    const r = Svc.resolveIssueSourceFiles(issue, twoFileExtractions());
    expect(r.map((f: any) => f.fileId)).toEqual(['A']);
  });

  it('fileNames 为空数组与 undefined 等价（不触发候选路径）', () => {
    const issue1 = { ruleCode: 'C3', originalText: '不存在的原文片段XYZ', fileNames: [] };
    const issue2 = { ruleCode: 'C3', originalText: '不存在的原文片段XYZ', fileNames: undefined };
    expect(Svc.resolveIssueSourceFiles(issue1, twoFileExtractions()).map((f: any) => f.fileId)).toEqual(['A']);
    expect(Svc.resolveIssueSourceFiles(issue2, twoFileExtractions()).map((f: any) => f.fileId)).toEqual(['A']);
  });
});

describe('findIssueSourceFilesInCandidates：fingerprint 与原文双口径命中', () => {
  it('fingerprint 包含即命中（即使原文因归一化不含）', () => {
    const candidates = [
      makeExtraction({
        fileId: 'B',
        fileName: 'B.pdf',
        text: '设计温度=350℃(含单位换算说明)',
        params: [makeItem({ content: '设计温度=350℃', fingerprint: '设计温度：350℃，设计压力：17.5MPa', fileName: 'B.pdf', fileId: 'B' })],
      }),
    ];
    // originalText 与原文有标点差异，但 fingerprint 包含它
    const r = Svc.findIssueSourceFilesInCandidates('设计温度：350℃', candidates);
    expect(r.map((f: any) => f.fileId)).toEqual(['B']);
  });
});

describe('parseCrossCompareResult：fileNames 解析（L790 生效路径）', () => {
  it('fileNames 数组解析为字符串数组', () => {
    const raw = JSON.stringify([
      { ruleCode: 'C3', originalText: '设计温度不一致', fileNames: ['A.pdf', 'B.pdf'] },
    ]);
    const issues = Svc.parseCrossCompareResult(raw, 'C3');
    expect(issues[0].fileNames).toEqual(['A.pdf', 'B.pdf']);
  });

  it('fileNames 非数组（字符串）→ undefined，不抛错', () => {
    const raw = JSON.stringify([{ ruleCode: 'C3', originalText: 'x', fileNames: 'B.pdf' }]);
    const issues = Svc.parseCrossCompareResult(raw, 'C3');
    expect(issues[0].fileNames).toBeUndefined();
  });

  it('fileNames 元素非字符串 → String() 归一', () => {
    const raw = JSON.stringify([{ ruleCode: 'C3', originalText: 'x', fileNames: [42, null] }]);
    const issues = Svc.parseCrossCompareResult(raw, 'C3');
    expect(issues[0].fileNames).toEqual(['42', 'null']);
  });

  it('无 fileNames 字段 → undefined（触发退化路径）', () => {
    const raw = JSON.stringify([{ ruleCode: 'C3', originalText: 'x' }]);
    const issues = Svc.parseCrossCompareResult(raw, 'C3');
    expect(issues[0].fileNames).toBeUndefined();
  });
});

describe('paramFingerprint（P2-9 跨服务去重键修复）', () => {
  it('正则参数：CROSS（前后各 40 字片段）与 INTRA（60 字行切片）原文不同但指纹相同', () => {
    // CROSS originalText：匹配位前后各 40 字片段（中文冒号分隔）
    const crossText = '某文件参数段前文内容 设计压力：17.5MPa 后文补充说明文字';
    // INTRA originalText：60 字行切片（等号分隔、前缀不同、紧邻逗号截断）
    const intraText = '设备铭牌 设计压力=17.5MPa，与设计文件一致且已通过验收';
    expect(paramFingerprint(crossText)).toBe('设计压力|17.5MPa');
    expect(paramFingerprint(intraText)).toBe('设计压力|17.5MPa');
  });

  it('表格 KV（| key | value |）无 ::= 分隔符 → 回退整段去空白比较', () => {
    expect(paramFingerprint('| 设计压力 | 17.5MPa |')).toBe('|设计压力|17.5MPa|');
  });

  it('无分隔符文本 → 回退整段去空白', () => {
    expect(paramFingerprint(' 普通 文本 片段 ')).toBe('普通文本片段');
  });

  it('空值/undefined → 空串（不误伤）', () => {
    expect(paramFingerprint('')).toBe('');
    expect(paramFingerprint(null)).toBe('');
    expect(paramFingerprint(undefined)).toBe('');
  });
});
