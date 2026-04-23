# 文件智能审查系统 - 快速参考卡

## 🚀 一键部署

```bash
# Windows: 右键以管理员身份运行
deploy-offline.bat

# Linux: 执行脚本
chmod +x deploy-offline.sh && sudo ./deploy-offline.sh
```

## 🌐 访问地址

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端界面 | http://localhost | 主界面 |
| 后端API | http://localhost:3000/api | REST API |
| 健康检查 | http://localhost:3000/health | 服务状态 |
| MaxKB | http://localhost:8080 | 知识库管理 |
| MarkItDown | http://localhost:8000 | 文档解析 |

## 🔑 默认账号

- **用户名**: admin
- **密码**: admin123

## 📝 常用命令

```bash
# 查看服务状态
docker compose -f compose-files/docker-compose.offline.yml ps

# 查看实时日志
docker compose -f compose-files/docker-compose.offline.yml logs -f

# 重启所有服务
docker compose -f compose-files/docker-compose.offline.yml restart

# 停止所有服务
docker compose -f compose-files/docker-compose.offline.yml down

# 备份数据库
docker exec file_review_postgres pg_dump -U file_review_user file_review_db > backup.sql
```

## ⚠️ 常见问题

### 端口被占用
编辑 `compose-files/.env.offline`，修改端口号后重启

### 权限不足
Linux: `sudo usermod -aG docker $USER` 或使用 `sudo`

### 防火墙拦截
开放端口 80, 3000, 5432, 6379, 8080

### 服务启动慢
首次启动需要 2-3 分钟，请耐心等待

## 📞 获取帮助

查看详细文档: `DEPLOYMENT.md`
