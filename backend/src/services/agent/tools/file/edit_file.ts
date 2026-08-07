/**
 * edit_file 工具 — 编辑已上传的文本文件（精确替换 + unified patch）
 *
 * P1-⑪ 编辑类工具，参考 pi 引擎 edit.ts 的能力，但不引入外部 diff 依赖
 * （内网友好：不新增未离线打包的 npm 包）。
 *
 * 两种编辑模式：
 * 1. replace（精确替换）：
 *    - oldText → newText，指定 occurrence（第几次出现，1-based，默认 1）
 *    - replaceAll=true 时替换所有出现
 *    - 兼容 <file_content> 包裹：文件内容存储时是原始文本，工具读取时是明文
 * 2. patch（unified diff）：
 *    - 接收标准 unified diff 文本（@@ hunk @@ + 上下文行），自实现应用器
 *    - 逐 hunk 校验上下文匹配，任一 hunk 失败则整体回滚（原子性）
 *
 * 安全约束（与 read_file 一致）：
 * - 只能编辑 Agent 临时目录下当前用户/会话的文件（uploads/agent_temp/{userId}/{sessionId}/）
 * - 路径规范化后校验是否在允许的根目录内，防止路径穿越
 * - 纯文本格式可编辑（txt/md/csv/log/json/xml/yaml/yml）；DOCX 走受控替换
 *   （复用 DocxReplaceService，保留格式，仅 replace 模式）；PDF 等二进制拒绝
 *
 * 返回：
 * - filePath / fileName / lines: 编辑后总行数
 * - changes: 变更摘要（[{type, oldLine, newLine, oldText, newText}]，供 LLM 确认改动范围）
 * - message: 人类可读摘要
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getAgentTempRoot } from './paths';
import type { ToolContext } from './upload_file';
import { DocxReplaceService } from '../../../file/docx-replace.service';
import { FileWriteQueueService } from '../../file-queue/file-write-queue.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

/** 纯文本扩展名（与 read_file / extract_text 保持一致） */
const PLAIN_TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'xml', 'yaml', 'yml'];

/** DOCX 扩展名（走受控替换，保留格式） */
const DOCX_EXT = 'docx';

/** 变更记录 */
interface ChangeRecord {
  type: 'replace' | 'insert' | 'delete';
  oldLine?: number;
  newLine?: number;
  oldText?: string;
  newText?: string;
}

/** 编辑结果（由 execute 返回对象字面量，无需接口声明） */

/** 校验路径在 Agent 临时目录且属于当前用户（按日期目录存储，跨会话共享） */
function assertEditablePath(context: ToolContext, filePath: string): string {
  const uploadsRoot = getAgentTempRoot();
  const normalizedRoot = path.resolve(uploadsRoot);
  const normalizedPath = path.resolve(filePath);
  if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
    throw new Error('路径越权：只能编辑 Agent 临时目录下的文件');
  }
  const expectedUserDir = path.join(normalizedRoot, context.userId);
  if (!normalizedPath.startsWith(expectedUserDir + path.sep) && normalizedPath !== expectedUserDir) {
    throw new Error('路径越权：只能编辑当前用户上传的文件');
  }
  return normalizedPath;
}

/**
 * 判断目标文件是否可编辑，返回格式类别
 *
 * 支持：
 * - 纯文本（txt/md/csv/log/json/xml/yaml/yml 等）→ 'text'
 * - DOCX（走受控替换，保留格式）→ 'docx'
 * - 其他（PDF/二进制等）→ 明确拒绝（PDF 不可原地编辑，引导下载重编）
 */
function assertEditableFormat(filePath: string): 'text' | 'docx' {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  if (ext === DOCX_EXT) return 'docx';
  if (PLAIN_TEXT_EXTS.includes(ext)) return 'text';
  throw new Error(
    `不支持编辑 ${ext} 格式：仅支持纯文本（${PLAIN_TEXT_EXTS.join('/')}）或 DOCX（受控替换）。PDF 等二进制格式不可原地编辑，请下载后重编。`,
  );
}

