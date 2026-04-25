-- 检查 LLM 配置是否正确保存到数据库
SELECT key, value, "updatedAt" 
FROM "SystemConfig" 
WHERE key IN ('llm_chat_model', 'llm_ocr_model')
ORDER BY key;

-- 如果上面的查询没有结果，说明配置根本没有保存
-- 如果有结果，检查 value 字段的内容是否正确
