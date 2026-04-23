#!/bin/bash
# ============================================
# 文件智能审查系统 - 离线镜像加载脚本 (Linux)
# 在目标服务器上执行此脚本
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "============================================"
echo "  文件智能审查系统 - 离线镜像加载"
echo "============================================"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker 未安装，请先安装 Docker"
    exit 1
fi

echo "[INFO] 检测到 Docker: $(docker --version)"
echo ""

# 加载所有 tar 镜像
echo "[INFO] 开始加载基础镜像..."
for tar in "${SCRIPT_DIR}"/*.tar; do
    if [ -f "$tar" ]; then
        echo "[INFO] 加载镜像: $(basename "$tar")"
        if docker load -i "$tar"; then
            echo "[SUCCESS] 加载成功: $(basename "$tar")"
        else
            echo "[ERROR] 加载失败: $(basename "$tar")"
        fi
        echo ""
    fi
done

# 加载 MaxKB 镜像
if [ -d "${SCRIPT_DIR}/maxkb-images" ]; then
    echo "[INFO] 开始加载 MaxKB 镜像..."
    for tar in "${SCRIPT_DIR}/maxkb-images"/*.tar; do
        if [ -f "$tar" ]; then
            echo "[INFO] 加载: $(basename "$tar")"
            if docker load -i "$tar"; then
                echo "[SUCCESS] 加载成功: $(basename "$tar")"
            else
                echo "[ERROR] 加载失败: $(basename "$tar")"
            fi
            echo ""
        fi
    done
fi

echo ""
echo "============================================"
echo "  镜像加载完成!"
echo "============================================"
echo ""
echo "[INFO] 已加载的镜像:"
docker images | grep -E "file-review|pgvector|redis|maxkb" || true
echo ""
echo "[INFO] 下一步操作:"
echo "  1. 复制 compose-files 目录到服务器"
echo "  2. 进入 compose-files 目录"
echo "  3. 执行: docker-compose -f docker-compose.offline.yml up -d"
echo ""