/**
 * 生成行级 diff 摘要（LCS，比较编辑前后行列表）
 * 复用 compare_documents 的 LCS 思路，但输出轻量变更记录
 */
function lineDiffSummary(oldLines: string[], newLines: string[]): ChangeRecord[] {
  const a = oldLines;
  const b = newLines;
  const m = a.length;
  const n = b.length;
  // 简单 LCS 回溯（行级字符串完全相等）
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const changes: ChangeRecord[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      changes.unshift({ type: 'delete', oldLine: i, oldText: a[i - 1] });
      i--;
    } else {
      changes.unshift({ type: 'insert', newLine: j, newText: b[j - 1] });
      j--;
    }
  }
  while (i > 0) { changes.unshift({ type: 'delete', oldLine: i, oldText: a[i - 1] }); i--; }
  while (j > 0) { changes.unshift({ type: 'insert', newLine: j, newText: b[j - 1] }); j--; }
  // 合并相邻 delete+insert 为 replace（同一位置替换）
  // 注意：unshift 使变更数组呈逆序（insert 常在 delete 前），两种顺序都要合并
  const merged: ChangeRecord[] = [];
  for (let k = 0; k < changes.length; k++) {
    const c = changes[k];
    const next = changes[k + 1];
    if (c.type === 'delete' && next && next.type === 'insert' && next.newLine === c.oldLine) {
      merged.push({ type: 'replace', oldLine: c.oldLine, oldText: c.oldText, newText: next.newText });
      k++;
    } else if (c.type === 'insert' && next && next.type === 'delete' && next.oldLine === c.newLine) {
      merged.push({ type: 'replace', oldLine: next.oldLine, oldText: next.oldText, newText: c.newText });
      k++;
    } else {
      merged.push(c);
    }
  }
  return merged.slice(0, 50); // 截断超长 diff 摘要，避免撑爆上下文
}

/**
 * 解析 unified diff 文本并应用到文本
 * 支持标准 @@ -a,b +c,d @@ 格式；逐 hunk 校验上下文，失败抛错（调用方负责原子回滚）
 */
function applyUnifiedPatch(originalText: string, patchText: string): string {
  const originalLines = originalText.split('\n');
  const patchLines = patchText.split('\n');
  const result = [...originalLines];
  let offset = 0; // 已应用的净行数变化，用于调整后续 hunk 的起始行

  // 去掉文件名头（--- / +++ 行）
  let i = 0;
  while (i < patchLines.length && !/^@@/.test(patchLines[i])) i++;

  let hunkCount = 0;
  while (i < patchLines.length) {
    const headerMatch = patchLines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!headerMatch) {
      throw new Error(`unified patch 格式错误：无法解析 hunk 头「${patchLines[i]}」`);
    }
    const oldStart = parseInt(headerMatch[1], 10);
    // oldCount 仅用于校验（当前实现按行内容精确匹配，hunk 头数字不参与应用）
    i++;

    // 收集本 hunk 的上下文/删除/新增行
    const hunkBody: Array<{ op: string; text: string }> = [];
    while (i < patchLines.length && !/^@@/.test(patchLines[i])) {
      const line = patchLines[i];
      if (line === '\\ No newline at end of file') {
        i++;
        continue;
      }
      const op = line[0];
      if (op === ' ' || op === '-' || op === '+') {
        hunkBody.push({ op, text: line.slice(1) });
      } else if (line.trim() === '') {
        // patch 中空行在 diff 里应是 " " 前缀；裸空行视为上下文空行
        hunkBody.push({ op: ' ', text: '' });
      } else {
        throw new Error(`unified patch 格式错误：未知行「${line}」`);
      }
      i++;
    }

    // 校验并应用：目标行 = oldStart - 1 + offset（1-based → 0-based）
    const baseIdx = oldStart - 1 + offset;
    // 逐行比对上下文与删除行
    let cursor = baseIdx;
    for (const entry of hunkBody) {
      if (entry.op === ' ' || entry.op === '-') {
        if (cursor >= result.length || result[cursor] !== entry.text) {
          throw new Error(
            `unified patch 应用失败：第 ${cursor + 1} 行上下文不匹配（期望「${entry.text}」，实际「${result[cursor]}」）`,
          );
        }
        if (entry.op === '-') {
          result.splice(cursor, 1);
          offset--;
        } else {
          cursor++;
        }
      } else {
        // '+' 新增行：在 cursor 处插入
        result.splice(cursor, 0, entry.text);
        cursor++;
        offset++;
      }
    }

    hunkCount++;
    if (hunkCount > 50) throw new Error('unified patch 过大（超过 50 个 hunk），请分批编辑');
  }

  if (hunkCount === 0) throw new Error('unified patch 为空或没有可应用的 hunk');
  return result.join('\n');
}

