# 文件智能审查系统 - 离线部署指南

## 📦 离线包内容

```
offline-packages/
├── *.tar                          # Docker 镜像文件 (6个)
│   ├── backend-v1.0.tar          # 后端服务 (1.3 GB)
│   ├── markitdown-v1.0.tar       # 文档解析服务 (707 MB)
│   ├── pgvector-pg15.tar         # PostgreSQL + pgvector (419 MB)
│   ├── frontend-v1.0.tar         # 前端 Nginx (123 MB)
│   └── redis-7-alpine.tar        # Redis 缓存 (40 MB)
├── maxkb-images/                  # MaxKB 知识库镜像 (可选)
│   └── maxkb.tar.gz
├── compose-files/                 # Docker Compose 配置文件
│   ├── docker-compose.complete.yml      # 完整部署配置
│   ├── docker-compose.offline.yml       # 含 MaxKB 的离线部署
│   ├── .env.offline                     # 环境变量模板
│   ├── .env.production                  # 生产环境变量
│   ├── nginx.conf                       # Nginx 配置
│   └── backend/prisma/init-db.sql       # 数据库初始化脚本
├── load-images.bat                # Windows 镜像加载脚本
└── load-images.sh                 # Linux 镜像加载脚本
```

---

## 🚀 部署步骤

### 步骤 1: 传输离线包到目标服务器

将整个 `offline-packages` 目录复制到目标服务器的任意位置,例如:
```bash
# Linux
scp -r offline-packages user@server:/opt/

# Windows (使用 WinSCP 或其他工具)
# 复制到 D:\deploy\
```

### 步骤 2: 加载 Docker 镜像

#### Windows 服务器:
```cmd
cd D:\deploy\offline-packages
load-images.bat
```

#### Linux 服务器:
```bash
cd /opt/offline-packages
chmod +x load-images.sh
./load-images.sh
```

**预期输出:**
```
[INFO] 检测到 Docker: Docker version 24.x.x
[INFO] 开始加载基础镜像...
[INFO] 加载镜像: backend-v1.0.tar
Loaded image: file-review-backend:v1.0
[SUCCESS] 加载成功: backend-v1.0.tar
...
[INFO] 已加载的镜像:
file-review-backend     v1.0    xxx
file-review-frontend    v1.0    xxx
file-review-markitdown  v1.0    xxx
pgvector/pgvector       pg15    xxx
redis                   7-alpine xxx
```

### 步骤 3: 配置环境变量

进入 `compose-files` 目录,复制并编辑环境变量文件:

```bash
cd compose-files
cp .env.offline .env
```

编辑 `.env` 文件,修改以下关键配置:

```env
# 端口配置 (根据服务器实际情况调整)
PG_PORT=5432
REDIS_PORT=6379
PARSER_PORT=8000
BACKEND_PORT=3000
FRONTEND_PORT=80
MAXKB_PORT=8080

# JWT 密钥 (生产环境必须修改!)
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# MaxKB 公网访问地址 (如果启用 MaxKB)
MAXKB_PUBLIC_URL=http://your-server-ip:8080
```

### 步骤 4: 启动服务

#### 方案 A: 不含 MaxKB (推荐初次部署)

```bash
docker-compose -f docker-compose.complete.yml up -d
```

#### 方案 B: 包含 MaxKB 知识库

```bash
docker-compose -f docker-compose.offline.yml up -d
```

### 步骤 5: 验证部署

等待所有容器启动完成 (约 1-2 分钟),然后检查状态:

```bash
# 查看所有容器状态
docker-compose -f docker-compose.complete.yml ps

# 查看后端日志
docker logs file_review_backend --tail 50

# 健康检查
curl http://localhost:3000/health
```

**预期输出:**
```json
{"status":"ok","timestamp":"2026-04-23T12:00:00.000Z"}
```

### 步骤 6: 访问系统

打开浏览器访问:
- **前端**: `http://服务器IP:80` (或配置的 FRONTEND_PORT)
- **后端 API**: `http://服务器IP:3000/api`
- **MaxKB** (如果启用): `http://服务器IP:8080`

**默认账号:**
| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | admin | admin123 |
| 部门主管 | manager | manager123 |
| 普通员工 | user | user123 |

---

## 🔧 常见问题

### 1. 容器启动失败

**检查日志:**
```bash
docker logs <container_name>
```

**常见原因:**
- 端口冲突: 修改 `.env` 中的端口配置
- 磁盘空间不足: 确保至少 10 GB 可用空间
- 内存不足: 至少需要 4 GB RAM

### 2. 数据库连接失败

**检查 PostgreSQL 是否就绪:**
```bash
docker exec file_review_postgres pg_isready -U file_review_user
```

**重置数据库 (⚠️ 会丢失所有数据):**
```bash
docker-compose down -v
docker-compose up -d
```

### 3. MaxKB 无法访问

**检查 MaxKB 容器状态:**
```bash
docker logs file_review_maxkb --tail 100
```

**确认端口映射:**
```bash
docker port file_review_maxkb
```

### 4. 文件上传失败

**检查 uploads 卷权限:**
```bash
docker exec file_review_backend ls -la /app/uploads
```

**重启后端服务:**
```bash
docker-compose restart backend
```

---

## 📊 资源需求

| 组件 | CPU | 内存 | 磁盘 |
|------|-----|------|------|
| PostgreSQL | 1核 | 2 GB | 10 GB+ |
| Redis | 0.5核 | 512 MB | 1 GB |
| MarkItDown | 1核 | 1 GB | 500 MB |
| Backend | 1核 | 1 GB | 500 MB |
| Frontend | 0.25核 | 256 MB | 100 MB |
| MaxKB (可选) | 2核 | 4 GB | 20 GB+ |
| **总计** | **5.75核** | **8.75 GB** | **32 GB+** |

**最低配置建议:**
- CPU: 4核
- 内存: 8 GB
- 磁盘: 50 GB SSD

---

## 🔒 安全建议

1. **修改默认密码**: 首次登录后立即修改所有默认账号密码
2. **更换 JWT_SECRET**: 在 `.env` 中设置强随机密钥
3. **防火墙配置**: 仅开放必要端口 (80, 443)
4. **HTTPS 配置**: 生产环境建议配置 SSL 证书
5. **定期备份**: 备份 PostgreSQL 数据和 uploads 目录

**备份命令:**
```bash
# 备份数据库
docker exec file_review_postgres pg_dump -U file_review_user file_review_db > backup_$(date +%Y%m%d).sql

# 备份上传文件
docker cp file_review_backend:/app/uploads ./backup_uploads
```

---

## 📞 技术支持

如遇到问题,请提供以下信息:
1. 操作系统版本
2. Docker 版本 (`docker --version`)
3. Docker Compose 版本 (`docker-compose --version`)
4. 相关容器日志 (`docker logs <container_name>`)
5. 错误截图或详细描述

---

**版本**: v1.0  
**更新日期**: 2026-04-23
