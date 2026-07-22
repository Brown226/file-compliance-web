-- Complete baseline (squashed) generated from prisma/schema.prisma
-- Enables pgvector extension required by vector_documents.embedding (Unsupported vector)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'USER');

-- CreateEnum
CREATE TYPE "StandardStatus" AS ENUM ('CURRENT', 'UPCOMING', 'ABOLISHED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewMode" AS ENUM ('LIBRARY_REVIEW', 'DOC_REVIEW', 'CONSISTENCY', 'TYPO_GRAMMAR', 'MULTIMODAL', 'RULE_ONLY', 'SELF_CHECK', 'CONTRACT_REVIEW', 'STANDARD_CHECK', 'RULE_PARSING', 'CUSTOM_RULE', 'FULL_REVIEW');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG_REPORT', 'SUGGESTION', 'FEATURE_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "AnnouncementUrgency" AS ENUM ('NORMAL', 'IMPORTANT', 'URGENT');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "KnowledgeCategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PermissionPrincipalType" AS ENUM ('USER', 'ROLE', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "CategoryPermission" AS ENUM ('READ', 'WRITE', 'UPLOAD', 'PUBLISH', 'ADMIN');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "RuleLibraryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "departmentId" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standard_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standards" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "standardNo" TEXT,
    "standardName" TEXT,
    "standardIdent" TEXT,
    "standardStatus" "StandardStatus" NOT NULL DEFAULT 'CURRENT',
    "publishDate" TIMESTAMP(3),
    "implementDate" TIMESTAMP(3),
    "abolishDate" TIMESTAMP(3),
    "content" TEXT,
    "folderId" TEXT,
    "maxkbDocId" TEXT,
    "source" TEXT,
    "importedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "reviewMode" "ReviewMode" NOT NULL DEFAULT 'LIBRARY_REVIEW',
    "creatorId" TEXT NOT NULL,
    "standardId" TEXT,
    "maxkbKnowledgeId" TEXT,
    "perspective" TEXT,
    "pre_analysis_data" JSONB,
    "review_plan" JSONB,
    "self_check_report" JSONB,
    "knowledgeCategoryId" TEXT,
    "rule_library_id" TEXT,
    "ai_engine_used" TEXT,
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_files" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "fileType" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "textLength" INTEGER NOT NULL DEFAULT 0,
    "processedLength" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "extractedText" TEXT,
    "extractedMarkdown" TEXT,
    "dwg_metadata" JSONB,
    "document_key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "source_action" TEXT NOT NULL,
    "storage_path" TEXT,
    "plain_text" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_details" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fileId" TEXT,
    "issueType" TEXT NOT NULL,
    "ruleCode" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "review_source" TEXT DEFAULT 'RULE_ENGINE',
    "specification_item_id" TEXT,
    "originalText" TEXT NOT NULL,
    "suggestedText" TEXT,
    "description" TEXT,
    "plain_language" TEXT,
    "cadHandleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "diffRanges" JSONB,
    "matchLevel" INTEGER,
    "similarity" DOUBLE PRECISION,
    "standardRefId" TEXT,
    "standardRef" TEXT,
    "isFalsePositive" BOOLEAN NOT NULL DEFAULT false,
    "adopted" BOOLEAN NOT NULL DEFAULT false,
    "adoptedBy" TEXT,
    "adoptedAt" TIMESTAMP(3),
    "fpMarkedBy" TEXT,
    "fpMarkedAt" TIMESTAMP(3),
    "fpReason" TEXT,
    "sourceReferences" JSONB,
    "textPosition" JSONB,
    "dwg_metadata" JSONB,
    "locate_meta" JSONB,
    "reviewStatus" TEXT DEFAULT 'CONFIRMED',
    "riskLevel" TEXT,
    "clauseType" TEXT,
    "recommendation" TEXT,

    CONSTRAINT "task_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "details" JSONB,
    "userId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_rules" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_standards" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "standardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_file_groups" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL DEFAULT '默认参照组',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_file_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_files" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "fileType" TEXT NOT NULL,
    "extractedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ref_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminology_whitelist" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "aliases" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminology_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "placeholders" TEXT,
    "defaultValue" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "false_positive_library" (
    "id" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "fpReason" TEXT,
    "issueType" TEXT,
    "ruleCode" TEXT,
    "severity" TEXT,
    "markedById" TEXT,
    "markedByName" TEXT,
    "taskId" TEXT,
    "taskTitle" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastMarkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "false_positive_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temp_standard_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "standardNo" TEXT NOT NULL,
    "standardName" TEXT,
    "standardIdent" TEXT,
    "rawText" TEXT,
    "sourceFile" TEXT,
    "importType" TEXT NOT NULL DEFAULT 'excel',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temp_standard_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL DEFAULT 'OTHER',
    "status" "FeedbackStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT NOT NULL,
    "attachmentPaths" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolverId" TEXT,
    "remark" TEXT,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "urgency" "AnnouncementUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_announcement_reads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "KnowledgeCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "parentId" TEXT,
    "is_leaf" BOOLEAN NOT NULL DEFAULT true,
    "chunk_mode" TEXT NOT NULL DEFAULT 'auto',
    "max_chars" INTEGER NOT NULL DEFAULT 900,
    "overlap" INTEGER NOT NULL DEFAULT 120,
    "min_similarity" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "direct_return_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "max_reference_chars" INTEGER NOT NULL DEFAULT 5000,
    "enable_rerank" BOOLEAN NOT NULL DEFAULT true,
    "embedding_use_document_title" BOOLEAN NOT NULL DEFAULT true,
    "embedding_use_clause_id" BOOLEAN NOT NULL DEFAULT false,
    "contextual_retrieval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_category_permissions" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "principal_type" "PermissionPrincipalType" NOT NULL DEFAULT 'ROLE',
    "principal_id" TEXT NOT NULL,
    "permission" "CategoryPermission" NOT NULL DEFAULT 'READ',
    "inherited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_category_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "source_file" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'standard',
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "total_chars" INTEGER NOT NULL DEFAULT 0,
    "is_vectorized" BOOLEAN NOT NULL DEFAULT false,
    "vector_status" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "parse_score" INTEGER,
    "parse_report" JSONB,
    "metadata" JSONB,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_count" INTEGER NOT NULL,
    "total_chars" INTEGER NOT NULL,
    "source_file" TEXT,
    "parse_score" INTEGER,
    "parse_report" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vector_documents" (
    "id" TEXT NOT NULL,
    "document_id" TEXT,
    "categoryId" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "title" TEXT,
    "clause_id" TEXT,
    "content" TEXT NOT NULL,
    "content_hash" TEXT,
    "chunk_index" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "embedding" vector,
    "vector_status" TEXT NOT NULL DEFAULT 'PENDING',
    "search_vector" tsvector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vector_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tags" (
    "id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "category_id" TEXT,
    "document_title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specification_folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "specification_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_libraries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source_file_name" TEXT,
    "status" "RuleLibraryStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_libraries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_library_items" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "rule_code" TEXT,
    "rule_name" TEXT,
    "category" TEXT,
    "description" TEXT,
    "check_method" TEXT,
    "severity" TEXT DEFAULT 'warning',
    "execution_type" TEXT DEFAULT 'BUILTIN_PREFIX',
    "builtin_prefix" TEXT,
    "target_scope" TEXT DEFAULT 'TEXT',
    "params" JSONB,
    "message_template" TEXT,
    "source_quote" TEXT,
    "source_location" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_library_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "sources" JSONB,
    "debug" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_chat_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "chatUserToken" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_call_log" (
    "id" BIGSERIAL NOT NULL,
    "task_id" VARCHAR(50),
    "mode" VARCHAR(50),
    "model" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50),
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'success',
    "error_msg" TEXT,
    "cost_estimate" DOUBLE PRECISION,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_call_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_memory" (
    "id" BIGSERIAL NOT NULL,
    "user_id" VARCHAR(50) NOT NULL,
    "content" TEXT NOT NULL,
    "chapter_name" VARCHAR(200),
    "source_type" VARCHAR(50) NOT NULL DEFAULT 'requirement',
    "category" VARCHAR(50) NOT NULL DEFAULT 'other',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "task_files_document_key_key" ON "task_files"("document_key");

-- CreateIndex
CREATE INDEX "file_versions_fileId_idx" ON "file_versions"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_fileId_version_no_key" ON "file_versions"("fileId", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "task_details_taskId_fileId_issueType_ruleCode_originalText_key" ON "task_details"("taskId", "fileId", "issueType", "ruleCode", "originalText");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_key_key" ON "system_configs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "review_rules_ruleCode_key" ON "review_rules"("ruleCode");

-- CreateIndex
CREATE UNIQUE INDEX "task_standards_taskId_standardId_key" ON "task_standards"("taskId", "standardId");

-- CreateIndex
CREATE UNIQUE INDEX "terminology_whitelist_term_category_key" ON "terminology_whitelist"("term", "category");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_key_key" ON "prompt_templates"("key");

-- CreateIndex
CREATE INDEX "false_positive_library_originalText_idx" ON "false_positive_library"("originalText");

-- CreateIndex
CREATE INDEX "false_positive_library_issueType_idx" ON "false_positive_library"("issueType");

-- CreateIndex
CREATE INDEX "false_positive_library_lastMarkedAt_idx" ON "false_positive_library"("lastMarkedAt");

-- CreateIndex
CREATE INDEX "temp_standard_entries_userId_idx" ON "temp_standard_entries"("userId");

-- CreateIndex
CREATE INDEX "feedbacks_userId_idx" ON "feedbacks"("userId");

-- CreateIndex
CREATE INDEX "feedbacks_status_idx" ON "feedbacks"("status");

-- CreateIndex
CREATE INDEX "feedbacks_category_idx" ON "feedbacks"("category");

-- CreateIndex
CREATE INDEX "feedbacks_createdAt_idx" ON "feedbacks"("createdAt");

-- CreateIndex
CREATE INDEX "system_announcements_status_publishAt_idx" ON "system_announcements"("status", "publishAt");

-- CreateIndex
CREATE INDEX "user_announcement_reads_userId_idx" ON "user_announcement_reads"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_announcement_reads_userId_announcementId_key" ON "user_announcement_reads"("userId", "announcementId");

-- CreateIndex
CREATE INDEX "knowledge_category_permissions_category_id_idx" ON "knowledge_category_permissions"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_category_permissions_category_id_principal_type_p_key" ON "knowledge_category_permissions"("category_id", "principal_type", "principal_id", "permission");

-- CreateIndex
CREATE INDEX "documents_categoryId_idx" ON "documents"("categoryId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_created_at_idx" ON "documents"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_categoryId_title_key" ON "documents"("categoryId", "title");

-- CreateIndex
CREATE INDEX "document_versions_documentId_idx" ON "document_versions"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_version_key" ON "document_versions"("documentId", "version");

-- CreateIndex
CREATE INDEX "vector_documents_document_id_idx" ON "vector_documents"("document_id");

-- CreateIndex
CREATE INDEX "vector_documents_categoryId_idx" ON "vector_documents"("categoryId");

-- CreateIndex
CREATE INDEX "vector_documents_source_type_source_id_idx" ON "vector_documents"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "vector_documents_content_hash_idx" ON "vector_documents"("content_hash");

-- CreateIndex
CREATE INDEX "vector_documents_title_idx" ON "vector_documents"("title");

-- CreateIndex
CREATE INDEX "tags_category_id_idx" ON "tags"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_key_value_category_id_key" ON "tags"("key", "value", "category_id");

-- CreateIndex
CREATE INDEX "document_tags_document_id_idx" ON "document_tags"("document_id");

-- CreateIndex
CREATE INDEX "document_tags_category_id_idx" ON "document_tags"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_tags_tag_id_document_id_key" ON "document_tags"("tag_id", "document_id");

-- CreateIndex
CREATE INDEX "rule_library_items_libraryId_idx" ON "rule_library_items"("libraryId");

-- CreateIndex
CREATE INDEX "qa_sessions_userId_idx" ON "qa_sessions"("userId");

-- CreateIndex
CREATE INDEX "qa_messages_sessionId_idx" ON "qa_messages"("sessionId");

-- CreateIndex
CREATE INDEX "user_chat_sessions_userId_idx" ON "user_chat_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_chat_sessions_userId_applicationId_key" ON "user_chat_sessions"("userId", "applicationId");

-- CreateIndex
CREATE INDEX "idx_llm_log_task_id" ON "llm_call_log"("task_id");

-- CreateIndex
CREATE INDEX "idx_llm_log_model" ON "llm_call_log"("model");

-- CreateIndex
CREATE INDEX "idx_llm_log_created_at" ON "llm_call_log"("created_at");

-- CreateIndex
CREATE INDEX "idx_user_memory_user_id" ON "user_memory"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_memory_category" ON "user_memory"("category");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_folders" ADD CONSTRAINT "standard_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "standard_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standards" ADD CONSTRAINT "standards_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "standard_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "standards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_rule_library_id_fkey" FOREIGN KEY ("rule_library_id") REFERENCES "rule_libraries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_files" ADD CONSTRAINT "task_files_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "task_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_details" ADD CONSTRAINT "task_details_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_details" ADD CONSTRAINT "task_details_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "task_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_standards" ADD CONSTRAINT "task_standards_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_standards" ADD CONSTRAINT "task_standards_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "standards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ref_file_groups" ADD CONSTRAINT "ref_file_groups_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ref_files" ADD CONSTRAINT "ref_files_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ref_file_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_resolverId_fkey" FOREIGN KEY ("resolverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_announcements" ADD CONSTRAINT "system_announcements_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_announcement_reads" ADD CONSTRAINT "user_announcement_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_announcement_reads" ADD CONSTRAINT "user_announcement_reads_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "system_announcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "knowledge_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_category_permissions" ADD CONSTRAINT "knowledge_category_permissions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "knowledge_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "knowledge_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vector_documents" ADD CONSTRAINT "vector_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vector_documents" ADD CONSTRAINT "vector_documents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "knowledge_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "knowledge_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specification_folders" ADD CONSTRAINT "specification_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "specification_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_library_items" ADD CONSTRAINT "rule_library_items_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "rule_libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_sessions" ADD CONSTRAINT "qa_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_messages" ADD CONSTRAINT "qa_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "qa_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_chat_sessions" ADD CONSTRAINT "user_chat_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text search GIN index (preserved from manual add_fts migration)
CREATE INDEX IF NOT EXISTS "idx_vector_documents_fts" ON "vector_documents" USING GIN (search_vector);
