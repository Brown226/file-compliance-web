#!/bin/bash
# ============================================
# 文件智能审查系统 - 离线镜像加载脚本 (Linux)
# 用于内网环境加载离线 Docker 镜像
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo "  开始加载离线镜像"
echo "============================================"
echo ""

# 加载所有 tar 镜像（主服务）
for f in "${SCRIPT_DIR}"/*.tar; do
    if [ -f "$f" ]; then
        echo "加载镜像: $(basename "$f")"
        docker load -i "$f"
    fi
done

# 加载 MaxKB 镜像
if [ -d "${SCRIPT_DIR}/maxkb-images" ]; then
    echo ""
    echo "加载 MaxKB 镜像..."
    for f in "${SCRIPT_DIR}/maxkb-images/"*; do
        if [ -f "$f" ]; then
            echo "加载: $(basename "$f")"
            docker load -i "$f"
        fi
    done
else
    echo "[WARN] 未找到 maxkb-images 目录，MaxKB 镜像未加载"
fi

echo ""
echo "============================================"
echo "  镜像加载完成!"
echo "============================================"
echo ""
docker images | grep -iE "file-review|pgvector|redis|maxkb"

echo ""
