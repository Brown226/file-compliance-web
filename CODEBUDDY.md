# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## Common Commands

### Infrastructure
```bash
docker-compose up -d          # Start PostgreSQL + Redis containers
```

### Backend (from `backend/`)
```bash
npm install                   # Install dependencies
npx prisma generate           # Generate Prisma Client from schema
npx prisma db push            # Sync schema to database (dev mode, no migrations)
npm run dev                   # Start dev server on port 3000 (ts-node-dev with hot reload)
npm run build                 # Compile TypeScript to dist/
npm run start                 # Run compiled server from dist/
npx tsx src/seed.ts           # Seed database with default users (admin/manager/user)
npx prisma db push --force-reset && npx tsx src/seed.ts  # Reset DB and re-seed
```

### Frontend (from `frontend/`)
```bash
npm install                   # Install dependencies
npm run dev                   # Start Vite dev server on port 5173
npm run build                 # Type-check (vue-tsc) and production build to dist/
npm run preview               # Preview production build locally
```

No test framework is configured in either frontend or backend.

## Architecture

This is a **file compliance review system** — an enterprise web app for uploading business documents and automatically checking them against corporate standards using LLM-powered analysis. The system runs on an internal network (no public cloud dependencies in production).

### Tech Stack
- **Backend**: Node.js + Express 5 + TypeScript (CommonJS), Prisma 5 ORM, PostgreSQL 15, Redis 7, ExcelJS
- **Frontend**: Vue 3 (Composition API) + Vite 6 + Element Plus + ECharts + Pinia + Vue Router
- **AI Pipeline**: OpenAI-compatible LLM API (chat review) + PaddleOCR-VL (image/PDF OCR), both configurable via SystemConfig in DB

### Request Flow
1. Frontend makes requests to `/api/*`; Vite dev server proxies these to backend `http://localhost:3000`
2. Backend middleware chain: `express.json()` → `cors` → `morgan` → `auditLog` (logs all POST/PUT/DELETE to audit_logs table)
3. `authenticate` middleware (JWT Bearer token) and `requireRole` RBAC middleware guard protected routes
4. Controllers delegate to service classes; services use the shared `prisma` singleton from `config/db.ts`

### Authentication & RBAC
- JWT-based auth. Token stored in Pinia store (persisted via `pinia-plugin-persistedstate`), attached as `Authorization: Bearer <token>` by Axios interceptor
- Three roles: `ADMIN` (global access), `MANAGER` (own department + sub-departments), `USER` (own data only)
- `getTaskFilterByRole()` in `rbac.middleware.ts` dynamically builds Prisma `where` clauses based on role and department hierarchy
- Department hierarchy is a self-referential tree (`Department.parentId → Department.id`); sub-department IDs are resolved recursively by `getSubDepartmentIds()`

### Review Pipeline (Core Business Logic)
The async review pipeline is the heart of the system, orchestrated by `ReviewService.processTask()`:

1. **Task creation** (`TaskService.createTask`): Creates Task + TaskFile records, then triggers `ReviewService.processTask()` via `setImmediate()` (non-blocking)
2. **File parsing** (`ParserService`): Delegates to MarkItDown service (`backend/markitdown-service/`, FastAPI on configurable port) via `PythonParserService`. Supports DOCX/XLSX/PDF/PPTX with Markdown output. DWG falls back to OCR. Standard reference extraction is done in `StandardExtractorService` (Node.js-side)
3. **OCR fallback** (`OcrService`): If parsed text is empty or too short (<20 chars for PDF), and file type supports OCR, sends base64-encoded file to PaddleOCR-VL API
4. **LLM review** (`LlmService.reviewText`): Splits extracted text into ≤4000-char chunks, sends each with standard content to the LLM. Returns structured `ReviewIssue[]` (TYPO or VIOLATION)
5. **Result persistence**: Issues are bulk-inserted into `task_details` table; file error counts are updated

### Database (Prisma)
- Schema defined in `backend/prisma/schema.prisma`, uses `@@map` for snake_case table names
- Key models: `Department` (self-referential tree), `User` (role enum: ADMIN/MANAGER/USER), `Standard` (compliance rules), `Task` → `TaskFile` → `TaskDetail` (review results with `cadHandleId` for CAD定位), `SystemConfig` (key-value JSON store for LLM/OCR config), `AuditLog`
- DB connection configured via `DATABASE_URL` env var; Prisma client is a singleton exported from `config/db.ts`
- Development uses `prisma db push` (schema-only sync, no migration files); no migration directory exists

### Frontend Structure
- `utils/request.ts`: Axios instance with `/api` base URL, auto-attaches JWT token, handles 401/403/404 globally
- `stores/user.ts`: Pinia store for token + userInfo, persisted to localStorage
- `router/index.ts`: All authenticated routes nested under `AppLayout` (sidebar + topbar), guard redirects to `/login` if no token
- `views/`: Feature pages — Dashboard (ECharts), NewTask (file upload), TaskHistory, TaskDetails (left file tree + right detail cards), StandardLibrary, LLMConfig, DepartmentManage, EmployeeManage, AuditLog
- `api/`: Thin Axios wrapper modules matching backend route groups (auth, task, standard, system, dashboard, audit)

### Environment Variables (backend/.env)
- `PORT` (default 3000), `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN` (default 1d)
- LLM and OCR API configs are stored in the `system_configs` DB table, not in env vars — they can be changed at runtime via the LLM Config UI

### Key Conventions
- Backend service classes use static methods (not instances): `TaskService.createTask()`, `ReviewService.processTask()`
- All API routes are prefixed with `/api/` and registered in `app.ts`
- File uploads go to `backend/uploads/`, served statically at `/uploads/`
- Audit middleware automatically redacts `password` fields before logging
- The architecture doc (`文件智能审查系统_架构设计文档.md`) describes a more advanced microservices architecture (Python/FastAPI + Celery + MinIO + pgvector) that is the production target; the current codebase is the MVP implementation using Node.js/Express
