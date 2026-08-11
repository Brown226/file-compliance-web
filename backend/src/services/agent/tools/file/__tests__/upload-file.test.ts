/**
 * upload_file 工具测试（2026-08-07 上传安全加固：sanitizeFileName 净化 + 黑名单 + 50MB 上限）
 *
 * 覆盖：
 * - sanitizeFileName：basename 净化 / 空与点拒绝 / 可执行与脚本类扩展名黑名单 / 大小写归一
 * - execute：正常写盘（data URL 前缀容忍）/ 超大输入两重校验（base64 长度估算 + buffer 实算）/ 黑名单拒绝
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 注：@ai-sdk/provider-utils 的 vi.mock 对 CJS 外部化包不生效（vitest 不拦截），
// 真实 tool() 原样返回 def（execute 不做参数解析，解析在 AI SDK 运行时完成）。
// 本测试直接调用 execute，参数均为必填，无需模拟运行时解析。

// —— 日期目录指向临时目录（不碰真实 uploads）——
// 通过 vi.hoisted 让 mock 工厂引用可变值
const { state } = vi.hoisted(() => ({ state: { dir: '' } }));
vi.mock('../paths', () => ({ getTodayDir: () => state.dir }));

import { sanitizeFileName, createUploadFileTool, MAX_UPLOAD_BYTES } from '../upload_file';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-tool-'));
  state.dir = tmpRoot;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sanitizeFileName', () => {
  it('正常文件名原样保留', () => {
    expect(sanitizeFileName('合同.pdf')).toBe('合同.pdf');
    expect(sanitizeFileName('report v2.docx')).toBe('report v2.docx');
  });

  it('路径形式只取 basename（防目录穿越）', () => {
    expect(sanitizeFileName('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFileName('..\\..\\evil.txt')).toBe('evil.txt');
    expect(sanitizeFileName('/tmp/a/b.txt')).toBe('b.txt');
  });

  it('空 / 纯点 / 点号串 → 拒绝', () => {
    expect(() => sanitizeFileName('')).toThrow('文件名无效');
    expect(() => sanitizeFileName('   ')).toThrow('文件名无效');
    expect(() => sanitizeFileName('.')).toThrow('文件名无效');
    expect(() => sanitizeFileName('..')).toThrow('文件名无效');
    expect(() => sanitizeFileName('...')).toThrow('文件名无效');
  });

  it('可执行/脚本类扩展名拒绝（黑名单）', () => {
    for (const name of [
      'a.exe', 'a.dll', 'a.bat', 'a.cmd', 'a.sh', 'a.ps1', 'a.vbs',
      'a.js', 'a.jar', 'a.php', 'a.asp', 'a.jsp', 'a.html', 'a.htm',
      'a.svg', 'a.swf', 'a.apk', 'a.msh', 'a.php5', 'a.phtml',
    ]) {
      expect(() => sanitizeFileName(name)).toThrow('不支持上传', name);
    }
  });

  it('扩展名大小写归一（.EXE 同样拒绝）', () => {
    expect(() => sanitizeFileName('virus.EXE')).toThrow('不支持上传');
    expect(() => sanitizeFileName('x.SVG')).toThrow('不支持上传');
    expect(() => sanitizeFileName('x.HtMl')).toThrow('不支持上传');
  });

  it('无扩展名 / 隐藏文件 / 合法办公扩展名放行', () => {
    expect(sanitizeFileName('README')).toBe('README');
    expect(sanitizeFileName('.gitignore')).toBe('.gitignore');
    for (const name of ['a.pdf', 'a.docx', 'a.xlsx', 'a.txt', 'a.md', 'a.dwg']) {
      expect(sanitizeFileName(name)).toBe(name);
    }
  });
});

describe('createUploadFileTool execute', () => {
  it('正常上传：base64 解码写盘 + 返回路径/文件名/字节数', async () => {
    const tool = createUploadFileTool({ userId: 'u1', sessionId: 's1' });
    const content = '你好，审查文档';
    const res = await tool.execute!({
      fileName: '合同.txt',
      fileBase64: Buffer.from(content).toString('base64'),
    });

    expect(res.size).toBe(Buffer.byteLength(content));
    expect(res.fileName).toBe('合同.txt');
    expect(res.filePath).toBe(path.join(tmpRoot, '合同.txt'));
    expect(fs.readFileSync(res.filePath, 'utf8')).toBe(content);
  });

  it('data URL 前缀被容忍', async () => {
    const tool = createUploadFileTool({ userId: 'u1', sessionId: 's1' });
    const content = 'hello';
    const res = await tool.execute!({
      fileName: 'a.txt',
      fileBase64: `data:text/plain;base64,${Buffer.from(content).toString('base64')}`,
    });
    expect(fs.readFileSync(res.filePath, 'utf8')).toBe(content);
  });

  it('黑名单扩展名 → 拒绝且不落盘', async () => {
    const tool = createUploadFileTool({ userId: 'u1', sessionId: 's1' });
    await expect(
      tool.execute!({ fileName: 'malware.sh', fileBase64: Buffer.from('rm -rf /').toString('base64') }),
    ).rejects.toThrow('不支持上传');
    expect(fs.readdirSync(tmpRoot)).toHaveLength(0);
  });

  it('目录穿越文件名 → basename 净化后落盘（不越界）', async () => {
    const tool = createUploadFileTool({ userId: 'u1', sessionId: 's1' });
    const res = await tool.execute!({
      fileName: '../../escape.txt',
      fileBase64: Buffer.from('x').toString('base64'),
    });
    expect(res.fileName).toBe('escape.txt');
    // 文件只落在目标目录内
    expect(res.filePath).toBe(path.join(tmpRoot, 'escape.txt'));
    expect(fs.existsSync(path.join(tmpRoot, 'escape.txt'))).toBe(true);
  });

  it('超过 50MB（base64 长度估算）→ 拒绝', async () => {
    const tool = createUploadFileTool({ userId: 'u1', sessionId: 's1' });
    const over = 'a'.repeat(Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 17);
    await expect(
      tool.execute!({ fileName: 'big.pdf', fileBase64: over }),
    ).rejects.toThrow('文件过大');
  });

  it('base64 长度略小但解码后超 50MB → 拒绝（实算兜底）', async () => {
    const tool = createUploadFileTool({ userId: 'u1', sessionId: 's1' });
    // 构造解码后恰好超上限的 base64（长度估算放行，buffer 实算拒绝）
    const bytes = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61);
    const b64 = bytes.toString('base64');
    expect(b64.length).toBeLessThan(Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 16);
    await expect(
      tool.execute!({ fileName: 'big.pdf', fileBase64: b64 }),
    ).rejects.toThrow('文件过大');
  });

  it('恰好等于 50MB → 允许', async () => {
    const tool = createUploadFileTool({ userId: 'u1', sessionId: 's1' });
    const bytes = Buffer.alloc(MAX_UPLOAD_BYTES, 0x61);
    const res = await tool.execute!({
      fileName: 'exact.pdf',
      fileBase64: bytes.toString('base64'),
    });
    expect(res.size).toBe(MAX_UPLOAD_BYTES);
  });
});
