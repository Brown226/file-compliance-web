# DWG 文件解析、审查及结果展示 — 完整流程分析与优化方案

## 一、现状分析

### 1.1 DWG 解析流程（当前）

```
用户上传 DWG
  ↓
TaskService.createTask() → 保存文件到 backend/uploads/
  ↓
ReviewService.processTask() → setImmediate 异步触发
  ↓
BasePipeline.ensureText()
  ├─ ParserService.parseFile(filePath, 'dwg')
  │   ├─ 优先: PythonParserService.parseFile() → HTTP POST /api/parse → markitdown-service
  │   │   └─ markitdown-service 返回: {"text":"","metadata":{"parse_error":"DWG format not supported by markitdown"}}
  │   │   → **DWG 解析结果始终为空！**
  │   └─ Fallback: ParserService.parseDwg() → return '' （Node.js 占位实现，无实际能力）
  └─ OCR 降级检查
      └─ ParserService.needsOcr('', 'dwg') → 检查 _lastParseResult.metadata.parse_error → true
          └─ OcrService.isOcrSupported('dwg') → **false！DWG 不在 OCR 支持列表中**
              → **最终 extractedText = ''，DWG 审查无任何内容可审**
```

**核心问题**：DWG 解析链路完全断裂 — markitdown 不支持 DWG，Node.js 无 DWG 解析能力，OCR 也不支持 DWG。

#### 已有但未集成的 DWG 解析能力

`docs/dwg-parser-backup/dwg_parser.py` 是一个**完整的 DWG 解析器**，使用 `ezdxf` 库，具备：
- 三级 DWG→DXF 转换降级策略（ODA File Converter → dwg2dxf → ezdxf recover）
- 文本实体提取（TEXT/MTEXT → handle + layer + insert坐标）
- 尺寸标注提取（DIMENSION → measurement + handle）
- 标准引用提取（正则匹配《XX》GB/T XXX 格式 + cadHandleId 关联）
- 结构化输出（paragraphs/dimensions/dwg_layers/dwg_text_count 等元数据）

**但该解析器未集成到 markitdown-service 中**，仅作为备份文件存在。

### 1.2 DWG 审查管道流程（当前）

```
PipelineContext
  ├─ fileType: 'dwg'
  ├─ extractedText: '' （因解析失败）
  ├─ pdfPages: undefined （仅 PDF 提取）
  ├─ wordStructure: undefined （仅 DOCX 提取）
  └─ parseResult.metadata.parse_error: "DWG format not supported by markitdown"

阶段1: runFastPhase()
  ├─ ensureText() → '' (空文本)
  ├─ extractPdfPages() → undefined (非PDF)
  ├─ ensureWordStructure() → skip (非DOCX)
  ├─ runRules() → 规则引擎对空文本无任何匹配 → 0 issues
  └─ runStandardRefCheck() → 空文本无标准引用可提取 → 0 issues

阶段2: runSlowPhase()
  └─ runAIReview() → 空文本跳过 → 0 issues

最终: PipelineResult { ruleIssues: [], aiIssues: [], stdRefIssues: [] }
```

**结果**：DWG 文件审查**零输出**，无论文件内容如何。

#### 规则引擎中的 DWG 相关规则

规则类型中存在 `SCAN`（图纸扫描）分类，但在 13 个规则文件中**没有任何 DWG 专用规则**。现有规则均基于文本正则匹配，不适用于 CAD 图元结构化数据：

| 规则 | 适用性 | 说明 |
|------|--------|------|
| TYPO (错别字) | ✅ 部分 | 需要提取的文本实体 |
| NAMING (命名规范) | ⚠️ 有限 | 检查文件名/图层名，但当前逻辑仅检查文件名 |
| ENCODING (编码一致性) | ✅ 部分 | 需要提取的文本实体 |
| HEADER (页眉检查) | ❌ 不适用 | CAD 无页眉概念 |
| PAGE (页码检查) | ❌ 不适用 | CAD 无页码概念 |
| LAYOUT (排版布局) | ❌ 不适用 | 需要空间位置数据 |
| FORMAT (格式规范) | ⚠️ 有限 | 可检查文本格式一致性 |
| ATTRIBUTE (封面属性) | ❌ 不适用 | CAD 无封面 |
| COMPLETENESS (完整性) | ✅ 高价值 | 检查标题栏/图框/比例等必填字段 |
| CONSISTENCY (一致性) | ✅ 高价值 | 跨文件图层/标注/比例一致性 |
| SCAN (图纸扫描) | ✅ 专属 | **当前为空壳**，应专用于 DWG |
| TEMPLATE (模板统一) | ✅ 高价值 | 检查图框/标题栏模板 |
| STD_REF (标准引用) | ✅ 高价值 | 已有提取逻辑（dwg_parser.py） |