/**
 * 创建 edit_file 工具
 *
 * @param context userId / sessionId
 * @param descriptionOverride 可选：覆盖默认 description（供 edit_document 等业务语义别名使用）
 */
export function createEditFileTool(context: ToolContext, descriptionOverride?: string) {
  return tool({
    description:
      descriptionOverride ||
      '编辑已上传的文件。支持两种模式：① replace：精确替换文本（oldText → newText，occurrence 指定第几次出现）；② patch：应用 unified diff（unified patch 格式，@@ -a,b +c,d @@ 头 + 上下文行，仅纯文本）。支持纯文本（txt/md/csv/log/json/xml/yaml/yml）与 DOCX（受控替换，保留格式；仅 replace 模式）。只能编辑当前会话上传的文件。返回变更摘要供确认。注意：这是修改原文件的写操作，执行前必须先调 ask_user(method=confirm) 向用户说明改动并获得确认。',
    inputSchema: z.object({
      filePath: z.string().describe('服务端文件绝对路径（由 upload_file 返回）'),
      mode: z.enum(['replace', 'patch']).default('replace').describe('编辑模式：replace=精确替换，patch=unified diff'),
      oldText: z.string().optional().describe('replace 模式：要被替换的旧文本（精确匹配，含缩进）'),
      newText: z.string().optional().describe('replace 模式：替换后的新文本'),
      occurrence: z.number().int().min(1).optional().default(1).describe('replace 模式：替换第几次出现（1-based，默认 1）'),
      replaceAll: z.boolean().optional().default(false).describe('replace 模式：为 true 时替换所有出现'),
      patch: z.string().optional().describe('patch 模式：unified diff 文本（@@ hunk @@ + 上下文行）'),
    }),
    execute: async ({ filePath, mode, oldText, newText, occurrence, replaceAll, patch }) => {
      const normalizedPath = assertEditablePath(context, filePath);
      // 格式校验：text / docx；其他（PDF/二进制）抛错拒绝
      const format = assertEditableFormat(normalizedPath);

      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`文件不存在: ${normalizedPath}`);
      }

      // ===== DOCX 受控替换分支 =====
      // 走 DocxReplaceService（在 DOCX ZIP 内操作 word/*.xml，保留格式），仅支持 replace 模式
      if (format === 'docx') {
        if (mode !== 'replace') {
          throw new Error('DOCX 不支持 patch 模式，请用 replace 模式做受控替换');
        }
        if (typeof oldText !== 'string' || oldText.length === 0) {
          throw new Error('replace 模式必须提供 oldText');
        }
        const newValue = typeof newText === 'string' ? newText : '';
        // 写队列串行化（P2-⑲ 防并发写冲突），内部执行受控替换
        const replacements = await FileWriteQueueService.enqueue(normalizedPath, async () => {
          try {
            return DocxReplaceService.replaceText(normalizedPath, oldText, newValue);
          } catch (e: any) {
            // 把「原文未找到」的专用错误码转成友好提示
            if (e?.message === 'DOCX_EXACT_TEXT_NOT_FOUND') {
              throw new Error(`在 DOCX 中未找到要替换的文本「${oldText.slice(0, 50)}...」`);
            }
            throw e;
          }
        });
        return {
          filePath: normalizedPath,
          fileName: path.basename(normalizedPath),
          format: 'docx',
          replacements,
          changes: [{ type: 'replace' as const, oldText, newText: newValue }],
          message: `已编辑 DOCX ${path.basename(normalizedPath)}：${replacements} 处替换`,
        };
      }

      // ===== 纯文本分支（replace / patch）=====
      const before = await fs.promises.readFile(normalizedPath, 'utf-8');
      const beforeLines = before.split('\n');
      let after: string;

      if (mode === 'replace') {
        if (typeof oldText !== 'string' || oldText.length === 0) {
          throw new Error('replace 模式必须提供 oldText');
        }
        const newValue = typeof newText === 'string' ? newText : '';
        const occ = occurrence || 1;
        const isAll = replaceAll === true;

        // 精确匹配替换（不依赖正则，避免用户文本中的特殊字符被当正则解释）
        let idx = isAll ? before.indexOf(oldText) : -1;
        if (isAll) {
          if (idx === -1) throw new Error(`未找到要替换的文本「${oldText.slice(0, 50)}...」`);
          // 所有出现
          let acc = '';
          let searchFrom = 0;
          let count = 0;
          for (;;) {
            const found = before.indexOf(oldText, searchFrom);
            if (found === -1) break;
            acc += before.slice(searchFrom, found) + newValue;
            searchFrom = found + oldText.length;
            count++;
          }
          if (count === 0) throw new Error(`未找到要替换的文本「${oldText.slice(0, 50)}...」`);
          after = acc + before.slice(searchFrom);
        } else {
          // 第 occurrence 次出现
          let searchFrom = 0;
          let found = -1;
          for (let n = 1; n <= occ; n++) {
            found = before.indexOf(oldText, searchFrom);
            if (found === -1) break;
            searchFrom = found + oldText.length;
          }
          if (found === -1) {
            throw new Error(
              occ === 1
                ? `未找到要替换的文本「${oldText.slice(0, 50)}...」`
                : `未找到第 ${occ} 次出现的文本「${oldText.slice(0, 50)}...」`,
            );
          }
          after = before.slice(0, found) + newValue + before.slice(found + oldText.length);
        }
      } else {
        // patch 模式
        if (typeof patch !== 'string' || patch.length === 0) {
          throw new Error('patch 模式必须提供 patch 文本');
        }
        after = applyUnifiedPatch(before, patch);
      }

      // 原子写入：先写临时文件再 rename，避免写一半崩溃留下损坏文件
      // P2-⑲：经文件写队列串行化，同一文件的并发写操作排队执行（防写冲突）
      await FileWriteQueueService.enqueue(normalizedPath, async () => {
        const tmpPath = `${normalizedPath}.edit.tmp`;
        try {
          await fs.promises.writeFile(tmpPath, after, 'utf-8');
          await fs.promises.rename(tmpPath, normalizedPath);
        } catch (err) {
          // 修复：写入/重命名失败时清理残留的 .tmp 文件（原实现崩溃中断后永久残留）
          await fs.promises.unlink(tmpPath).catch(() => {});
          throw err;
        }
      });

      const afterLines = after.split('\n');
      const changes = lineDiffSummary(beforeLines, afterLines);
      const message = `已编辑 ${path.basename(normalizedPath)}：${beforeLines.length} 行 → ${afterLines.length} 行，${changes.length} 处变更`;

      return {
        filePath: normalizedPath,
        fileName: path.basename(normalizedPath),
        format: 'text',
        lines: afterLines.length,
        changes,
        message,
      };
    },
  });
}
