/**
 * extract_text / chunk_document 工具测试（2026-08-06 越权修复：assertUserFilePath 前置校验）
 *
 * 覆盖：
 * - 用户隔离：其他用户目录 / 上传根目录外路径 → 「路径越权」拒绝（存在性不泄露）
 * - extract_text：txt 直接读取（<file_content> 包裹 + structure）/ docx 走 doc-parser mock /
 *   服务异常（HTTP 非 2xx / code!=200）→ 明确报错 / 文件不存在
 * - chunk_document：txt fixed_4000（重叠 200）/ by_paragraph / by_page（doc-parser pages）/
 *   auto 策略推导（pdf→by_page、docx+Heading→by_section、其他→fixed_4000）/ 越权拒绝
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 注：@ai-sdk/provider-utils 的 vi.mock 对 CJS 外部化包不生效（vitest 不拦截），
// 真实 tool() 原样返回 def 且不做参数解析——schema 解析由 AI SDK 运行时在
// 调用 execute 前完成（zod safeParse + default 填充）。测试用 runTool 模拟该调用模式。

// —— uploads 根指向临时目录（paths.ts 依赖 config/upload；mock 路径相对本测试文件 5 级）——
const { state } = vi.hoisted(() => ({ state: { root: '' } }));
vi.mock('../../../../../config/upload', () => ({ getUploadDir: () => state.root }));

import { createExtractTextTool } from '../extract_text';
import { createChunkDocumentTool } from '../chunk_document';

/** 模拟 AI SDK 运行时：先经 inputSchema 解析（默认值/枚举校验），再调 execute */
async function runTool(tool: any, args: Record<string, unknown>): Promise<any> {
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) throw new Error(parsed.error.message);
  return tool.execute(parsed.data);
}

let tmpRoot: string;
/** 用户目录：{tmpRoot}/agent_temp/u1/2026-08-11 */
let userDir: string;

function writeUserFile(relName: string, content: string): string {
  const p = path.join(userDir, relName);
  fs.writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-chunk-'));
  state.root = tmpRoot;
  userDir = path.join(tmpRoot, 'agent_temp', 'u1', '2026-08-11');
  fs.mkdirSync(userDir, { recursive: true });
  // 其他用户目录（越权目标）
  fs.mkdirSync(path.join(tmpRoot, 'agent_temp', 'u2', '2026-08-11'), { recursive: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const ctx = { userId: 'u1', sessionId: 's1' };

describe('extract_text：用户隔离（2026-08-06 越权修复）', () => {
  it('其他用户目录内的文件 → 路径越权拒绝', async () => {
    const otherFile = path.join(tmpRoot, 'agent_temp', 'u2', '2026-08-11', 'secret.txt');
    fs.writeFileSync(otherFile, '机密');
    const tool = createExtractTextTool(ctx);
    await expect(runTool(tool, { filePath: otherFile })).rejects.toThrow('路径越权');
  });

  it('agent_temp 之外的文件 → 路径越权拒绝', async () => {
    const outside = path.join(tmpRoot, 'outside.txt');
    fs.writeFileSync(outside, '外部文件');
    const tool = createExtractTextTool(ctx);
    await expect(runTool(tool, { filePath: outside })).rejects.toThrow('路径越权');
  });

  it('其他用户的日期目录（同级前缀陷阱）→ 拒绝', async () => {
    // u1 目录前缀陷阱：u11 不是 u1
    fs.mkdirSync(path.join(tmpRoot, 'agent_temp', 'u11'), { recursive: true });
    const trapFile = path.join(tmpRoot, 'agent_temp', 'u11', 'x.txt');
    fs.writeFileSync(trapFile, 'x');
    const tool = createExtractTextTool(ctx);
    await expect(runTool(tool, { filePath: trapFile })).rejects.toThrow('路径越权');
  });
});

describe('extract_text：纯文本直接读取', () => {
  it('txt → 读文件 + <file_content> 包裹 + structure.paragraphs', async () => {
    const filePath = writeUserFile('a.txt', '第一段\n\n第二段');
    const tool = createExtractTextTool(ctx);
    const res = await runTool(tool, { filePath });

    expect(res.text).toBe('<file_content>第一段\n\n第二段</file_content>');
    expect(res.structure.paragraphs).toEqual(['第一段', '第二段']);
  });

  it('md → markdown 字段同样包裹', async () => {
    const filePath = writeUserFile('b.md', '# 标题\n正文');
    const tool = createExtractTextTool(ctx);
    const res = await runTool(tool, { filePath });
    expect(res.markdown).toBe('<file_content># 标题\n正文</file_content>');
  });

  it('合法路径内文件不存在 → 明确报错（不泄露外部存在性）', async () => {
    const tool = createExtractTextTool(ctx);
    await expect(
      runTool(tool, { filePath: path.join(userDir, 'nope.txt') }),
    ).rejects.toThrow('文件不存在');
  });
});

describe('extract_text：二进制格式走 doc-parser', () => {
  it('docx → fetch 解析成功，text/markdown 包裹 + pages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        code: 200,
        data: {
          text: '合同正文',
          structure: { paragraphs: [{ text: '合同正文' }] },
          metadata: { page_count: 3 },
          markdown: '# 合同',
        },
      }),
    }));

    const filePath = writeUserFile('c.docx', Buffer.from('PKfake').toString('binary'));
    const tool = createExtractTextTool(ctx);
    const res = await runTool(tool, { filePath });

    expect(res.text).toBe('<file_content>合同正文</file_content>');
    expect(res.markdown).toBe('<file_content># 合同</file_content>');
    expect(res.pages).toBe(3);
  });

  it('doc-parser HTTP 500 → 抛「调用失败」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('internal error'),
    }));
    const filePath = writeUserFile('d.docx', 'x');
    const tool = createExtractTextTool(ctx);
    await expect(runTool(tool, { filePath })).rejects.toThrow('doc-parser 调用失败 (HTTP 500)');
  });

  it('doc-parser code != 200 → 抛「解析失败」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ code: 500, message: 'unsupported format' }),
    }));
    const filePath = writeUserFile('e.pdf', 'x');
    const tool = createExtractTextTool(ctx);
    await expect(runTool(tool, { filePath })).rejects.toThrow('doc-parser 解析失败');
  });
});