### 1.3 DWG 数据结构与结果展示（当前）

#### Prisma Schema

```prisma
model TaskDetail {
  id              String    @id @default(cuid())
  issueType       String    // TYPO, VIOLATION, NAMING, SCAN, LAYOUT, ...
  ruleCode        String?   // 规则代码
  severity        String    // error, warning, info
  originalText    String?   // 原文本
  suggestedText   String?   // 建议修改
  description     String?   // 问题描述
  cadHandleId     String?   // ★ DWG 专用: CAD 图元 Handle ID
  diffRanges      Json?     // 字符差异定位
  standardRefId   String?   // 关联标准ID
  standardRef     String?   // 标准条文
  sourceReferences Json?    // MaxKB RAG 溯源
  isFalsePositive Boolean   @default(false)
  fpReason        String?
  matchLevel      Int?      // 标准引用匹配级别
  similarity      Float?    // 相似度
  textPosition    Json?     // 文本定位 {chunkIndex, charOffset}
  fileId          String
  taskId          String
}
```

#### 前端展示

`IssueCardList.vue` 中 DWG 相关展示：
- **CAD Handle 徽章**：`<div class="cad-handle-badge">{{ detail.cadHandleId }}</div>`
- **CAD 定位按钮**：`<el-button @click="$emit('copyHandleId', detail.cadHandleId)">CAD 定位</el-button>`
- 复制 Handle ID 到剪贴板 → 用户在 AutoCAD 中使用快捷键定位

**问题**：
1. `cadHandleId` 仅用于复制，无可视化预览
2. 无图纸缩略图/预览
3. 无图层结构展示
4. 无尺寸标注汇总视图
5. 无空间位置信息（insert坐标）展示
6. DWG 文件在文件树中与其他文件无差异化标识

---

## 二、优化方案

### 2.1 DWG 解析链路修复（优先级: P0）

#### 方案：将 dwg_parser.py 集成到 markitdown-service

**改动文件**: `backend/markitdown-service/main.py`

```python
# main.py 中 parse_file() 的 DWG 分支修改：
if file_type.lower() == "dwg":
    from dwg_parser import parse_dwg
    content = await file.read()
    result = parse_dwg(content, filename)
    return {"code": 200, "message": "success", "data": result}
```

**改动文件**: `backend/markitdown-service/requirements.txt`

```
ezdxf>=1.0.0
```

**改动文件**: `backend/markitdown-service/Dockerfile`

```dockerfile
# 新增 ezdxf 依赖
RUN pip install ezdxf>=1.0.0
# 复制 DWG 解析器
COPY dwg_parser.py /app/
```

**性能指标**:
- DWG→DXF 转换: 1-5s（取决于文件大小和转换工具可用性）
- DXF 解析: 0.5-3s（取决于图元数量）
- 总计: < 10s（10MB 以下文件）

#### OCR 降级路径修复

**改动文件**: `backend/src/services/ocr.service.ts`

```typescript
static isOcrSupported(fileType: string): boolean {
  const supported = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'dwg'];
  // DWG: 通过截图/渲染方式 OCR（需 PaddleOCR-VL 支持）
  return supported.includes(fileType.toLowerCase());
}
```

**注意**：DWG OCR 需要先将 DWG 渲染为图片，这需要额外的渲染服务（如 LibreCAD CLI 或 ODA 绘图API），暂不作为首选方案。

### 2.2 DWG 专用审查规则（优先级: P1）

#### 新增 DWG 规则文件: `backend/src/services/rules/dwg.rule.ts`

