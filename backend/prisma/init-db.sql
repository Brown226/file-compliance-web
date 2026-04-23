-- Initialize pgvector extension for the file compliance system
-- This script runs automatically when the PostgreSQL container starts for the first time
CREATE EXTENSION IF NOT EXISTS vector;
