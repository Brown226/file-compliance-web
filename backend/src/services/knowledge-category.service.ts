/**
 * 知识子库管理服务
 */

import prisma from '../config/db';
import { VectorService } from './vector.service';
import { EmbeddingService } from './embedding.service';
import fs from 'fs';
import path from 'path';
import { ParserService } from './parser.service';

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
   * 上传文档到知识子库：解析文件 → 分块 → 向量化入库
   */
  static async uploadDocument(categoryId: string, filePath: string, fileName: string): Promise<{ chunks: number }> {
    const category = await prisma.knowledgeCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new Error('知识子库不存在');

    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const fileType = ext === 'doc' ? 'docx' : ext;

    // 解析文件内容
    const text = await ParserService.parseFile(filePath, fileType);
    if (!text || text.trim().length < 10) {
      throw new Error('文件内容过少或解析失败');
    }

    // 导入向量库
    const result = await VectorService.importDocument({
      sourceType: 'standard',
      title: fileName.replace(/\.\w+$/, ''),
      content: text,
      categoryId,
      metadata: { original_file: fileName },
    });

    return { chunks: result.chunks };
  }
}
