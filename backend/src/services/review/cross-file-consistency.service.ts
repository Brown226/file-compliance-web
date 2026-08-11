/**
 * 跨文件一致性检查服务
 * 检测同名参数在不同文件中的不一致取值
 *
 * 规则代码: CROSS_CONSIST_001（参数值跨文件不一致，C2 维度）
 *
 * Task 10: 新增从 markdown 表格中抽取键值对，与正则抽取的参数合并后参与跨文件一致性比对。
 * Task 12: 扩展到全维度 C1-C6。C2 由正则规则覆盖（保持不变），
 *          C1/C3/C4/C5/C6 走 LLM 抽取 + 分维度并行比对新路径。
 */

import prisma from '../../config/db';
import { TextExtractionService } from '../review-pipeline/text-extraction.service';
import { resolveFilePath } from '../../config/upload';
import { parallelLimit } from '../../utils/parallel';
import { getModeCapabilitiesConfig, ParamToleranceConfig } from '../review-pipeline/mode-config.service';
import { getToleranceForUnit } from '../review-pipeline/param-tolerance';
import { LlmService, TextChunk } from '../llm/llm.service';
import { PromptLoader } from '../prompts';
import { CONSISTENCY_DIMENSIONS } from '../prompts';

/** 参数抽取结果 */
interface ParamEntry {
  paramName: string;
  value: string;
  position: number;    // 在原文中的起始偏移位置（匹配开始的字符偏移）
  endPosition: number; // 在原文中的结束偏移位置（匹配结束的字符偏移，不含）
  context: string;     // 匹配位置前后的原文片段（用于 buildLocateMeta 精确定位）
}

/**
 * 参数指纹（P2-9 跨服务去重键）
 *
 * 从 originalText 中提取"参数名:值"指纹用于去重匹配。
 * 原因：CROSS（匹配位前后各 40 字）与 INTRA（60 字行切片）对同一参数生成的
 * originalText 原文格式不同，整段去空白比较永不命中 → 双报残留。
 * 表格 KV（| key | value |，无 ::= 分隔符）回退到整段去空白比较（保持原行为）。
 */
export function paramFingerprint(s?: string | null): string {
  const t = s || '';
  const m = t.match(/([^\s\n\r：:=|]{1,20})\s*[：:=]\s*([^\s\n\r,，。；;|]{1,50})/);
  return m ? `${m[1]}|${m[2]}` : t.replace(/\s+/g, '').trim();
}

/**
 * Task 10: 从 markdown 文本中抽取表格键值对，返回带位置信息的 ParamEntry 列表。
 * 仅处理 markdown 表格语法 `| key | value |`，二列表格第一列为键、第二列为值；
 * 多列表格第一列为键、其余列用空格拼接为值。
 *
 * 与 intra-file-consistency.service.ts 中的 extractTableKvPairsFromMarkdown 等价，
 * 但额外计算 position/endPosition/context，供 cross-file 的 locateMeta 定位使用。
 */
function extractTableKvPairsAsParams(text: string): ParamEntry[] {
  if (!text) return [];
  const params: ParamEntry[] = [];
  const lines = text.split('\n');
  // 计算每行起始字符偏移（按 \n 长度 1 累加）
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1; // +1 for \n
  }

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('|') || trimmed.indexOf('|', 1) === -1) {
      i++;
      continue;
    }
    const tableStartLine = i;
    const tableLines: string[] = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      tableLines.push(lines[i].trim());
      i++;
    }
    if (tableLines.length < 2) continue;

    const parseRow = (rowLine: string): string[] => {
      let inner = rowLine.trim();
      if (inner.startsWith('|')) inner = inner.slice(1);
      if (inner.endsWith('|')) inner = inner.slice(0, -1);
      return inner.split('|').map(c => c.trim());
    };

    const rows = tableLines.map(parseRow);
    // 跳过分隔符行（|---|---|）
    if (rows.length >= 2 && rows[1].every(c => /^:?-{2,}:?$/.test(c || ''))) {
      rows.splice(1, 1);
    }

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < 2) continue;
      const key = (row[0] || '').trim();
      if (!key) continue;
      const value = row.length === 2
        ? (row[1] || '').trim()
        : row.slice(1).map(c => (c || '').trim()).filter(Boolean).join(' ');
      if (!value) continue;

      // 计算该行在原文中的位置（使用表格中第 r 行的偏移；分隔符行已删除，r 已对齐到原始行索引可能错位，
      // 但定位精度对一致性检查不关键，使用表格起始行作为兜底）
      const rowIndex = Math.min(tableStartLine + r, lines.length - 1);
      const position = lineOffsets[rowIndex];
      const lineText = lines[rowIndex] || '';
      const endPosition = position + lineText.length;
      // 上下文：取该行前后各 40 字符
      const ctxStart = Math.max(0, position - 40);
      const ctxEnd = Math.min(text.length, endPosition + 40);
      const context = text.substring(ctxStart, ctxEnd).replace(/\n/g, ' ').trim();

      params.push({
        paramName: key,
        value,
        position,
        endPosition,
        context,
      });
    }
  }
  return params;
}

/** 按参数名分组的索引项 */
interface ParamIndexEntry {
  fileName: string;
  fileId: string;
  value: string;
  position: number;    // 匹配起始字符偏移
  endPosition: number; // 匹配结束字符偏移（不含）
  context: string;     // 原文上下文片段
}

/** 不一致对 */
interface InconsistencyPair {
  paramName: string;
  entries: ParamIndexEntry[];
  /** 不一致类型：intra-file=文件内多次出现取值不一致；cross-file=跨文件取值不一致 */
  kind: 'intra-file' | 'cross-file';
}

// ============================================================
// Task 12: 全维度跨文件比对类型（C1/C3/C4/C5/C6 走 LLM 路径）
// ============================================================

/** 共享的文件文本提取结果（C2 与 C1-C6 两条路径共享，避免重复 OCR） */
interface FileTextEntry {
  file: { id: string; fileName: string; filePath: string; fileType: string };
  text: string;
}

/** 单个结构化条目（params/codes/refs/meta/facts 五类统一形态） */
interface DimensionItem {
  content: string;       // 条目内容（如 "1EAA360CR"、"设计温度=350°C"、"GB/T 123"）
  context?: string;      // 条目上下文描述（仅 codes 有）
  fingerprint: string;   // 原文片段（用于精确定位）
  fileName: string;
  fileId: string;
  position: number;     // 在该文件原文中的字符偏移
  endPosition: number;
}

