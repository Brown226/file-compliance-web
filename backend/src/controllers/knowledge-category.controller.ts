import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { KnowledgeCategoryService } from '../services/knowledge-category.service';
import { VectorService } from '../services/vector.service';
import { RAGService } from '../services/rag.service';
import { EmbeddingService } from '../services/embedding.service';
import prisma from '../config/db';
import { success, error } from '../utils/response';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

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
  } catch (err) {
    console.error('Create KnowledgeCategory Error:', err);
    error(res, '创建失败', 500);
  }
};

/** 更新知识子库 */
export const updateCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const category = await KnowledgeCategoryService.update(id, req.body);
    success(res, category, '更新成功');
  } catch (err) {
    console.error('Update KnowledgeCategory Error:', err);
    error(res, '更新失败', 500);
  }
};

/** 删除知识子库 */
export const deleteCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await KnowledgeCategoryService.delete(id);
    success(res, null, '删除成功');
  } catch (err) {
    console.error('Delete KnowledgeCategory Error:', err);
    error(res, '删除失败', 500);
  }
};

/** 上传文档到知识子库 */
export const uploadDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const file = req.file;
    if (!file) { error(res, '请选择文件', 400); return; }

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
    error(res, err.message || '上传失败', 500);
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
    const { page, pageSize, query, status } = req.query;
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
    const { oldTitle, newTitle, isActive } = req.body;

    if (!oldTitle) { error(res, '原文档名称不能为空', 400); return; }
    if (!newTitle && isActive === undefined) { error(res, '请提供要更新的字段', 400); return; }

    // 更新该分类下所有同标题的向量文档
    const updateData: any = {};
    if (newTitle) updateData.title = newTitle;
    if (isActive !== undefined) {
      // isActive 存储在 metadata 中
      updateData.metadata = { isActive };
    }

    const result = await prisma.vectorDocument.updateMany({
      where: { categoryId, title: oldTitle },
      data: updateData,
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

/** 批量重新向量化文档 */
export const batchVectorize = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const categoryId = req.params.id as string;
    const { titles } = req.body;  // 文档标题数组

    if (!titles?.length) { error(res, '请选择要向量化的文档', 400); return; }

    let totalUpdated = 0;

    for (const title of titles) {
      // 获取该文档所有段落
      const paragraphs = await prisma.vectorDocument.findMany({
        where: { categoryId, title },
        select: { id: true, content: true },
        orderBy: { chunkIndex: 'asc' },
      });

      if (paragraphs.length === 0) continue;

      // 重新向量化每个段落
      for (const para of paragraphs) {
        try {
          const embedding = await EmbeddingService.embedText(para.content);
          const embeddingStr = `[${embedding.join(',')}]`;

          await prisma.$executeRawUnsafe(
            `UPDATE vector_documents SET embedding = $1::vector, updated_at = NOW() WHERE id = $2`,
            embeddingStr,
            para.id
          );
          totalUpdated++;
        } catch (e: any) {
          console.warn(`向量化段落 ${para.id} 失败:`, e.message);
        }
      }
    }

    success(res, { updatedCount: totalUpdated }, `向量化完成，已更新 ${totalUpdated} 个段落`);
  } catch (err) {
    console.error('Batch Vectorize Error:', err);
    error(res, '批量向量化失败', 500);
  }
};
