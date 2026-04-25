#!/bin/bash
# ============================================
# 文件智能审查系统 - 数据库备份脚本
# 用法: ./backup-db.sh [备份文件名前缀]
# 输出: backups/backup_YYYYMMDD_HHMMSS.sql.gz
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PREFIX="${1:-backup}"
BACKUP_FILE="${BACKUP_DIR}/${PREFIX}_${TIMESTAMP}.sql.gz"

# 数据库连接信息（与 docker-compose 一致）
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

echo "============================================"
echo "  数据库备份"
echo "============================================"
echo ""

# 创建备份目录
mkdir -p "${BACKUP_DIR}"

# 检查 pg_dump 是否可用
if ! command -v pg_dump &> /dev/null; then
    echo -e "${YELLOW}[WARN]${NC} 本地未安装 pg_dump，尝试使用 Docker 容器执行备份..."

    # 检查 postgres 容器是否运行
    if ! docker ps | grep -q "file_review_postgres"; then
        echo -e "${RED}[ERROR]${NC} PostgreSQL 容器未运行，无法备份"
        exit 1
    fi

    # 使用容器内的 pg_dump
    docker exec file_review_postgres pg_dump \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        --clean \
        --if-exists \
        --verbose | gzip > "${BACKUP_FILE}"
else
    # 使用本地 pg_dump
    PGPASSWORD="${DB_PASSWORD}" pg_dump \
        -h "${DB_HOST}" \
        -p "${DB_PORT}" \
        -U "${DB_USER}" \
        -d "${DB_NAME}" \
        --clean \
        --if-exists \
        --verbose | gzip > "${BACKUP_FILE}"
fi

if [ $? -eq 0 ] && [ -f "${BACKUP_FILE}" ] && [ -s "${BACKUP_FILE}" ]; then
    FILE_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}[SUCCESS]${NC} 备份完成: ${BACKUP_FILE}"
    echo -e "${BLUE}[INFO]${NC} 文件大小: ${FILE_SIZE}"
else
    echo -e "${RED}[ERROR]${NC} 备份失败"
    rm -f "${BACKUP_FILE}"
    exit 1
fi

echo ""
echo -e "${BLUE}[INFO]${NC} 最近5个备份:"
ls -lht "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | head -5 || echo "  无历史备份"
