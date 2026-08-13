// 图文复核服务测试（交叉复核第二层）
// - 无 dwgStructure 时跳过（返回原样）
// - 图纸标准引用 vs 设计文本一致性
// - 图纸关键参数 vs 设计文本一致性
// - 产出 issue 带 reviewSource='IMAGE_TEXT'
import { describe, it, expect } from 'vitest';
import { ImageTextCheckService } from '../image-text-check.service';
import type { ReviewIssue } from '../../../llm/llm.service';

function makeIssue(partial: Partial<ReviewIssue> = {}): ReviewIssue {
  return {
    issueType: 'VIOLATION',
    originalText: '原文内容',
    severity: 'warning',
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

describe('ImageTextCheckService（图文复核）', () => {
  it('无 dwgStructure 时跳过图文复核，原样返回', async () => {
    const issues = [makeIssue()];
    const result = await ImageTextCheckService.check(issues, makeCtx(), '设计文本');
    expect(result).toHaveLength(1);
    expect(result[0].ruleCode).toBeUndefined();
  });

  it('dwgStructure 无标准引用无标注时不产出图文 issue', async () => {
    const issues = [makeIssue()];
    const ctx = makeCtx({ dwgStructure: { layers: ['A'], textEntities: [], dimensions: [], standardRefs: [] } });
    const result = await ImageTextCheckService.check(issues, ctx, '设计文本');
    expect(result).toHaveLength(1);
  });

  it('图纸标准引用在设计文本中缺失时产出 IMG_TXT_STDREF issue（带 IMAGE_TEXT 标记）', async () => {
    const ctx = makeCtx({
      dwgStructure: {
        layers: ['A'],
        textEntities: [],
        dimensions: [],
        standardRefs: [{ standardNo: 'GB 50016-2014', standardName: '建筑设计防火规范', standardIdent: '', cadHandleId: 'h1' }],
      },
    });
    const result = await ImageTextCheckService.check([], ctx, '本工程采用钢筋混凝土框架结构。');
    expect(result).toHaveLength(1);
    expect(result[0].ruleCode).toBe('IMG_TXT_STDREF');
    expect(result[0].reviewSource).toBe('IMAGE_TEXT');
    expect(result[0].cadHandleId).toBe('h1');
    expect(result[0].severity).toBe('warning');
  });

  it('图纸标准号与文本标准号写法不同（去分隔符）仍视为一致', async () => {
    const ctx = makeCtx({
      dwgStructure: {
        layers: [],
        textEntities: [],
        dimensions: [],
        standardRefs: [{ standardNo: 'GB 50016-2014', standardName: '', standardIdent: '', cadHandleId: '' }],
      },
    });
    // 文本中为 GB50016-2014（无空格），图纸中为 GB 50016-2014（有空格）
    const result = await ImageTextCheckService.check([], ctx, '本设计依据GB50016-2014执行。');
    expect(result).toHaveLength(0);
  });

  it('图纸标准引用在文本中已提及时不产出 issue', async () => {
    const ctx = makeCtx({
      dwgStructure: {
        layers: [],
        textEntities: [],
        dimensions: [],
        standardRefs: [{ standardNo: 'JGJ 3-2010', standardName: '', standardIdent: '', cadHandleId: '' }],
      },
    });
    const result = await ImageTextCheckService.check([], ctx, '高层建筑混凝土结构技术规程 JGJ3-2010 适用于本工程。');
    expect(result).toHaveLength(0);
  });

  it('图纸关键参数（DN/单位数值）未在设计文本中体现时产出 IMG_TXT_DIMENSION issue', async () => {
    const ctx = makeCtx({
      dwgStructure: {
        layers: ['PIPE'],
        textEntities: [],
        dimensions: [{ text: 'DN100 排水管', layer: 'PIPE', entityType: 'DIMENSION', handle: 'h2' }],
        standardRefs: [],
      },
    });
    const result = await ImageTextCheckService.check([], ctx, '生活给水系统采用镀锌钢管。');
    expect(result).toHaveLength(1);
    expect(result[0].ruleCode).toBe('IMG_TXT_DIMENSION');
    expect(result[0].reviewSource).toBe('IMAGE_TEXT');
    expect(result[0].cadHandleId).toBe('h2');
  });

  it('图纸参数在文本中已体现时不产出 issue', async () => {
    const ctx = makeCtx({
      dwgStructure: {
        layers: ['PIPE'],
        textEntities: [],
        dimensions: [{ text: 'DN100 排水管', layer: 'PIPE', entityType: 'DIMENSION', handle: '' }],
        standardRefs: [],
      },
    });
    const result = await ImageTextCheckService.check([], ctx, '排水干管采用DN100管径。');
    expect(result).toHaveLength(0);
  });

  it('一条标注包含多个参数时只报一次', async () => {
    const ctx = makeCtx({
      dwgStructure: {
        layers: [],
        textEntities: [],
        dimensions: [{ text: 'DN100, 0.8MPa', layer: 'PIPE', entityType: 'DIMENSION', handle: '' }],
        standardRefs: [],
      },
    });
    const result = await ImageTextCheckService.check([], ctx, '设计文本无任何参数。');
    expect(result).toHaveLength(1);
  });

  it('已有 issues 与新增图文 issue 合并返回', async () => {
    const existing = [makeIssue({ originalText: '原有问题' })];
    const ctx = makeCtx({
      dwgStructure: {
        layers: [],
        textEntities: [],
        dimensions: [],
        standardRefs: [{ standardNo: 'GB 50016-2014', standardName: '', standardIdent: '', cadHandleId: '' }],
      },
    });
    const result = await ImageTextCheckService.check(existing, ctx, '设计文本');
    expect(result).toHaveLength(2);
    expect(result[0].originalText).toBe('原有问题');
    expect(result[1].ruleCode).toBe('IMG_TXT_STDREF');
  });
});