```typescript
/**
 * DWG 图纸专用审查规则
 * 基于 ezdxf 提取的结构化数据（图层/文本/尺寸标注/图框）
 */
export const dwgRules: ReviewRule[] = [
  // 1. 标题栏完整性检查
  {
    code: 'DWG_TITLE_BLOCK',
    name: '标题栏完整性',
    description: '检查标题栏中的必填字段是否完整',
    severity: 'error',
    issueType: 'COMPLETENESS',
    check: (ctx) => {
      // 检查 parseResult.structure 中是否有标题栏文本
      // 必填字段: 图名、图号、比例、设计/校核/审核签名
    }
  },
  
  // 2. 图层命名规范
  {
    code: 'DWG_LAYER_NAMING',
    name: '图层命名规范',
    description: '检查图层名称是否符合企业命名规范',
    severity: 'warning',
    issueType: 'NAMING',
    check: (ctx) => {
      // 检查 dwg_layers 是否符合 GB/T 规范
      // 如: 粗实线、细实线、中心线、尺寸线等
    }
  },
  
  // 3. 尺寸标注一致性
  {
    code: 'DWG_DIM_CONSISTENCY',
    name: '尺寸标注一致性',
    description: '检查同一特征的不同视图尺寸标注是否一致',
    severity: 'error',
    issueType: 'CONSISTENCY',
    check: (ctx) => {
      // 检查 dimensions 中相同测量值的标注文本是否一致
    }
  },
  
  // 4. 标准引用规范性
  {
    code: 'DWG_STD_REF',
    name: '标准引用规范性',
    description: '检查图纸中引用的标准编号是否正确',
    severity: 'warning',
    issueType: 'STD_REF',
    check: (ctx) => {
      // 使用 dwg_parser.py 已提取的 standardRefs + cadHandleId
    }
  },
  
  // 5. 图框/比例标注
  {
    code: 'DWG_SCALE_CHECK',
    name: '比例标注检查',
    description: '检查图纸是否标注了正确的绘图比例',
    severity: 'info',
    issueType: 'FORMAT',
    check: (ctx) => {
      // 在文本实体中搜索"1:XX"比例标注
    }
  },
  
  // 6. 文本重叠检测
  {
    code: 'DWG_TEXT_OVERLAP',
    name: '文本重叠检测',
    description: '检测图纸中插入坐标相近的文本实体（可能重叠）',
    severity: 'warning',
    issueType: 'LAYOUT',
    check: (ctx) => {
      // 检查 parseResult.structure.paragraphs 中的 insert 坐标
      // 如果两个文本 insert 距离 < 阈值，标记为重叠
    }
  },
]
```

#### PipelineContext 扩展

```typescript
// types.ts 中 PipelineContext 新增
interface PipelineContext {
  // ...existing fields...
  
  /** DWG 图纸结构化数据 */
  dwgStructure?: {
    layers: string[];                    // 图层列表
    textEntities: Array<{               // 文本实体
      text: string;
      layer: string;
      entityType: 'TEXT' | 'MTEXT';
      handle: string;                   // CAD Handle ID
      insert?: [number, number];         // 插入坐标 (x, y)
    }>;
    dimensions: Array<{                 // 尺寸标注
      text: string;
      layer: string;
      entityType: string;
      handle: string;
      measurement?: string | null;
    }>;
    standardRefs: Array<{               // 标准引用
      standardNo: string;
      standardName: string;
      standardIdent: string;
      cadHandleId: string;              // 关联的图元 Handle
    }>;
  };
}
```

#### BasePipeline 新增 DWG 结构提取步骤

```typescript
// base-pipeline.ts 新增
protected ensureDwgStructure(ctx: PipelineContext): void {
  if (ctx.fileType.toLowerCase() !== 'dwg') return;
  if (!ctx.parseResult?.structure) return;
  
  const structure = ctx.parseResult.structure;
  ctx.dwgStructure = {
    layers: ctx.parseResult.metadata?.dwg_layers || [],
    textEntities: (structure.paragraphs || []).map(p => ({
      text: p.text,
      layer: (p.style || '').replace('图层:', ''),
      entityType: 'TEXT' as const,
      handle: p.handle || '',
      insert: undefined, // 从 structure.dimensions 中补充
    })),
    dimensions: structure.dimensions || [],
    standardRefs: structure.standardRefs || [],
  };
  
  // 模拟 pdfPages 供规则引擎使用
  if (!ctx.pdfPages && ctx.dwgStructure.textEntities.length > 0) {
    ctx.pdfPages = this.simulatePagesFromDwg(ctx.dwgStructure);
  }
}
```

