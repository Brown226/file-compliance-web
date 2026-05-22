/**
 * 文档服务 - 管理 Document 和 DocumentVersion
 *
 * 支持功能：
 * - 文档 CRUD 操作
 * - 文档版本管理
 * - 文档状态流转（草稿→活跃→归档→删除）
 */

import prisma from '../config/db';
import { DocumentStatus } from '@prisma/client';
import { ParserService } from './parser.service';
import { VectorService, ChunkingConfig } from './vector.service';

export interface CreateDocumentOptions {
  categoryId: string;
  title: string;
  sourceFile?: string;
  sourceType?: string;
  createdBy?: string;
  metadata?: Record<string, any>;
}

export interface UpdateDocumentOptions {
  title?: string;
  status?: DocumentStatus;
  totalChunks?: number;
  totalChars?: number;
  isVectorized?: boolean;
  vectorStatus?: string;
  parseScore?: number;
  parseReport?: any;
  metadata?: Record<string, any>;
}

export interface ListDocumentsOptions {
  categoryId?: string;
  status?: DocumentStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

export class DocumentService {
  /**
   * 创建新文档（仅创建记录，不处理文件）
   */
  static async createDocument(options: CreateDocumentOptions) {
    const { categoryId, title, sourceFile, sourceType, createdBy, metadata } = options;

    return prisma.document.create({
      data: {
        categoryId,
        title,
        sourceFile,
        sourceType: sourceType || 'standard',
        status: DocumentStatus.DRAFT,
        createdBy,
        metadata: metadata || {},
      },
    });
  }

