-- =====================================================
-- 迁移脚本：添加 Document 和 DocumentVersion 表
-- 执行时间：2026-05-22
-- =====================================================

-- 1. 创建 DocumentStatus 枚举类型
DO $$ BEGIN
    CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED', 'DELETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. 创建 documents 表
CREATE TABLE IF NOT EXISTS "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "categoryId" UUID,
    "title" VARCHAR(255) NOT NULL,
    "source_file" VARCHAR(255),
    "source_type" VARCHAR(255) NOT NULL DEFAULT 'standard',
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "total_chars" INTEGER NOT NULL DEFAULT 0,
    "is_vectorized" BOOLEAN NOT NULL DEFAULT false,
    "vector_status" VARCHAR(255),
    "parse_score" INTEGER,
    "parse_report" JSONB,
    "metadata" JSONB,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documents_categoryId_title_key" UNIQUE ("categoryId", "title")
);

-- 3. 创建 document_versions 表
CREATE TABLE IF NOT EXISTS "document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_count" INTEGER NOT NULL,
    "total_chars" INTEGER NOT NULL,
    "source_file" VARCHAR(255),
    "parse_score" INTEGER,
    "parse_report" JSONB,
    "created_by" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_versions_documentId_version_key" UNIQUE ("documentId", "version")
);

-- 4. 添加 documentId 字段到 vector_documents 表
ALTER TABLE "vector_documents" ADD COLUMN IF NOT EXISTS "document_id" UUID;

-- 5. 添加外键约束
ALTER TABLE "document_versions"
    ADD CONSTRAINT "document_versions_documentId_fkey"
    FOREIGN KEY ("documentId")
    REFERENCES "documents"("id")
    ON DELETE CASCADE;

ALTER TABLE "vector_documents"
    ADD CONSTRAINT "vector_documents_documentId_fkey"
    FOREIGN KEY ("document_id")
    REFERENCES "documents"("id")
    ON DELETE CASCADE;

ALTER TABLE "documents"
    ADD CONSTRAINT "documents_categoryId_fkey"
    FOREIGN KEY ("categoryId")
    REFERENCES "knowledge_categories"("id")
    ON DELETE CASCADE;

-- 6. 添加索引
CREATE INDEX IF NOT EXISTS "documents_categoryId_idx" ON "documents"("categoryId");
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents"("status");
CREATE INDEX IF NOT EXISTS "documents_created_at_idx" ON "documents"("created_at");
CREATE INDEX IF NOT EXISTS "document_versions_documentId_idx" ON "document_versions"("documentId");
CREATE INDEX IF NOT EXISTS "vector_documents_documentId_idx" ON "vector_documents"("document_id");

-- 7. 修改 document_tags 表
ALTER TABLE "document_tags" DROP COLUMN IF EXISTS "document_title";
ALTER TABLE "document_tags" DROP COLUMN IF EXISTS "categoryId";
ALTER TABLE "document_tags" ADD COLUMN IF NOT EXISTS "documentId" UUID;

ALTER TABLE "document_tags"
    ADD CONSTRAINT "document_tags_documentId_fkey"
    FOREIGN KEY ("documentId")
    REFERENCES "documents"("id")
    ON DELETE CASCADE;

ALTER TABLE "document_tags" DROP CONSTRAINT IF EXISTS "document_tags_tagId_documentTitle_categoryId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "document_tags_tagId_documentId_key" ON "document_tags"("tagId", "documentId");
DROP INDEX IF EXISTS "document_tags_categoryId_documentTitle_idx";

-- 8. 创建 HNSW 索引（pgvector 向量索引）
-- 注意：这需要 pgvector 扩展已启用
-- CREATE INDEX IF NOT EXISTS "vector_documents_embedding_idx" ON "vector_documents" USING hnsw ("embedding" vector_cosine_ops);

-- =====================================================
-- 回滚脚本（如果需要回滚）
-- =====================================================
-- DROP INDEX IF EXISTS "vector_documents_documentId_idx";
-- DROP INDEX IF EXISTS "document_versions_documentId_idx";
-- DROP INDEX IF EXISTS "documents_created_at_idx";
-- DROP INDEX IF EXISTS "documents_status_idx";
-- DROP INDEX IF EXISTS "documents_categoryId_idx";
-- DROP TABLE IF EXISTS "document_versions";
-- ALTER TABLE "vector_documents" DROP COLUMN IF EXISTS "document_id";
-- DROP TABLE IF EXISTS "documents";
-- DROP TYPE IF EXISTS "DocumentStatus";
