# ============================================
# MarkItDown 文档解析服务 - Docker 镜像
# 支持 DOCX / XLSX / PDF / PPTX
# DWG 已改为前端 WASM 解析（@mlightcad/libredwg-web），后端不再处理
# 端口通过 PORT 环境变量配置，默认 8000
# ============================================

FROM python:3.12-slim AS base

# 设置时区和编码
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

WORKDIR /app

# 安装系统依赖（lxml 编译需要）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖（含格式依赖 + markitdown 运行时依赖）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制 markitdown 包源码到 site-packages（跳过 pip/hatchling 构建）
# markitdown 是纯 Python 包，源码直接放入 site-packages 即可使用
COPY vendor/markitdown/src/markitdown/ /usr/local/lib/python3.12/site-packages/markitdown/

# 复制服务代码
COPY main.py .
COPY engine.py .

# 暴露端口（默认 8000，可通过 PORT 环境变量修改）
EXPOSE 8000

# 健康检查（使用 PORT 环境变量）
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\", \"8000\")}/health')" || exit 1

# 启动
CMD ["python", "main.py"]