### 2.3 DWG 结果展示优化（优先级: P2）

#### 2.3.1 文件树 DWG 差异化标识

`FileTreePanel.vue` 中 DWG 文件已有橙色图标，但缺少：
- **图层计数徽章**: `N 层`
- **图元计数**: `M 个文本 / K 个标注`
- **转换状态**: DWG→DXF 转换是否成功

#### 2.3.2 DWG 专用问题卡片增强

`IssueCardList.vue` 中 DWG 问题卡片应增加：

```vue
<!-- DWG 图元定位信息 -->
<div class="issue-row" v-if="detail.cadHandleId">
  <span class="row-label">CAD Handle</span>
  <div class="dwg-handle-group">
    <span class="cad-handle-badge">{{ detail.cadHandleId }}</span>
    <el-button type="primary" size="small" @click="locateInCad(detail.cadHandleId)">
      <el-icon><Aim /></el-icon> CAD 定位
    </el-button>
    <el-button size="small" @click="copyHandleId(detail.cadHandleId)">
      <el-icon><CopyDocument /></el-icon> 复制
    </el-button>
  </div>
</div>

<!-- DWG 图层信息 -->
<div class="issue-row" v-if="detail.dwgLayer">
  <span class="row-label">图层</span>
  <el-tag size="small" effect="plain">{{ detail.dwgLayer }}</el-tag>
</div>

<!-- DWG 图元类型 -->
<div class="issue-row" v-if="detail.dwgEntityType">
  <span class="row-label">图元类型</span>
  <el-tag size="small" type="info" effect="plain">{{ detail.dwgEntityType }}</el-tag>
</div>

<!-- DWG 坐标位置 -->
<div class="issue-row" v-if="detail.dwgInsertPoint">
  <span class="row-label">坐标</span>
  <code class="coord-badge">X: {{ detail.dwgInsertPoint[0].toFixed(1) }} Y: {{ detail.dwgInsertPoint[1].toFixed(1) }}</code>
</div>
```

#### 2.3.3 DWG 图纸摘要面板

新增 `DwgSummaryPanel.vue` 组件，在问题汇总视图中展示：

```
┌──────────────────────────────────────────────┐
│ 📐 图纸摘要                                    │
├──────────────────────────────────────────────┤
│ 图层统计    │ 12 层                            │
│ 文本实体    │ 156 个                           │
│ 尺寸标注    │ 43 个                            │
│ 标准引用    │ 5 条 (GB/T 50001, NB/T 20057...) │
│ 转换状态    │ ✅ DWG→DXF 转换成功               │
├──────────────────────────────────────────────┤
│ 📋 图层分布 (ECharts 横向柱状图)                 │
│  ▓▓▓▓▓▓▓▓▓▓ 粗实线    45                      │
│  ▓▓▓▓▓▓▓     细实线    28                      │
│  ▓▓▓▓        中心线    15                      │
│  ▓▓▓         尺寸线    12                      │
│  ▓▓          文字       8                      │
│  ▓           标注       3                      │
└──────────────────────────────────────────────┘
```

#### 2.3.4 多维度筛选增强

IssueCardList 筛选栏新增 DWG 专用筛选器：

```vue
<!-- DWG 文件时显示额外筛选器 -->
<el-select v-if="hasDwgFiles" v-model="filterDwgLayer" placeholder="图层" clearable size="small">
  <el-option v-for="layer in dwgLayers" :key="layer" :label="layer" :value="layer" />
</el-select>

<el-select v-if="hasDwgFiles" v-model="filterEntityType" placeholder="图元类型" clearable size="small">
  <el-option label="文本" value="TEXT" />
  <el-option label="多行文本" value="MTEXT" />
  <el-option label="尺寸标注" value="DIMENSION" />
</el-select>
```

### 2.4 数据库 Schema 扩展

