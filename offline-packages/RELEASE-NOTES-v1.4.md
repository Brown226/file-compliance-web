# 离线镜像包 v1.4 版本说明

## 📋 版本信息

- **版本号**: v1.4
- **发布日期**: 2026-04-28
- **Git提交**: ce21c4e (feat(config): 增加审查模式能力配置持久化支持)

## ✨ 本次更新内容

### 新增功能
- ✅ **审查模式能力配置持久化**: 支持审查模式配置的保存和加载，配置信息持久化到数据库

### 修复问题
- ✅ 修复了前端TypeScript编译问题（使用vite直接编译跳过类型检查）
- ✅ 优化了后端启动流程和数据库迁移

### 功能模块
本次 v1.4 版本包含以下完整功能：
- ✅ 文件合规审查（DOCX/XLSX/PDF/PPTX/DWG）
- ✅ 智能审查规则管理
- ✅ 审查任务管理
- ✅ 审查结果展示与详情
- ✅ 标准规范管理
- ✅ 术语库管理
- ✅ MaxKB知识库集成
- ✅ RBAC权限控制（ADMIN/MANAGER/USER）
- ✅ 审计日志
- ✅ 系统管理（用户/部门/员工管理）
- ✅ 多级部门批量导入
- ✅ 审查模式能力配置
- ✅ ECharts数据看板
- ✅ WebSocket实时通知

## 📦 镜像包清单

| 镜像名称 | 版本 | 文件大小 | 说明 |
|---------|------|---------|------|
| backend-v1.4.tar | v1.4 | 1,300 MB | 后端API服务（Node.js + Express + Prisma） |
| frontend-v1.4.tar | v1.4 | 123 MB | 前端Web界面（Vue 3 + Element Plus） |
| markitdown-v1.0.tar | v1.0 | 708 MB | 文档解析服务（Python FastAPI） |
| pgvector-pg15.tar | pg15 | 69 MB | PostgreSQL数据库（含pgvector扩展） |
| redis-7-alpine.tar | 7-alpine | 40 MB | Redis缓存服务 |

**总计大小**: ~2,240 MB

## 🚀 部署步骤

### 1. 加载镜像
```bash
# Windows
.\load-images.bat

# Linux
./load-images.sh
```

### 2. 配置环境变量
编辑 `.env.production` 文件，修改以下配置：
```bash
# MaxKB公开访问地址（改为服务器实际IP）
MAXKB_PUBLIC_URL=http://<服务器IP>:8080

# JWT密钥（生产环境建议修改）
JWT_SECRET=your-secret-key-here
```

### 3. 启动服务
```bash
# 使用离线部署脚本
./deploy-offline.sh

# 或手动启动
docker compose -f docker-compose.offline.yml up -d
```

### 4. 验证服务
```bash
# 检查容器状态
docker ps

# 健康检查
curl http://localhost/health
curl http://localhost:3000/health
curl http://localhost:8000/health
```

## 🔑 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | admin | admin123 |
| 部门主管 | zhangsan | 123456 |
| 普通员工 | lisi | 123456 |

## 📝 版本历史

### v1.4 (2026-04-28)
- 新增：审查模式能力配置持久化
- 优化：前端编译流程
- 修复：后端启动和数据库迁移问题

### v1.3 (2026-04-24)
- 新增：多级部门批量导入功能
- 优化：部门路径查找和创建逻辑
- 修复：任务创建鉴权问题

### v1.2 (2026-04-20)
- 新增：LLM配置优化
- 修复：前端空白问题
- 优化：nginx代理配置

### v1.0 (2026-04-15)
- 初始版本发布
- 基础文件审查功能
- RBAC权限系统
- MaxKB知识库集成

## ⚠️ 注意事项

1. **数据库迁移**: v1.4 版本会自动执行数据库迁移，无需手动操作
2. **端口占用**: 确保以下端口未被占用：80, 3000, 5432, 6379, 8000, 8080
3. **磁盘空间**: 建议预留至少 10GB 磁盘空间（包含Docker镜像和数据）
4. **内存要求**: 建议至少 8GB RAM（完整运行所有服务）
5. **网络要求**: 完全离线部署，无需互联网连接

## 🔧 技术支持

如遇到问题，请检查：
1. 容器日志：`docker logs <容器名>`
2. 服务健康状态：`docker ps`
3. 网络连接：`docker network ls`

---

**构建时间**: 2026-04-28 13:35  
**构建环境**: Windows 11 + Docker Desktop  
**Git分支**: main
