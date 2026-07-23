# ============================================
# 文档解析服务 - 精简 Docker 镜像（多阶段构建）
# 各格式使用独立的增强解析器（原生 Python 库）
# 支持 DOCX / XLSX / PDF / PPTX
# ============================================

# ============================================
# 阶段1: 编译阶段（安装编译工具 + 构建 lxml 等 C 扩展）
# ============================================
FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ============================================
# 阶段2: 运行阶段（仅运行时依赖，无编译工具）
# ============================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai \
    PORT=8000

WORKDIR /app

# 仅安装运行时系统库（libreoffice 用于 .doc 转换），不装 gcc/编译头文件
# 已移除 poppler-utils（PDF 转图片改用 PyMuPDF 内置渲染）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libxml2 \
    libxslt1.1 \
    && rm -rf /var/lib/apt/lists/*

# 从 builder 阶段复制已编译的 Python 包
COPY --from=builder /install /usr/local

# 复制服务代码
COPY main.py .
COPY pdf_enhanced.py .
COPY docx_enhanced.py .
COPY xlsx_enhanced.py .
COPY pptx_enhanced.py .
COPY vision_ocr.py .
COPY rapid_ocr.py .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\", \"8000\")}/health')" || exit 1

CMD ["python", "main.py"]