describe('chunk_document：用户隔离', () => {
  it('其他用户目录 → 路径越权拒绝', async () => {
    const otherFile = path.join(tmpRoot, 'agent_temp', 'u2', '2026-08-11', 'secret.txt');
    fs.writeFileSync(otherFile, '机密');
    const tool = createChunkDocumentTool(ctx);
    await expect(runTool(tool, { filePath: otherFile })).rejects.toThrow('路径越权');
  });

  it('agent_temp 之外 → 路径越权拒绝', async () => {
    const outside = path.join(tmpRoot, 'outside.txt');
    fs.writeFileSync(outside, '外部');
    const tool = createChunkDocumentTool(ctx);
    await expect(runTool(tool, { filePath: outside })).rejects.toThrow('路径越权');
  });
});

describe('chunk_document：分块策略', () => {
  it('txt fixed_4000：超长文本分块 + 200 字符重叠 + <file_content> 包裹', async () => {
    const text = 'a'.repeat(4000) + 'B' + 'c'.repeat(4000);
    const filePath = writeUserFile('long.txt', text);
    const tool = createChunkDocumentTool(ctx);
    const res = await runTool(tool, { filePath });

    expect(res.strategy).toBe('fixed_4000');
    // 8001 字符：4000 + (3800→7800) + (7600→8001) = 3 块
    expect(res.total).toBe(3);
    expect(res.chunks[0].text).toContain('<file_content>');
    // 重叠：第二块开头 = 第一块末尾往前 200 字符
    expect(res.chunks[1].text).toContain(text.slice(3800, 4000));
    expect(res.chunks[1].text).toContain('B');
  });

  it('txt by_paragraph：按空行分段', async () => {
    const filePath = writeUserFile('p.txt', '第一段\n\n第二段\n\n第三段');
    const tool = createChunkDocumentTool(ctx);
    const res = await runTool(tool, { filePath, strategy: 'by_paragraph' });
    expect(res.strategy).toBe('by_paragraph');
    expect(res.total).toBe(3);
    expect(res.chunks[1].text).toContain('第二段');
  });

  it('pdf auto → by_page（doc-parser pages 数组，含 pageRange）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        code: 200,
        data: { text: 'pdf全文', pages: ['第一页', '第二页', '第三页'], structure: {} },
      }),
    }));
    const filePath = writeUserFile('doc.pdf', 'x');
    const tool = createChunkDocumentTool(ctx);
    const res = await runTool(tool, { filePath });

    expect(res.strategy).toBe('by_page');
    expect(res.total).toBe(3);
    expect(res.chunks[0].pageRange).toBe('p1');
    expect(res.chunks[2].pageRange).toBe('p3');
    expect(res.chunks[0].text).toContain('<file_content>第一页</file_content>');
  });

  it('docx 含 Heading → auto 推导 by_section（标题为 sectionTitle）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        code: 200,
        data: {
          text: '第一章\n\n内容一\n\n第二章\n\n内容二',
          structure: {
            paragraphs: [
              { text: '第一章', style: 'Heading1' },
              { text: '内容一', style: 'Normal' },
              { text: '第二章', style: 'Heading1' },
              { text: '内容二', style: 'Normal' },
            ],
          },
        },
      }),
    }));
    const filePath = writeUserFile('doc.docx', 'x');
    const tool = createChunkDocumentTool(ctx);
    const res = await runTool(tool, { filePath });

    expect(res.strategy).toBe('by_section');
    expect(res.total).toBe(2);
    expect(res.chunks[0].sectionTitle).toBe('第一章');
    expect(res.chunks[1].sectionTitle).toBe('第二章');
  });

  it('by_page 无 pages 信息 → 降级 fixed_4000', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        code: 200,
        data: { text: '短文本', structure: {} },
      }),
    }));
    const filePath = writeUserFile('nodata.pdf', 'x');
    const tool = createChunkDocumentTool(ctx);
    const res = await runTool(tool, { filePath, strategy: 'by_page' });
    expect(res.strategy).toBe('fixed_4000');
    expect(res.total).toBe(1);
  });
});
