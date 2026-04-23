# 文件智能审查系统 (File Compliance Review System)

[![Vue](https://img.shields.io/badge/Vue.js-3.0-4FC08D?logo=vue.js)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express.js-5.0-000000?logo=express)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.0-2D3748?logo=prisma)](https://www.prisma.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com/)

**文件智能审查系统**是一个企业级的文件合规性检查平台。通过本系统，企业员工可以上传审查文件并对比企业内部合规标准库，自动识别高频错别字及合规违规项。系统配有功能完善的监控看板、部门与账号管理以及详尽的安全审计日志功能，帮助企业保障各类业务文档的规范与安全。

## 🎯 核心功能

### 📊 数据监控看板 (Dashboard)
- 核心业务质量数据的可视化统计
- 各部门审查违规率监测及趋势图展示
- 最高频错别字 Top 10 预警
- 最常被违反的标准规范 Top 10 统计
- 任务状态分布图
- 采用 ECharts 定制的现代企业蓝白数据大屏风格

### 📝 审查任务管理 (Tasks)
- 个人操作台，支持批量文件上传（DWG, Word, Excel, PDF 等）
- 支持多类审查标准选择
- 审查记录追踪：实时显示任务状态（排队中/审查中/已完成/失败）
- 任务详情左右分栏：左侧文件树 + 右侧错误明细卡片
- CAD Handle ID 一键复制定位
- 审查报告 Excel 导出

### 📚 企业标准库管理 (Standard Library)
- 内置规范管理：对各行业标准及内部红线规范进行增删改查
- 支持多版本标准文档的录入及状态管理
- Excel 批量导入标准条目
- 导出标准库为 Excel 文件
- 下载 Excel 导入模板

### 🏢 系统与人员管理 (System)
- 基于树形结构的部门层级管理
- 员工账号配置与多角色权限划分（Admin, Manager, User）
- RBAC 权限控制：管理员全局访问、部门主管本部门数据隔离、普通员工仅自己创建的数据

### 🤖 LLM 配置管理
- 大语言模型连接参数配置（API 地址、密钥、模型名称等）
- 支持测试连接与发送测试消息
- 配置持久化到数据库

### 🔐 身份与安全
- JWT Token 身份认证
- 修改密码功能
- 全局安全审计日志：自动拦截并记录 POST/PUT/DELETE 操作

---

## 🛠️ 技术栈

### 前端 (Frontend)
| 技术 | 版本 | 说明 |
|------|------|------|
| Vue 3 | 3.5+ | Composition API |
| Vite | 6.2+ | 构建工具 |
| Element Plus | 2.9+ | UI 组件库 |
| ECharts | 5.6+ | 数据可视化 |
| Pinia | 2.3+ | 状态管理 |
| Vue Router | 4.5+ | 路由管理 |
| Axios | 1.7+ | HTTP 客户端 |

### 后端 (Backend)
| 技术 | 版本 | 说明 |
|------|------|------|
| Node.js + Express | 5.x | 运行环境与 Web 框架 |
| TypeScript | 6.x | 类型安全 |
| Prisma | 5.x | ORM / 数据库操作 |
| JWT (jsonwebtoken) | 9.x | 身份认证 |
| Multer | 2.x | 文件上传处理 |
| ExcelJS | 4.x | Excel 导入导出 |
| Redis (ioredis) | 5.x | 缓存服务 |
| bcryptjs | 3.x | 密码加密 |

### 基础设施 (Infrastructure)
| 服务 | 版本 | 说明 |
|------|------|------|
| PostgreSQL | 15 | 关系型数据库 |
| Redis | 7 | 缓存服务 |
| Docker & Docker Compose | - | 容器化编排 |

---

## 🚀 快速启动

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/install/)
- npm 9+

### 1. 启动基础设施 (数据库与 Redis)

```bash
# 在项目根目录执行
docker-compose up -d
```

等待 PostgreSQL 和 Redis 容器健康检查通过（约 10-30 秒）。

### 2. 后端服务配置与启动

```bash
cd backend

# 安装依赖
npm install

# 生成 Prisma Client
npx prisma generate

# 同步数据库表结构（首次启动或 schema 变更后执行）
npx prisma db push

# 初始化种子数据（创建默认管理员/主管/员工账号）
npx tsx src/seed.ts

# 启动开发服务器（默认端口 3000）
npm run dev
```

后端启动成功后，可访问 `http://localhost:3000/health` 验证服务状态。

> **注意**: 后端环境变量配置在 `backend/.env` 中。如需修改数据库连接或 Redis 地址，请同步更新。

### 3. 前端服务配置与启动

```bash
# 在新的终端窗口中执行
cd frontend

# 安装依赖
npm install

# 启动 Vite 开发服务器（默认端口 5173）
npm run dev
```

成功启动后，浏览器访问 `http://localhost:5173` 即可使用系统。

### 默认账号

| 角色 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 管理员 (ADMIN) | admin | admin123 | 全局权限，可管理所有数据 |
| 部门主管 (MANAGER) | manager | manager123 | 本部门数据权限 |
| 普通员工 (USER) | user | user123 | 仅自己创建的数据权限 |

---

## 📁 项目目录结构

```
file-compliance-web/
├── backend/                          # 后端服务
│   ├── prisma/
│   │   └── schema.prisma             # Prisma 数据模型定义
│   ├── src/
│   │   ├── config/                   # 数据库和环境变量配置
│   │   ├── controllers/              # API 请求控制层
│   │   │   ├── auth.controller.ts    # 认证（登录/修改密码）
│   │   │   ├── standard.controller.ts # 标准库 CRUD + Excel 导入导出
│   │   │   ├── task.controller.ts    # 任务管理 + 报告导出
│   │   │   ├── department.controller.ts # 部门管理
│   │   │   ├── employee.controller.ts  # 员工管理
│   │   │   ├── dashboard.controller.ts # 看板数据
│   │   │   ├── audit.controller.ts    # 审计日志
│   │   │   └── systemConfig.controller.ts # LLM 系统配置
│   │   ├── middlewares/              # 全局中间件
│   │   │   ├── auth.middleware.ts    # JWT 认证
│   │   │   ├── rbac.middleware.ts    # RBAC 角色权限控制
│   │   │   └── audit.middleware.ts   # 自动审计日志
│   │   ├── routes/                   # Express 路由注册
│   │   ├── services/                 # 核心业务逻辑
│   │   │   ├── auth.service.ts
│   │   │   ├── standard.service.ts   # 含 Excel 导入导出
│   │   │   ├── task.service.ts       # 含报告 Excel 生成
│   │   │   └── dashboard.service.ts  # 含 Top 10 统计
│   │   ├── seed.ts                   # 数据库种子数据
│   │   ├── app.ts                    # Express 应用入口
│   │   └── index.ts                  # 服务启动入口
│   ├── .env                          # 环境变量
│   ├── tsconfig.json
│   └── package.json
├── frontend/                         # 前端服务
│   ├── public/                       # 静态资源
│   ├── src/
│   │   ├── api/                      # API 请求封装
│   │   │   ├── auth.ts              # 认证接口
│   │   │   ├── standard.ts          # 标准库接口（含导入导出）
│   │   │   ├── task.ts              # 任务接口（含报告导出）
│   │   │   └── system.ts            # 系统管理接口（含 LLM 配置）
│   │   ├── assets/                   # 样式及图片资源
│   │   ├── components/               # 全局复用组件
│   │   │   └── layout/
│   │   │       └── AppLayout.vue     # 侧边栏 + 顶部栏布局
│   │   ├── router/                   # Vue Router 路由配置
│   │   ├── stores/                   # Pinia 状态管理
│   │   ├── views/                    # 各功能页面视图
│   │   │   ├── Login.vue            # 登录页
│   │   │   ├── Dashboard.vue        # 数据看板
│   │   │   ├── NewTask.vue          # 新建审查任务
│   │   │   ├── TaskHistory.vue      # 任务历史列表
│   │   │   ├── TaskDetails.vue      # 任务详情（左右分栏）
│   │   │   ├── StandardLibrary.vue  # 标准库管理
│   │   │   ├── LLMConfig.vue        # LLM 配置
│   │   │   ├── DepartmentManage.vue # 部门管理
│   │   │   ├── EmployeeManage.vue   # 员工管理
│   │   │   └── AuditLog.vue         # 审计日志
│   │   ├── App.vue
│   │   └── main.ts
│   ├── vite.config.ts               # Vite 配置（含 API 代理）
│   └── package.json
├── docker-compose.yml                # Docker 基础设施编排
├── 文件智能审查系统_架构设计文档.md    # 架构设计文档
└── README.md
```

---

## 🔌 API 接口一览

### 认证模块
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/auth/login` | 用户登录 | 公开 |
| POST | `/api/auth/change-password` | 修改密码 | 已登录 |

### 标准库模块
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/standards` | 获取标准列表 | 已登录 |
| GET | `/api/standards/:id` | 获取标准详情 | 已登录 |
| POST | `/api/standards` | 创建标准 | ADMIN/MANAGER |
| PUT | `/api/standards/:id` | 更新标准 | ADMIN/MANAGER |
| DELETE | `/api/standards/:id` | 删除标准 | ADMIN |
| GET | `/api/standards/export/excel` | 导出标准库 Excel | 已登录 |
| POST | `/api/standards/import/excel` | 导入标准库 Excel | ADMIN/MANAGER |
| GET | `/api/standards/template/excel` | 下载导入模板 | 已登录 |

### 任务模块
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/tasks` | 获取任务列表（按角色过滤） | 已登录 |
| GET | `/api/tasks/:id` | 获取任务详情 | 已登录 |
| POST | `/api/tasks` | 创建审查任务 | 已登录 |
| PATCH | `/api/tasks/:id/status` | 更新任务状态 | ADMIN |
| GET | `/api/tasks/:id/export` | 导出审查报告 Excel | 已登录 |

### 系统管理模块
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/departments` | 获取部门树 | 已登录 |
| POST | `/api/departments` | 创建部门 | ADMIN |
| PUT | `/api/departments/:id` | 更新部门 | ADMIN |
| DELETE | `/api/departments/:id` | 删除部门 | ADMIN |
| GET | `/api/employees` | 获取员工列表 | 已登录 |
| POST | `/api/employees` | 创建员工 | ADMIN |
| PUT | `/api/employees/:id` | 更新员工 | ADMIN |
| DELETE | `/api/employees/:id` | 删除员工 | ADMIN |

### 系统配置模块
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/system-config/:key` | 获取配置项 | ADMIN |
| PUT | `/api/system-config/:key` | 更新配置项 | ADMIN |
| POST | `/api/system-config/test-llm` | 测试 LLM 连接 | ADMIN |
| POST | `/api/system-config/test-llm-send` | 发送测试消息 | ADMIN |

### 看板与日志
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/dashboard/stats` | 获取看板统计数据 | 已登录 |
| GET | `/api/audit-logs` | 获取审计日志 | 已登录 |

---

## 🔒 RBAC 权限模型

系统实现了基于角色的访问控制（RBAC），结合部门数据隔离：

### 角色权限矩阵

| 功能 | ADMIN | MANAGER | USER |
|------|-------|---------|------|
| 查看全局数据 | ✅ | ❌ | ❌ |
| 查看本部门数据 | ✅ | ✅ | ❌ |
| 查看自己的数据 | ✅ | ✅ | ✅ |
| 创建/编辑标准 | ✅ | ✅ | ❌ |
| 删除标准 | ✅ | ❌ | ❌ |
| 管理部门/员工 | ✅ | ❌ | ❌ |
| 更新任务状态 | ✅ | ❌ | ❌ |
| 系统配置管理 | ✅ | ❌ | ❌ |

### 数据隔离规则

- **ADMIN**：可查看所有部门的数据
- **MANAGER**：仅可查看所属部门及子部门的数据
- **USER**：仅可查看自己创建的任务数据

---

## 🗄️ 数据库模型

### 核心数据表

| 模型 | 表名 | 说明 |
|------|------|------|
| Department | departments | 部门（支持树形层级） |
| User | users | 用户账号（含角色和部门关联） |
| Standard | standards | 企业标准规范库 |
| Task | tasks | 审查主任务 |
| TaskFile | task_files | 任务关联文件 |
| TaskDetail | task_details | 审查结果明细（含 CAD Handle ID） |
| AuditLog | audit_logs | 安全审计日志 |
| SystemConfig | system_configs | 系统配置（LLM 参数等） |

### 模型关系图

```
Department ──1:N──> Department (自引用，parent-child)
Department ──1:N──> User
User ──1:N──> Task (creator)
User ──1:N──> AuditLog
Task ──1:N──> TaskFile
Task ──1:N──> TaskDetail
TaskFile ──1:N──> TaskDetail
```

---

## ⚙️ 环境变量说明

### 后端 (`backend/.env`)

```env
PORT=3000                          # 服务端口
NODE_ENV=development               # 运行环境
DATABASE_URL=postgresql://user:pass@localhost:5432/db  # PostgreSQL 连接字符串
REDIS_URL=redis://localhost:6379   # Redis 连接地址
JWT_SECRET=your-jwt-secret         # JWT 签名密钥（生产环境请更换）
JWT_EXPIRES_IN=1d                  # Token 过期时间
```

### 前端 (`frontend/vite.config.ts`)

前端通过 Vite 代理将 `/api` 请求转发到后端 `http://localhost:3000`，开发环境下无需额外配置跨域。

---

## 📝 开发指南

### 数据库 Schema 变更

当修改了 `prisma/schema.prisma` 后，需同步数据库：

```bash
cd backend
npx prisma db push        # 开发环境：直接推送 schema
npx prisma generate       # 重新生成 Prisma Client
```

### 重置数据库

```bash
cd backend
npx prisma migrate reset  # 重置并重新执行所有迁移和种子
# 或者
npx prisma db push --force-reset && npx tsx src/seed.ts
```

### 前端构建

```bash
cd frontend
npm run build             # 生产构建，输出到 dist/
npm run preview           # 预览生产构建结果
```

---

## 🔒 许可证

Copyright © 2026 Enterprise Inc. All rights reserved.
