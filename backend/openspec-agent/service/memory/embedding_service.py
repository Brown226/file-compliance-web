"""
千问 text-embedding-v3 向量化服务
"""
import os
import logging
import dashscope

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-v3"
EMBEDDING_DIMENSION = 1024


def get_embedding(text: str) -> list[float] | None:
    """调用千问 embedding API 获取文本向量"""
    if not text or not text.strip():
        return None

    try:
        response = dashscope.TextEmbedding.call(
            model=EMBEDDING_MODEL,
            input=text.strip(),
            dimension=EMBEDDING_DIMENSION,
            api_key=os.getenv("DASHSCOPE_API_KEY"),
        )
        if response.status_code == 200:
            return response.output["embeddings"][0]["embedding"]
        else:
            logger.error(f"Embedding API error: {response.code} - {response.message}")
            return None
    except Exception as e:
        logger.error(f"Embedding call failed: {e}")
        return None


def get_embeddings_batch(texts: list[str]) -> list[list[float] | None]:
    """批量获取文本向量"""
    if not texts:
        return []

    try:
        response = dashscope.TextEmbedding.call(
            model=EMBEDDING_MODEL,
            input=[t.strip() for t in texts if t and t.strip()],
            dimension=EMBEDDING_DIMENSION,
            api_key=os.getenv("DASHSCOPE_API_KEY"),
        )
        if response.status_code == 200:
            return [item["embedding"] for item in response.output["embeddings"]]
        else:
            logger.error(f"Batch embedding API error: {response.code} - {response.message}")
            return [None] * len(texts)
    except Exception as e:
        logger.error(f"Batch embedding call failed: {e}")
        return [None] * len(texts)
