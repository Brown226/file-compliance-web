# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**文件智能审查系统 (File Compliance Review System)** — an enterprise web app for uploading business documents and automatically checking them against corporate compliance standards using LLM-powered analysis. Runs on an internal network.

Current state is an **MVP** in Node.js/Express. The architecture design doc (`文件智能审查系统_架构设计文档.md`) describes a more advanced production target (Python FastAPI + Celery + RabbitMQ + MinIO + vLLM on multi-node cluster).

## Common Commands

### Infrastructure
```bash
docker-compose up -d          # Start PostgreSQL 15 (pgvector) + Redis 7
```

### Backend (from `backend/`)
```bash
npm install
npx prisma generate           # Generate Prisma Client from schema
npx prisma db push            # Sync schema to DB (dev mode, no migrations)
npx tsx src/seed.ts           # Seed default users (admin/manager/user)
npm run dev                   # Dev server on port 3000 (ts-node-dev, hot reload)
npm run build                 # Compile TypeScript to dist/
npm run start                 # Run compiled server
npx prisma db push --force-reset && npx tsx src/seed.ts  # Reset DB and re-seed
```

### Frontend (from `frontend/`)
```bash
npm install
npm run dev                   # Vite dev server on port 5173
npm run build                 # Type-check (vue-tsc) + production build
npm run preview               # Preview production build
```

Default accounts: `admin/admin123`, `manager/manager123`, `user/user123`

No test framework is configured in either frontend or backend.

## Architecture

### Tech Stack
- **Backend**: Node.js + Express 5 + TypeScript (CommonJS), Prisma 5 ORM, PostgreSQL 15, Redis 7 (ioredis)
- **Frontend**: Vue 3 (Composition API) + Vite 6 + Element Plus + ECharts + Pinia + Vue Router
- **AI Pipeline**: OpenAI-compatible LLM API (configurable via SystemConfig DB table) + PaddleOCR-VL (OCR fallback)
- **MaxKB**: Knowledge base system (v2.8.0) integrated via `maxkb.service.ts`; standards chunked and synced to MaxKB for RAG

### Request Flow
1. Frontend requests to `/api/*`; Vite dev server proxies to backend `http://localhost:3000`
2. Backend middleware chain: `express.json()` → `express.urlencoded()` → `cors()` → `morgan()` → `auditLog()` (intercepts all POST/PUT/DELETE) → route handlers → `errorHandler()`
3. `authenticate` middleware (JWT Bearer) and `requireRole` RBAC guard protected routes
4. Controllers delegate to service classes; services use shared `prisma` singleton from `config/db.ts`

### Authentication & RBAC
- JWT-based auth. Token in Pinia store (persisted via `pinia-plugin-persistedstate`), attached as `Authorization: Bearer <token>` by Axios interceptor
- Three roles: `ADMIN` (global access), `MANAGER` (own department + sub-departments), `USER` (own data only)
- `getTaskFilterByRole()` in `rbac.middleware.ts` dynamically builds Prisma `where` clauses based on role and department hierarchy
- Department hierarchy is a self-referential tree (`Department.parentId → Department.id`); sub-department IDs resolved recursively by `getSubDepartmentIds()`

### Review Pipeline (Core Business Logic)
Orchestrated by `ReviewService.processTask()`, triggered via `setImmediate()` from `TaskService.createTask()`:
1. **Task creation** (`TaskService.createTask`): Creates Task + TaskFile records, triggers pipeline
2. **File parsing** (`ParserService`): Extracts text from docx (mammoth), xlsx/xls (xlsx), pdf (pdf-parse). DWG is placeholder
3. **OCR fallback** (`OcrService`): If parsed text < 20 chars for PDF, sends base64 to PaddleOCR-VL
4. **LLM review** (`LlmService.reviewText`): Splits text into ≤4000-char chunks, sends with standard content to LLM. Returns `ReviewIssue[]` (TYPO or VIOLATION)
5. **Rule engine** (`RuleEngineService`): Rule-based checks (NAMING, ENCODING, ATTRIBUTE, HEADER, PAGE, SCAN, TEMPLATE) via `ruleCode` pattern
6. Results bulk-inserted into `task_details` table

### Frontend Structure
- `utils/request.ts`: Axios instance with `/api` base URL, auto-attaches JWT token, handles 401/403/404 globally
- `stores/user.ts`: Pinia store for token + userInfo, persisted to localStorage
- `router/index.ts`: All authenticated routes nested under `AppLayout` (sidebar + topbar), guard redirects to `/login`
- `views/`: Feature pages — Dashboard (ECharts), NewTask (file upload), TaskHistory, TaskDetails (left file tree + right error cards), StandardLibrary, LLMConfig, DepartmentManage, EmployeeManage, AuditLog
- `api/`: Thin Axios wrapper modules matching backend route groups

### Database (Prisma)
- Schema in `backend/prisma/schema.prisma`, uses `@@map` for snake_case table names
- 10 models: `Department` (tree), `User` (role enum: ADMIN/MANAGER/USER), `Standard`, `Task` → `TaskFile` → `TaskDetail` (review results with `cadHandleId`), `SystemConfig` (key-value JSON store), `AuditLog`, `ReviewRule`, `StandardChunk` (RAG chunks), `TaskStandard` (M:M), plus `MaxKB sync` tracking on Standard
- Development uses `prisma db push` (schema sync, no migration files exist)
- LLM/OCR configs stored in `system_configs` DB table (not env vars) — configurable at runtime via LLM Config UI

### MaxKB Integration
- Standards chunked into `StandardChunk` and synced to MaxKB knowledge base via `MaxkbService`
- Vector status tracked on Standard model: `pending | vectorizing | completed | failed`
- Separate `docker-compose.maxkb-offline.yml` deploys MaxKB with its own PostgreSQL and Redis on ports 8080, 15432, 16379
- API routes at `/api/maxkb/*`, controller at `maxkb.controller.ts`

### Key Conventions
- Backend service classes use **static methods** (not instances): `TaskService.createTask()`, `ReviewService.processTask()`
- All API routes prefixed with `/api/`, registered in `app.ts`
- File uploads stored in `backend/uploads/`, served statically at `/uploads/`
- Audit middleware auto-redacts `password` fields before logging
- Vite proxy in `vite.config.ts` currently rewrites `/api` to MaxKB at `http://localhost:8080` (path rewrite to `/admin/api`), not the Node.js backend at port 3000 — be aware of this when working with API routing

### Environment Variables (`backend/.env`)
`PORT`, `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`

### Notable Files
- `backend/src/seed.ts` — default admin/manager/user accounts
- `backend/prisma/schema.prisma` — all data models
- `backend/src/app.ts` — Express app setup + route registration
- `frontend/vite.config.ts` — Vite config with API proxy
- `start-platform.bat` / `start-maxkb.bat` — Windows startup scripts
