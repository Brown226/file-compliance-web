-- Remove FULL_REVIEW from ReviewMode enum (兼容 PostgreSQL < 12)

-- 1. 将使用 FULL_REVIEW 的记录迁移为 LIBRARY_REVIEW（安全兜底）
UPDATE "tasks" SET "reviewMode" = 'LIBRARY_REVIEW' WHERE "reviewMode" = 'FULL_REVIEW';

-- 2. 先清除列默认值（旧默认值 FULL_REVIEW 在新枚举中不存在）
ALTER TABLE "tasks" ALTER COLUMN "reviewMode" DROP DEFAULT;

-- 3. 创建新的枚举类型（不含 FULL_REVIEW）
CREATE TYPE "ReviewMode_new" AS ENUM (
  'LIBRARY_REVIEW',
  'DOC_REVIEW',
  'CONSISTENCY',
  'TYPO_GRAMMAR',
  'MULTIMODAL',
  'CUSTOM_RULE',
  'SELF_CHECK'
);

-- 4. 转移列数据到新枚举
ALTER TABLE "tasks" ALTER COLUMN "reviewMode" TYPE "ReviewMode_new"
  USING "reviewMode"::text::"ReviewMode_new";

-- 5. 设置新默认值
ALTER TABLE "tasks" ALTER COLUMN "reviewMode" SET DEFAULT 'LIBRARY_REVIEW';

-- 6. 删除旧枚举，重命名新枚举
DROP TYPE "ReviewMode";
ALTER TYPE "ReviewMode_new" RENAME TO "ReviewMode";
