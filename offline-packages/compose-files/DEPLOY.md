# 文件智能审查系统 - 离线部署与升级手册

## 目录

1. [首次部署](#首次部署)
2. [日常升级](#日常升级)
3. [数据备份](#数据备份)
4. [故障恢复](#故障恢复)
5. [注意事项](#注意事项)

---

## 首次部署

### 环境要求

- Docker Engine 20.10+
- Docker Compose 2.0+
- 可用磁盘空间: 至少 5GB
- 内存: 至少 4GB

### 部署步骤

```bash
# 1. 加载 Docker 镜像（只需执行一次）
./load-images.sh          # Linux
# 或
load-images.bat           # Windows

# 2. 启动所有服务
./deploy.sh               # Linux
# 或
deploy.bat                # Windows

# 3. 等待服务就绪（约 30 秒）
# 后端会自动执行数据库迁移和数据初始化

# 4. 访问系统
# Web UI: http://localhost
# 默认账号: admin / admin123
```

### 首次部署数据初始化

后端容器启动时会自动完成：

1. **数据库表创建** — `prisma migrate deploy`
2. **种子数据** — `node dist/seed.js`（幂等 upsert）
   - 5 个部门（总公司/研发部/建筑设计部/结构设计部/机电设计部）
   - 3 个用户（admin/admin123, zhangsan/123456, lisi/123456）
   - 8 条标准数据
   - 30+ 审查规则
   - 35+ 术语白名单
   - 4 个 LLM 配置（需修改为内网地址）
   - 4 个演示任务

---

## 日常升级

### 升级前必做：备份

```bash
# Linux
./backup-db.sh pre_upgrade

# Windows
backup-db.bat pre_upgrade
```

### 升级步骤

```bash
# 1. 进入 compose 目录
cd compose-files

# 2. 拉取/加载新镜像（如果有新镜像包）
docker load -i ../backend-v1.1.tar
docker load -i ../frontend-v1.1.tar

# 3. 重启服务（保留数据卷）
docker-compose -f docker-compose.offline.yml up -d

# 4. 查看后端日志，确认迁移成功
docker-compose -f docker-compose.offline.yml logs -f backend
```

### 升级原理

后端容器启动时会智能检测数据库状态：

| 场景 | 检测条件 | 处理方式 |
|------|---------|---------|
| **全新部署** | 无业务表 | `migrate deploy` 创建所有表 |
| **正常升级** | 有 `_prisma_migrations` 表 | `migrate deploy` 应用新迁移 |
| **兼容旧部署** | 有业务表但无迁移记录 | `migrate resolve` 建立基线 |

### 升级后验证

```bash
# 检查所有服务状态
docker-compose -f docker-compose.offline.yml ps

# 检查后端健康
curl http://localhost:3000/health

# 登录系统验证数据完整性
```

---

## 数据备份

### 自动备份建议

建议设置定时任务，每天自动备份：

```bash
# Linux crontab 示例（每天凌晨 2 点备份）
0 2 * * * /path/to/compose-files/backup-db.sh daily >> /var/log/file-review-backup.log 2>&1
```

### 手动备份

```bash
# 备份到 backups/ 目录，文件名包含时间戳
./backup-db.sh manual

# 输出示例:
# backups/manual_20260422_143052.sql.gz
```

### 备份文件位置

```
compose-files/
  backups/
    backup_20260422_020000.sql.gz    # 自动备份
    manual_20260422_143052.sql.gz    # 手动备份
    pre_upgrade_20260422_100000.sql  # 升级前备份
```

---

## 故障恢复

### 场景 1: 升级失败，需要回滚

```bash
# 1. 停止服务
docker-compose -f docker-compose.offline.yml down

# 2. 恢复数据库到升级前状态
./restore-db.sh backups/pre_upgrade_20260422_100000.sql.gz

# 3. 回退到旧镜像（重新加载旧版本 tar）
docker load -i ../backend-v1.0.tar
docker load -i ../frontend-v1.0.tar

# 4. 重新启动
docker-compose -f docker-compose.offline.yml up -d
```

### 场景 2: 数据卷意外删除

```bash
# 如果执行了 docker-compose down -v（数据卷被删除）
# 可以从备份恢复:

# 1. 重新启动（会创建空数据库）
docker-compose -f docker-compose.offline.yml up -d

# 2. 等待数据库就绪（约 10 秒）
sleep 10

# 3. 恢复备份
./restore-db.sh backups/backup_20260422_020000.sql.gz
```

### 场景 3: 完全重置（⚠️ 数据全部丢失）

```bash
# 仅当确定要清空所有数据时执行
docker-compose -f docker-compose.offline.yml down -v

# 重新启动后会自动初始化全新数据库
docker-compose -f docker-compose.offline.yml up -d
```

---

## 注意事项

### ⚠️ 危险操作

| 操作 | 后果 | 替代方案 |
|------|------|---------|
| `docker-compose down -v` | **删除所有数据卷**（数据库+上传文件） | 使用 `docker-compose down`（保留卷） |
| `docker volume rm postgres_data` | **删除数据库** | 先备份再操作 |
| 直接修改数据库表结构 | 可能导致数据不一致 | 通过 Prisma 迁移管理 |

### ✅ 安全操作

| 操作 | 效果 |
|------|------|
| `docker-compose up -d` | 启动/更新服务，**保留所有数据** |
| `docker-compose restart backend` | 重启后端，**保留数据** |
| `docker-compose pull` + `up -d` | 更新镜像，**保留数据** |

### 数据存储位置

| 数据类型 | 存储位置 | 备份方式 |
|---------|---------|---------|
| 数据库 | Docker 卷 `postgres_data` | `backup-db.sh` |
| 上传文件 | Docker 卷 `uploads` | 直接复制卷内容 |
| Redis 缓存 | Docker 卷 `redis_data` | 无需备份（可重建） |

### 查看数据卷

```bash
# 列出所有卷
docker volume ls | grep file-review

# 查看卷详情
docker volume inspect compose-files_postgres_data
```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-04-21 | 初始版本，使用 db push |
| v1.1 | 2026-04-22 | 引入迁移系统（migrate deploy），支持安全升级 |

---

## 技术支持

如遇问题，请检查：

1. `docker-compose logs backend` — 查看后端日志
2. `docker-compose logs postgres` — 查看数据库日志
3. 确认数据卷未被删除：`docker volume ls`
4. 确认备份文件可用：`ls backups/`