  /**
   * 获取文档详情
   */
  static async getDocument(id: string) {
    return prisma.document.findUnique({
      where: { id },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          take: 5,
        },
        versions: {
          orderBy: { version: 'desc' },
          take: 5,
        },
        tags: {
          include: { tag: true },
        },
      },
    });
  }

  /**
   * 获取文档列表（支持分页和搜索）
   */
  static async listDocuments(options: ListDocumentsOptions = {}) {
    const {
      categoryId,
      status,
      search,
      page = 1,
      pageSize = 20,
    } = options;

    const where: any = {};

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (status) {
      where.status = status;
    } else {
      where.status = { not: DocumentStatus.DELETED };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { sourceFile: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: {
            select: { chunks: true, versions: true },
          },
        },
      }),
      prisma.document.count({ where }),
    ]);

    return {
      documents,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 更新文档信息
   */
  static async updateDocument(id: string, options: UpdateDocumentOptions) {
    return prisma.document.update({
      where: { id },
      data: options,
    });
  }

  /**
   * 上传新版本（原子操作）
   * 1. 创建新版本记录
   * 2. 更新文档统计信息
   */
  static async uploadNewVersion(
    documentId: string,
    content: string,
    options: {
      sourceFile?: string;
      parseScore?: number;
      parseReport?: any;
      createdBy?: string;
      chunkConfig?: ChunkingConfig;
    }
  ) {
    const { sourceFile, parseScore, parseReport, createdBy, chunkConfig } = options;

    return prisma.$transaction(async (tx) => {
      const document = await tx.document.findUniqueOrThrow({
        where: { id: documentId },
      });

      const newVersion = document.currentVersion + 1;

      const paragraphs = VectorService.splitTextIntoChunks(content, chunkConfig);

      const [version, updatedDoc] = await Promise.all([
        tx.documentVersion.create({
          data: {
            documentId,
            version: newVersion,
            content,
            chunkCount: paragraphs.length,
            totalChars: content.length,
            sourceFile,
            parseScore,
            parseReport,
            createdBy,
          },
        }),
        tx.document.update({
          where: { id: documentId },
          data: {
            currentVersion: newVersion,
            totalChunks: paragraphs.length,
            totalChars: content.length,
            parseScore,
            parseReport,
            sourceFile: sourceFile || document.sourceFile,
            status: DocumentStatus.ACTIVE,
          },
        }),
      ]);

      return { version, document: updatedDoc };
    });
  }

  /**
   * 获取文档版本列表
   */
  static async listVersions(documentId: string) {
    return prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        chunkCount: true,
        totalChars: true,
        sourceFile: true,
        parseScore: true,
        createdBy: true,
        createdAt: true,
      },
    });
  }

  /**
   * 获取指定版本详情
   */
  static async getVersion(documentId: string, version: number) {
    return prisma.documentVersion.findUnique({
      where: {
        documentId_version: {
          documentId,
          version,
        },
      },
    });
  }

  /**
   * 回滚到指定版本
   */
  static async restoreVersion(
    documentId: string,
    version: number,
    options: { createdBy?: string } = {}
  ) {
    return prisma.$transaction(async (tx) => {
      const targetVersion = await tx.documentVersion.findUniqueOrThrow({
        where: {
          documentId_version: {
            documentId,
            version,
          },
        },
      });

      const document = await tx.document.findUniqueOrThrow({
        where: { id: documentId },
      });

      const newVersion = document.currentVersion + 1;

      const paragraphs = VectorService.splitTextIntoChunks(targetVersion.content);

      const [_, updatedDoc] = await Promise.all([
        tx.documentVersion.create({
          data: {
            documentId,
            version: newVersion,
            content: targetVersion.content,
            chunkCount: paragraphs.length,
            totalChars: targetVersion.totalChars,
            sourceFile: targetVersion.sourceFile,
            parseScore: targetVersion.parseScore,
            parseReport: targetVersion.parseReport,
            createdBy: options.createdBy,
          },
        }),
        tx.document.update({
          where: { id: documentId },
          data: {
            currentVersion: newVersion,
            totalChunks: paragraphs.length,
            totalChars: targetVersion.totalChars,
            parseScore: targetVersion.parseScore,
            parseReport: targetVersion.parseReport,
            status: DocumentStatus.ACTIVE,
          },
        }),
      ]);

      return updatedDoc;
    });
  }

  /**
   * 删除文档（软删除）
   */
  static async deleteDocument(id: string) {
    return prisma.document.update({
      where: { id },
      data: { status: DocumentStatus.DELETED },
    });
  }

  /**
   * 归档文档
   */
  static async archiveDocument(id: string) {
    return prisma.document.update({
      where: { id },
      data: { status: DocumentStatus.ARCHIVED },
    });
  }

  /**
   * 恢复归档的文档
   */
  static async unarchiveDocument(id: string) {
    return prisma.document.update({
      where: { id },
      data: { status: DocumentStatus.ACTIVE },
    });
  }

  /**
   * 检查同名文档是否存在
   */
  static async findByTitle(categoryId: string, title: string) {
    return prisma.document.findUnique({
      where: {
        categoryId_title: {
          categoryId,
          title,
        },
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
  }

  /**
   * 获取文档的段落列表
   */
  static async getDocumentChunks(documentId: string, options: { page?: number; pageSize?: number } = {}) {
    const { page = 1, pageSize = 50 } = options;

    const [chunks, total] = await Promise.all([
      prisma.vectorDocument.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.vectorDocument.count({ where: { documentId } }),
    ]);

    return { chunks, total, page, pageSize };
  }

  /**
   * 为文档添加标签
   */
  static async addTag(documentId: string, tagId: string) {
    return prisma.documentTag.upsert({
      where: {
        tagId_documentId: {
          tagId,
          documentId,
        },
      },
      update: {},
      create: {
        tagId,
        documentId,
      },
    });
  }

  /**
   * 移除文档标签
   */
  static async removeTag(documentId: string, tagId: string) {
    return prisma.documentTag.deleteMany({
      where: {
        documentId,
        tagId,
      },
    });
  }

  /**
   * 获取文档统计信息
   */
  static async getDocumentStats(categoryId?: string) {
    const where = categoryId ? { categoryId } : {};

    const [total, active, draft, archived] = await Promise.all([
      prisma.document.count({ where: { ...where } }),
      prisma.document.count({ where: { ...where, status: DocumentStatus.ACTIVE } }),
      prisma.document.count({ where: { ...where, status: DocumentStatus.DRAFT } }),
      prisma.document.count({ where: { ...where, status: DocumentStatus.ARCHIVED } }),
    ]);

    return { total, active, draft, archived };
  }
}
