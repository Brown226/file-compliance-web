#!/bin/sh
# ============================================
# 文件智能审查系统 - 后端容器入口脚本
# 功能: 自动执行数据库迁移/初始化，然后启动服务
# ============================================

set -e

echo "[entrypoint] ============================================"
echo "[entrypoint] 文件智能审查系统 - 容器启动"
echo "[entrypoint] ============================================"
echo ""

# 使用项目自带的 Prisma CLI（避免 npx 下载最新版）
PRISMA="node ./node_modules/prisma/build/index.js"

# ==========================================
# 从 DATABASE_URL 中提取主机和端口用于连通性检测
# ==========================================
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')

echo "[entrypoint] 等待数据库就绪 (${DB_HOST}:${DB_PORT})..."
RETRIES=30
until node -e "
const net = require('net');
const sock = net.createConnection(${DB_PORT:-5432}, '${DB_HOST:-postgres}');
sock.on('connect', () => { sock.end(); process.exit(0); });
sock.on('error', () => { setTimeout(() => process.exit(1), 500); });
" 2>/dev/null; do
  echo "[entrypoint] 等待数据库连接... ($RETRIES 次重试剩余)"
  RETRIES=$((RETRIES - 1))
  sleep 2
  if [ $RETRIES -eq 0 ]; then
    echo "[entrypoint] ❌ 数据库连接超时，退出"
    exit 1
  fi
done

echo "[entrypoint] ✅ 数据库连接成功"
echo ""

# ==========================================
# 执行数据库迁移
# 策略: 先尝试 migrate deploy，如果存在失败迁移则标记回滚后重试
# ==========================================
echo "[entrypoint] 执行数据库迁移..."
if $PRISMA migrate deploy 2>&1; then
  echo "[entrypoint] ✅ 数据库迁移完成"
else
  echo "[entrypoint] migrate deploy 失败，检查是否有失败的迁移记录..."
  # 查找所有未完成的迁移并标记为已回滚
  FAILED_MIGRATIONS=$(docker exec -i file_review_postgres psql -U file_review_user -d file_review_db -t -A -c \
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;" 2>/dev/null || true)
  if [ -n "$FAILED_MIGRATIONS" ]; then
    for migration in $FAILED_MIGRATIONS; do
      echo "[entrypoint] 标记失败迁移为已回滚: $migration"
      $PRISMA migrate resolve --rolled-back "$migration" 2>/dev/null || true
    done
  fi
  echo "[entrypoint] 重新执行 migrate deploy..."
  $PRISMA migrate deploy 2>&1 || echo "[entrypoint] ⚠️ migrate deploy 仍有问题，后续 db push 将兜底同步"
fi

echo ""

# ==========================================
# 同步数据库结构（兜底修正历史迁移与当前 schema 漂移）
# ==========================================
echo "[entrypoint] 同步数据库结构 (db push)..."
$PRISMA db push --skip-generate --accept-data-loss

echo ""

# ==========================================
# 执行数据种子（幂等 upsert，重复执行安全）
# ==========================================
echo "[entrypoint] 执行数据初始化 (seed)..."
node dist/seed.js 2>/dev/null || echo "[entrypoint] ⚠️ seed 执行异常（可能数据已存在），继续启动"

echo ""
echo "[entrypoint] 启动后端服务..."
echo "[entrypoint] ============================================"
exec node dist/index.js
