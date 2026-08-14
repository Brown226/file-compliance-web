-- =====================================================
-- 迁移脚本：方案A 审查阶段状态机（ReviewStage）
-- 执行时间：2026-08-13
-- 说明：新表只增不改，无外键依赖，对现有数据零影响。
--       支撑断点续跑 / 阶段可观测 / 审计追溯（设计文档 outputs/方案A-DEC阶段状态机设计.md）
-- 回滚：DROP TABLE IF EXISTS "review_stages"; DROP TYPE IF EXISTS "ReviewStageStatus";
-- =====================================================

CREATE TYPE "ReviewStageStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

CREATE TABLE "review_stages" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fileId" TEXT,
    "mode" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "status" "ReviewStageStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_stages_taskId_fileId_stageKey_key" ON "review_stages"("taskId", "fileId", "stageKey");
CREATE INDEX "review_stages_taskId_status_idx" ON "review_stages"("taskId", "status");
