/**
 * 知识子库管理服务
 */

import prisma from '../config/db';
import { VectorService } from './vector.service';
import path from 'path';
import { ParserService } from './parser.service';
import { LlmService } from './llm.service';

export class KnowledgeCategoryService {

  static async list() {
    return prisma.knowledgeCategory.findMany({
      include: {
        _count: { select: { vectorDocuments: true } },
        children: {
          include: { _count: { select: { vectorDocuments: true } } },
          orderBy: { name: 'asc' },
        },
      },
      where: { parentId: null },
      orderBy: { name: 'asc' },
    });
  }

  static async listAll() {
    return prisma.knowledgeCategory.findMany({
      include: { _count: { select: { vectorDocuments: true } } },
      orderBy: { name: 'asc' },
    });
  }

  static async create(data: { name: string; description?: string; documentTypes?: string; parentId?: string }) {
    return prisma.knowledgeCategory.create({
      data: {
        name: data.name,
        description: data.description,
        documentTypes: data.documentTypes,
        parentId: data.parentId,
      },
    });
  }

  static async update(id: string, data: { name?: string; description?: string; documentTypes?: string; status?: 'ACTIVE' | 'ARCHIVED' }) {
    return prisma.knowledgeCategory.update({ where: { id }, data });
  }

  static async delete(id: string) {
    // 先删除该分类下的所有向量文档
    await VectorService.deleteDocuments({ categoryId: id });
    return prisma.knowledgeCategory.delete({ where: { id } });
  }

  /**
   * 预览文档分段：解析文件 → 分块，返回预览结果但不入库
   * 返回 MaxKB 格式的 {title, content} 段落数组
   */
  static async previewDocument(categoryId: string, filePath: string, fileName: string): Promise<{
    title: string;
    chunks: Array<{ title: string; content: string }>;
    metadata: Record<string, any>;
  }> {
    const category = await prisma.knowledgeCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new Error('知识子库不存在');

    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const fileType = ext === 'doc' ? 'docx' : ext;

    await ParserService.parseFile(filePath, fileType);
    const markdown = ParserService.getLastMarkdown();
    const text = ParserService.getLastParseResult()?.text || '';
    const content = (markdown && markdown.trim().length > 10) ? markdown : text;

    if (!content || content.trim().length < 10) {
      throw new Error('文件内容过少或解析失败');
    }

    const parseResult = ParserService.getLastParseResult();
    const title = fileName.replace(/\.\w+$/, '');

    // 使用 SplitModel 按标题层级分块
    const paragraphs = VectorService.splitMarkdownIntoParagraphs(content, category.maxChars || 3000);

    return {
      title,
      chunks: paragraphs.map(p => ({ title: p.title, content: p.content })),
      metadata: {
        original_file: fileName,
        has_tables: parseResult?.metadata?.has_tables || false,
        has_images: parseResult?.metadata?.has_images || false,
        page_count: parseResult?.metadata?.page_count || null,
      },
    };
  }

  /**
   * 上传文档到知识子库：解析文件 → 分块 → 向量化入库
   * 优先使用Markdown格式保留表格结构
   */
  static async uploadDocument(categoryId: string, filePath: string, fileName: string): Promise<{ chunks: number }> {
    const category = await prisma.knowledgeCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new Error('知识子库不存在');

    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const fileType = ext === 'doc' ? 'docx' : ext;

    // 解析文件内容
    await ParserService.parseFile(filePath, fileType);
    // 优先使用Markdown格式（保留表格结构），回退到纯文本
    const markdown = ParserService.getLastMarkdown();
    const text = ParserService.getLastParseResult()?.text || '';
    const content = (markdown && markdown.trim().length > 10) ? markdown : text;

    if (!content || content.trim().length < 10) {
      throw new Error('文件内容过少或解析失败');
    }

    const parseResult = ParserService.getLastParseResult();

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
      },
      metadata: {
        original_file: fileName,
        has_tables: parseResult?.metadata?.has_tables || false,
        has_images: parseResult?.metadata?.has_images || false,
        page_count: parseResult?.metadata?.page_count || null,
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
    const paragraphs = await prisma.vectorDocument.findMany({
      where: { categoryId, title },
      select: { id: true, content: true, metadata: true },
      orderBy: { chunkIndex: 'asc' },
    });

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
}
