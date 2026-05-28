/**
 * 知识子库管理服务
 */

import prisma from '../config/db';
import { VectorService } from './vector.service';
import path from 'path';
import { TextExtractionService } from './review-pipeline/text-extraction.service';
import { LlmService } from './llm.service';
import { AppError } from '../middlewares/error.middleware';
import { FileTypeService } from './file-type.service';

interface KnowledgeTreeNode {
  id: string;
  name: string;
  isLeaf: boolean;
  type: 'folder' | 'knowledge';
  documentCount?: number;
  parentId?: string | null;
  children?: KnowledgeTreeNode[];
}

interface ParseQualityReport {
  passed: boolean;
  score: number;
  reasons: string[];
  metrics: {
    textLength: number;
    visibleCharRatio: number;
    duplicateLineRatio: number;
    headingDensity: number;
    tableSeparatorRatio: number;
    mojibakeRatio: number;
  };
}

export class KnowledgeCategoryService {

  private static buildParseQualityReport(content: string): ParseQualityReport {
    const raw = String(content || '');
    const lines = raw.split(/\r?\n/);
    const nonEmptyLines = lines.map(l => l.trim()).filter(Boolean);
    const textLength = raw.trim().length;

    const visibleChars = (raw.match(/[\u4e00-\u9fa5A-Za-z0-9]/g) || []).length;
    const visibleCharRatio = textLength > 0 ? visibleChars / textLength : 0;

    const lineCountMap = new Map<string, number>();
    for (const line of nonEmptyLines) {
      lineCountMap.set(line, (lineCountMap.get(line) || 0) + 1);
    }
    const duplicateLineCount = [...lineCountMap.values()].filter(v => v > 1).reduce((a, b) => a + b, 0);
    const duplicateLineRatio = nonEmptyLines.length > 0 ? duplicateLineCount / nonEmptyLines.length : 0;

    const headingCount = nonEmptyLines.filter(l => /^#{1,6}\s+/.test(l) || /^第[一二三四五六七八九十百千\d]+[章节条款]/.test(l)).length;
    const headingDensity = nonEmptyLines.length > 0 ? headingCount / nonEmptyLines.length : 0;

    const tableSepCount = nonEmptyLines.filter(l => /^\|[\s\-:|]+\|$/.test(l)).length;
    const tableSeparatorRatio = nonEmptyLines.length > 0 ? tableSepCount / nonEmptyLines.length : 0;

    const mojibakeCount = (raw.match(/�|Ã|Ð|Ñ|Ø|�/g) || []).length;
    const mojibakeRatio = textLength > 0 ? mojibakeCount / textLength : 0;

    const reasons: string[] = [];
    if (textLength < 80) reasons.push('文本长度过短，疑似解析失败');
    if (visibleCharRatio < 0.25) reasons.push('可见字符比例过低，疑似错列或噪声文本');
    if (duplicateLineRatio > 0.45) reasons.push('重复行比例过高，疑似分页/抽取异常');
    if (headingDensity > 0.5) reasons.push('标题密度异常，疑似标题树解析异常');
    if (tableSeparatorRatio > 0.35) reasons.push('表格分隔行比例异常，疑似表格抽取异常');
    if (mojibakeRatio > 0.02) reasons.push('疑似乱码字符占比过高');

    const penalties = [
      textLength < 80 ? 30 : 0,
      visibleCharRatio < 0.25 ? 20 : 0,
      duplicateLineRatio > 0.45 ? 15 : 0,
      headingDensity > 0.5 ? 15 : 0,
      tableSeparatorRatio > 0.35 ? 10 : 0,
      mojibakeRatio > 0.02 ? 20 : 0,
    ].reduce((a, b) => a + b, 0);

    const score = Math.max(0, 100 - penalties);

    return {
      passed: reasons.length === 0,
      score,
      reasons,
      metrics: {
        textLength,
        visibleCharRatio,
        duplicateLineRatio,
        headingDensity,
        tableSeparatorRatio,
        mojibakeRatio,
      },
    };
  }

  private static async getCategoryById(id: string) {
    return prisma.knowledgeCategory.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            documents: true,
            vectorDocuments: true,
            children: true,
          },
        },
      },
    });
  }

  private static buildCategoryTree(categories: any[]) {
    const map = new Map<string, any>();
    const roots: any[] = [];

    categories.forEach((cat) => {
      map.set(cat.id, { ...cat, children: [] });
    });

    map.forEach((node) => {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  private static async assertParentAcceptsChildren(parentId: string, currentId?: string) {
    const parent = await this.getCategoryById(parentId);
    if (!parent) throw new AppError(404, '父级节点不存在');

    if (currentId && parent.id === currentId) {
      throw new AppError(409, '不能将节点设为自己的子节点');
    }

    return parent;
  }

  static async ensureLeafCategory(categoryId: string) {
    const category = await this.getCategoryById(categoryId);
    if (!category) throw new AppError(404, '知识子库不存在');
    if (!category.isLeaf) {
      throw new AppError(409, '仅叶子知识库允许挂载文档');
    }
    return category;
  }

  static async list() {
    const categories = await prisma.knowledgeCategory.findMany({
      include: {
        _count: { select: { documents: true } },
      },
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });

    const result = categories.map(cat => ({
      ...cat,
    }));

    return this.buildCategoryTree(result);
  }

  static async listAll() {
    const categories = await prisma.knowledgeCategory.findMany({
      include: { _count: { select: { documents: true, children: true } } },
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });

    return categories.filter(cat => cat._count.children === 0);
  }

  static async create(data: {
    name: string;
    description?: string;
    parentId?: string;
    isLeaf?: boolean;
  }) {
    if (data.parentId) {
      await this.assertParentAcceptsChildren(data.parentId);
    }

    const newCategory = await prisma.knowledgeCategory.create({
      data: {
        name: data.name,
        description: data.description,
        parentId: data.parentId || null,
        isLeaf: data.isLeaf ?? false,
      },
    });

    // 有子节点时，父节点标记为非叶子
    if (data.parentId) {
      await prisma.knowledgeCategory.update({
        where: { id: data.parentId },
        data: { isLeaf: false },
      });
    }

    return newCategory;
  }

  static async update(id: string, data: {
    name?: string;
    description?: string;
    status?: 'ACTIVE' | 'ARCHIVED';
    chunkMode?: string;
    maxChars?: number;
    overlap?: number;
    parentId?: string | null;
    isLeaf?: boolean;
  }) {
    const existing = await prisma.knowledgeCategory.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, '知识子库不存在');

    if (data.parentId !== undefined) {
      if (data.parentId) {
        let current = await this.assertParentAcceptsChildren(data.parentId, id);
        while (current.parentId) {
          current = await this.assertParentAcceptsChildren(current.parentId, id);
        }
      }
    }

    return prisma.knowledgeCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.chunkMode !== undefined && { chunkMode: data.chunkMode }),
        ...(data.maxChars !== undefined && { maxChars: data.maxChars }),
        ...(data.overlap !== undefined && { overlap: data.overlap }),
        ...(data.parentId !== undefined && { parentId: data.parentId || null }),
        ...(data.isLeaf !== undefined && { isLeaf: data.isLeaf }),
      },
    });
  }

  static async delete(id: string) {
    const existing = await this.getCategoryById(id);
    if (!existing) throw new AppError(404, '知识子库不存在');
    if (existing._count.children > 0) {
      throw new AppError(409, '该节点下还有子节点，无法删除');
    }
    if (existing._count.documents > 0) {
      throw new AppError(409, '该节点下还有文档，无法删除');
    }

    await prisma.knowledgeCategory.delete({ where: { id } });

    // 如果父节点不再有子节点，恢复为叶子节点
    if (existing.parentId) {
      const siblingCount = await prisma.knowledgeCategory.count({
        where: { parentId: existing.parentId },
      });
      if (siblingCount === 0) {
        await prisma.knowledgeCategory.update({
          where: { id: existing.parentId },
          data: { isLeaf: true },
        });
      }
    }
  }

  /**
   * 预览文档分段：解析文件 → 分块，返回预览结果但不入库
   * 返回 MaxKB 格式的 {title, content} 段落数组
   */
  static async previewDocument(
    categoryId: string,
    filePath: string,
    fileName: string,
    userConfig?: {
      chunkMode?: string;
      maxChars?: number;
      overlap?: number;
      embeddingUseDocumentTitle?: boolean;
      contextualRetrieval?: boolean;
    },
  ): Promise<{
    title: string;
    chunks: Array<{ title: string; content: string }>;
    metadata: Record<string, any>;
    parseQuality: ParseQualityReport;
    canImport: boolean;
  }> {
    const category = await this.ensureLeafCategory(categoryId);

    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const fileType = FileTypeService.getStandardizedType(ext);

    const text = await TextExtractionService.extractFileText(filePath, fileType, fileName);
    const content = text;

    if (!content || content.trim().length < 10) {
      throw new Error('文件内容过少或解析失败');
    }

    const parseQuality = this.buildParseQualityReport(content);
    const title = fileName.replace(/\.\w+$/, '');

    // 使用前端传入的配置覆盖DB默认值
    const effectiveMode = (userConfig?.chunkMode as 'auto' | 'fixed' | 'paragraph') ||
      (category.chunkMode as 'auto' | 'fixed' | 'paragraph') || 'auto';
    const effectiveMaxChars = userConfig?.maxChars ?? category.maxChars ?? 900;
    const effectiveOverlap = userConfig?.overlap ?? category.overlap ?? 120;

    // 根据模式选择不同的分段策略
    let paragraphs: Array<{ title: string; content: string }>;
    if (effectiveMode === 'fixed') {
      const chunks = VectorService.splitTextIntoChunks(content, { mode: 'fixed', maxChars: effectiveMaxChars, overlap: effectiveOverlap });
      paragraphs = chunks.map(chunk => ({ title: '', content: chunk.trim() })).filter(p => p.content.length > 0);
    } else if (effectiveMode === 'paragraph') {
      const rawParagraphs = VectorService.splitTextIntoChunks(content, { mode: 'paragraph', maxChars: effectiveMaxChars, overlap: effectiveOverlap });
      paragraphs = rawParagraphs.map(p => ({ title: '', content: p }))
        .filter(p => p.content.length > 0);
    } else {
      const parsed = VectorService.splitMarkdownIntoParagraphs(content, effectiveMaxChars);
      paragraphs = (parsed as Array<{title: string; content: string}>).map(paragraph => ({
        title: paragraph.title,
        content: paragraph.content,
      })).filter(p => p.content.length > 0);
    }

    return {
      title,
      chunks: paragraphs,
      parseQuality,
      canImport: parseQuality.passed,
      metadata: {
        original_file: fileName,
        has_tables: false,
        has_images: false,
        page_count: null,
        chunkConfigUsed: {
          mode: effectiveMode,
          maxChars: effectiveMaxChars,
          overlap: effectiveOverlap,
          contextualRetrieval: userConfig?.contextualRetrieval ?? category.contextualRetrieval,
        },
        parseQuality,
      },
    };
  }

  /**
   * 上传文档到知识子库：解析文件 → 分块 → 向量化入库
   * 优先使用Markdown格式保留表格结构
   */
  static async uploadDocument(categoryId: string, filePath: string, fileName: string): Promise<{ chunks: number }> {
    const category = await this.ensureLeafCategory(categoryId);

    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const fileType = ext === 'doc' ? 'docx' : ext;

    console.info('[KB][uploadDocument] start', { categoryId, fileName, fileType, filePath });

    // 解析文件内容（统一管道：含 OCR 降级）
    const content = await TextExtractionService.extractFileText(filePath, fileType, fileName);

    console.info('[KB][uploadDocument] parsed', {
      categoryId,
      fileName,
      contentLength: content.length,
    });

    if (!content || content.trim().length < 10) {
      throw new Error('文件内容过少或解析失败');
    }

    const parseQuality = this.buildParseQualityReport(content);
    console.info('[KB][uploadDocument] quality', { categoryId, fileName, score: parseQuality.score, passed: parseQuality.passed, reasons: parseQuality.reasons });
    if (!parseQuality.passed) {
      throw new AppError(400, `解析质量未通过：${parseQuality.reasons.join('；')}`);
    }

    // 导入向量库
    const result = await VectorService.importDocument({
      sourceType: 'standard',
      title: fileName.replace(/\.\w+$/, ''),
      content,
      categoryId,
      chunkConfig: {
        mode: category.chunkMode as any,
        maxChars: category.maxChars,
        overlap: category.overlap,
        contextualRetrieval: category.contextualRetrieval,
      },
      embeddingUseDocumentTitle: category.embeddingUseDocumentTitle,
      embeddingUseClauseId: category.embeddingUseClauseId,
      metadata: {
        original_file: fileName,
        has_tables: false,
        has_images: false,
        page_count: null,
      },
    });

    console.info('[KB][uploadDocument] imported', { categoryId, fileName, chunks: result.chunks });

    // 同步创建 Document 记录（确保 Document ↔ VectorDocument 数据一致）
    const docTitle = fileName.replace(/\.\w+$/, '');
    await prisma.document.upsert({
      where: { categoryId_title: { categoryId, title: docTitle } },
      update: {
        totalChunks: result.chunks,
        totalChars: content.length,
        isVectorized: true,
        vectorStatus: 'SUCCESS',
      },
      create: {
        categoryId,
        title: docTitle,
        sourceType: 'standard',
        status: 'ACTIVE',
        totalChunks: result.chunks,
        totalChars: content.length,
        isVectorized: true,
        vectorStatus: 'SUCCESS',
      },
    });

    return { chunks: result.chunks };
  }

  /**
   * 为文档的每个段落自动生成问题，存入 metadata.generatedQuestions
   */
  static async generateDocumentQuestions(categoryId: string, title: string): Promise<{
    totalChunks: number;
    generatedCount: number;
  }> {
    const paragraphs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, content, metadata
       FROM vector_documents
       WHERE "categoryId" = $1 AND COALESCE(metadata->>'original_file', title) = $2
       ORDER BY chunk_index ASC`,
      categoryId, title
    );

    if (paragraphs.length === 0) throw new Error('文档不存在或无段落数据');

    let generatedCount = 0;

    for (const para of paragraphs) {
      try {
        // 跳过已有生成问题的段落
        const meta = (para.metadata as Record<string, any>) || {};
        if (meta.generatedQuestions?.length > 0) continue;

        // 跳过过短的段落
        if (para.content.length < 50) continue;

        const questions = await LlmService.generateQuestions(para.content, { maxTokens: 512, timeout: 30 });

        if (questions.length > 0) {
          await prisma.vectorDocument.update({
            where: { id: para.id },
            data: {
              metadata: { ...meta, generatedQuestions: questions },
            },
          });
          generatedCount++;
        }

        // 简单限流：避免 LLM API 过载
        if (paragraphs.indexOf(para) < paragraphs.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (err: any) {
        console.warn(`[KB] 段落 ${para.id} 问题生成失败:`, err.message);
      }
    }

    return { totalChunks: paragraphs.length, generatedCount };
  }

  static async getKnowledgeTree(): Promise<KnowledgeTreeNode[]> {
    const categories = await prisma.knowledgeCategory.findMany({
      where: { status: 'ACTIVE' },
      include: { _count: { select: { documents: true } } },
      orderBy: { name: 'asc' },
    });

    const map = new Map<string, KnowledgeTreeNode>();
    const roots: KnowledgeTreeNode[] = [];

    for (const cat of categories) {
      map.set(cat.id, {
        id: cat.id,
        name: cat.name,
        parentId: cat.parentId,
        isLeaf: cat.isLeaf,
        type: cat.isLeaf ? 'knowledge' : 'folder',
        documentCount: cat._count.documents,
        children: [],
      });
    }

    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        const parent = map.get(node.parentId)!;
        parent.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    const normalize = (node: KnowledgeTreeNode): KnowledgeTreeNode => {
      const children = (node.children || []).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      if (children.length === 0) {
        return {
          id: node.id,
          name: node.name,
          parentId: node.parentId,
          isLeaf: node.isLeaf,
          type: node.isLeaf ? 'knowledge' : 'folder',
          documentCount: node.documentCount,
        };
      }
      return {
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        isLeaf: node.isLeaf,
        type: node.isLeaf ? 'knowledge' : 'folder',
        documentCount: node.documentCount,
        children: children.map(normalize),
      };
    };

    return roots
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .map(normalize);
  }
}
