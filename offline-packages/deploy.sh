#!/bin/bash
# ============================================
# 文件智能审查系统 - 离线部署脚本 (Linux)
# 使用 docker-compose 统一编排部署
# 包含: PostgreSQL + Redis + MarkItDown + 后端 + 前端 + MaxKB
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "============================================"
echo "  文件智能审查系统 - 离线部署"
echo "============================================"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERROR] Docker 未安装${NC}"
    exit 1
fi

# 检查 docker-compose
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    echo -e "${RED}[ERROR] docker-compose 未安装${NC}"
    exit 1
fi

echo -e "${BLUE}[INFO]${NC} Docker: $(docker --version)"
echo -e "${BLUE}[INFO]${NC} Compose: $COMPOSE_CMD"

# 检查镜像是否已加载
echo -e "${BLUE}[INFO]${NC} 检查 Docker 镜像..."
if ! docker images | grep -q "file-review-backend"; then
    echo -e "${YELLOW}[WARN]${NC} 未检测到预构建镜像，正在加载..."
    if [ -f "${SCRIPT_DIR}/load-images.sh" ]; then
        bash "${SCRIPT_DIR}/load-images.sh"
    else
        echo -e "${RED}[ERROR] 镜像未加载且找不到 load-images.sh${NC}"
        exit 1
    fi
fi

# 进入 compose 配置目录
cd "${SCRIPT_DIR}/compose-files"

# 检查配置文件
if [ ! -f "docker-compose.offline.yml" ]; then
    echo -e "${RED}[ERROR] 配置文件不存在: docker-compose.offline.yml${NC}"
    exit 1
fi

# 加载 compose-files/.env（若存在），让端口检查与 compose 实际映射一致
if [ -f ".env" ]; then
    set -a
    . ./.env
    set +a
fi

# ==========================================
# 端口占用检测
# ==========================================
echo ""
echo -e "${BLUE}[INFO]${NC} 检查端口占用情况..."

PORT_CONFLICT=0

# 定义需要检测的端口: 端口号=服务描述
declare -A PORTS=(
    [80]="前端Web"
    [3000]="后端API"
    [8080]="MaxKB"
    [8000]="MarkItDown"
    [5432]="PostgreSQL"
    [6379]="Redis"
)

# 支持环境变量自定义端口
FRONTEND_PORT=${FRONTEND_PORT:-80}
BACKEND_PORT=${BACKEND_PORT:-3000}
MAXKB_PORT=${MAXKB_PORT:-8080}
PARSER_PORT=${PARSER_PORT:-8000}
PG_PORT=${PG_PORT:-5432}
REDIS_PORT=${REDIS_PORT:-6379}

check_port() {
    local port=$1
    local name=$2
    if ss -tlnp 2>/dev/null | grep -q ":${port} " || netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
        echo -e "  ${RED}[占用]${NC} 端口 ${port} (${name}) 已被占用"
        return 1
    else
        echo -e "  ${GREEN}[空闲]${NC} 端口 ${port} (${name})"
        return 0
    fi
}

check_port ${FRONTEND_PORT} "前端Web" || PORT_CONFLICT=1
check_port ${BACKEND_PORT} "后端API" || PORT_CONFLICT=1
check_port ${MAXKB_PORT} "MaxKB" || PORT_CONFLICT=1
check_port ${PARSER_PORT} "MarkItDown" || PORT_CONFLICT=1
check_port ${PG_PORT} "PostgreSQL" || PORT_CONFLICT=1
check_port ${REDIS_PORT} "Redis" || PORT_CONFLICT=1

if [ ${PORT_CONFLICT} -eq 1 ]; then
    echo ""
    echo -e "${RED}[ERROR]${NC} 存在端口冲突，请先释放上述端口或设置环境变量指定其他端口:"
    echo "  FRONTEND_PORT=8081  BACKEND_PORT=3001  MAXKB_PORT=8082  ./deploy.sh"
    echo ""
    echo "或在 compose-files/.env 文件中配置:"
    echo "  FRONTEND_PORT=8081"
    echo "  BACKEND_PORT=3001"
    echo "  MAXKB_PORT=8082"
    exit 1
fi

echo -e "${GREEN}[OK]${NC} 所有端口均可用"

# ==========================================
# 启动服务
# ==========================================
echo ""
echo -e "${BLUE}[INFO]${NC} 使用 docker-compose 启动所有服务..."
echo ""

# 清理本项目的旧容器（含旧版容器名，不影响其他项目）
echo -e "${BLUE}[INFO]${NC} 清理本项目旧容器..."
for c in file_review_postgres file_review_redis file_review_markitdown file_review_maxkb_pgsql file_review_maxkb_redis file_review_maxkb file_review_backend file_review_frontend markitdown_service maxkb maxkb-pgsql maxkb-redis; do
    docker rm -f "$c" 2>/dev/null || true
done

$COMPOSE_CMD -f docker-compose.offline.yml up -d

echo ""
echo -e "${BLUE}[INFO]${NC} 等待服务就绪（约60秒，MaxKB 启动较慢）..."
sleep 60

# 检查服务状态
echo ""
echo "============================================"
echo "  服务状态"
echo "============================================"
$COMPOSE_CMD -f docker-compose.offline.yml ps

echo ""
echo "============================================"
echo -e "  ${GREEN}部署完成!${NC}"
echo "============================================"
echo ""
echo "访问地址:"
echo "  - Web UI:   http://localhost:${FRONTEND_PORT}"
echo "  - API:      http://localhost:${BACKEND_PORT}/api"
echo "  - MaxKB:    http://localhost:${MAXKB_PORT}"
echo "  - 健康检查:  http://localhost:${BACKEND_PORT}/health"
echo ""
echo "初始账号:"
echo "  - 管理员: admin / admin123"
echo "  - 主管:   zhangsan / 123456"
echo "  - 员工:   lisi / 123456"
echo ""
echo "常用命令:"
echo "  - 查看日志: $COMPOSE_CMD -f docker-compose.offline.yml logs -f [服务名]"
echo "  - 停止服务: $COMPOSE_CMD -f docker-compose.offline.yml down"
echo "  - 重启服务: $COMPOSE_CMD -f docker-compose.offline.yml restart"
echo ""
