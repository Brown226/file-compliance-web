#!/bin/bash
# ============================================
# 文件智能审查系统 - 数据库恢复脚本
# 用法: ./restore-db.sh <备份文件路径>
# 警告: 会覆盖当前数据库所有数据！
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 数据库连接信息
DB_USER="file_review_user"
DB_PASSWORD="file_review_password"
DB_NAME="file_review_db"
DB_HOST="localhost"
DB_PORT="5432"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$1" ]; then
    echo -e "${RED}[ERROR]${NC} 用法: $0 <备份文件路径>"
    echo ""
    echo "可用备份:"
    ls -1ht "${SCRIPT_DIR}/backups"/*.sql* 2>/dev/null || echo "  无备份文件"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}[ERROR]${NC} 备份文件不存在: $BACKUP_FILE"
    exit 1
fi

echo "============================================"
echo -e "  ${YELLOW}数据库恢复${NC}"
echo "============================================"
echo ""
echo -e "${RED}⚠️  警告: 此操作将覆盖当前数据库所有数据！${NC}"
echo ""
read -p "确认恢复? 输入 'yes' 继续: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "已取消"
    exit 0
fi

echo ""
echo -e "${BLUE}[INFO]${NC} 正在恢复数据库..."

# 检查 postgres 容器是否运行
if ! docker ps | grep -q "file_review_postgres"; then
    echo -e "${RED}[ERROR]${NC} PostgreSQL 容器未运行"
    exit 1
fi

# 解压（如果是 gz 文件）
if [[ "$BACKUP_FILE" == *.gz ]]; then
    echo -e "${BLUE}[INFO]${NC} 解压备份文件..."
    gunzip -c "$BACKUP_FILE" | docker exec -i file_review_postgres psql -U "$DB_USER" -d "$DB_NAME"
else
    cat "$BACKUP_FILE" | docker exec -i file_review_postgres psql -U "$DB_USER" -d "$DB_NAME"
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} 数据库恢复完成"
    echo ""
    echo -e "${YELLOW}[IMPORTANT]${NC} 请重启后端服务以应用恢复后的数据:"
    echo "  docker-compose -f docker-compose.offline.yml restart backend"
else
    echo -e "${RED}[ERROR]${NC} 恢复失败"
    exit 1
fi
