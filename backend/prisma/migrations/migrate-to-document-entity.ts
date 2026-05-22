/**
 * 数据迁移脚本：将 VectorDocument 迁移到 Document + DocumentVersion 结构
 *
 * 执行方式：npx ts-node prisma/migrations/migrate-to-document-entity.ts
 *
 * 迁移前请务必备份数据库！
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrate() {
  console.log('开始迁移数据...\n');

  const existingDocCount = await prisma.document.count();
  if (existingDocCount > 0) {
    console.log(`Document 表已有 ${existingDocCount} 条记录，跳过迁移。`);
    return;
  }

  const totalRecords = await prisma.vectorDocument.count();
  console.log(`VectorDocument 表共有 ${totalRecords} 条记录\n`);

  const vectorDocs = await prisma.vectorDocument.groupBy({
    by: ['categoryId', 'title'],
    _count: { id: true },
  });

  console.log(`发现 ${vectorDocs.length} 个唯一文档\n`);

  let migratedDocs = 0;
  let migratedChunks = 0;

  for (const doc of vectorDocs) {
    if (!doc.title) continue;

    try {
      const chunks = await prisma.vectorDocument.findMany({
        where: {
          categoryId: doc.categoryId,
          title: doc.title,
        },
        orderBy: { chunkIndex: 'asc' },
      });

      if (chunks.length === 0) continue;

      const firstChunk = chunks[0];

      await prisma.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            categoryId: doc.categoryId,
            title: doc.title,
            sourceFile: firstChunk.sourceId || null,
            sourceType: firstChunk.sourceType,
            status: 'ACTIVE',
            totalChunks: chunks.length,
            totalChars: chunks.reduce((sum, c) => sum + (c.content?.length || 0), 0),
            isVectorized: true,
            vectorStatus: 'SUCCESS',
            currentVersion: 1,
          },
        });

        await tx.documentVersion.create({
          data: {
            documentId: document.id,
            version: 1,
            content: chunks.map((c) => c.content).join('\n\n'),
            chunkCount: chunks.length,
            totalChars: chunks.reduce((sum, c) => sum + (c.content?.length || 0), 0),
            sourceFile: firstChunk.sourceId || null,
          },
        });

        await tx.vectorDocument.updateMany({
          where: {
            categoryId: doc.categoryId,
            title: doc.title,
          },
          data: {
            documentId: document.id,
          },
        });
      });

      migratedDocs++;
      migratedChunks += chunks.length;

      console.log(`  ✓ 迁移文档: ${doc.title} (${chunks.length} 个段落)`);
    } catch (err: any) {
      console.error(`  ✗ 迁移失败: ${doc.title}`, err.message);
    }
  }

  console.log(`\n迁移完成！`);
  console.log(`  迁移文档数: ${migratedDocs}`);
  console.log(`  迁移段落数: ${migratedChunks}`);
}

async function main() {
  try {
    await migrate();
  } catch (err) {
    console.error('迁移过程中出错:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
