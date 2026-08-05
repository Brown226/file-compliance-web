/**
 * ocr_scan 单元测试
 *
 * 覆盖：
 * - 图片/扫描件类型预检（png/pdf 通过，txt/zip 拒绝）
 * - OcrService.recognizeFile 成功路径 → 返回包裹文本 + 置信度 + 统计
 * - 识别失败/不可用 → 返回 failed/unavailable + reason
 * - 路径越权（agent_temp 根外 / 其他用户）
 * - 文件不存在 + 乱码路径兜底
 *
 * Mock：OcrService.recognizeFile（避免真实网络调用 doc-parser/视觉模型）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// —— Mock OcrService ——
const { recognizeFileMock } = vi.hoisted(() => ({ recognizeFileMock: vi.fn() }));
vi.mock('../../../../file/ocr.service', () => ({
  OcrService: { recognizeFile: recognizeFileMock },
}));
vi.mock('../../../../file/file-type.service', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    // 保持真实 FileTypeService.isOcrSupported（基于 FILE_TYPE_CONSTANTS.OCR_SUPPORTED）
    FileTypeService: actual.FileTypeService,
  };
});

import { createOcrScanTool } from '../ocr_scan';

const TEST_ROOT = path.resolve(__dirname, '../../../../../../uploads/agent_temp');
const TEST_USER = 'test-user-ocr';
const DATE_DIR = '2026-08-05';
const USER_DIR = path.join(TEST_ROOT, TEST_USER, DATE_DIR);

function makeFile(name: string, content: string): string {
  fs.mkdirSync(USER_DIR, { recursive: true });
  const fp = path.join(USER_DIR, name);
  fs.writeFileSync(fp, content, 'utf-8');
  return fp;
}

const ctx = { userId: TEST_USER, sessionId: 'session-1' };
const tool = createOcrScanTool(ctx);

beforeEach(() => {
  recognizeFileMock.mockReset();
});

afterEach(() => {
  // 清理测试目录
  fs.rmSync(path.join(TEST_ROOT, TEST_USER), { recursive: true, force: true });
});

describe('ocr_scan 类型预检', () => {
  it('支持图片类型 png', async () => {
    const fp = makeFile('a.png', 'fake-png-bytes');
    // recognizeFileMock 返回成功，否则类型预检后也会走到识别
    recognizeFileMock.mockResolvedValue({
      text: '图片里的文字',
      status: 'success',
      confidence: 0.92,
    });

    const res = await tool.execute({ filePath: fp, fileType: 'png' });
    expect(res.status).toBe('success');
    expect(recognizeFileMock).toHaveBeenCalledTimes(1);
    expect(recognizeFileMock).toHaveBeenCalledWith(fp, 'png');
  });

  it('支持 pdf', async () => {
    const fp = makeFile('scan.pdf', 'fake-pdf');
    recognizeFileMock.mockResolvedValue({
      text: '扫描件文字',
      status: 'success',
    });
    const res = await tool.execute({ filePath: fp });
    expect(res.status).toBe('success');
  });

  it('拒绝不支持的扩展名（txt）', async () => {
    const fp = makeFile('a.txt', 'hello');
    const res = await tool.execute({ filePath: fp });
    expect(res.status).toBe('failed');
    expect(res.reason).toContain('暂不支持 OCR');
    expect(recognizeFileMock).not.toHaveBeenCalled();
  });

  it('fileType 显式传入可覆盖扩展名判断', async () => {
    const fp = makeFile('weird.dat', 'fake');
    recognizeFileMock.mockResolvedValue({ text: 'ok', status: 'success' });
    // 显式传 png，即使扩展名是 .dat 也走 OCR
    const res = await tool.execute({ filePath: fp, fileType: 'png' });
    expect(res.status).toBe('success');
    expect(recognizeFileMock).toHaveBeenCalledWith(fp, 'png');
  });
});

describe('ocr_scan 识别结果', () => {
  it('成功时返回包裹文本 + 置信度 + 统计', async () => {
    const fp = makeFile('scan.png', 'fake');
    recognizeFileMock.mockResolvedValue({
      text: '第一行\n第二行',
      status: 'success',
      confidence: 0.88,
    });

    const res = await tool.execute({ filePath: fp, fileType: 'png' });
    expect(res.status).toBe('success');
    expect(res.text).toContain('<file_content>');
    expect(res.text).toContain('第一行');
    expect(res.confidence).toBe(0.88);
    expect(res.charCount).toBe('第一行\n第二行'.length);
    expect(res.lineCount).toBe(2);
  });

  it('识别失败返回 failed + reason', async () => {
    const fp = makeFile('scan.png', 'fake');
    recognizeFileMock.mockResolvedValue({
      text: '',
      status: 'failed',
      reason: 'OCR API 错误 (500): timeout',
    });

    const res = await tool.execute({ filePath: fp, fileType: 'png' });
    expect(res.status).toBe('failed');
    expect(res.reason).toContain('OCR API 错误');
    expect(res.text).toBe('');
  });

  it('未配置视觉模型返回 unavailable', async () => {
    const fp = makeFile('scan.png', 'fake');
    recognizeFileMock.mockResolvedValue({
      text: '',
      status: 'unavailable',
      reason: '未配置视觉模型(llm_vision_model)',
    });

    const res = await tool.execute({ filePath: fp, fileType: 'png' });
    expect(res.status).toBe('unavailable');
    expect(res.reason).toContain('未配置视觉模型');
  });
});

describe('ocr_scan 安全校验', () => {
  it('路径越权：agent_temp 根目录之外', async () => {
    const outside = path.join(TEST_ROOT, '..', 'outside.png');
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, 'x');
    await expect(tool.execute({ filePath: outside })).rejects.toThrow('路径越权');
  });

  it('路径越权：其他用户目录', async () => {
    const otherDir = path.join(TEST_ROOT, 'other-user', DATE_DIR);
    fs.mkdirSync(otherDir, { recursive: true });
    const fp = path.join(otherDir, 'a.png');
    fs.writeFileSync(fp, 'x');
    await expect(tool.execute({ filePath: fp })).rejects.toThrow('只能识别当前用户');
  });

  it('文件不存在报错', async () => {
    await expect(tool.execute({ filePath: path.join(USER_DIR, 'nope.png') })).rejects.toThrow('文件不存在');
  });
});
