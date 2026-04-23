#!/bin/bash
# ============================================
# 文件智能审查系统 - 一键离线部署脚本 (Linux)
# 功能: 加载镜像 -> 初始化环境 -> 启动服务 -> 健康检查
# ============================================

set -e

echo ""
echo "========================================"
echo "  文件智能审查系统 - 一键离线部署"
echo "========================================"
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "[错误] Docker 未安装"
    echo "请先安装 Docker: https://docs.docker.com/engine/install/"
    exit 1
fi

# 检测 Docker Compose 命令
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    echo "[错误] Docker Compose 未安装"
    exit 1
fi

echo "[检查] Docker Compose 版本..."
$COMPOSE_CMD version
echo ""

# 切换到脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/compose-files"

# 检查环境变量文件
if [ ! -f ".env.offline" ]; then
    echo "[错误] 配置文件缺失: .env.offline"
    exit 1
fi

echo "[步骤 1/4] 检查并加载 Docker 镜像..."
echo ""
cd ..
bash load-images.sh
if [ $? -ne 0 ]; then
    echo "[错误] 镜像加载失败"
    exit 1
fi
cd compose-files
echo ""

echo "[步骤 2/4] 初始化环境配置..."
echo ""
# 复制环境变量文件
if [ -f ".env.production" ]; then
    cp -f .env.production .env
    echo "      ✓ 环境配置文件已就绪"
else
    echo "      ⚠ 使用默认配置"
fi
echo ""

echo "[步骤 3/4] 启动所有服务..."
echo ""
echo "      正在启动容器组，请稍候..."
echo "      (首次启动可能需要 2-3 分钟)"
echo ""

$COMPOSE_CMD -f docker-compose.offline.yml up -d

if [ $? -ne 0 ]; then
    echo ""
    echo "[错误] 服务启动失败"
    echo "请检查日志: $COMPOSE_CMD -f docker-compose.offline.yml logs"
    exit 1
fi

echo "      ✓ 容器启动命令已发送"
echo ""

echo "[步骤 4/4] 服务健康检查..."
echo ""

# 等待服务启动
echo "      等待服务初始化 (30秒)..."
sleep 30

# 检查各个服务状态
CHECK_PASSED=0
CHECK_TOTAL=6

check_service() {
    local service_name=$1
    local display_name=$2
    
    if $COMPOSE_CMD -f docker-compose.offline.yml ps "$service_name" | grep -q "Up"; then
        echo "        ✓ $display_name 运行正常"
        ((CHECK_PASSED++))
    else
        echo "        ✗ $display_name 启动异常"
    fi
}

echo "      检查 PostgreSQL 数据库..."
check_service "postgres" "PostgreSQL"

echo "      检查 Redis 缓存..."
check_service "redis" "Redis"

echo "      检查 MarkItDown 解析服务..."
check_service "markitdown" "MarkItDown"

echo "      检查后端 API 服务..."
check_service "backend" "后端服务"

echo "      检查前端 Web 服务..."
check_service "frontend" "前端服务"

echo "      检查 MaxKB 知识库..."
check_service "maxkb" "MaxKB"

echo ""
echo "========================================"
echo "  部署结果"
echo "========================================"
echo "  健康检查: ${CHECK_PASSED}/${CHECK_TOTAL} 通过"
echo ""

if [ $CHECK_PASSED -eq $CHECK_TOTAL ]; then
    echo "[成功] 系统部署完成！"
    echo ""
    echo "📊 访问地址:"
    echo "   前端界面: http://localhost"
    echo "   后端API:  http://localhost:3000/api"
    echo "   健康检查: http://localhost:3000/health"
    echo ""
    echo "🔑 默认账号:"
    echo "   用户名: admin"
    echo "   密码:   admin123"
    echo ""
    echo "📝 常用命令:"
    echo "   查看日志:   $COMPOSE_CMD -f docker-compose.offline.yml logs -f"
    echo "   停止服务:   $COMPOSE_CMD -f docker-compose.offline.yml down"
    echo "   重启服务:   $COMPOSE_CMD -f docker-compose.offline.yml restart"
    echo ""
else
    echo "[警告] 部分服务启动异常"
    echo ""
    echo "请执行以下命令查看详细日志:"
    echo "   $COMPOSE_CMD -f docker-compose.offline.yml logs"
    echo ""
    exit 1
fi
