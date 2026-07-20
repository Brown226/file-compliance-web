"""
记忆存储与检索服务
使用 pgvector 进行向量相似度搜索
"""
import os
import logging
from datetime import datetime, timedelta
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

from service.memory.embedding_service import get_embedding, EMBEDDING_DIMENSION

load_dotenv()
logger = logging.getLogger(__name__)

# 去重阈值：相似度超过此值认为是重复记忆
DEDUP_THRESHOLD = 0.9
# 召回阈值：相似度超过此值才返回
RECALL_THRESHOLD = 0.5
# 默认召回数量
DEFAULT_RECALL_LIMIT = 5


def _get_conn_str() -> str:
    """从环境变量获取 PostgreSQL 连接字符串"""
    return os.getenv(
        "POSTGRES_URL",
        "postgresql://archspec:archspec_doc_pass@localhost:5433/doc_generator",
    )


def _get_connection():
    """获取数据库连接"""
    return psycopg.connect(_get_conn_str(), row_factory=dict_row)


def ensure_table():
    """确保 user_memory 表和 pgvector 扩展存在"""
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS user_memory (
                        id BIGSERIAL PRIMARY KEY,
                        user_id VARCHAR(50) NOT NULL,
                        content TEXT NOT NULL,
                        embedding vector({EMBEDDING_DIMENSION}),
                        chapter_name VARCHAR(200),
                        source_type VARCHAR(50) DEFAULT 'requirement',
                        category VARCHAR(50) DEFAULT 'other',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_user_memory_user_id
                    ON user_memory(user_id)
                """)
                # 兼容升级：已有表添加 category 列
                cur.execute("""
                    ALTER TABLE user_memory
                    ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'other'
                """)
            conn.commit()
        logger.info("user_memory table ensured")
    except Exception as e:
        logger.error(f"Failed to ensure user_memory table: {e}")


def save_memory(
    user_id: str,
    content: str,
    chapter_name: str = None,
    source_type: str = "requirement",
    category: str = "other",
) -> dict | None:
    """
    保存一条记忆。自动去重：如果已有高度相似的记忆则跳过。
    返回保存的记忆 dict，如果去重跳过则返回 None。
    """
    if not content or not content.strip():
        return None

    content = content.strip()
    embedding = get_embedding(content)
    if embedding is None:
        logger.warning(f"Failed to get embedding, saving memory without vector")

    # 去重检查
    if embedding:
        similar = _find_similar(user_id, embedding, threshold=DEDUP_THRESHOLD, limit=1)
        if similar:
            logger.info(
                f"Duplicate memory skipped (similarity={similar[0]['similarity']:.3f}): "
                f"{content[:50]}..."
            )
            return None

    # LLM 分类提取（异步，失败不阻塞）
    if category == "other":
        try:
            from service.memory.extraction_service import extract_memory_category
            category = extract_memory_category(content)
        except Exception as e:
            logger.warning(f"Category extraction failed (using 'other'): {e}")

    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                if embedding:
                    cur.execute(
                        """
                        INSERT INTO user_memory (user_id, content, embedding, chapter_name, source_type, category)
                        VALUES (%s, %s, %s::vector, %s, %s, %s)
                        RETURNING id, user_id, content, chapter_name, source_type, category, created_at
                        """,
                        (user_id, content, str(embedding), chapter_name, source_type, category),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO user_memory (user_id, content, chapter_name, source_type, category)
                        VALUES (%s, %s, %s, %s, %s)
                        RETURNING id, user_id, content, chapter_name, source_type, category, created_at
                        """,
                        (user_id, content, chapter_name, source_type, category),
                    )
                row = cur.fetchone()
            conn.commit()
            logger.info(f"Memory saved: id={row['id']}, user={user_id}, category={category}")
            return _row_to_dict(row)
    except Exception as e:
        logger.error(f"Failed to save memory: {e}")
        return None


def recall_memories(
    user_id: str,
    query: str,
    limit: int = DEFAULT_RECALL_LIMIT,
    threshold: float = RECALL_THRESHOLD,
    chapter_names: list[str] = None,
    days_limit: int = None,
) -> list[dict]:
    """
    根据查询文本召回相关记忆。
    返回按相似度降序排列的记忆列表。

    Args:
        chapter_names: 只召回指定章节的记忆
        days_limit: 只召回最近 N 天的记忆
    """
    embedding = get_embedding(query)
    if embedding is None:
        return []

    return _find_similar(
        user_id, embedding,
        threshold=threshold, limit=limit,
        chapter_names=chapter_names, days_limit=days_limit,
    )


def list_memories(user_id: str, limit: int = 50, offset: int = 0) -> list[dict]:
    """列出用户的所有记忆"""
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, user_id, content, chapter_name, source_type, category, created_at
                    FROM user_memory
                    WHERE user_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (user_id, limit, offset),
                )
                rows = cur.fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Failed to list memories: {e}")
        return []


def delete_memory(memory_id: int, user_id: str) -> bool:
    """删除一条记忆（需验证 user_id 归属）"""
    try:
        with _get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM user_memory WHERE id = %s AND user_id = %s",
                    (memory_id, user_id),
                )
                deleted = cur.rowcount > 0
            conn.commit()
        return deleted
    except Exception as e:
        logger.error(f"Failed to delete memory {memory_id}: {e}")
        return False


def _find_similar(
    user_id: str,
    embedding: list[float],
    threshold: float = RECALL_THRESHOLD,
    limit: int = DEFAULT_RECALL_LIMIT,
    chapter_names: list[str] = None,
    days_limit: int = None,
) -> list[dict]:
    """向量相似度搜索，支持章节和时间过滤"""
    try:
        embedding_str = str(embedding)
        with _get_connection() as conn:
            with conn.cursor() as cur:
                conditions = [
                    "user_id = %s",
                    "embedding IS NOT NULL",
                    "1 - (embedding <=> %s::vector) > %s",
                ]
                # SELECT 中的 similarity 计算参数放在最前面
                params: list = [embedding_str]
                # WHERE 子句参数
                where_params: list = [user_id, embedding_str, threshold]

                if chapter_names:
                    conditions.append("chapter_name = ANY(%s)")
                    where_params.append(chapter_names)

                if days_limit is not None and days_limit > 0:
                    conditions.append("created_at >= %s")
                    where_params.append(datetime.now() - timedelta(days=days_limit))

                where_clause = " AND ".join(conditions)
                params.extend(where_params)
                params.append(limit)

                cur.execute(
                    f"""
                    SELECT id, user_id, content, chapter_name, source_type, category, created_at,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM user_memory
                    WHERE {where_clause}
                    ORDER BY similarity DESC
                    LIMIT %s
                    """,
                    params,
                )
                rows = cur.fetchall()
        return [_row_to_dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Vector search failed: {e}")
        return []


def _row_to_dict(row: dict) -> dict:
    """将数据库行转为返回格式"""
    result = {
        "id": row["id"],
        "user_id": row["user_id"],
        "content": row["content"],
        "chapter_name": row.get("chapter_name"),
        "source_type": row.get("source_type"),
        "category": row.get("category", "other"),
        "created_at": row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
    }
    if "similarity" in row:
        result["similarity"] = round(row["similarity"], 4)
    return result