/** 单个文件的全维度抽取结果 */
interface FileDimensionSummary {
  fileId: string;
  fileName: string;
  text: string;
  params: DimensionItem[];
  codes: DimensionItem[];
  refs: DimensionItem[];
  meta: DimensionItem[];
  facts: DimensionItem[];
}

/** LLM 比对返回的原始 issue */
interface CrossFileIssueRaw {
  ruleCode: string;
  originalText: string;
  suggestedText?: string;
  description?: string;
  fileNames?: string[];
  severity?: 'error' | 'warning';
}

/**
 * P2-11b：按 LLM 返回的 fileNames 过滤排序候选文件（纯函数，可单测）
 *
 * 匹配优先级：
 *   1. 精确匹配：ext.fileName === fileName（排在前面，按 fileNames 数组顺序）
 *   2. 包含匹配：互为子串（ext.fileName.includes(fileName) || fileName.includes(ext.fileName)）
 * 未命中任何 fileName 的文件被剔除；按 fileId 去重（同名/别名文件只保留一次）。
 * 返回 [] 表示无候选（调用方应退化为原启发式 findIssueSourceFile）。
 */
export function orderCandidatesByFileNames(
  fileNames: string[],
  extractions: FileDimensionSummary[],
): FileDimensionSummary[] {
  const names = [...new Set(fileNames.map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0 || extractions.length === 0) return [];

  const ordered: FileDimensionSummary[] = [];
  const seen = new Set<string>();
  const pushUnique = (ext: FileDimensionSummary) => {
    if (seen.has(ext.fileId)) return;
    seen.add(ext.fileId);
    ordered.push(ext);
  };

  for (const name of names) {
    // 精确匹配优先
    for (const ext of extractions) {
      if (ext.fileName === name) pushUnique(ext);
    }
    // 包含匹配兜底
    for (const ext of extractions) {
      if (ext.fileName !== name && (ext.fileName.includes(name) || name.includes(ext.fileName))) {
        pushUnique(ext);
      }
    }
  }
  return ordered;
}

export class CrossFileConsistencyService {
  /**
   * 执行跨文件一致性检查
   *
   * Task 12 改造：文本提取共享给两条路径，避免重复 OCR。
   *   - C2 路径：正则抽取参数 + 容差比对（Task 3/4/7/10/13 已有逻辑，保持不变）
   *   - C1/C3/C4/C5/C6 路径：LLM 抽取 5 类条目 + 分维度并行比对（Task 12 新增）
   *
   * @param taskId 任务 ID
   * @param files 任务文件列表
   */
  static async check(taskId: string, files: Array<{ id: string; fileName: string; filePath: string; fileType: string }>): Promise<number> {
    if (!files || files.length < 2) {
      console.log('[CrossConsist] 文件数不足2，跳过跨文件一致性检查');
      return 0;
    }

    console.log(`[CrossConsist] 开始跨文件一致性检查，共 ${files.length} 个文件`);

    // 1. 文本提取（一次提取，C2 与 C1-C6 共享，避免重复 OCR/doc-parser 调用）
    const EXTRACT_CONCURRENCY = 4; // 受 OCR/doc-parser 并发上限约束
    const fileTexts = await parallelLimit(
      files,
      EXTRACT_CONCURRENCY,
      async (file) => {
        try {
          const text = await this.extractText(file);
          return { file, text };
        } catch (e) {
          console.warn(`[CrossConsist] 文本提取失败: ${file.fileName}`, e);
          return null;
        }
      },
    );

    const validFiles = fileTexts.filter(
      (r): r is FileTextEntry => r !== null && !!r.text && r.text.trim().length > 0,
    );

    if (validFiles.length < 2) {
      console.log('[CrossConsist] 有效文件不足2，跳过');
      return 0;
    }

    // 2. C2 路径：参数值一致性（保持 Task 3/4/7/10/13 已有逻辑，正则 + 表格 KV + 容差比对）
    const c2Details = await this.runC2ParamCheck(taskId, validFiles);

    // 3. C1/C3/C4/C5/C6 路径：LLM 全维度抽取 + 跨文件分维度并行比对（Task 12 新增）
    const c13456Details = await this.runCrossDimensionCheck(taskId, validFiles);

    // 4. 合并写入 TaskDetail
    const allDetails = [...c2Details, ...c13456Details];
    if (allDetails.length > 0) {
      // P2-9 跨服务去重：同一文件同一原文已被 INTRA_CONSIST_001（文件内一致性，先跑）覆盖时，
      // 不再写 CROSS 重复项（INTRA 证据更直接、优先保留）。归一化：trim + 压缩空白。
      try {
        const intraDetails = await prisma.taskDetail.findMany({
          where: { taskId, ruleCode: 'INTRA_CONSIST_001' },
          select: { fileId: true, originalText: true },
        });
        if (intraDetails.length > 0) {
          // P2-9 去重键修复：改用"参数指纹"（参数名:值）而非整段原文比较。
          // 正则提取类参数（如"设计压力=17.5MPa"）两边原文格式不同，整段去空白比较永不命中；
          // 表格 KV（| key | value |）无 ::= 分隔符，paramFingerprint 回退到整段比较。
          const intraKeys = new Set(intraDetails.map((d) => `${d.fileId}|${paramFingerprint(d.originalText)}`));
          const before = allDetails.length;
          const filtered = allDetails.filter((d) => !intraKeys.has(`${d.fileId}|${paramFingerprint(d.originalText)}`));
          if (filtered.length !== before) {
            console.log(`[CrossConsist] P2-9 跨服务去重: 丢弃 ${before - filtered.length} 条与 INTRA_CONSIST_001 重复的一致性明细`);
            allDetails.splice(0, allDetails.length, ...filtered);
          }
        }
      } catch (e) {
        console.warn('[CrossConsist] P2-9 跨服务去重查询失败，跳过去重（不影响主流程）:', e);
      }
      await prisma.taskDetail.createMany({ data: allDetails });
    }

    // 5. 更新相关文件的错误计数
    const affectedFileIds = new Set(
      allDetails.map((d) => d.fileId).filter((id): id is string => !!id),
    );
    for (const fileId of affectedFileIds) {
      await this.updateFileErrorCount(fileId);
    }

    console.log(
      `[CrossConsist] 完成: C2=${c2Details.length}, C1/C3-C6=${c13456Details.length}`,
    );

    return allDetails.length;
  }

  /**
   * C2 路径：参数值跨文件/文件内一致性检查
   * 保持 Task 3/4/7/10/13 的逻辑不变，仅从 check 抽出为独立方法以便共享文本提取。
   * 返回待写入 DB 的 detail 记录数组（不在此方法内写库，由调用方统一写）。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async runC2ParamCheck(
    taskId: string,
    validFiles: FileTextEntry[],
  ): Promise<any[]> {
    // 1. 提取每个文件的参数（正则 + 表格 KV）
    const allParams = validFiles
      .map((vf) => {
        const params = this.extractParameters(vf.text);
        const tableParams = extractTableKvPairsAsParams(vf.text);
        if (tableParams.length > 0) {
          params.push(...tableParams);
          console.log(`[CrossConsist] ${vf.file.fileName}: 表格 KV 抽取到 ${tableParams.length} 对`);
        }
        if (params.length > 0) {
          console.log(`[CrossConsist] ${vf.file.fileName}: 抽取到 ${params.length} 个参数`);
        }
        return { fileId: vf.file.id, fileName: vf.file.fileName, params };
      })
      .filter((r) => r.params.length > 0);

    if (allParams.length < 2) {
      console.log('[CrossConsist] C2 有效参数文件不足2，跳过 C2');
      return [];
    }

    // 2. 构建参数索引
    const paramIndex = this.buildParamIndex(allParams);

    // 加载 CONSISTENCY 模式的数值容差配置（可选，未配置时保持 1% 默认）
    let paramTolerance: ParamToleranceConfig | undefined;
    try {
      const modeConfig = await getModeCapabilitiesConfig();
      paramTolerance = modeConfig.CONSISTENCY?.paramTolerance;
    } catch (e) {
      console.warn('[CrossConsist] 加载容差配置失败，使用默认 1%', e);
    }

    // 3. 比对一致性
    const inconsistencies = this.findInconsistencies(paramIndex, paramTolerance);

    if (inconsistencies.length === 0) {
      console.log('[CrossConsist] 未发现参数不一致');
      return [];
    }

    console.log(`[CrossConsist] 发现 ${inconsistencies.length} 个参数不一致（含文件内/跨文件）`);

    // 4. 构造 detail 记录（每个相关文件都写入一条，而非仅第一个文件）
    return inconsistencies.flatMap((inc) => {
      const valuesDesc = inc.entries
        .map((e) => `${e.fileName}: "${e.value}"`)
        .join('; ');

      const descPrefix = inc.kind === 'intra-file'
        ? `参数 "${inc.paramName}" 在同一文件内取值不一致`
        : `参数 "${inc.paramName}" 在不同文件中取值不一致`;

      return inc.entries.map((entry) => ({
        taskId,
        fileId: entry.fileId,
        issueType: 'CONSISTENCY' as const,
        ruleCode: 'CROSS_CONSIST_001',
        severity: 'error' as const,
        reviewSource: 'RULE_ENGINE' as const,
        originalText: entry.context || inc.paramName,
        suggestedText: null as string | null,
        description: `${descPrefix}: ${valuesDesc}`,
        // locateMeta: 指向该文件中参数首次出现的位置（version 2 与 structured-consistency 一致）
        locateMeta: {
          version: 2,
          mode: 'text' as const,
          confidence: 'exact' as const,
          absolute: { start: entry.position, end: entry.endPosition },
          quote: { text: entry.context },
        },
      }));
    });
  }

  // ==========================================================
  // Task 12: C1/C3/C4/C5/C6 跨文件全维度比对（LLM 路径）
  // ==========================================================

  /**
   * C1/C3/C4/C5/C6 路径：LLM 全维度抽取 + 跨文件分维度并行比对
   *
   * 流程：
   *   1. 对每个文件调用 LLM 抽取 5 类条目（params/codes/refs/meta/facts）
   *      复用 consistency_extract_system prompt（与 structured-consistency.service 共用）
   *   2. 用 fingerprint 在原文中定位每个条目的字符位置
   *   3. 对 C1/C3/C4/C5/C6 五个维度并行 LLM 比对（C2 已由正则规则覆盖）
   *      每个维度只传该维度相关的条目，避免上下文超限
   *   4. 将 issue 映射回来源文件，构造 TaskDetail 记录
   *
   * 简化策略：单文件文本超过 6000 字符时分片抽取，每片独立 LLM 调用后合并；
   *          单维度条目数超过 200 时按文件截断，避免 prompt 过大。
   */
  private static async runCrossDimensionCheck(
    taskId: string,
    validFiles: FileTextEntry[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]> {
    if (validFiles.length < 2) return [];

    // ---- 1. 全文件维度抽取（文件级并行，单文件内分片并行） ----
    const fileExtractions = await this.extractAllDimensionsForFiles(validFiles);
    if (fileExtractions.length < 2) {
      console.log('[CrossConsist] C1-C6 维度有效抽取文件不足2，跳过');
      return [];
    }

    // ---- 2. 分维度并行 LLM 比对 ----
    const dimensions = this.buildDimensionBatches(fileExtractions);
    if (dimensions.length === 0) return [];

    console.log(
      `[CrossConsist] C1-C6 分维度比对: ${dimensions.map(d => `${d.code}(${d.items.length})`).join(' ')}`,
    );

    const DIMENSION_CONCURRENCY = 5; // C1/C3/C4/C5/C6 同时进行
    const dimResults = await parallelLimit(
      dimensions,
      DIMENSION_CONCURRENCY,
      async (dim) => {
        try {
          const issues = await this.callCrossCompareLLM(dim.code, dim.label, dim.items);
          return issues;
        } catch (e: any) {
          console.warn(`[CrossConsist] 维度 ${dim.code} 比对失败: ${e.message}`);
          return [];
        }
      },
    );

    const allIssues: CrossFileIssueRaw[] = dimResults.flat();
    if (allIssues.length === 0) {
      console.log('[CrossConsist] C1-C6 未发现跨文件不一致');
      return [];
    }

    console.log(`[CrossConsist] C1-C6 发现 ${allIssues.length} 个跨文件不一致`);

    // ---- 3. issue → TaskDetail（映射回来源文件，构造 locateMeta） ----
    // P2-11b：优先使用 LLM 返回的 fileNames 归因——按文件名过滤排序候选文件，
    // 在候选内做 fingerprint/原文定位；多文件命中时每个命中文件各写一条（与 C2 路径 L296 口径一致）；
    // 无 fileNames 或候选无命中时完全退化为原启发式 findIssueSourceFile（兼容旧行为）。
    return allIssues.flatMap((issue) => {
      const sourceFiles = this.resolveIssueSourceFiles(issue, fileExtractions);

      return sourceFiles.map((sourceFile) => {
        const loc = this.locateIssueInFile(issue.originalText, sourceFile);

        return {
          taskId,
          fileId: sourceFile.fileId,
          issueType: 'CONSISTENCY' as const,
          ruleCode: issue.ruleCode,
          severity: issue.severity === 'error' ? 'error' : 'warning',
          reviewSource: 'RULE_ENGINE' as const,
          originalText: issue.originalText,
          suggestedText: issue.suggestedText || null,
          description: issue.description || '',
          plainLanguage: undefined,
          locateMeta: {
            version: 2,
            mode: 'text' as const,
            confidence: loc.confidence,
            absolute: { start: loc.position, end: loc.endPosition },
            quote: { text: issue.originalText },
          },
        };
      });
    });
  }

  /**
   * 对每个文件调用 LLM 抽取 5 类结构化条目
   * 复用 consistency_extract_system prompt（与 structured-consistency.service 共用）
   * 长文件分片抽取，分片结果合并后用 fingerprint 在原文中定位
   */
  private static async extractAllDimensionsForFiles(
    validFiles: FileTextEntry[],
  ): Promise<FileDimensionSummary[]> {
    const EXTRACT_CHUNK_SIZE = 4000; // 与 structured-consistency 对齐
    const FILE_CONCURRENCY = 4;      // 文件级并发（受 LLM 速率限制）
    const CHUNK_CONCURRENCY = 2;     // 单文件内分片并发

    const results = await parallelLimit(
      validFiles,
      FILE_CONCURRENCY,
      async (vf) => {
        try {
          const text = vf.text;
          if (!text || text.trim().length < 100) return null;

          // 分片（含位置信息，用于 fingerprint 反向定位）
          const chunks = LlmService.splitText(text, EXTRACT_CHUNK_SIZE, true) as TextChunk[];

          // 单文件内分片并行抽取
          const chunkResults = await parallelLimit(
            chunks,
            CHUNK_CONCURRENCY,
            async (chunk) => {
              try {
                return await this.extractDimensionFromChunk(chunk, chunks.length);
              } catch (e: any) {
                console.warn(
                  `[CrossConsist] ${vf.file.fileName} 分片 ${chunk.chunkIndex + 1} 抽取失败: ${e.message}`,
                );
                return { params: [], codes: [], refs: [], meta: [], facts: [] };
              }
            },
          );

          // 合并 + 用 fingerprint 在原文中定位
          const merged = this.mergeAndLocateExtraction(chunkResults, text, vf.file);
          console.log(
            `[CrossConsist] ${vf.file.fileName} 维度抽取: ` +
            `params=${merged.params.length} codes=${merged.codes.length} ` +
            `refs=${merged.refs.length} meta=${merged.meta.length} facts=${merged.facts.length}`,
          );
          return merged;
        } catch (e: any) {
          console.warn(`[CrossConsist] 维度抽取失败: ${vf.file.fileName}: ${e.message}`);
          return null;
        }
      },
    );

    return results.filter((r): r is FileDimensionSummary => r !== null);
  }

  /**
   * 调用 LLM 抽取单个分片的 5 类条目（params/codes/refs/meta/facts）
   * 复用 consistency_extract_system prompt，不重复造轮子
   */
  private static async extractDimensionFromChunk(
    chunk: TextChunk,
    totalChunks: number,
  ): Promise<{
    params: Array<{ name: string; value: string; fingerprint: string }>;
    codes: Array<{ code: string; context: string; fingerprint: string }>;
    refs: Array<{ ref: string; fingerprint: string }>;
    meta: Array<{ key: string; value: string; fingerprint: string }>;
    facts: Array<{ subject: string; claim: string; fingerprint: string }>;
  }> {
    const fallback = '你是文档结构化信息抽取器。从文本中提取参数、编码、引用、元信息、事实断言五类信息，严格输出 JSON。';
    const systemPrompt = await PromptLoader.resolve(
      'consistency',
      'system',
      'extract',
      fallback,
    );

    const userPrompt = `文本片段（第${chunk.chunkIndex + 1}/${totalChunks}片）：\n${chunk.text}`;

    const raw = await LlmService.chat(userPrompt, {
      systemPrompt,
      maxTokens: 1024,
      timeout: 60,
    });

    return this.parseDimensionResult(raw);
  }

  /**
   * 解析 LLM 抽取返回的 JSON
   * 与 structured-consistency.service.parseExtractResult 同形态，但跨文件不需要 chunkIndex/lineHint
   */
  private static parseDimensionResult(raw: string): {
    params: Array<{ name: string; value: string; fingerprint: string }>;
    codes: Array<{ code: string; context: string; fingerprint: string }>;
    refs: Array<{ ref: string; fingerprint: string }>;
    meta: Array<{ key: string; value: string; fingerprint: string }>;
    facts: Array<{ subject: string; claim: string; fingerprint: string }>;
  } {
    const empty = { params: [], codes: [], refs: [], meta: [], facts: [] };
    try {
      let jsonStr = raw.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!objMatch) return empty;

      const parsed = JSON.parse(objMatch[0]);

      return {
        params: (parsed.params || []).filter((p: any) => p.name && p.value).map((p: any) => ({
          name: String(p.name).trim(),
          value: String(p.value).trim(),
          fingerprint: String(p.fingerprint || '').trim(),
        })),
        codes: (parsed.codes || []).filter((c: any) => c.code).map((c: any) => ({
          code: String(c.code).trim(),
          context: String(c.context || '').trim(),
          fingerprint: String(c.fingerprint || '').trim(),
        })),
        refs: (parsed.refs || []).filter((r: any) => r.ref).map((r: any) => ({
          ref: String(r.ref).trim(),
          fingerprint: String(r.fingerprint || '').trim(),
        })),
        meta: (parsed.meta || []).filter((m: any) => m.key && m.value).map((m: any) => ({
          key: String(m.key).trim(),
          value: String(m.value).trim(),
          fingerprint: String(m.fingerprint || '').trim(),
        })),
        facts: (parsed.facts || []).filter((f: any) => f.subject && f.claim).map((f: any) => ({
          subject: String(f.subject).trim(),
          claim: String(f.claim).trim(),
          fingerprint: String(f.fingerprint || '').trim(),
        })),
      };
    } catch (e) {
      console.warn('[CrossConsist] 维度抽取 JSON 解析失败:', e);
      return empty;
    }
  }

  /**
   * 合并分片抽取结果，并用 fingerprint 在原文中定位每个条目
   * 定位策略：精确 indexOf → 去空格后匹配 → 兜底返回 position=0
   */
  private static mergeAndLocateExtraction(
    chunkResults: Array<{
      params: Array<{ name: string; value: string; fingerprint: string }>;
      codes: Array<{ code: string; context: string; fingerprint: string }>;
      refs: Array<{ ref: string; fingerprint: string }>;
      meta: Array<{ key: string; value: string; fingerprint: string }>;
      facts: Array<{ subject: string; claim: string; fingerprint: string }>;
    }>,
    text: string,
    file: { id: string; fileName: string },
  ): FileDimensionSummary {
    /** 用 fingerprint 在原文中查找位置 */
    const locate = (fingerprint: string): { position: number; endPosition: number } => {
      if (!fingerprint) return { position: 0, endPosition: 0 };
      // Level 1: 精确匹配
      const idx = text.indexOf(fingerprint);
      if (idx >= 0) {
        return { position: idx, endPosition: idx + fingerprint.length };
      }
      // Level 2: 去空格后匹配（容错中文/英文之间的空格差异）
      const compactFp = fingerprint.replace(/\s+/g, '');
      if (compactFp.length >= 3) {
        const compactText = text.replace(/\s+/g, '');
        const compactIdx = compactText.indexOf(compactFp);
        if (compactIdx >= 0) {
          // 反向映射：compactIdx → 原文位置（粗略，定位精度对该场景足够）
          let charCount = 0;
          let origIdx = 0;
          for (let i = 0; i < text.length && charCount < compactIdx; i++) {
            if (!/\s/.test(text[i])) charCount++;
            origIdx = i + 1;
          }
          return {
            position: origIdx,
            endPosition: Math.min(origIdx + fingerprint.length + 20, text.length),
          };
        }
      }
      // 兜底
      return { position: 0, endPosition: Math.min(fingerprint.length, text.length) };
    };

    /** 去重 + 转 DimensionItem */
    const dedup = <T extends { fingerprint: string }>(
      arr: T[],
      keyFn: (item: T) => string,
    ): T[] => {
      const map = new Map<string, T>();
      for (const item of arr) {
        const key = keyFn(item);
        if (!map.has(key)) map.set(key, item);
      }
      return [...map.values()];
    };

    const toDimensionItem = (
      fingerprint: string,
      content: string,
      context?: string,
    ): DimensionItem => {
      const loc = locate(fingerprint);
      return {
        content,
        context,
        fingerprint,
        fileName: file.fileName,
        fileId: file.id,
        position: loc.position,
        endPosition: loc.endPosition,
      };
    };

    const allParams = chunkResults.flatMap(r => r.params);
    const allCodes = chunkResults.flatMap(r => r.codes);
    const allRefs = chunkResults.flatMap(r => r.refs);
    const allMeta = chunkResults.flatMap(r => r.meta);
    const allFacts = chunkResults.flatMap(r => r.facts);

    const params: DimensionItem[] = dedup(allParams, p => `${p.name}|${p.value}`)
      .map(p => toDimensionItem(p.fingerprint, `${p.name}=${p.value}`));
    const codes: DimensionItem[] = dedup(allCodes, c => c.code)
      .map(c => toDimensionItem(c.fingerprint, c.code, c.context));
    const refs: DimensionItem[] = dedup(allRefs, r => r.ref)
      .map(r => toDimensionItem(r.fingerprint, r.ref));
    const meta: DimensionItem[] = dedup(allMeta, m => `${m.key}|${m.value}`)
      .map(m => toDimensionItem(m.fingerprint, `${m.key}=${m.value}`));
    const facts: DimensionItem[] = dedup(allFacts, f => `${f.subject}|${f.claim}`)
      .map(f => toDimensionItem(f.fingerprint, `${f.subject}: ${f.claim}`));

    return {
      fileId: file.id,
      fileName: file.fileName,
      text,
      params,
      codes,
      refs,
      meta,
      facts,
    };
  }

  /**
   * 构建分维度比对批次：C1 用 codes，C3 用 params+meta，C4 用 refs+codes，C5 用 meta，C6 用 facts
   * C2（参数值）已由正则规则覆盖，此处不重复
   */
  private static buildDimensionBatches(
    fileExtractions: FileDimensionSummary[],
  ): Array<{ code: 'C1' | 'C3' | 'C4' | 'C5' | 'C6'; label: string; items: DimensionItem[] }> {
    const allParams = fileExtractions.flatMap(f => f.params);
    const allCodes = fileExtractions.flatMap(f => f.codes);
    const allRefs = fileExtractions.flatMap(f => f.refs);
    const allMeta = fileExtractions.flatMap(f => f.meta);
    const allFacts = fileExtractions.flatMap(f => f.facts);

    const dims: Array<{ code: 'C1' | 'C3' | 'C4' | 'C5' | 'C6'; label: string; items: DimensionItem[] }> = [];

    // C1 编码一致性：仅 codes
    if (allCodes.length > 0) {
      dims.push({ code: 'C1', label: '编码', items: allCodes });
    }
    // C3 命名一致性：params（参数名）+ meta（标题/术语）
    if (allParams.length > 0 || allMeta.length > 0) {
      dims.push({ code: 'C3', label: '命名', items: [...allParams, ...allMeta] });
    }
    // C4 交叉引用一致性：refs + codes（refs 引用的编码能否在 codes 中找到）
    if (allRefs.length > 0 || allCodes.length > 0) {
      dims.push({ code: 'C4', label: '交叉引用', items: [...allRefs, ...allCodes] });
    }
    // C5 文档元信息一致性：仅 meta
    if (allMeta.length > 0) {
      dims.push({ code: 'C5', label: '文档元信息', items: allMeta });
    }
    // C6 事实断言一致性：仅 facts
    if (allFacts.length > 0) {
      dims.push({ code: 'C6', label: '事实断言', items: allFacts });
    }

    return dims;
  }

  /**
   * 调用 LLM 进行单维度跨文件比对
   * 用户 prompt 按文件分组列出该维度条目，限制每文件最多 100 条避免上下文超限
   */
  private static async callCrossCompareLLM(
    dimensionCode: 'C1' | 'C3' | 'C4' | 'C5' | 'C6',
    dimensionLabel: string,
    items: DimensionItem[],
  ): Promise<CrossFileIssueRaw[]> {
    const fallback = this.fallbackCrossCompareSystem();
    const systemPrompt = await PromptLoader.resolve(
      'consistency',
      'system',
      'cross_compare',
      fallback,
    );

    // 按文件分组
    const byFile = new Map<string, DimensionItem[]>();
    for (const item of items) {
      if (!byFile.has(item.fileName)) byFile.set(item.fileName, []);
      byFile.get(item.fileName)!.push(item);
    }

    // 每文件最多 100 条（截断，避免 prompt 过大）
    const MAX_ITEMS_PER_FILE = 100;
    const fileBlocks = [...byFile.entries()].map(([fileName, fileItems]) => {
      const truncated = fileItems.slice(0, MAX_ITEMS_PER_FILE);
      const lines = truncated.map(i => {
        const ctx = i.context ? ` (${i.context})` : '';
        const fp = i.fingerprint ? ` [原文: ${i.fingerprint.slice(0, 60)}]` : '';
        return `- ${i.content}${ctx}${fp}`;
      }).join('\n');
      const more = fileItems.length > MAX_ITEMS_PER_FILE
        ? `\n(另有 ${fileItems.length - MAX_ITEMS_PER_FILE} 条已省略)`
        : '';
      return `### 文件：${fileName}\n${lines}${more}`;
    }).join('\n\n');

    const dimensionDesc = CONSISTENCY_DIMENSIONS[dimensionCode] || '';

    const userPrompt = `## 当前审查维度
${dimensionCode} ${dimensionDesc}

## 各文件的${dimensionLabel}清单
${fileBlocks}

请按 ${dimensionCode} 维度检查以上跨文件数据的一致性问题，输出 JSON 数组。`;

    const raw = await LlmService.chat(userPrompt, {
      systemPrompt,
      maxTokens: 2048,
      timeout: 90,
    });

    return this.parseCrossCompareResult(raw, dimensionCode);
  }

  /**
   * 解析跨文件比对 LLM 返回的 JSON
   */
  private static parseCrossCompareResult(
    raw: string,
    expectedCode: string,
  ): CrossFileIssueRaw[] {
    try {
      let jsonStr = raw.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      const arrMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!arrMatch) {
        console.warn(`[CrossConsist] ${expectedCode} 比对结果未找到 JSON 数组:`, raw.slice(0, 200));
        return [];
      }

      const parsed: any[] = JSON.parse(arrMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: any) => ({
        ruleCode: String(item.ruleCode || expectedCode).toUpperCase(),
        originalText: String(item.originalText || '').trim(),
        suggestedText: item.suggestedText ? String(item.suggestedText) : undefined,
        description: item.description ? String(item.description) : undefined,
        fileNames: Array.isArray(item.fileNames) ? item.fileNames.map(String) : undefined,
        severity: (item.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning',
      })).filter(issue => issue.originalText);
    } catch (e) {
      console.warn('[CrossConsist] 跨文件比对 JSON 解析失败:', e);
      return [];
    }
  }

  /**
   * 根据 originalText 找到来源文件
   * 优先匹配 fingerprint 包含 originalText 的文件；其次匹配原文包含 originalText 的文件；兜底返回第一个文件
   */
  private static findIssueSourceFile(
    originalText: string,
    extractions: FileDimensionSummary[],
  ): FileDimensionSummary {
    if (extractions.length === 0) {
      // 理论不可达（外层已校验 >=2），保险
      throw new Error('[CrossConsist] findIssueSourceFile: extractions 为空');
    }
    // 优先：fingerprint 包含 originalText
    for (const ext of extractions) {
      const allItems = [...ext.params, ...ext.codes, ...ext.refs, ...ext.meta, ...ext.facts];
      for (const item of allItems) {
        if (item.fingerprint && item.fingerprint.includes(originalText)) {
          return ext;
        }
      }
    }
    // 其次：原文包含 originalText
    for (const ext of extractions) {
      if (ext.text.includes(originalText)) {
        return ext;
      }
    }
    // 兜底：第一个文件
    return extractions[0];
  }

  /**
   * P2-11b：解析 issue 归属文件，优先采用 LLM 返回的 fileNames 归因
   *
   * 规则：
   *   1. 有 fileNames：先用文件名过滤排序候选文件（精确匹配优先、包含匹配兜底），
   *      再在候选内做 fingerprint/原文定位；多候选命中时返回全部命中文件（每个写一条 TaskDetail）；
   *      候选均未命中时兜底 findIssueSourceFile。
   *   2. 无 fileNames：完全退化为原启发式（单文件），兼容旧行为。
   */
  private static resolveIssueSourceFiles(
    issue: CrossFileIssueRaw,
    fileExtractions: FileDimensionSummary[],
  ): FileDimensionSummary[] {
    const namedCandidates = issue.fileNames && issue.fileNames.length > 0
      ? orderCandidatesByFileNames(issue.fileNames, fileExtractions)
      : [];

    if (namedCandidates.length === 0) {
      return [this.findIssueSourceFile(issue.originalText, fileExtractions)];
    }

    const hitFiles = this.findIssueSourceFilesInCandidates(issue.originalText, namedCandidates);
    if (hitFiles.length > 0) {
      return hitFiles;
    }
    // fileNames 指定的候选文件中均未定位到原文 → 兜底原启发式
    return [this.findIssueSourceFile(issue.originalText, fileExtractions)];
  }

  /**
   * P2-11b：在候选文件中定位 issue 的归属文件
   * 匹配口径与 findIssueSourceFile 一致（fingerprint 包含 → 原文包含），
   * 但返回全部命中的候选文件（供多文件各写一条 TaskDetail），而非第一个命中。
   */
  private static findIssueSourceFilesInCandidates(
    originalText: string,
    candidates: FileDimensionSummary[],
  ): FileDimensionSummary[] {
    const hit: FileDimensionSummary[] = [];
    for (const ext of candidates) {
      const allItems = [...ext.params, ...ext.codes, ...ext.refs, ...ext.meta, ...ext.facts];
      const inFingerprint = allItems.some(
        (item) => !!item.fingerprint && item.fingerprint.includes(originalText),
      );
      const inText = !!originalText && ext.text.includes(originalText);
      if (inFingerprint || inText) {
        hit.push(ext);
      }
    }
    return hit;
  }

  /**
   * 在来源文件原文中精确定位 originalText 的位置
   * 返回 { position, endPosition, confidence }
   */
  private static locateIssueInFile(
    originalText: string,
    sourceFile: FileDimensionSummary,
  ): { position: number; endPosition: number; confidence: 'exact' | 'normalized' | 'fallback' } {
    if (!originalText) {
      return { position: 0, endPosition: 0, confidence: 'fallback' };
    }

    // Level 1: 精确匹配
    const exactIdx = sourceFile.text.indexOf(originalText);
    if (exactIdx >= 0) {
      return {
        position: exactIdx,
        endPosition: exactIdx + originalText.length,
        confidence: 'exact',
      };
    }

    // Level 2: 去空格后匹配
    const compactSearch = originalText.replace(/\s+/g, '');
    if (compactSearch.length >= 3) {
      const compactText = sourceFile.text.replace(/\s+/g, '');
      const compactIdx = compactText.indexOf(compactSearch);
      if (compactIdx >= 0) {
        // 反向映射：compactIdx → 原文位置（粗略）
        let charCount = 0;
        let origIdx = 0;
        for (let i = 0; i < sourceFile.text.length && charCount < compactIdx; i++) {
          if (!/\s/.test(sourceFile.text[i])) charCount++;
          origIdx = i + 1;
        }
        return {
          position: origIdx,
          endPosition: Math.min(origIdx + originalText.length + 20, sourceFile.text.length),
          confidence: 'normalized',
        };
      }
    }

    // 兜底：取该文件首个条目的位置
    const firstItem = sourceFile.params[0] || sourceFile.codes[0] || sourceFile.refs[0]
      || sourceFile.meta[0] || sourceFile.facts[0];
    if (firstItem) {
      return {
        position: firstItem.position,
        endPosition: firstItem.endPosition,
        confidence: 'fallback',
      };
    }
    return { position: 0, endPosition: Math.min(originalText.length, sourceFile.text.length), confidence: 'fallback' };
  }

  /**
   * 跨文件比对的兜底系统提示词（registry 不可达时使用）
   */
  private static fallbackCrossCompareSystem(): string {
    return `你是跨文件一致性审查专家。按用户指定的单一维度检查多个文件间的一致性问题。
严格按照 JSON 数组格式输出，每个问题包含: issueType, ruleCode, originalText, suggestedText, description, fileNames, severity。
如果未发现不一致，输出空数组 []。只输出 JSON，不要解释。`;
  }

  /**
   * 提取文件文本（统一管道：含 OCR 降级）
   */
  private static async extractText(file: { fileName: string; filePath: string; fileType: string }): Promise<string> {
    const absolutePath = resolveFilePath(file.filePath);
    return TextExtractionService.extractFileText(absolutePath, file.fileType, file.fileName);
  }

  /**
   * 参数抽取：从文本中抽取"参数名=参数值"对
   * 匹配模式：
   *   - 参数名[：:=]参数值，如 "设计温度：350°C"
   *   - 参数名[：:=]\s*参数值，如 "设计压力=17.5MPa"
   */
  static extractParameters(text: string): ParamEntry[] {
    const params: ParamEntry[] = [];
    if (!text) return params;

    // 主匹配模式：参数名 + 分隔符 + 参数值
    // 参数名：2~20个中文字符或字母数字组合
    // 分隔符：冒号（中英文）或等号
    // 参数值：非空白字符开头的值，包含数字、单位、特殊字符
    const paramPattern = /([^\s\n\r：:=]{2,20})\s*[：:=]\s*([^\s\n\r,，。；;]{1,50})/g;

    let match: RegExpExecArray | null;
    while ((match = paramPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const value = match[2].trim();

      // 过滤：参数名应包含至少一个中文字符或为常见技术术语
      if (!this.isValidParamName(name)) continue;

      // 过滤：参数值应包含数字或可度量的值
      if (!this.isValidParamValue(value)) continue;

      // 规范化参数名（去空格、统一大小写）
      const normalizedName = this.normalizeParamName(name);
      const normalizedValue = this.normalizeParamValue(value);

      // 提取匹配位置前后各 40 字符作为上下文（用于精确定位）
      const ctxStart = Math.max(0, match.index - 40);
      const ctxEnd = Math.min(text.length, match.index + match[0].length + 40);
      const context = text.substring(ctxStart, ctxEnd).replace(/\n/g, ' ').trim();

      params.push({
        paramName: normalizedName,
        value: normalizedValue,
        position: match.index,
        endPosition: match.index + match[0].length,
        context,
      });
    }

    // 保留同一文件中同名参数的所有出现（含位置与上下文），
    // 用于检测文件内不一致（如第3章写10MPa、第7章写12MPa）
    return params;
  }

  /**
   * 构建参数索引：按参数名分组
   */
  static buildParamIndex(
    allParams: Array<{ fileId: string; fileName: string; params: ParamEntry[] }>,
  ): Map<string, ParamIndexEntry[]> {
    const index = new Map<string, ParamIndexEntry[]>();

    for (const fileParams of allParams) {
      for (const param of fileParams.params) {
        const key = param.paramName;
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key)!.push({
          fileName: fileParams.fileName,
          fileId: fileParams.fileId,
          value: param.value,
          position: param.position,
          endPosition: param.endPosition,
          context: param.context,
        });
      }
    }

    return index;
  }

  /**
   * 一致性比对：检测同名参数的取值不一致
   * 两种情形均报告：
   *   1. 文件内不一致：同一文件内同名参数出现多个不同值
   *   2. 跨文件不一致：不同文件间同名参数取值不同
   */
  static findInconsistencies(
    paramIndex: Map<string, ParamIndexEntry[]>,
    paramTolerance?: ParamToleranceConfig,
  ): InconsistencyPair[] {
    const results: InconsistencyPair[] = [];

    for (const [paramName, entries] of paramIndex) {
      const fileIds = new Set(entries.map((e) => e.fileId));

      // 按文件分组，用于检测文件内不一致
      const fileGroups = new Map<string, ParamIndexEntry[]>();
      for (const entry of entries) {
        if (!fileGroups.has(entry.fileId)) {
          fileGroups.set(entry.fileId, []);
        }
        fileGroups.get(entry.fileId)!.push(entry);
      }

      // 1. 文件内不一致：任一文件中同名参数存在 2 个以上不同值
      let hasIntraFileInconsistency = false;
      for (const fileEntries of fileGroups.values()) {
        if (fileEntries.length >= 2) {
          const distinctInFile = this.getDistinctValues(fileEntries, paramTolerance);
          if (distinctInFile.length >= 2) {
            hasIntraFileInconsistency = true;
            break;
          }
        }
      }

      // 2. 跨文件不一致：出现在 2 个以上文件且整体存在 2 个以上不同值
      let hasCrossFileInconsistency = false;
      if (fileIds.size >= 2) {
        const distinctValues = this.getDistinctValues(entries, paramTolerance);
        if (distinctValues.length >= 2) {
          hasCrossFileInconsistency = true;
        }
      }

      if (hasIntraFileInconsistency || hasCrossFileInconsistency) {
        // 跨文件不一致优先标记为 cross-file（更普遍），否则为 intra-file
        const kind: 'intra-file' | 'cross-file' = hasCrossFileInconsistency ? 'cross-file' : 'intra-file';
        results.push({ paramName, entries, kind });
      }
    }

    return results;
  }

  /**
   * 获取去重后的不同值列表
   * 忽略大小写差异、忽略数值差异<1%的、智能合并同义单位
   */
  private static getDistinctValues(
    entries: ParamIndexEntry[],
    paramTolerance?: ParamToleranceConfig,
  ): string[] {
    const normalizedValues: Array<{ original: string; numeric: number | null; unit: string }> = [];

    for (const entry of entries) {
      const parsed = this.parseNumericValue(entry.value);
      normalizedValues.push(parsed);
    }

    // 两两比较
    const distinct: string[] = [];
    const matched = new Set<number>();

    for (let i = 0; i < normalizedValues.length; i++) {
      if (matched.has(i)) continue;

      let isDuplicate = false;
      for (let j = 0; j < i; j++) {
        if (matched.has(j)) continue;

        if (this.valuesAreEqual(normalizedValues[i], normalizedValues[j], paramTolerance)) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        distinct.push(normalizedValues[i].original);
      } else {
        matched.add(i);
      }
    }

    return distinct;
  }

  /**
   * 判断两个值是否"相等"
   * - 忽略大小写
   * - 忽略纯数值差异<1%
   * - 智能合并同义单位（如 °C 和 度）
   */
  private static valuesAreEqual(
    a: { original: string; numeric: number | null; unit: string },
    b: { original: string; numeric: number | null; unit: string },
    paramTolerance?: ParamToleranceConfig,
  ): boolean {
    // 完全相同（忽略大小写和前后空格）
    if (a.original.trim().toLowerCase() === b.original.trim().toLowerCase()) {
      return true;
    }

    // 如果两个都能解析为数值，比较数值
    if (a.numeric !== null && b.numeric !== null) {
      // 先尝试单位统一
      const aInBase = this.convertToBaseUnit(a.numeric, a.unit);
      const bInBase = this.convertToBaseUnit(b.numeric, b.unit);

      if (aInBase !== null && bInBase !== null) {
        const diff = Math.abs(aInBase - bInBase);
        const avg = (Math.abs(aInBase) + Math.abs(bInBase)) / 2;
        // 按单位选择容差（默认 1%）
        const tol = getToleranceForUnit(a.unit, paramTolerance);
        if (avg > 0 && diff / avg < tol) {
          return true;
        }
        // 零值特殊处理
        if (aInBase === 0 && bInBase === 0) {
          return true;
        }
      }

      // 直接数值比较（无单位转换时）
      const diff = Math.abs(a.numeric - b.numeric);
      const avg = (Math.abs(a.numeric) + Math.abs(b.numeric)) / 2;
      const tol = getToleranceForUnit(a.unit, paramTolerance);
      if (avg > 0 && diff / avg < tol) {
        return true;
      }
    }

    return false;
  }

  /**
   * 解析数值+单位
   * 如 "350°C" → { numeric: 350, unit: "°C" }
   * 如 "17.5MPa" → { numeric: 17.5, unit: "MPa" }
   */
  private static parseNumericValue(value: string): { original: string; numeric: number | null; unit: string } {
    const match = value.match(/^([+-]?\d+\.?\d*)\s*(.*)$/);
    if (match) {
      const numeric = parseFloat(match[1]);
      const unit = match[2].trim();
      return { original: value, numeric: isNaN(numeric) ? null : numeric, unit };
    }
    return { original: value, numeric: null, unit: '' };
  }

  /**
   * 尝试将带单位的值转换为基准单位
   * 目前支持温度和压力的常见单位换算
   */
  private static convertToBaseUnit(value: number, unit: string): number | null {
    const normalizedUnit = unit.toLowerCase().replace(/\s/g, '');

    // 温度：都以 °C 为基准
    if (['°c', '℃', '度', 'oc'].includes(normalizedUnit)) {
      return value; // 已经是摄氏度
    }
    if (['°f', '℉', 'of'].includes(normalizedUnit)) {
      return (value - 32) * 5 / 9; // 华氏度转摄氏度
    }
    if (normalizedUnit === 'k') {
      return value - 273.15; // 开尔文转摄氏度
    }

    // 压力：都以 MPa 为基准
    if (['mpa', '兆帕'].includes(normalizedUnit)) {
      return value;
    }
    if (['kpa', '千帕'].includes(normalizedUnit)) {
      return value / 1000;
    }
    if (['pa', '帕'].includes(normalizedUnit)) {
      return value / 1000000;
    }
    if (normalizedUnit === 'bar') {
      return value * 0.1;
    }
    if (['atm', '标准大气压'].includes(normalizedUnit)) {
      return value * 0.101325;
    }

    // 无单位或未知单位，不做转换
    return null;
  }


  /**
   * 判断是否为有效的参数名
   * 至少包含一个中文字符，或者为常见英文技术术语
   */
  private static isValidParamName(name: string): boolean {
    // 包含中文
    if (/[\u4e00-\u9fa5]/.test(name)) return true;

    // 常见英文技术参数缩写
    const commonEnglishParams = /^(temp|pressure|flow|rate|speed|power|voltage|current|freq|width|height|depth|length|diameter|thickness|weight|density|volume|area|capacity|load|torque|rpm|ph|humidity|voltage|resistance)$/i;
    if (commonEnglishParams.test(name)) return true;

    return false;
  }

  /**
   * 判断是否为有效的参数值
   * 应包含数字或可度量的值
   */
  private static isValidParamValue(value: string): boolean {
    // 包含数字
    if (/\d/.test(value)) return true;
    // 包含常见单位标识
    if (/[°℃℉MPaPaKkWVAmAmmcmsmgkNt]/i.test(value)) return true;
    return false;
  }

  /**
   * 规范化参数名
   */
  private static normalizeParamName(name: string): string {
    return name
      .replace(/\s+/g, '') // 去空格
      .toLowerCase();
  }

  /**
   * 规范化参数值
   */
  private static normalizeParamValue(value: string): string {
    return value
      .trim()
      // 统一全角数字和符号为半角
      .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2').replace(/３/g, '3')
      .replace(/４/g, '4').replace(/５/g, '5').replace(/６/g, '6').replace(/７/g, '7')
      .replace(/８/g, '8').replace(/９/g, '9')
      .replace(/℃/g, '°C')
      .replace(/℉/g, '°F');
  }

  /**
   * 更新文件的错误计数
   */
  private static async updateFileErrorCount(fileId: string): Promise<void> {
    const count = await prisma.taskDetail.count({
      where: {
        fileId,
        ruleCode: { not: 'NO_RESULT' },
      },
    });
    await prisma.taskFile.update({
      where: { id: fileId },
      data: { errorCount: count },
    });
  }
}
