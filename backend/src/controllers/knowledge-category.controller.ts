import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { KnowledgeCategoryService } from '../services/knowledge-category.service';
import { VectorService } from '../services/vector.service';
import { LangChainSearchService } from '../services/langchain/langchain-search.service';
import { UploadTaskService } from '../services/upload-task.service';
import prisma from '../config/db';
import { success, error } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../middlewares/error.middleware';

const UPLOAD_DIR = path.join(__dirname, '../../uploads/knowledge');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ==================== 名称/描述校验工具 ====================

const NAME_MIN_LEN = 1;
const NAME_MAX_LEN = 64;
const DESC_MAX_LEN = 128;

function validateAndCleanName(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length < NAME_MIN_LEN || trimmed.length > NAME_MAX_LEN) return null;

  const hasValidChar = /[\u4e00-\u9fa5A-Za-z0-9]/.test(trimmed);
  if (!hasValidChar) return null;

  const onlyPunctuation = /^[^\u4e00-\u9fa5A-Za-z0-9]*$/.test(trimmed);
  if (onlyPunctuation) return null;

  const suspiciousPatterns = [
    /^[\;\.\,\s]+$/,
    /^\.+$/,
    /^\;+$/,
    /^[\;\.\,]+$/,
    /^v+$/i,
    /^[a-zA-Z]v[a-zA-Z]*$/i,
  ];
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) return null;
  }

  return trimmed.replace(/\s{2,}/g, ' ');
}

function isValidDescription(text: string): boolean {
  if (!text || text.length > DESC_MAX_LEN) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const hasValidContent = /[\u4e00-\u9fa5A-Za-z0-9]{2,}/.test(trimmed);
  return hasValidContent;
}

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
    const { name, description, parentId, isLeaf } = req.body;
    console.log('[DEBUG] createCategory isLeaf =', isLeaf, 'parentId =', parentId);

    const cleanedName = validateAndCleanName(name);
    if (!cleanedName) { error(res, '名称不能为空，且需包含至少1个汉字、字母或数字', 400); return; }

    const cleanedDescription = description?.trim() || null;
    if (cleanedDescription && !isValidDescription(cleanedDescription)) {
      error(res, '描述内容不合法，请输入有意义的文字描述', 400);
      return;
    }

    const category = await KnowledgeCategoryService.create({
      name: cleanedName,
      description: cleanedDescription,
      parentId,
      isLeaf,
    });
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
    const { name, description } = req.body;

    if (name !== undefined) {
      const cleanedName = validateAndCleanName(name);
      if (!cleanedName) { error(res, '名称不合法，需包含至少1个汉字、字母或数字', 400); return; }
      req.body.name = cleanedName;
    }

    if (description !== undefined && description !== null) {
      const cleanedDesc = description.trim() || null;
      if (cleanedDesc && !isValidDescription(cleanedDesc)) {
        error(res, '描述内容不合法', 400);
        return;
      }
      req.body.description = cleanedDesc;
    }

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

/** 异步上传文档 — 立即返回任务ID，通过 Bull 队列后台处理 */
export const uploadDocumentAsync = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const files = req.files as Express.Multer.File[];
    if (!files?.length) { error(res, '请选择文件', 400); return; }

    await KnowledgeCategoryService.ensureLeafCategory(id);

    // 动态导入避免循环依赖
    const { knowledgeUploadQueue } = await import('../services/queue.service');

    const taskIds: string[] = [];

    for (const file of files) {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(originalName);
      const savedName = `${uuidv4()}${ext}`;
      const savedPath = path.join(UPLOAD_DIR, savedName);
      fs.renameSync(file.path, savedPath);

      const taskId = UploadTaskService.createTask(originalName);
      taskIds.push(taskId);

      // 通过 Bull 队列持久化处理（重启不丢任务，自动重试）
      await knowledgeUploadQueue.add('upload', {
        taskId,
        categoryId: id,
        savedPath,
        originalName,
      }, {
        jobId: `kb-upload:${taskId}`,
      });

      console.log(`[KB-Upload] 任务已入队: ${originalName} (taskId=${taskId})`);
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
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { error(res, '请选择文件', 400); return; }

    await KnowledgeCategoryService.ensureLeafCategory(id);

    const userConfig = {
      chunkMode: (req.body.chunkMode as string) || undefined,
      maxChars: req.body.maxChars ? Number(req.body.maxChars) : undefined,
      overlap: req.body.overlap ? Number(req.body.overlap) : undefined,
      embeddingUseDocumentTitle: req.body.embeddingUseDocumentTitle === 'true',
      contextualRetrieval: req.body.contextualRetrieval === 'true',
    };

    const fileTasks = files.map(async (file) => {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(originalName);
      const savedName = `${uuidv4()}${ext}`;
      const savedPath = path.join(UPLOAD_DIR, savedName);
      fs.renameSync(file.path, savedPath);

      const preview = await KnowledgeCategoryService.previewDocument(id, savedPath, originalName, userConfig);
      return { name: originalName, title: preview.title, chunks: preview.chunks, canImport: preview.canImport };
    });

    const fileResults = await Promise.all(fileTasks);
    const totalChunks = fileResults.reduce((s, f) => s + f.chunks.length, 0);
    const canImport = fileResults.every(f => f.canImport);

    success(res, {
      files: fileResults,
      totalChunks,
      parseQuality: { passed: canImport, reasons: [] },
      canImport,
    }, `预览完成，共 ${totalChunks} 个分段`);
  } catch (err: any) {
    console.error('Preview Document Error:', err);
    error(res, err.message || '预览失败', err instanceof AppError ? err.statusCode : 500);
  }
};

