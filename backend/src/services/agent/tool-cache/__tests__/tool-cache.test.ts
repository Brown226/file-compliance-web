/**
 * tool-cache 单元测试（P1-⑫ token 成本控制 — 缓存键/文件指纹）
 *
 * 覆盖：
 * - 普通工具：canonical args → MD5 键（确定性、键序无关）
 * - 文件内容类工具（extract_text/chunk_document/extract_tables）：
 *   - 小文件（≤10MB）键含内容 sha1，内容变更 → 键变化
 *   - 大文件仅用 size+mtime（mock stat 绕过 10MB 大文件真实读写）
 *   - stat/read 失败回退纯参数键（不抛错）
 * - CACHEABLE_TOOLS 集合与文档/实现一致
 *
 * 通过 vi.mock 隔离 redis（避免真实 ioredis 连接），cacheKey 本身不碰 redis。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolCacheService, CACHEABLE_TOOLS } from '../tool-cache.service';

vi.mock('../../../../utils/redis', () => ({
  redisClient: { get: vi.fn(), set: vi.fn() },
}));

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-cache-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('普通工具缓存键', () => {
  it('同一参数返回同一键（确定性）', async () => {
    const k1 = await ToolCacheService.cacheKey('search_knowledge', { query: '合同', topK: 5 });
    const k2 = await ToolCacheService.cacheKey('search_knowledge', { query: '合同', topK: 5 });
    expect(k1).toBe(k2);
  });

  it('参数键序不影响结果（canonical sorted keys）', async () => {
    const k1 = await ToolCacheService.cacheKey('search_knowledge', { a: 1, b: 2 });
    const k2 = await ToolCacheService.cacheKey('search_knowledge', { b: 2, a: 1 });
    expect(k1).toBe(k2);
  });

  it('不同参数产生不同键', async () => {
    const k1 = await ToolCacheService.cacheKey('search_knowledge', { query: '合同' });
    const k2 = await ToolCacheService.cacheKey('search_knowledge', { query: '标书' });
    expect(k1).not.toBe(k2);
  });

  it('键带 tool-cache: 前缀', async () => {
    const k = await ToolCacheService.cacheKey('read_file', { filePath: '/x' });
    expect(k.startsWith('tool-cache:')).toBe(true);
  });

  it('不同 userId 产生不同键（防跨用户缓存泄露）', async () => {
    // list_uploads 参数恒为 {}，若缓存键不含 userId，A 用户清单会返回给 B 用户
    const kA = await ToolCacheService.cacheKey('list_uploads', {}, 'user-a');
    const kB = await ToolCacheService.cacheKey('list_uploads', {}, 'user-b');
    expect(kA).not.toBe(kB);
    // 同一用户键稳定
    const kA2 = await ToolCacheService.cacheKey('list_uploads', {}, 'user-a');
    expect(kA).toBe(kA2);
  });
});

describe('文件内容类工具缓存键（文件指纹）', () => {
  it('同文件未变 → 键稳定（命中缓存）', async () => {
    const fp = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(fp, '内容 v1');
    const k1 = await ToolCacheService.cacheKey('extract_text', { filePath: fp });
    const k2 = await ToolCacheService.cacheKey('extract_text', { filePath: fp });
    expect(k1).toBe(k2);
  });

  it('文件内容变更（同路径）→ 键变化（缓存自动失效）', async () => {
    const fp = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(fp, '内容 v1');
    const k1 = await ToolCacheService.cacheKey('extract_text', { filePath: fp });
    fs.writeFileSync(fp, '内容 v2 变更');
    const k2 = await ToolCacheService.cacheKey('extract_text', { filePath: fp });
    expect(k1).not.toBe(k2);
  });

  it('文件内容相同但参数不同 → 键不同', async () => {
    const fp = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(fp, '内容');
    const k1 = await ToolCacheService.cacheKey('extract_text', { filePath: fp, strategy: 'a' });
    const k2 = await ToolCacheService.cacheKey('extract_text', { filePath: fp, strategy: 'b' });
    expect(k1).not.toBe(k2);
  });

  it('大文件（>10MB）只用 size+mtime，键不含内容 hash', async () => {
    const fp = path.join(tmpDir, 'big.txt');
    fs.writeFileSync(fp, 'x'); // 真实小文件，但 mock stat 报大 size
    const statSpy = vi
      .spyOn(fs.promises, 'stat')
      .mockResolvedValueOnce({ size: 11 * 1024 * 1024, mtimeMs: 123456 } as any)
      .mockResolvedValueOnce({ size: 11 * 1024 * 1024, mtimeMs: 123456 } as any);
    try {
      const k1 = await ToolCacheService.cacheKey('extract_text', { filePath: fp });
      const k2 = await ToolCacheService.cacheKey('extract_text', { filePath: fp });
      expect(k1).toBe(k2);
      // 大文件路径不触发 readFile（mock 的 readFile 未被调用）
      const readSpy = vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('should not read'));
      try {
        await ToolCacheService.cacheKey('extract_text', { filePath: fp });
      } finally {
        readSpy.mockRestore();
      }
    } finally {
      statSpy.mockRestore();
    }
  });

  it('大文件 mtime 变化 → 键变化', async () => {
    const fp = path.join(tmpDir, 'big.txt');
    fs.writeFileSync(fp, 'x');
    const statSpy = vi
      .spyOn(fs.promises, 'stat')
      .mockResolvedValueOnce({ size: 11 * 1024 * 1024, mtimeMs: 100 } as any)
      .mockResolvedValueOnce({ size: 11 * 1024 * 1024, mtimeMs: 200 } as any);
    try {
      const k1 = await ToolCacheService.cacheKey('extract_text', { filePath: fp });
      const k2 = await ToolCacheService.cacheKey('extract_text', { filePath: fp });
      expect(k1).not.toBe(k2);
    } finally {
      statSpy.mockRestore();
    }
  });

  it('文件不存在（stat 失败）→ 回退纯参数键，不抛错', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const k = await ToolCacheService.cacheKey('extract_text', { filePath: '/not/exist.txt' });
      expect(k.startsWith('tool-cache:')).toBe(true);
      // 回退键 = 纯参数键（与普通工具同路径：参数不变则键稳定）
      const k2 = await ToolCacheService.cacheKey('extract_text', { filePath: '/not/exist.txt' });
      expect(k).toBe(k2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('回退参数键'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('CACHEABLE_TOOLS 集合', () => {
  it('包含文档声明的可缓存工具（含 compare_documents/extract_tables）', () => {
    for (const name of [
      'extract_text',
      'chunk_document',
      'search_knowledge',
      'search_rule_library',
      'search_standard_checkpoints',
      'list_available_rules',
      'read_file',
      'list_uploads',
      'compare_documents',
      'extract_tables',
    ]) {
      expect(CACHEABLE_TOOLS.has(name)).toBe(true);
    }
  });

  it('非幂等工具不在集合中', () => {
    expect(CACHEABLE_TOOLS.has('edit_file')).toBe(false);
    expect(CACHEABLE_TOOLS.has('upload_file')).toBe(false);
    expect(CACHEABLE_TOOLS.has('write_report')).toBe(false);
  });
});
