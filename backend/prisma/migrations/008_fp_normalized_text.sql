-- =====================================================
-- 迁移脚本：误报库归一化口径（P1-2）
-- 执行时间：2026-08-14
-- 说明：false_positive_library 加 normalized_text 列 + 归一化唯一索引。
--       写入侧（syncFromTaskDetail/remove）与查询侧（isInLibrary/batchCheck）
--       统一按归一化文本匹配，消除"同一文本因标点/全半角差异在库中分裂多条"。
--       存量行回填由 scripts/backfill-fp-normalized.ts 一次性执行。
-- 回滚：
--   ALTER TABLE "false_positive_library" DROP COLUMN IF EXISTS "normalized_text";
--   DROP INDEX IF EXISTS "false_positive_library_normalizedText_key";
-- =====================================================

ALTER TABLE "false_positive_library" ADD COLUMN IF NOT EXISTS "normalized_text" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "false_positive_library_normalizedText_key"
  ON "false_positive_library"("normalized_text");