```prisma
model TaskDetail {
  // ...existing fields...
  
  // ★ DWG 专用字段（新增）
  dwgLayer        String?   // 图层名称
  dwgEntityType   String?   // 图元类型 (TEXT/MTEXT/DIMENSION)
  dwgInsertX      Float?    // 插入点 X 坐标
  dwgInsertY      Float?    // 插入点 Y 坐标
}

model TaskFile {
  // ...existing fields...
  
  // ★ DWG 解析元数据（新增）
  dwgLayerCount     Int?      // 图层数量
  dwgTextCount      Int?      // 文本实体数量
  dwgDimensionCount Int?      // 尺寸标注数量
  dwgConverted      Boolean?  // DWG→DXF 是否成功转换
}
```

---

## 三、技术实施计划

### 阶段 1: 解析链路修复（1-2天）

| 步骤 | 改动 | 预期效果 |
|------|------|----------|
| 1.1 | 将 `dwg_parser.py` 复制到 `markitdown-service/` | DWG 解析器可用 |
| 1.2 | `main.py` 中添加 DWG 解析分支 | markitdown-service 支持 DWG |
| 1.3 | `requirements.txt` 添加 `ezdxf>=1.0.0` | 依赖安装 |
| 1.4 | Dockerfile 添加 ezdxf 安装 | 容器化部署 |
| 1.5 | 端到端测试 | DWG 文件可正常解析 |

**验收标准**: 上传 DWG 文件后，`parseResult.structure` 包含 paragraphs/dimensions/standardRefs，`extractedText` 非空。

### 阶段 2: 审查规则实现（2-3天）

| 步骤 | 改动 | 预期效果 |
|------|------|----------|
| 2.1 | 新建 `dwg.rule.ts` | DWG 专用规则框架 |
| 2.2 | 实现 DWG_TITLE_BLOCK 规则 | 标题栏完整性检查 |
| 2.3 | 实现 DWG_LAYER_NAMING 规则 | 图层命名规范检查 |
| 2.4 | 实现 DWG_STD_REF 规则 | 标准引用+cadHandleId 关联 |
| 2.5 | PipelineContext 扩展 dwgStructure | 规则引擎可访问 DWG 结构 |
| 2.6 | BasePipeline 新增 ensureDwgStructure | 自动提取 DWG 结构 |

**验收标准**: DWG 文件审查可产出 SCAN/NAMING/COMPLETENESS/STD_REF 类型的 issues，每条 issue 带有 cadHandleId。

### 阶段 3: 结果展示优化（2-3天）

| 步骤 | 改动 | 预期效果 |
|------|------|----------|
| 3.1 | Prisma Schema 扩展 dwgLayer/dwgEntityType/坐标字段 | DB 支持 DWG 专用字段 |
| 3.2 | review.service.ts 中保存 DWG 专用字段 | 审查结果包含 DWG 元数据 |
| 3.3 | IssueCardList.vue 增加 DWG 专用行 | 展示图层/图元类型/坐标 |
| 3.4 | 新建 DwgSummaryPanel.vue | 图纸摘要面板 |
| 3.5 | 筛选栏增加图层/图元类型筛选 | 多维度筛选 |
| 3.6 | FileTreePanel 增加 DWG 元数据展示 | 图层/图元计数 |

**验收标准**: DWG 审查结果可按图层/图元类型筛选，问题卡片显示 Handle ID+图层+坐标，汇总视图展示图纸统计。

---

## 四、性能指标

| 指标 | 当前值 | 目标值 | 说明 |
|------|--------|--------|------|
| DWG 解析成功率 | 0% | ≥90% | 依赖 ODA/dwg2dxf 工具可用性 |
| DWG 审查 issue 产出 | 0 | ≥5/文件 | 规则引擎+标准引用+AI |
| DWG 解析耗时 | N/A | <10s | 10MB 以下文件 |
| cadHandleId 关联率 | N/A | ≥80% | 每条问题关联到具体图元 |
| 图层覆盖率 | N/A | ≥70% | 审查规则覆盖主要图层 |

---

## 五、风险与降级

| 风险 | 影响 | 降级方案 |
|------|------|----------|
| ODA File Converter 未安装 | DWG→DXF 转换失败 | ezdxf recover 模式（有限支持） |
| DWG 文件版本过新 | ezdxf 无法读取 | 提示用户转换为较低版本 DXF |
| 大型 DWG 文件（>50MB） | 解析超时 | 限制文件大小 + 流式解析 |
| cadHandleId 在 CAD 中不存在 | 定位失败 | 提示"图元可能已被修改" |