/** 确认导入 — 用户确认分段后批量入库（保留用户编辑的分段，不重新分块） */
export const confirmImport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { documents, metadata } = req.body;

    if (!documents?.length) { error(res, '文档列表不能为空', 400); return; }

    await KnowledgeCategoryService.ensureLeafCategory(id);

    const category = await prisma.knowledgeCategory.findUnique({ where: { id } });
    const baseConfig = {
      sourceType: 'standard' as const,
      categoryId: id,
      embeddingUseDocumentTitle: metadata?.embeddingUseDocumentTitle ?? category?.embeddingUseDocumentTitle ?? false,
      embeddingUseClauseId: category?.embeddingUseClauseId ?? false,
      contextualRetrieval: metadata?.contextualRetrieval ?? category?.contextualRetrieval ?? false,
      metadata: metadata || {},
    };

    const entries = documents.map((doc: any) => ({
      ...baseConfig,
      title: (doc.title || '').trim(),
      content: (doc.chunks || []).map((c: any) => typeof c === 'string' ? c : c.content || '').join('\n\n'),
      preChunkedParagraphs: (doc.chunks || []).map((c: any) => {
        const text = typeof c === 'string' ? c : (c.content || '');
        const title = c.title || '';
        return { title, content: text };
      }).filter((p: any) => p.content.length > 0),
      chunkConfig: {
        mode: metadata?.chunkMode || 'auto',
        maxChars: metadata?.maxChars || undefined,
        overlap: metadata?.overlap || undefined,
        contextualRetrieval: baseConfig.contextualRetrieval,
      },
    }));

    const result = await VectorService.importDocuments(entries);
    if (result.errors?.length) {
      console.warn(`[ConfirmImport] ${result.errors.length} 个文档导入失败:`, result.errors);
    }

    // 同步创建 Document 记录，确保 Document ↔ VectorDocument 数据一致
    for (const entry of entries) {
      if (!entry.title) continue;
      const totalChars = entry.content?.length || 0;
      const totalChunks = entry.preChunkedParagraphs?.length || 0;
      await prisma.document.upsert({
        where: { categoryId_title: { categoryId: id, title: entry.title } },
        update: { totalChunks, totalChars, isVectorized: true, vectorStatus: 'SUCCESS' },
        create: {
          categoryId: id,
          title: entry.title,
          sourceType: 'standard',
          status: 'ACTIVE',
          totalChunks,
          totalChars,
          isVectorized: true,
          vectorStatus: 'SUCCESS',
        },
      });
    }

    success(res, { imported: result.imported, deduped: result.deduped, errors: result.errors }, `导入完成：${result.imported} 成功，${result.errors.length} 失败`);
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
    const tree = await KnowledgeCategoryService.getKnowledgeTree();
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
        COALESCE(metadata->>'original_file', title) as title,
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
      GROUP BY COALESCE(metadata->>'original_file', title), "categoryId"
      ORDER BY MAX(updated_at) DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      ...params,
      pageSizeNum,
      offset
    );

    const titles = rows.map(row => row.title).filter(Boolean);

    // 通过 Document 表将 title 映射到 documentId，再查 DocumentTag
    const titleToDocId = new Map<string, string>();
    if (titles.length > 0) {
      const docs = await prisma.document.findMany({
        where: { categoryId, title: { in: titles } },
        select: { id: true, title: true },
      });
      docs.forEach(d => titleToDocId.set(d.title, d.id));
    }

    const docIdToTitle = new Map<string, string>();
    for (const [title, docId] of titleToDocId) {
      docIdToTitle.set(docId, title);
    }

    const documentIds = [...titleToDocId.values()];
    const tagRows = documentIds.length > 0
      ? await prisma.documentTag.findMany({
          where: { documentId: { in: documentIds } },
          include: { tag: true },
        })
      : [];

    const tagMap: Record<string, Array<{ id: string; key: string; value: string; categoryId?: string; createdAt: Date }>> = {};
    tagRows.forEach(row => {
      const title = docIdToTitle.get(row.documentId);
      if (title) {
        if (!tagMap[title]) tagMap[title] = [];
        tagMap[title].push({
          id: row.tag.id,
          key: row.tag.key,
          value: row.tag.value,
          categoryId: row.tag.categoryId || undefined,
          createdAt: row.tag.createdAt,
        });
      }
    });

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

    // 更新该分类下所有同标题的向量文档和关联记录
    const result = await prisma.$transaction(async (tx) => {
      // 向量文档：更新 metadata->>'document_title'（兼容新旧数据）
      const updated = await tx.$executeRawUnsafe(
        `UPDATE vector_documents
         SET metadata = jsonb_set(metadata, '{document_title}', $1::jsonb)
         WHERE "categoryId" = $2 AND COALESCE(metadata->>'original_file', title) = $3`,
        JSON.stringify(normalizedTitle), categoryId, oldTitle
      );

      // 同步更新 Document 表标题
      await tx.document.updateMany({
        where: { categoryId, title: oldTitle },
        data: { title: normalizedTitle },
      });

      // 同步更新 DocumentTag 冗余字段
      await tx.documentTag.updateMany({
        where: { categoryId, documentTitle: oldTitle },
        data: { documentTitle: normalizedTitle },
      });

      return { count: updated };
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

    const paragraphs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, clause_id as "clauseId", content, chunk_index as "chunkIndex",
              source_type as "sourceType", metadata, created_at as "createdAt", updated_at as "updatedAt"
       FROM vector_documents
       WHERE "categoryId" = $1
         AND COALESCE(metadata->>'original_file', title) = $2
         AND vector_status = 'SUCCESS'
       ORDER BY chunk_index ASC`,
      categoryId, title
    );

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
      // 1. 获取该文档所有段落的原始内容（兼容新旧数据）
      const paragraphs = await prisma.$queryRawUnsafe<any[]>(
        `SELECT content, metadata
         FROM vector_documents
         WHERE "categoryId" = $1 AND COALESCE(metadata->>'original_file', title) = $2
         ORDER BY chunk_index ASC`,
        categoryId, title
      );

      if (paragraphs.length === 0) continue;

      // 获取知识库分类配置
      const category = await prisma.knowledgeCategory.findUnique({ where: { id: categoryId } });
      const chunkConfig = {
        mode: category?.chunkMode as any || 'auto',
        maxChars: category?.maxChars || 1500,
        overlap: category?.overlap || 120,
        contextualRetrieval: category?.contextualRetrieval ?? false,
      };

      // 重建内容：将所有段落的 content 拼接（保留 heading 结构）
      const fullContent = paragraphs.map(p => {
        const content = p.content as string;
        const meta = (p.metadata as Record<string, any>) || {};
        // 若有 heading 元数据且内容以 heading 开头，在前面补回 Markdown 标记
        // 确保 splitMarkdownIntoParagraphs 能正确识别标题层级
        if (meta.heading && content.startsWith(meta.heading)) {
          return `## ${content.trim()}`;
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

    // 确保 Document 记录存在（若无则自动创建）
    await prisma.document.upsert({
      where: { categoryId_title: { categoryId, title: documentTitle } },
      update: {},
      create: { categoryId, title: documentTitle, sourceType: 'standard', status: 'ACTIVE' },
    });

    // 获取 documentId 以建立正确关联
    const doc = await prisma.document.findUniqueOrThrow({
      where: { categoryId_title: { categoryId, title: documentTitle } },
    });

    const docTag = await prisma.documentTag.create({
      data: { tagId, documentId: doc.id, documentTitle, categoryId },
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

    const doc = await prisma.document.findUnique({
      where: { categoryId_title: { categoryId, title: documentTitle } },
    });
    if (!doc) { error(res, '文档不存在', 404); return; }

    await prisma.documentTag.deleteMany({
      where: { tagId, documentId: doc.id },
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

    // 通过 Document 表获取 documentId，再查标签关联
    const doc = await prisma.document.findUnique({
      where: { categoryId_title: { categoryId, title: title as string } },
    });

    if (!doc) {
      // 无 Document 记录时，尝试通过冗余字段查询（兼容历史数据）
      const legacyTags = await prisma.documentTag.findMany({
        where: { categoryId, documentTitle: title as string },
        include: { tag: true },
      });
      return success(res, legacyTags.map(dt => dt.tag));
    }

    const docTags = await prisma.documentTag.findMany({
      where: { documentId: doc.id },
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

    const result = await LangChainSearchService.hitTest({
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
