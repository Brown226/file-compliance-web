import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { KnowledgeCategoryService } from '../services/knowledge-category.service';
import { VectorService } from '../services/vector.service';
import { RAGService } from '../services/rag.service';

import { SearchService } from '../services/search.service';
import { UploadTaskService } from '../services/upload-task.service';
import prisma from '../config/db';
import { success, error } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../middlewares/error.middleware';

const UPLOAD_DIR = path.join(__dirname, '../../uploads/knowledge');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** 获取知识子库列表 */
export const listCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await KnowledgeCategoryService.list();
    success(res, categories);
  } catch (err) {
    console.error('List KnowledgeCategories Error:', err);
    error(res, '获取知识子库列表失败', 500);
  }
};

/** 获取所有知识子库（扁平） */
export const listAllCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categories = await KnowledgeCategoryService.listAll();
    success(res, categories);
  } catch (err) {
    console.error('ListAll KnowledgeCategories Error:', err);
    error(res, '获取知识子库列表失败', 500);
  }
};

/** 创建知识子库 */
export const createCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, documentTypes, parentId } = req.body;
    if (!name?.trim()) { error(res, '名称不能为空', 400); return; }
    const category = await KnowledgeCategoryService.create({ name: name.trim(), description, documentTypes, parentId });
    success(res, category, '创建成功');
  } catch (err: any) {
    console.error('Create KnowledgeCategory Error:', err);
    error(res, err?.message || '创建失败', err instanceof AppError ? err.statusCode : 500);
  }
};

/** 更新知识子库 */
export const updateCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const category = await KnowledgeCategoryService.update(id, req.body);
    success(res, category, '更新成功');
  } catch (err: any) {
    console.error('Update KnowledgeCategory Error:', err);
    error(res, err?.message || '更新失败', err instanceof AppError ? err.statusCode : 500);
  }
};

/** 删除知识子库 */
export const deleteCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await KnowledgeCategoryService.delete(id);
    success(res, null, '删除成功');
  } catch (err: any) {
    console.error('Delete KnowledgeCategory Error:', err);
    error(res, err?.message || '删除失败', err instanceof AppError ? err.statusCode : 500);
  }
};

/** 上传文档到知识子库 */
export const uploadDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const file = req.file;
    if (!file) { error(res, '请选择文件', 400); return; }

    await KnowledgeCategoryService.ensureLeafCategory(id);

    // 解码中文文件名（Chrome 将非ASCII字符以latin1编码传输）
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // 移动到永久目录
    const ext = path.extname(originalName);
    const savedName = `${uuidv4()}${ext}`;
    const savedPath = path.join(UPLOAD_DIR, savedName);
    fs.renameSync(file.path, savedPath);

    const result = await KnowledgeCategoryService.uploadDocument(id, savedPath, originalName);
    success(res, result, `上传成功，已分块 ${result.chunks} 个向量片段`);
  } catch (err: any) {
    console.error('Upload Document Error:', err);
    error(res, err.message || '上传失败', err instanceof AppError ? err.statusCode : 500);
  }
};

// ==================== 异步上传 ====================

/** 异步上传文档 — 立即返回任务ID，后台处理 */
export const uploadDocumentAsync = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const files = req.files as Express.Multer.File[];
    if (!files?.length) { error(res, '请选择文件', 400); return; }

    await KnowledgeCategoryService.ensureLeafCategory(id);

    const taskIds: string[] = [];

    for (const file of files) {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(originalName);
      const savedName = `${uuidv4()}${ext}`;
      const savedPath = path.join(UPLOAD_DIR, savedName);
      fs.renameSync(file.path, savedPath);

      const taskId = UploadTaskService.createTask(originalName);
      taskIds.push(taskId);

      // 后台处理，不阻塞响应
      setImmediate(async () => {
        try {
          UploadTaskService.updateTask(taskId, { status: 'processing', progress: 30, message: '正在解析...' });
          const result = await KnowledgeCategoryService.uploadDocument(id, savedPath, originalName);
          UploadTaskService.updateTask(taskId, {
            status: 'completed',
            progress: 100,
            message: `完成，${result.chunks} 个分段`,
            chunks: result.chunks,
          });
        } catch (err: any) {
          UploadTaskService.updateTask(taskId, {
            status: 'failed',
            progress: 0,
            message: '处理失败',
            error: err.message,
          });
        }
      });
    }

    success(res, { taskIds }, '文件已接收，正在后台处理');
  } catch (err: any) {
    console.error('Upload Async Error:', err);
    error(res, err.message || '上传失败', err instanceof AppError ? err.statusCode : 500);
  }
};

