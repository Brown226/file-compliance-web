#!/bin/bash
# ============================================
# 文件智能审查系统 - 离线镜像打包脚本
# 功能: 构建所有 Docker 镜像并导出为 tar 文件
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/offline-packages"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 创建输出目录
mkdir -p "${OUTPUT_DIR}"
cd "${SCRIPT_DIR}"

echo "============================================"
echo "  文件智能审查系统 - 离线镜像打包"
echo "============================================"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker 未安装，请先安装 Docker"
    exit 1
fi

log_info "检查 Docker 版本..."
docker --version

# ==========================================
# 步骤 0: 编译前端和后端（必须先编译，Docker 镜像需要产物）
# ==========================================
if [ "${SKIP_BUILD}" != "1" ]; then
    log_info "步骤 0: 编译前端和后端..."

    # 编译前端
    log_info "编译前端..."
    (cd frontend && npm run build)
    if [ $? -ne 0 ]; then
        log_error "前端编译失败"
        exit 1
    fi
    log_success "前端编译完成"

    # 编译后端
    log_info "编译后端..."
    (cd backend && npm run build)
    if [ $? -ne 0 ]; then
        log_error "后端编译失败"
        exit 1
    fi
    log_success "后端编译完成"
else
    log_warn "跳过编译步骤（SKIP_BUILD=1）"
fi

# 1. 构建/导出 pgvector 镜像
log_info "步骤 1/7: 处理 PostgreSQL (pgvector) 镜像..."
PG_IMAGE="pgvector/pgvector:pg15"
PG_OUTPUT="${OUTPUT_DIR}/pgvector-pg15.tar"
if docker image inspect "${PG_IMAGE}" &> /dev/null; then
    if [ ! -f "${PG_OUTPUT}" ]; then
        log_info "导出镜像: ${PG_IMAGE} -> ${PG_OUTPUT}"
        docker save -o "${PG_OUTPUT}" "${PG_IMAGE}"
        log_success "已导出: ${PG_OUTPUT}"
    else
        log_warn "已存在，跳过: ${PG_OUTPUT}"
    fi
else
    log_error "镜像不存在，请先拉取: ${PG_IMAGE}"
fi

# 2. 构建/导出 Redis 镜像
log_info "步骤 2/7: 处理 Redis 镜像..."
REDIS_IMAGE="redis:7-alpine"
REDIS_OUTPUT="${OUTPUT_DIR}/redis-7-alpine.tar"
if docker image inspect "${REDIS_IMAGE}" &> /dev/null; then
    if [ ! -f "${REDIS_OUTPUT}" ]; then
        log_info "导出镜像: ${REDIS_IMAGE} -> ${REDIS_OUTPUT}"
        docker save -o "${REDIS_OUTPUT}" "${REDIS_IMAGE}"
        log_success "已导出: ${REDIS_OUTPUT}"
    else
        log_warn "已存在，跳过: ${REDIS_OUTPUT}"
    fi
else
    log_error "镜像不存在，请先拉取: ${REDIS_IMAGE}"
fi

# 3. 构建 MarkItDown 镜像
log_info "步骤 3/7: 构建 MarkItDown 文档解析服务..."
MARKITDOWN_IMAGE="file-review-markitdown:v1.0"
MARKITDOWN_CONTEXT="./backend/markitdown-service"
if [ -f "${MARKITDOWN_CONTEXT}/Dockerfile" ]; then
    log_info "构建镜像: ${MARKITDOWN_IMAGE}"
    docker build -t "${MARKITDOWN_IMAGE}" -f "${MARKITDOWN_CONTEXT}/Dockerfile" "${MARKITDOWN_CONTEXT}"
    MARKITDOWN_OUTPUT="${OUTPUT_DIR}/markitdown-v1.0.tar"
    docker save -o "${MARKITDOWN_OUTPUT}" "${MARKITDOWN_IMAGE}"
    log_success "已导出: ${MARKITDOWN_OUTPUT}"
else
    log_error "Dockerfile 不存在: ${MARKITDOWN_CONTEXT}/Dockerfile"
fi

# 4. 构建后端镜像
log_info "步骤 4/7: 构建后端 API 服务..."
BACKEND_IMAGE="file-review-backend:v1.0"
if [ -f "Dockerfile.backend" ]; then
    log_info "构建镜像: ${BACKEND_IMAGE}"
    docker build -t "${BACKEND_IMAGE}" -f Dockerfile.backend .
    BACKEND_OUTPUT="${OUTPUT_DIR}/backend-v1.0.tar"
    docker save -o "${BACKEND_OUTPUT}" "${BACKEND_IMAGE}"
    log_success "已导出: ${BACKEND_OUTPUT}"
