# ============================================
# 文档解析服务 - 精简 Docker 镜像（多阶段构建）
# 各格式使用独立的增强解析器（原生 Python 库）
# 支持 DOCX / XLSX / PDF / PPTX
# ============================================

# ============================================
# 阶段1: 编译阶段（安装编译工具 + 构建 lxml 等 C 扩展）
# 说明：lxml/markitdown 依赖一般有预编译 wheel，若 pypi 有 wheel
#       则可跳过此阶段（设为空）；仅当需要从源码编译时才启用。
# ============================================
FROM python:3.12-slim AS builder

WORKDIR /build

# 编译工具：仅当 pip 装 lxml 等 C 扩展没有 wheel 时才需要。
# 若网络/仓库受限，可注释掉下面 apt 段，pip 会尝试纯 wheel 安装。
# apt 源切换到阿里云镜像（deb.debian.org 在代理环境下 502 不稳定）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true && \
    sed -i 's|security.debian.org|mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    libxml2-dev \
    libxslt1-dev \
    || true

COPY requirements.txt .
# pip 源切换到阿里云镜像（files.pythonhosted.org 在代理环境下 SSL 连接被切断）
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ \
    --prefix=/install -r requirements.txt && \
    # rapidocr 依赖会同时拉 opencv-python（GUI 版），但容器无图形库（缺 libxcb.so.1）。
    # 强制卸载 GUI 版，只保留 opencv-python-headless（RapidOCR 场景的标准做法）。
    pip uninstall -y --prefix=/install opencv-python 2>/dev/null; \
    echo "opencv 清理完成"

# ============================================
# 阶段2: 运行阶段（仅运行时依赖，无编译工具）
# ============================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai \
    PORT=8000

WORKDIR /app

# 运行时系统库：antiword 用于 .doc 老格式文本提取（轻量 ~200KB，替代 libreoffice-writer 节省 ~550MB）
# libxml2/libxslt1.1 是 lxml wheel 运行期动态库，必须保留
# 已移除 poppler-utils（PDF 转图片改用 PyMuPDF 内置渲染）
# apt 源切换到阿里云镜像（deb.debian.org 在代理环境下 502 不稳定）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true && \
    sed -i 's|security.debian.org|mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    antiword \
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
# 固化 RapidOCR 模型（约 46MB），避免首次运行从 modelscope 下载（网络不稳定）
COPY models/ ./models/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://localhost:{os.environ.get(\"PORT\", \"8000\")}/health')" || exit 1

CMD ["python", "main.py"]
