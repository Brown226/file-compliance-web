#!/bin/bash
# ============================================
# 文件智能审查系统 - 离线镜像加载脚本 (Linux)
# 功能: 加载所有 Docker 镜像并验证
# ============================================

set -e

echo ""
echo "========================================"
echo "  文件智能审查系统 - 离线镜像加载"
echo "========================================"
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "[错误] Docker 未安装"
    echo "请先安装 Docker: https://docs.docker.com/engine/install/"
    exit 1
fi

echo "[检查] Docker 版本..."
docker --version
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 定义镜像列表
TOTAL_IMAGES=6
LOADED_COUNT=0
FAILED_COUNT=0

echo "[开始] 正在加载 Docker 镜像 (共 ${TOTAL_IMAGES} 个)..."
echo ""

# 1. 加载 PostgreSQL
echo "[1/6] 加载 PostgreSQL 数据库镜像..."
if [ -f "${SCRIPT_DIR}/pgvector-pg15.tar" ]; then
    if docker load -i "${SCRIPT_DIR}/pgvector-pg15.tar"; then
        echo "      ✓ PostgreSQL 镜像加载成功"
        ((LOADED_COUNT++))
    else
        echo "      ✗ PostgreSQL 镜像加载失败"
        ((FAILED_COUNT++))
    fi
else
    echo "      ✗ 文件不存在: pgvector-pg15.tar"
    ((FAILED_COUNT++))
fi
echo ""

# 2. 加载 Redis
echo "[2/6] 加载 Redis 缓存镜像..."
if [ -f "${SCRIPT_DIR}/redis-7-alpine.tar" ]; then
    if docker load -i "${SCRIPT_DIR}/redis-7-alpine.tar"; then
        echo "      ✓ Redis 镜像加载成功"
        ((LOADED_COUNT++))
    else
        echo "      ✗ Redis 镜像加载失败"
        ((FAILED_COUNT++))
    fi
else
    echo "      ✗ 文件不存在: redis-7-alpine.tar"
    ((FAILED_COUNT++))
fi
echo ""

# 3. 加载 MarkItDown
echo "[3/6] 加载 MarkItDown 解析服务镜像..."
if [ -f "${SCRIPT_DIR}/markitdown-v1.0.tar" ]; then
    if docker load -i "${SCRIPT_DIR}/markitdown-v1.0.tar"; then
        echo "      ✓ MarkItDown 镜像加载成功"
        ((LOADED_COUNT++))
    else
        echo "      ✗ MarkItDown 镜像加载失败"
        ((FAILED_COUNT++))
    fi
else
    echo "      ✗ 文件不存在: markitdown-v1.0.tar"
    ((FAILED_COUNT++))
fi
echo ""

# 4. 加载后端
echo "[4/6] 加载后端服务镜像..."
if [ -f "${SCRIPT_DIR}/backend-v1.0.tar" ]; then
    if docker load -i "${SCRIPT_DIR}/backend-v1.0.tar"; then
        echo "      ✓ 后端镜像加载成功"
        ((LOADED_COUNT++))
    else
        echo "      ✗ 后端镜像加载失败"
        ((FAILED_COUNT++))
    fi
else
    echo "      ✗ 文件不存在: backend-v1.0.tar"
    ((FAILED_COUNT++))
fi
echo ""

# 5. 加载前端
echo "[5/6] 加载前端服务镜像..."
if [ -f "${SCRIPT_DIR}/frontend-v1.0.tar" ]; then
    if docker load -i "${SCRIPT_DIR}/frontend-v1.0.tar"; then
        echo "      ✓ 前端镜像加载成功"
        ((LOADED_COUNT++))
    else
        echo "      ✗ 前端镜像加载失败"
        ((FAILED_COUNT++))
    fi
else
    echo "      ✗ 文件不存在: frontend-v1.0.tar"
    ((FAILED_COUNT++))
fi
echo ""

# 6. 加载 MaxKB
echo "[6/6] 加载 MaxKB 知识库镜像..."
if [ -f "${SCRIPT_DIR}/maxkb-images/maxkb.tar.gz" ]; then
    if docker load -i "${SCRIPT_DIR}/maxkb-images/maxkb.tar.gz"; then
        echo "      ✓ MaxKB 镜像加载成功"
        ((LOADED_COUNT++))
    else
        echo "      ✗ MaxKB 镜像加载失败"
        ((FAILED_COUNT++))
    fi
else
    echo "      ✗ 文件不存在: maxkb-images/maxkb.tar.gz"
    ((FAILED_COUNT++))
fi
echo ""

# 显示加载结果
echo "========================================"
echo "  镜像加载完成"
echo "========================================"
echo "  成功: ${LOADED_COUNT}/${TOTAL_IMAGES}"
echo "  失败: ${FAILED_COUNT}/${TOTAL_IMAGES}"
echo ""

if [ ${FAILED_COUNT} -gt 0 ]; then
    echo "[警告] 部分镜像加载失败，请检查文件完整性"
    echo ""
fi

# 显示已加载的镜像列表
echo "[信息] 当前系统中的相关镜像:"
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep -iE "file-review|pgvector|redis|maxkb|markitdown" || echo "  未找到相关镜像"
echo ""

if [ ${LOADED_COUNT} -eq ${TOTAL_IMAGES} ]; then
    echo "[成功] 所有镜像加载完成！"
    echo ""
    echo "下一步: 运行 ./deploy-offline.sh 启动服务"
    echo ""
else
    echo "[错误] 镜像加载不完整，无法启动服务"
    echo ""
    exit 1
fi
