-- Fix double-serialized JSONB values - extract inner text and parse as JSON
UPDATE system_configs 
SET value = (value #>> '{}')::jsonb 
WHERE key = 'llm_chat_model' 
  AND jsonb_typeof(value) = 'string';
