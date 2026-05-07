# Context — 文件智能审查系统

## Glossary

| Term | Definition |
|------|-----------|
| **Task** | A single review job. Created by a user, contains one or more TaskFiles, produces TaskDetails (issues). |
| **TaskFile** | A document uploaded to a Task. Parsed into text/markdown for review. Types: docx, xlsx, pdf, dwg. |
| **TaskDetail** | A single review finding (issue) found in a TaskFile. Has issueType, severity, originalText, suggestedText. |
| **Standard** | A compliance standard document (e.g. GB/T 50001-2017). Stored in the Standard Library, chunked for RAG. |
| **StandardChunk** | A text segment of a Standard, synced to MaxKB for vector search. |
| **StandardFolder** | A folder in the Standard Library tree for organizing Standards. |
| **ReviewMode** | The review strategy for a Task: LIBRARY_REVIEW (标准库审文), DOC_REVIEW (以文审文), CONSISTENCY (一致性), TYPO_GRAMMAR (错别字), MULTIMODAL (多模态), CUSTOM_RULE (自定义规则), FULL_REVIEW (全量). |
| **ReviewRule** | A rule-based check (NAMING, ENCODING, ATTRIBUTE, HEADER, PAGE, SCAN, TEMPLATE). Has a ruleCode like NAME_001. |
| **RuleEngine** | The service that runs ReviewRules against parsed text. Produces TaskDetails with ruleCode set. |
| **LLM Review** | The AI-powered review path. Splits text into chunks, sends to LLM with standard content, returns ReviewIssues. |
| **MaxKB** | External knowledge base system (v2.8.0) for RAG. Standards are chunked and synced to MaxKB for vector retrieval. |
| **Pipeline** | The review orchestration flow: Task creation → File parsing → OCR fallback → LLM review → Rule engine → Results. |
| **ParserService** | Extracts text from uploaded files. Supports docx (mammoth), xlsx (xlsx), pdf (pdf-parse). DWG is placeholder. |
| **OcrService** | Fallback for PDFs with < 20 chars parsed text. Sends base64 to PaddleOCR-VL. |
| **RefFileGroup** | A group of reference files for DOC_REVIEW mode (以文审文). Contains RefFiles. |
| **RefFile** | A reference document uploaded for comparison in DOC_REVIEW mode. |
| **FalsePositive** | A TaskDetail marked as误报 by a user. Tracked in FalsePositiveLibrary for dedup. |
| **TerminologyWhitelist** | Domain terms that should not be flagged as typos (e.g. 核安全术语, 设备术语). |
| **PromptTemplate** | LLM prompt template with placeholders (${text}, ${ragContext}, etc.). Configurable per review module. |
| **Department** | Organizational unit in a self-referential tree. Users belong to departments. RBAC uses department hierarchy. |
| **Role** | User permission level: ADMIN (global), MANAGER (own dept + sub-depts), USER (own data only). |
| **AuditLog** | Auto-logged record of POST/PUT/DELETE operations. Password fields auto-redacted. |
| **SystemConfig** | Key-value JSON store for runtime config (LLM endpoint, OCR endpoint, etc.). |
| **Feedback** | User-submitted bug reports, suggestions, or feature requests. |
| **SystemAnnouncement** | Admin-published announcements with urgency levels (NORMAL, IMPORTANT, URGENT). |

## Architecture Notes

- Backend services use **static methods** (not instances): `TaskService.createTask()`, `ReviewService.processTask()`
- All API routes prefixed with `/api/`
- File uploads stored in `backend/uploads/`, served statically at `/uploads/`
- LLM/OCR configs stored in `system_configs` DB table (not env vars) — runtime-configurable via UI
- Vite proxy rewrites `/api` to MaxKB at `http://localhost:8080` (not the Node.js backend at port 3000)
- Development uses `prisma db push` (schema sync, no migration files)