else
    log_error "Dockerfile.backend 不存在"
fi

# 5. 构建前端镜像
log_info "步骤 5/7: 构建前端 Web 服务..."
FRONTEND_IMAGE="file-review-frontend:v1.0"
if [ -f "Dockerfile.frontend" ]; then
    log_info "构建镜像: ${FRONTEND_IMAGE}"
    docker build -t "${FRONTEND_IMAGE}" -f Dockerfile.frontend .
    FRONTEND_OUTPUT="${OUTPUT_DIR}/frontend-v1.0.tar"
    docker save -o "${FRONTEND_OUTPUT}" "${FRONTEND_IMAGE}"
    log_success "已导出: ${FRONTEND_OUTPUT}"
else
    log_error "Dockerfile.frontend 不存在"
fi

# 6. 处理 MaxKB 镜像（如果存在）
log_info "步骤 6/7: 处理 MaxKB 知识库镜像..."
MAXKB_SOURCE="./maxkb-v2.8.0-x86_64-offline-installer/maxkb-v2.8.0-x86_64-offline-installer/images"
if [ -d "${MAXKB_SOURCE}" ]; then
    log_info "找到 MaxKB 离线镜像目录: ${MAXKB_SOURCE}"
    MAXKB_OUTPUT="${OUTPUT_DIR}/maxkb-images"
    mkdir -p "${MAXKB_OUTPUT}"
    for img in "${MAXKB_SOURCE}"/*.tar; do
        if [ -f "$img" ]; then
            img_name=$(basename "$img")
            cp "$img" "${MAXKB_OUTPUT}/${img_name}"
            log_success "复制: $img -> ${MAXKB_OUTPUT}/${img_name}"
        fi
    done
else
    log_warn "MaxKB 离线镜像目录不存在，跳过"
fi

# 7. 复制 docker-compose 配置文件
log_info "步骤 7/7: 复制部署配置文件..."
COMPOSE_OUTPUT="${OUTPUT_DIR}/compose-files"
mkdir -p "${COMPOSE_OUTPUT}"

# 主配置文件
cp docker-compose.complete.yml "${COMPOSE_OUTPUT}/"
cp docker-compose.offline.yml "${COMPOSE_OUTPUT}/"

# 环境变量模板
cp .env.offline "${COMPOSE_OUTPUT}/"
cp .env.production "${COMPOSE_OUTPUT}/"

# Nginx 配置
cp nginx.conf "${COMPOSE_OUTPUT}/"

# Prisma 初始化脚本
cp backend/prisma/init-db.sql "${COMPOSE_OUTPUT}/"

log_success "已复制配置文件到: ${COMPOSE_OUTPUT}"

# 生成镜像清单
echo ""
echo "============================================"
echo "  镜像打包完成!"
echo "============================================"
echo ""
log_info "镜像清单:"
echo ""
ls -lh "${OUTPUT_DIR}"/*.tar 2>/dev/null || true
ls -lh "${OUTPUT_DIR}" 2>/dev/null || true

# 生成镜像加载脚本
cat > "${OUTPUT_DIR}/load-images.sh" << 'LOADSCRIPT'
#!/bin/bash
# 离线镜像加载脚本
# 在目标服务器上执行

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "============================================"
echo "  开始加载离线镜像"
echo "============================================"

# 加载所有 tar 镜像
for tar in "${SCRIPT_DIR}"/*.tar; do
    if [ -f "$tar" ]; then
        echo "加载镜像: $(basename "$tar")"
        docker load -i "$tar"
    fi
done

# 加载 MaxKB 镜像（如果存在）
if [ -d "${SCRIPT_DIR}/maxkb-images" ]; then
    echo ""
    echo "加载 MaxKB 镜像..."
    for tar in "${SCRIPT_DIR}/maxkb-images"/*.tar; do
        if [ -f "$tar" ]; then
            echo "加载: $(basename "$tar")"
            docker load -i "$tar"
        fi
    done
fi

echo ""
echo "镜像加载完成!"
docker images | grep -E "file-review|pgvector|redis|maxkb" || true
LOADSCRIPT

chmod +x "${OUTPUT_DIR}/load-images.sh"
log_success "已生成镜像加载脚本: ${OUTPUT_DIR}/load-images.sh"

# 生成总大小统计
echo ""
echo "============================================"
echo "  离线包统计"
echo "============================================"
du -sh "${OUTPUT_DIR}"/* 2>/dev/null | sort -h || true
echo ""
total_size=$(du -sh "${OUTPUT_DIR}" 2>/dev/null | cut -f1)
log_info "总大小: ${total_size}"

echo ""
log_success "离线打包完成! 文件位于: ${OUTPUT_DIR}"
echo ""
