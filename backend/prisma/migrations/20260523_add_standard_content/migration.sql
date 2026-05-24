-- 为标准库添加 content 字段，存储标准的全文内容
ALTER TABLE "standards" ADD COLUMN IF NOT EXISTS "content" TEXT;
