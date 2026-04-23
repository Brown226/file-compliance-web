# 文件智能审查系统 - 离线部署指南

> **适用场景**: 完全无公网的内网环境  
> **部署方式**: 一键自动化脚本  
> **预计时间**: 5-10 分钟（取决于硬件性能）

---

## 📦 部署包内容

```
offline-packages/
├── 📄 deploy-offline.bat          # Windows 一键部署脚本
├── 📄 deploy-offline.sh           # Linux 一键部署脚本
├── 📄 load-images.bat             # Windows 镜像加载脚本
├── 📄 load-images.sh              # Linux 镜像加载脚本
├── 📄 DEPLOYMENT.md               # 本文档
│
├── 🖼️  Docker 镜像文件 (约 3.7 GB)
│   ├── backend-v1.0.tar           # 后端服务镜像
│   ├── frontend-v1.0.tar          # 前端 Web 镜像
│   ├── markitdown-v1.0.tar        # 文档解析服务镜像
│   ├── pgvector-pg15.tar          # PostgreSQL 数据库镜像
│   ├── redis-7-alpine.tar         # Redis 缓存镜像
│   └── maxkb-images/
│       └── maxkb.tar.gz           # MaxKB 知识库镜像
│
└── ⚙️  配置文件
    └── compose-files/
        ├── docker-compose.offline.yml  # Docker Compose 配置
        ├── .env.offline                # 环境变量模板
        ├── .env.production             # 生产环境配置
        ├── nginx.conf                  # Nginx 反向代理配置
        └── backend/prisma/
            └── init-db.sql            # 数据库初始化脚本
```

---

## 🚀 快速开始（三步部署）

### Windows 系统

```batch
:: 1. 右键以管理员身份运行
deploy-offline.bat

:: 2. 等待自动完成（约 5-10 分钟）

:: 3. 打开浏览器访问 http://localhost
```

### Linux 系统

```bash
# 1. 赋予执行权限
chmod +x deploy-offline.sh load-images.sh

# 2. 执行部署（需要 root 或 docker 组权限）
sudo ./deploy-offline.sh

# 3. 打开浏览器访问 http://localhost
```

---

## 📋 详细部署步骤

### 步骤 1: 传输部署包

将整个 `offline-packages` 目录复制到目标服务器：

```bash
# Windows: 使用 U盘、移动硬盘或内网文件共享
# Linux: 使用 scp、rsync 或内网文件共享
scp -r offline-packages user@target-server:/opt/
```

### 步骤 2: 配置环境变量

> ⚠️ **重要**: 如果需要使用 MaxKB 知识库功能，必须修改 `MAXKB_PUBLIC_URL` 为服务器实际 IP。

编辑 `compose-files/.env.production`，找到以下配置并修改：

```bash
# 将 localhost 改为服务器实际 IP（如 192.168.1.100）
MAXKB_PUBLIC_URL=http://192.168.1.100:8080
```

如果不修改，MaxKB 知识库功能仅限本机浏览器访问，其他机器无法打开 MaxKB 页面。

### 步骤 3: 检查前置条件

确保目标服务器已安装：
- ✅ Docker Engine 20.10+ 或 Docker Desktop
- ✅ Docker Compose v2.0+（或 docker-compose 1.29+）
- ✅ 至少 8GB 可用内存
- ✅ 至少 20GB 可用磁盘空间

```bash
# 检查 Docker
docker --version

# 检查 Docker Compose
docker compose version
# 或
docker-compose --version

# 检查可用资源
df -h          # 磁盘空间
free -h        # 内存
```

### 步骤 4: 执行一键部署

**Windows:**
```batch
:: 右键点击 deploy-offline.bat，选择"以管理员身份运行"
```

**Linux:**
```bash
cd offline-packages
chmod +x deploy-offline.sh
sudo ./deploy-offline.sh
```

部署脚本会自动完成：
1. ✅ 加载所有 Docker 镜像
2. ✅ 初始化环境配置
3. ✅ 启动所有服务容器
4. ✅ 执行健康检查

### 步骤 4: 验证部署

部署完成后，脚本会显示访问地址和默认账号：

```
📊 访问地址:
   前端界面: http://localhost
   后端API:  http://localhost:3000/api
   健康检查: http://localhost:3000/health

🔑 默认账号:
   用户名: admin
   密码:   admin123
```

打开浏览器访问 `http://localhost`，使用默认账号登录即可。

---

## 🔧 手动部署（备选方案）

如果自动脚本失败，可以手动执行各步骤：

### 1. 加载镜像

```bash
# Windows
load-images.bat

# Linux
bash load-images.sh
```

### 2. 启动服务

```bash
cd compose-files

# 复制环境变量
cp .env.production .env

# 启动所有服务
docker compose -f docker-compose.offline.yml up -d
```

### 3. 查看日志

