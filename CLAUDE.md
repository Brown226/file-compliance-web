# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**文件智能审查系统 / 核审通 (File Compliance Review System)** — an enterprise web app for uploading business documents (docx, xlsx, pdf, dwg) and automatically checking them against corporate compliance standards using LLM-powered analysis and a configurable rule engine. Runs on an internal network.

Current state is a **functional MVP** in Node.js/Express + Vue 3. The architecture design doc (`docs/文件智能审查系统_架构设计文档.md`) describes a more advanced production target (Python FastAPI + Celery + RabbitMQ + MinIO + vLLM on multi-node cluster).

## Common Commands

### Infrastructure
```bash
docker-compose up -d                          # Start PostgreSQL 15 (pgvector) + Redis 7 + markitdown
docker-compose -f docker-compose.maxkb-offline.yml up -d  # Start MaxKB (separate stack on ports 8080/15432/16379)
```

### Backend (from `backend/`)
```bash
npm install
npx prisma generate           # Generate Prisma Client from schema
npx prisma db push            # Sync schema to DB (dev mode, no migrations)
npx tsx src/seed.ts           # Seed default users + built-in prompt templates
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

### Markitdown Python Parser (from `backend/markitdown-service/`)
```bash
pip install -r requirements.txt
python main.py                # FastAPI server on port 8000 (configurable via PARSER_PORT)
# Or via Docker: started automatically with docker-compose up
```

Default accounts: `admin/admin123`, `manager/manager123`, `user/user123`

No test framework is configured in either frontend or backend.

## Architecture

### Tech Stack
- **Backend**: Node.js + Express 5 + TypeScript (CommonJS), Prisma 5 ORM, PostgreSQL 15 (pgvector), Redis 7 (ioredis)
- **Frontend**: Vue 3 (Composition API) + Vite 6 + Element Plus + ECharts + Pinia + Vue Router
- **AI Pipeline**: OpenAI-compatible LLM API (configurable via SystemConfig DB table) + MaxKB RAG + PaddleOCR-VL (OCR fallback)
- **Parser Service**: Python FastAPI (`markitdown-service`) for advanced document parsing (docx, xlsx, pdf, dwg), runs on port 8000
- **MaxKB**: External knowledge base system (v2.8.0) for RAG; standards chunked and synced via `maxkb.service.ts`

### Request Flow
1. Frontend requests to `/api/*`; Vite dev server proxies to backend `http://localhost:3000`
2. WebSocket connections to `/ws` proxied to `ws://localhost:3000` for real-time progress
3. Backend middleware chain: `express.json({limit:'50mb'})` → `express.urlencoded()` → `cors()` → `morgan()` → `auditLog()` (intercepts all POST/PUT/DELETE) → route handlers → `errorHandler()`
4. `authenticate` middleware (JWT Bearer) and `requireRole` RBAC guard protected routes
5. Controllers delegate to service classes; services use shared `prisma` singleton from `config/db.ts`

### Authentication & RBAC
- JWT-based auth. Token in Pinia store (persisted via `pinia-plugin-persistedstate`), attached as `Authorization: Bearer <token>` by Axios interceptor
- Three roles: `ADMIN` (global access), `MANAGER` (own department + sub-departments), `USER` (own data only)
- `getTaskFilterByRole()` in `rbac.middleware.ts` dynamically builds Prisma `where` clauses based on role and department hierarchy
- Department hierarchy is a self-referential tree (`Department.parentId → Department.id`); sub-department IDs resolved recursively by `getSubDepartmentIds()`

### Review Pipeline (Core Business Logic)
Orchestrated by `ReviewService.processTask()`, triggered via `setImmediate()` from `TaskService.createTask()`:

**Two-phase parallel execution:**
1. **Phase 1 (Fast)** — Rule engine + standard reference checks (per-file concurrent)
2. **Phase 2 (Slow)** — AI deep review via MaxKB RAG / LLM (per-file concurrent, chunk-level progress via WebSocket)

**Per-file pipeline:**
1. **File parsing** (`ParserService` → `python-parser.service.ts` → markitdown): Extracts structured text, tables, metadata from docx/xlsx/pdf/dwg
2. **OCR fallback** (`OcrService`): If parsed text < 20 chars for PDF, sends base64 to PaddleOCR-VL
3. **Rule engine** (`rules/index.ts` → `runAllRules`): 18 rules across 12 categories, each with DB-configurable enabled/severity
4. **AI review** (`LlmService` / `RagService`): Splits text into chunks, sends with standard context to LLM. Returns `ReviewIssue[]`
5. **Cross-file consistency** (`cross-file-consistency.service.ts`): Detects parameter value inconsistencies across files in same task
6. Results bulk-inserted into `task_details` table; progress pushed via WebSocket

**7 Review Modes** (factory pattern in `review-pipeline/factory.ts`):

| Mode | Description | Rules | AI | Cross-file | RefFiles |
|------|-------------|-------|-----|------------|----------|
| `LIBRARY_REVIEW` | 标准库审文 | Yes | RAG/LLM | No | No |
| `DOC_REVIEW` | 以文审文 | Yes | Ref compare | No | Yes |
| `CONSISTENCY` | 一致性检查 | Yes | RAG/LLM | Yes | No |
| `TYPO_GRAMMAR` | 错别字检查 | Yes | LLM-only | No | No |
| `MULTIMODAL` | 多模态审查 | Yes | Multimodal LLM | No | No |
| `CUSTOM_RULE` | 自定义规则 | Yes | No | No | No |
| `FULL_REVIEW` | 全量审查 | Yes | RAG/LLM | Yes | No |

Mode capabilities are data-driven via `mode-config.ts` `ModeCapabilities` interface. Pipeline classes: `StandardPipeline` (shared base for 4 modes), `DocReviewPipeline`, `TypoGrammarPipeline`, `MultimodalPipeline`.

### Rule Engine (`backend/src/services/rules/`)
Registry-based design in `rules/index.ts` with `RULE_REGISTRY` array. Each rule has a prefix, category, execution function, and condition. Rules load enabled/severity config from `review_rules` DB table at runtime.

18 registered rules across 12 categories: `NAME` (NAMING), `CODE`/`UNIT` (ENCODING), `ATTR` (ATTRIBUTE), `HEADER`, `PAGE`, `FORMAT`, `COMPL` (COMPLETENESS), `CONSIST` (CONSISTENCY), `LAYOUT`, `TYPO`, `INTERNAL_CODE`, `DWG_TITLE`/`DWG_LAYER`/`DWG_DIM`/`DWG_STDREF`/`DWG_SCALE`/`DWG_OVERLAP` (DWG).

### WebSocket Real-time Progress
`WebSocketService` (static class) initializes on `/ws` path alongside Express. JWT-authenticated connections. Clients subscribe to task IDs; backend pushes per-chunk progress during AI review. Frontend composables: `useWebSocket.ts`.

### Frontend Structure
- `utils/request.ts`: Axios instance with `/api` base URL, auto-attaches JWT token, handles 401/403/404 globally, cancelAllPendingRequests on route change
- `stores/user.ts`: Pinia store for token + userInfo, persisted to localStorage
- `router/index.ts`: All authenticated routes nested under `AppLayout` (sidebar + topbar), guard redirects to `/login`. Admin routes guarded by `requiresAdmin` meta
- `views/`: Feature pages — Dashboard, NewTask (3-step wizard: BasicInfo → FileUpload → Confirm), TaskHistory, TaskDetails (left file tree + right issue cards with diff), StandardLibrary (tabs: Local/MaxKB/Terminology/FalsePositive), SystemManagement, LLMConfig (tabs: ChatModel/OCR/MaxKB), PipelineConfig, ReviewRules, PromptConfig, RegexTool, Feedback (Submit/MyFeedbacks/Detail), AnnouncementManagement, AuditLogs, Workspace
- `api/`: Thin Axios wrapper modules matching backend route groups
- `composables/`: Reusable hooks — `useWebSocket`, `useAnnouncements`, `usePolling`, `useECharts`, `useMarkdown`, `useKeyboardShortcuts`, `useBlobDownload`, `useFormatTime`, `useFormatFileSize`, `useSeverityHelpers`, `useStatusHelpers`, `useCategoryHelpers`
- `components/`: Shared components — `DocumentPreview` (docx/pdf), `DwgPreview` (CAD viewer via libredwg-web WASM), `GlobalSearch`, `KnowledgeTreeSelector`, `ModeCapabilitiesPanel`, `NotificationCenter`, `AnnouncementPopup`

### Database (Prisma)
Schema in `backend/prisma/schema.prisma`, uses `@@map` for snake_case table names. 20 models:

- **Core**: `Department` (tree), `User` (role enum: ADMIN/MANAGER/USER)
- **Standards**: `StandardFolder` (tree), `Standard` (with MaxKB sync tracking), `StandardChunk` (RAG chunks), `TaskStandard` (M:M)
- **Tasks**: `Task` → `TaskFile` → `TaskDetail` (review results with `cadHandleId`), `RefFileGroup` → `RefFile` (reference files for DOC_REVIEW)
- **Config**: `SystemConfig` (key-value JSON store), `ReviewRule` (rule engine config), `PromptTemplate` (LLM prompt templates)
- **Library**: `TerminologyWhitelist` (domain terms), `FalsePositiveLibrary` (误报 dedup), `TempStandardEntry`
- **User features**: `Feedback` (bug/suggestion), `SystemAnnouncement` + `UserAnnouncementRead`
- **Audit**: `AuditLog`

Development uses `prisma db push` (schema sync, no migration files exist). LLM/OCR configs stored in `system_configs` DB table (not env vars) — configurable at runtime via LLM Config UI.

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
- Vite proxy in `vite.config.ts` proxies `/api` → `http://localhost:3000` (Node.js backend) and `/ws` → `ws://localhost:3000` (WebSocket)
- DWG file parsing uses `@mlightcad/libredwg-web` (WASM) on frontend for preview, and Python parser backend for structured extraction

### Environment Variables (`backend/.env`)
`PORT`, `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`

### Notable Files
- `backend/src/seed.ts` — default accounts + built-in prompt templates
- `backend/prisma/schema.prisma` — all data models (20 models)
- `backend/src/app.ts` — Express app setup + route registration (17 route modules)
- `backend/src/services/review-pipeline/` — Pipeline factory + 4 pipeline classes + mode config
- `backend/src/services/rules/` — Rule engine registry + 12 rule modules
- `backend/markitdown-service/` — Python FastAPI parser service
- `frontend/vite.config.ts` — Vite config with API/WebSocket proxy
- `frontend/src/composables/` — Reusable Vue composables
- `CONTEXT.md` — Domain glossary and architecture notes
- `start-platform.bat` / `start-maxkb.bat` — Windows startup scripts

## Agent Skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. `CONTEXT.md` at repo root (domain glossary) + `docs/` for design docs and user manuals. See `docs/agents/domain.md`.

### Normative Reference

The `Normative/` directory contains a legacy .NET Framework 4.5.2 WCF service (`Normative.Services.Host`) for standard document management. This is a reference implementation — the Node.js backend reimplements its functionality. Useful for understanding the original business logic and data models.