/** 查询上传任务状态 */
export const getTaskStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskIds } = req.query;
    if (!taskIds) { error(res, '缺少任务ID', 400); return; }

    const ids = (taskIds as string).split(',');
    const statuses = ids.map(tid => UploadTaskService.getTask(tid)).filter(Boolean);
    success(res, statuses);
  } catch (err) {
    error(res, '查询任务状态失败', 500);
  }
};

/** 获取所有进行中的任务 */
export const getActiveTasks = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const activeTasks = UploadTaskService.getTasks().filter(t => t.status === 'pending' || t.status === 'processing');
    success(res, activeTasks);
  } catch (err) {
    error(res, '查询任务失败', 500);
  }
};

// ==================== 分段预览确认 ====================

/** 预览文档分段（不入库） — 上传后先查看分段结果 */
export const previewDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const file = req.file;
    if (!file) { error(res, '请选择文件', 400); return; }

    await KnowledgeCategoryService.ensureLeafCategory(id);

    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // 移动到临时目录
    const ext = path.extname(originalName);
    const savedName = `${uuidv4()}${ext}`;
    const savedPath = path.join(UPLOAD_DIR, savedName);
    fs.renameSync(file.path, savedPath);

    // 解析文件但不入库
    const preview = await KnowledgeCategoryService.previewDocument(id, savedPath, originalName);
    success(res, preview, `预览完成，共 ${preview.chunks.length} 个分段`);
  } catch (err: any) {
    console.error('Preview Document Error:', err);
    error(res, err.message || '预览失败', err instanceof AppError ? err.statusCode : 500);
  }
};

/** 确认导入 — 用户确认分段后批量入库（保留用户编辑的分段，不重新分块） */
export const confirmImport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { title, chunks, metadata } = req.body;

    if (!title?.trim()) { error(res, '文档标题不能为空', 400); return; }
    if (!chunks?.length) { error(res, '分段列表不能为空', 400); return; }

    const parseQuality = metadata?.parseQuality;
    if (parseQuality && parseQuality.passed === false) {
      const reasons = Array.isArray(parseQuality.reasons) ? parseQuality.reasons.join('；') : '解析质量未通过';
      error(res, `解析质量未通过：${reasons}`, 400);
      return;
    }

    await KnowledgeCategoryService.ensureLeafCategory(id);

    const category = await prisma.knowledgeCategory.findUnique({ where: { id } });
    const result = await VectorService.importChunks(chunks, {
      sourceType: 'standard',
      title: title.trim(),
      categoryId: id,
      embeddingUseDocumentTitle: category?.embeddingUseDocumentTitle ?? false,
      embeddingUseClauseId: category?.embeddingUseClauseId ?? false,
      metadata: metadata || {},
    });

    success(res, { chunks: result.chunks, deduped: result.deduped }, `导入成功，${result.chunks} 个分段，${result.deduped} 个去重`);
  } catch (err: any) {
    console.error('Confirm Import Error:', err);
    error(res, err.message || '导入失败', err instanceof AppError ? err.statusCode : 500);
  }
};

/** 获取向量文档列表 */
export const listDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, pageSize, query, sourceType, categoryId } = req.query;
    const result = await VectorService.listDocuments({
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 10,
      query: query as string,
      sourceType: sourceType as string,
      categoryId: categoryId as string,
    });
    success(res, result);
  } catch (err) {
    console.error('List VectorDocuments Error:', err);
    error(res, '获取文档列表失败', 500);
  }
};

/** 删除向量文档 */
export const deleteDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids, categoryId } = req.body;
    if (ids?.length) {
      await VectorService.deleteDocuments({ ids });
    } else if (categoryId) {
      await VectorService.deleteDocuments({ categoryId });
    } else {
      error(res, '请指定删除条件', 400); return;
    }
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete VectorDocuments Error:', err);
    error(res, '删除失败', 500);
  }
};

/** 获取向量库统计 */
export const getStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const stats = await VectorService.getStats();
    success(res, stats);
  } catch (err) {
    console.error('Get VectorStats Error:', err);
    error(res, '获取统计失败', 500);
  }
};