```bash
# 查看所有服务日志
docker compose -f docker-compose.offline.yml logs -f

# 查看特定服务日志
docker compose -f docker-compose.offline.yml logs -f backend
```

### 4. 检查状态

```bash
# 查看所有容器状态
docker compose -f docker-compose.offline.yml ps

# 检查服务健康状态
curl http://localhost:3000/health
```

---

## ⚠️ 常见问题排查

### 问题 1: 端口被占用

**症状**: 服务启动失败，提示端口冲突

**解决**:
```bash
# 检查端口占用
netstat -ano | findstr :80      # Windows
lsof -i :80                      # Linux

# 修改端口：编辑 compose-files/.env.offline
FRONTEND_PORT=8080    # 将前端改为 8080
BACKEND_PORT=3001     # 将后端改为 3001

# 重启服务
docker compose -f docker-compose.offline.yml down
docker compose -f docker-compose.offline.yml up -d
```

### 问题 2: 权限不足

**症状**: Docker 命令提示 permission denied

**解决**:
```bash
# Linux: 将用户加入 docker 组
sudo usermod -aG docker $USER
newgrp docker

# 或使用 sudo
sudo ./deploy-offline.sh
```

### 问题 3: 防火墙拦截

**症状**: 无法访问 http://localhost

**解决**:
```bash
# Windows: 允许 Docker 通过防火墙
# 控制面板 -> Windows Defender 防火墙 -> 允许应用通过防火墙 -> 勾选 Docker

# Linux: 开放端口
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# 或临时关闭防火墙测试
sudo systemctl stop firewalld
```

### 问题 4: 磁盘空间不足

**症状**: 镜像加载失败，提示 no space left on device

**解决**:
```bash
# 清理未使用的 Docker 资源
docker system prune -a

# 检查磁盘使用
df -h

# 扩展磁盘或清理其他文件
```

### 问题 5: 服务启动缓慢

**症状**: 健康检查超时，服务长时间处于 starting 状态

**解决**:
```bash
# 增加等待时间后重试
sleep 60
docker compose -f docker-compose.offline.yml ps

# 检查资源使用情况
docker stats

# 查看具体服务日志
docker compose -f docker-compose.offline.yml logs postgres
docker compose -f docker-compose.offline.yml logs backend
```

### 问题 6: MaxKB 启动失败

**症状**: MaxKB 容器反复重启

**解决**:
```bash
# 查看 MaxKB 日志
docker compose -f docker-compose.offline.yml logs maxkb

# 常见原因:
# 1. 内存不足 - 至少需要 4GB 可用内存
# 2. 端口冲突 - 检查 8080 端口是否被占用
# 3. 依赖服务未就绪 - 等待 PostgreSQL 和 Redis 完全启动

# 重启 MaxKB
docker compose -f docker-compose.offline.yml restart maxkb
```

**重要提示**: MaxKB 为**可选服务**，核心文件审查功能不依赖 MaxKB。如果 MaxKB 持续启动失败，可以暂时禁用：
```bash
# 停止 MaxKB
docker compose -f docker-compose.offline.yml stop maxkb maxkb-pgsql maxkb-redis

# 其他服务仍可正常使用
docker compose -f docker-compose.offline.yml ps
```

---

## 🛠️ 运维管理

### 查看服务状态

```bash
docker compose -f compose-files/docker-compose.offline.yml ps
```

### 查看实时日志

```bash
docker compose -f compose-files/docker-compose.offline.yml logs -f
```

### 重启服务

```bash
# 重启所有服务
docker compose -f compose-files/docker-compose.offline.yml restart

# 重启单个服务
docker compose -f compose-files/docker-compose.offline.yml restart backend
```

### 停止服务

```bash
docker compose -f compose-files/docker-compose.offline.yml down
```

### 备份数据

```bash
# 备份 PostgreSQL 数据
docker exec file_review_postgres pg_dump -U file_review_user file_review_db > backup_$(date +%Y%m%d).sql

# 备份上传的文件
tar czf uploads_backup_$(date +%Y%m%d).tar.gz compose-files/uploads/
```

### 恢复数据

```bash
# 恢复 PostgreSQL 数据
docker exec -i file_review_postgres psql -U file_review_user file_review_db < backup_20260423.sql
```

---

## 📞 技术支持

如遇到无法解决的问题，请提供以下信息：

1. **操作系统版本**: `winver` (Windows) 或 `cat /etc/os-release` (Linux)
2. **Docker 版本**: `docker --version`
3. **Docker Compose 版本**: `docker compose version`
4. **服务状态**: `docker compose -f compose-files/docker-compose.offline.yml ps`
5. **错误日志**: `docker compose -f compose-files/docker-compose.offline.yml logs`

---

## 📝 版本历史

- **v1.0** (2026-04-23): 初始版本，支持完整离线部署
  - ✅ 6 个 Docker 镜像打包
  - ✅ 一键自动化部署脚本
  - ✅ 健康检查与错误提示
  - ✅ 完整的故障排查指南
