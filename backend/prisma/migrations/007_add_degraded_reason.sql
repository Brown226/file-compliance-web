-- =====================================================
-- 迁移脚本：任务降级原因落库（P0-4）
-- 执行时间：2026-08-14
-- 说明：tasks 表只增一列，无外键依赖，对现有数据零影响。
--       支撑"降级不落库"修复：RAG 不可用/零命中/OCR 降级等降级原因持久化，
--       结果页/任务列表可追溯"本次审查哪些环节没审到"（没审到 ≠ 通过）。
-- 回滚：ALTER TABLE "tasks" DROP COLUMN IF EXISTS "degraded_reason";
-- =====================================================

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "degraded_reason" TEXT;
