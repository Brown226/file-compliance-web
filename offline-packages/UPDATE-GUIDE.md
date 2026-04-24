# 离线镜像包更新指南

## 📋 更新说明

本次更新修复了任务创建时的鉴权问题：
- ✅ 前端添加登录状态检查
- ✅ 后端优化错误提示和日志记录

## 🔄 更新步骤

### 方法一：自动脚本（推荐）

在项目根目录执行以下命令：

```powershell
# Windows PowerShell
.\rebuild-and-update-images.bat
```

该脚本会自动：
1. 重新构建后端镜像
2. 重新构建前端镜像  
3. 导出为 `.tar` 文件到 `offline-packages/` 目录

### 方法二：手动构建

如果自动脚本失败，可以手动执行以下步骤：

#### 1. 重新构建后端镜像

```powershell
cd e:\工作\file-compliance-web
docker build -f Dockerfile.backend -t file-review-backend:v1.0 .
```

#### 2. 重新构建前端镜像

```powershell
cd e:\工作\file-compliance-web
docker build -f Dockerfile.frontend -t file-review-frontend:v1.0 .
```

#### 3. 导出镜像到离线包

```powershell
# 导出后端镜像
docker save file-review-backend:v1.0 -o offline-packages\backend-v1.0.tar

# 导出前端镜像
docker save file-review-frontend:v1.0 -o offline-packages\frontend-v1.0.tar
```

#### 4. 验证文件大小

```powershell
# 检查后端镜像（应该约 1.3 GB）
Get-Item offline-packages\backend-v1.0.tar | Select-Object Length, LastWriteTime

# 检查前端镜像（应该约 120 MB）
Get-Item offline-packages\frontend-v1.0.tar | Select-Object Length, LastWriteTime
```

## ✅ 验证更新

### 1. 加载新镜像

在目标服务器上：

```bash
cd offline-packages
docker load -i backend-v1.0.tar
docker load -i frontend-v1.0.tar
```

### 2. 重启服务

```bash
cd compose-files
docker compose -f docker-compose.offline.yml down
docker compose -f docker-compose.offline.yml up -d
```

### 3. 测试修复

访问 http://localhost，尝试创建任务：

- **未登录状态**：应提示"请先登录后再创建任务"并跳转到登录页
- **已登录状态**：应成功创建任务

## 📊 更新的镜像文件

| 文件名 | 大小 | 说明 |
|--------|------|------|
| `backend-v1.0.tar` | ~1.3 GB | 后端服务镜像（包含鉴权修复） |
| `frontend-v1.0.tar` | ~120 MB | 前端 Web 镜像（包含登录检查） |

## 🔧 故障排查

### 问题 1: 构建失败

**症状**: `docker build` 命令报错

**解决**:
```powershell
# 清理 Docker 缓存
docker system prune -a

# 重新构建
docker build --no-cache -f Dockerfile.backend -t file-review-backend:v1.0 .
```

### 问题 2: 导出文件过大

**症状**: `.tar` 文件比预期大很多

**解决**:
```powershell
# 删除旧的未使用镜像
docker image prune -a

# 重新导出
docker save file-review-backend:v1.0 -o offline-packages\backend-v1.0.tar
```

### 问题 3: 终端输出被截断

**症状**: PowerShell 中看不到完整的构建输出

**解决**:
```powershell
# 将输出重定向到文件
docker build -f Dockerfile.backend -t file-review-backend:v1.0 . > build.log 2>&1

# 查看日志
Get-Content build.log -Tail 50
```

## 📝 注意事项

1. **构建时间**: 首次构建可能需要 5-10 分钟，取决于网络速度和硬件性能
2. **磁盘空间**: 确保至少有 10 GB 可用磁盘空间用于构建和导出
3. **Docker 版本**: 建议使用 Docker Desktop 4.0+ 或 Docker Engine 20.10+
4. **代码同步**: 确保在构建前已提交所有代码更改并重新编译

## 🎯 更新后的改进

### 前端改进
- ✅ 创建任务前检查登录状态
- ✅ 未登录时友好提示并跳转
- ✅ 避免无效的 API 请求

### 后端改进
- ✅ 更清晰的认证错误提示
- ✅ 详细的未授权访问日志
- ✅ 更好的调试信息

---

**最后更新**: 2026-04-24  
**更新版本**: v1.0 (鉴权修复版)