// ==================== 树形结构 ====================

/** 获取知识库树形结构 */
export const getTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tree = await RAGService.getKnowledgeTree();
    success(res, tree);
  } catch (err) {
    console.error('Get KnowledgeTree Error:', err);
    error(res, '获取知识库树形结构失败', 500);
  }
};

// ==================== 文档分组查询 ====================

/** 按标题分组获取文档列表（含统计信息） */
export const listGroupedDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categoryId = req.params.id as string;
    const { page, pageSize, query } = req.query;
    const pageNum = Number(page) || 1;
    const pageSizeNum = Number(pageSize) || 10;
    const offset = (pageNum - 1) * pageSizeNum;

    // 构建 WHERE 条件
    const whereClauses: string[] = [`"categoryId" = $1`];
    const params: any[] = [categoryId];
    let paramIdx = 2;

    if (query) {
      whereClauses.push(`title ILIKE $${paramIdx}`);
      params.push(`%${query}%`);
      paramIdx++;
    }

    const whereSQL = whereClauses.join(' AND ');

    // 分组查询：按title分组统计
    const countResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(DISTINCT title) as total FROM vector_documents WHERE ${whereSQL}`,
      ...params
    );
    const total = Number(countResult[0]?.total || 0);

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        title,
        "categoryId",
        COUNT(*) as paragraph_count,
        SUM(LENGTH(content)) as char_length,
        MIN(chunk_index) as min_chunk,
        MAX(chunk_index) as max_chunk,
        MIN(created_at) as create_time,
        MAX(updated_at) as update_time,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL) as embedded_count
      FROM vector_documents
      WHERE ${whereSQL}
      GROUP BY title, "categoryId"
      ORDER BY MAX(updated_at) DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      ...params,
      pageSizeNum,
      offset
    );

    const titles = rows.map(row => row.title).filter(Boolean);
    const tagRows = titles.length > 0
      ? await prisma.documentTag.findMany({
          where: {
            categoryId,
            documentTitle: { in: titles },
          },
          include: { tag: true },
        })
      : [];

    const tagMap = tagRows.reduce<Record<string, Array<{ id: string; key: string; value: string; categoryId?: string; createdAt: Date }>>>((acc, row) => {
      if (!acc[row.documentTitle]) acc[row.documentTitle] = [];
      acc[row.documentTitle].push({
        id: row.tag.id,
        key: row.tag.key,
        value: row.tag.value,
        categoryId: row.tag.categoryId || undefined,
        createdAt: row.tag.createdAt,
      });
      return acc;
    }, {});

    const items = rows.map(row => ({
      title: row.title,
      categoryId: row.categoryId,
      paragraph_count: Number(row.paragraph_count),
      char_length: Number(row.char_length),
      chunk_range: { min: Number(row.min_chunk), max: Number(row.max_chunk) },
      embedded_count: Number(row.embedded_count),
      is_fully_embedded: Number(row.embedded_count) === Number(row.paragraph_count),
      create_time: row.create_time,
      update_time: row.update_time,
      tags: tagMap[row.title] || [],
    }));

    success(res, { page: pageNum, pageSize: pageSizeNum, total, items });
  } catch (err) {
    console.error('List GroupedDocuments Error:', err);
    error(res, '获取文档列表失败', 500);
  }
};

// ==================== 单文档操作 ====================

/** 更新文档名称 */
export const updateDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categoryId = req.params.id as string;
    const { oldTitle, newTitle } = req.body;
    const normalizedTitle = newTitle?.trim();

    if (!oldTitle) { error(res, '原文档名称不能为空', 400); return; }
    if (!normalizedTitle) { error(res, '新文档名称不能为空', 400); return; }

    // 更新该分类下所有同标题的向量文档
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.vectorDocument.updateMany({
        where: { categoryId, title: oldTitle },
        data: { title: normalizedTitle },
      });

      await tx.documentTag.updateMany({
        where: { categoryId, documentTitle: oldTitle },
        data: { documentTitle: normalizedTitle },
      });

      return updated;
    });

    success(res, { updatedCount: result.count }, '更新成功');
  } catch (err) {
    console.error('Update Document Error:', err);
    error(res, '更新文档失败', 500);
  }
};

/** 删除文档（删除该分类下同一标题的所有向量片段） */
export const deleteDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categoryId = req.params.id as string;
    const { title } = req.body;

    if (!title) { error(res, '文档名称不能为空', 400); return; }

    const count = await VectorService.deleteDocuments({ categoryId, title });
    success(res, { deletedCount: count }, '删除成功');
  } catch (err) {
    console.error('Delete Document Error:', err);
    error(res, '删除文档失败', 500);
  }
};

/** 获取文档的所有段落（分块） */
export const getDocumentParagraphs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categoryId = req.params.id as string;
    const { title } = req.query;

    if (!title) { error(res, '文档名称不能为空', 400); return; }

    const paragraphs = await prisma.vectorDocument.findMany({
      where: { categoryId, title: title as string },
      select: {
        id: true,
        clauseId: true,
        content: true,
        chunkIndex: true,
        sourceType: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { chunkIndex: 'asc' },
    });

    const totalChars = paragraphs.reduce((sum, p) => sum + p.content.length, 0);

    success(res, {
      title,
      paragraphCount: paragraphs.length,
      totalChars,
      paragraphs,
    });
  } catch (err) {
    console.error('Get DocumentParagraphs Error:', err);
    error(res, '获取段落列表失败', 500);
  }
};

/** 更新单个段落 */
export const updateParagraph = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const paragraphId = req.params.paragraphId as string;
    const { content, clauseId } = req.body;

    if (!content && !clauseId) { error(res, '请提供要更新的字段', 400); return; }

    const updateData: any = {};
    if (content !== undefined) updateData.content = content;
    if (clauseId !== undefined) updateData.clauseId = clauseId;

    const paragraph = await prisma.vectorDocument.update({
      where: { id: paragraphId },
      data: updateData,
      select: { id: true, clauseId: true, content: true, chunkIndex: true },
    });

    success(res, paragraph, '更新成功');
  } catch (err) {
    console.error('Update Paragraph Error:', err);
    error(res, '更新段落失败', 500);
  }
};

/** 删除单个段落 */
export const deleteParagraph = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const paragraphId = req.params.paragraphId as string;

    await prisma.vectorDocument.delete({ where: { id: paragraphId } });
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete Paragraph Error:', err);
    error(res, '删除段落失败', 500);
  }
};

// ==================== 批量向量化 ====================

/** 批量重新向量化文档（重新解析 → 重新分段 → 重新向量化） */
export const batchVectorize = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categoryId = req.params.id as string;
    const { titles } = req.body;

    if (!titles?.length) { error(res, '请选择要向量化的文档', 400); return; }

    let totalUpdated = 0;

    for (const title of titles) {
      // 1. 获取该文档所有段落的原始内容（从第一个段落的 metadata 中获取原始文件信息）
      const paragraphs = await prisma.vectorDocument.findMany({
        where: { categoryId, title },
        select: { content: true, metadata: true },
        orderBy: { chunkIndex: 'asc' },
      });

      if (paragraphs.length === 0) continue;

      // 获取知识库分类配置
      const category = await prisma.knowledgeCategory.findUnique({ where: { id: categoryId } });
      const chunkConfig = {
        mode: category?.chunkMode as any || 'auto',
        maxChars: category?.maxChars || 1500,
        overlap: category?.overlap || 120,
      };

      // 重建内容：将所有段落的 storedContent 拼接（去掉 heading 前缀如果有的话）
      const fullContent = paragraphs.map(p => {
        const content = p.content as string;
        const meta = (p.metadata as Record<string, any>) || {};
        if (meta.heading && content.startsWith(meta.heading)) {
          return content.slice(meta.heading.length).trim();
        }
        return content;
      }).join('\n\n');

      const firstMeta = (paragraphs[0].metadata as Record<string, any>) || {};
      const originalFile = firstMeta.original_file;

      // 2. 原子替换：先完成 embedding，再事务替换旧数据
      const result = await VectorService.replaceDocumentAtomically({
        sourceType: 'standard',
        title,
        content: fullContent,
        categoryId,
        chunkConfig,
        embeddingUseDocumentTitle: category?.embeddingUseDocumentTitle ?? false,
        embeddingUseClauseId: category?.embeddingUseClauseId ?? false,
        metadata: { original_file: originalFile || title, revectorized: true },
      });

      totalUpdated += result.chunks;
    }

    success(res, { updatedCount: totalUpdated }, `重新向量化完成，共 ${totalUpdated} 个段落`);
  } catch (err: any) {
    console.error('Batch Vectorize Error:', err);
    error(res, err?.message || '批量向量化失败', 500);
  }
};

// ==================== 标签管理 ====================

/** 获取标签列表 */
export const listTags = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { categoryId } = req.query;
    const where: any = {};
    if (categoryId) where.categoryId = categoryId as string;

    const tags = await prisma.tag.findMany({
      where,
      include: { _count: { select: { documents: true } } },
      orderBy: [{ key: 'asc' }, { value: 'asc' }],
    });
    success(res, tags);
  } catch (err) {
    console.error('List Tags Error:', err);
    error(res, '获取标签列表失败', 500);
  }
};

/** 创建标签 */
export const createTag = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { key, value, categoryId } = req.body;
    if (!key?.trim() || !value?.trim()) { error(res, '标签名和值不能为空', 400); return; }

    const tag = await prisma.tag.create({
      data: { key: key.trim(), value: value.trim(), categoryId },
    });
    success(res, tag, '创建成功');
  } catch (err: any) {
    if (err?.code === 'P2002') { error(res, '该标签已存在', 409); return; }
    console.error('Create Tag Error:', err);
    error(res, '创建标签失败', 500);
  }
};

/** 删除标签 */
export const deleteTag = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const tagId = req.params.tagId as string;
    await prisma.tag.delete({ where: { id: tagId } });
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete Tag Error:', err);
    error(res, '删除标签失败', 500);
  }
};

/** 给文档添加标签 */
export const addDocumentTag = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { tagId, documentTitle, categoryId } = req.body;
    if (!tagId || !documentTitle || !categoryId) { error(res, '缺少必要参数', 400); return; }

    const docTag = await prisma.documentTag.create({
      data: { tagId, documentTitle, categoryId },
    });
    success(res, docTag, '添加成功');
  } catch (err: any) {
    if (err?.code === 'P2002') { error(res, '该标签已关联此文档', 409); return; }
    console.error('Add DocumentTag Error:', err);
    error(res, '添加文档标签失败', 500);
  }
};

/** 移除文档标签 */
export const removeDocumentTag = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { tagId, documentTitle, categoryId } = req.body;
    if (!tagId || !documentTitle || !categoryId) { error(res, '缺少必要参数', 400); return; }

    await prisma.documentTag.deleteMany({
      where: { tagId, documentTitle, categoryId },
    });
    success(res, null, '移除成功');
  } catch (err) {
    console.error('Remove DocumentTag Error:', err);
    error(res, '移除文档标签失败', 500);
  }
};

/** 获取文档的标签列表 */
export const getDocumentTags = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categoryId = req.params.id as string;
    const { title } = req.query;

    if (!title) { error(res, '文档名称不能为空', 400); return; }

    const docTags = await prisma.documentTag.findMany({
      where: { categoryId, documentTitle: title as string },
      include: { tag: true },
    });

    success(res, docTags.map(dt => dt.tag));
  } catch (err) {
    console.error('Get DocumentTags Error:', err);
    error(res, '获取文档标签失败', 500);
  }
};

// ==================== 问题自动生成 ====================

/** 为文档段落自动生成问题 */
export const generateQuestions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categoryId = req.params.id as string;
    const { title } = req.body;

    if (!title) { error(res, '文档名称不能为空', 400); return; }

    const result = await KnowledgeCategoryService.generateDocumentQuestions(categoryId, title);
    success(res, result, `生成完成，${result.generatedCount}/${result.totalChunks} 个段落已生成问题`);
  } catch (err: any) {
    console.error('Generate Questions Error:', err);
    error(res, err.message || '问题生成失败', 500);
  }
};

// ==================== 命中测试 ====================

/** 命中测试 — 检索效果测试接口 */
export const hitTest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { query, categoryId, sourceTypes, topNumber, searchMode } = req.body;

    if (!query?.trim()) { error(res, '请输入测试查询', 400); return; }

    const result = await SearchService.hitTest({
      query: query.trim(),
      categoryId,
      sourceTypes,
      topNumber: Number(topNumber) || 10,
      searchMode: searchMode || 'hybrid',
    });

    success(res, result);
  } catch (err) {
    console.error('Hit Test Error:', err);
    error(res, '命中测试失败', 500);
  }
};
