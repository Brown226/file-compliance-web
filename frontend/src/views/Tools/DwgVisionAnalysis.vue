<template>
  <div class="dwg-vision-page">
    <!-- ===== 页面头部 ===== -->
    <div class="page-hero">
      <div class="hero-left">
        <div class="hero-icon">
          <el-icon :size="26"><PictureFilled /></el-icon>
        </div>
        <div class="hero-text">
          <h2>图纸视觉智能分析</h2>
          <p>基于视觉大模型，对 CAD 图纸进行标题栏识别、图例符号识别、标注完整性检查和设计说明合规审查</p>
        </div>
      </div>
      <div class="hero-right">
        <el-button plain @click="goBackToEntry">
          <el-icon><ArrowLeft /></el-icon>
          重新选择模块
        </el-button>
        <el-tag v-if="visionStatus" :type="visionStatus.configured ? 'success' : 'warning'" effect="dark" round size="large">
          <el-icon style="margin-right:4px"><component :is="visionStatus.configured ? CircleCheck : WarningFilled" /></el-icon>
          {{ visionStatus.configured ? `视觉模型就绪 · ${visionStatus.modelName}` : '视觉模型未配置' }}
        </el-tag>
      </div>
    </div>

    <div class="page-body" :class="{ 'split-mode': splitView && result }">
      <!-- Task 27: 分屏模式切换按钮（分析完成后显示） -->
      <div v-if="result && previewSvg" class="split-toggle-bar">
        <el-button
          size="small"
          :type="splitView ? 'primary' : 'default'"
          @click="splitView = !splitView"
        >
          <el-icon style="margin-right: 4px"><Grid /></el-icon>
          {{ splitView ? '退出分屏' : '分屏对比' }}
        </el-button>
      </div>

      <!-- ===== 左侧：上传与控制（分屏模式下仅显示 SVG 预览） ===== -->
      <div class="left-panel" :class="{ 'split-left': splitView && result }">
        <!-- Task 26/27: 分屏模式 — 使用 DwgVisionPreviewPanel 通用组件（支持 pan/zoom + bbox 联动） -->
        <DwgVisionPreviewPanel
          v-if="splitView && result"
          :svg-content="previewSvg"
          :bbox-issues="bboxIssues"
          :active-issue-id="activeIssueId"
          :focus-bbox="focusBbox"
          class="split-preview-container"
          @rect-click="handleRectClick"
        />

        <!-- 正常模式：上传图纸 + SVG 预览 + 分析选项 -->
        <template v-else>
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="card-title">
              <el-icon class="title-icon"><UploadFilled /></el-icon>
              <span>上传图纸</span>
            </div>
          </template>

          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="1"
            accept=".dwg"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            drag
            class="dwg-upload"
          >
            <div class="upload-inner">
              <el-icon class="upload-icon"><UploadFilled /></el-icon>
              <div class="upload-text">拖拽 DWG 文件到此处，或 <em>点击选择</em></div>
              <div class="upload-hint">仅支持 .dwg 格式 · 不超过 50MB</div>
            </div>
          </el-upload>

          <!-- 已选文件信息 -->
          <div v-if="dwgFile" class="file-info">
            <el-icon class="file-icon"><Document /></el-icon>
            <div class="file-meta">
              <div class="file-name">{{ dwgFile.name }}</div>
              <div class="file-size">{{ formatFileSize(dwgFile.size) }}</div>
            </div>
          </div>

          <!-- SVG 预览缩略图 -->
          <div v-if="previewSvg" class="svg-preview">
            <div class="preview-label">
              <el-icon><View /></el-icon>
              <span>图纸预览</span>
              <el-tag v-if="bboxIssues.length" size="small" type="danger" effect="plain" class="overlay-count-tag">
                {{ bboxIssues.length }} 个标注
              </el-tag>
            </div>
            <div class="preview-canvas" :class="{ 'has-result': !!result }">
              <div class="preview-wrapper">
                <div class="preview-content" v-html="previewSvg"></div>
                <!-- SVG 叠框层：覆盖在图纸预览之上，根据 issue 的归一化 bbox 渲染问题框 -->
                <svg
                  v-if="bboxIssues.length"
                  class="overlay-svg"
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                >
                  <rect
                    v-for="issue in bboxIssues"
                    :key="issue.id"
                    :ref="el => setRectRef(el, issue.id)"
                    :x="issue.bbox![0]"
                    :y="issue.bbox![1]"
                    :width="rectWidth(issue.bbox!)"
                    :height="rectHeight(issue.bbox!)"
                    :class="['issue-rect', `issue-rect-${issue.severity}`, { 'issue-rect-active': activeIssueId === issue.id }]"
                    @click.stop="handleRectClick(issue)"
                  />
                </svg>
              </div>
            </div>
          </div>
        </el-card>

        <!-- 分析选项 -->
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="card-title">
              <el-icon class="title-icon"><SetUp /></el-icon>
              <span>分析选项</span>
              <el-tag size="small" type="info" class="count-tag">{{ selectedAnalyses.length }}/{{ analysisOptions.length }}</el-tag>
            </div>
          </template>

          <div class="option-grid">
            <div
              v-for="opt in analysisOptions"
              :key="opt.key"
              class="option-item"
              :class="{ selected: selectedAnalyses.includes(opt.key) }"
              @click="toggleAnalysis(opt.key)"
            >
              <div class="option-icon" :style="{ background: opt.bg, color: opt.color }">
                <el-icon :size="18"><component :is="opt.icon" /></el-icon>
              </div>
              <div class="option-text">
                <div class="option-label">{{ opt.label }}</div>
                <div class="option-desc">{{ opt.desc }}</div>
              </div>
              <div class="option-check">
                <el-icon v-if="selectedAnalyses.includes(opt.key)"><CircleCheckFilled /></el-icon>
              </div>
            </div>
          </div>

          <!-- 合规审查参考条文 -->
          <transition name="el-zoom-in-top">
            <div v-if="selectedAnalyses.includes('compliance')" class="ref-section">
              <div class="ref-label">对照标准条文（可选）</div>
              <el-input
                v-model="refText"
                type="textarea"
                :rows="3"
                placeholder="粘贴需要对照的标准条文 / 规范要求，用于合规性比对"
              />

              <!-- Task 15: 知识库 RAG 注入 -->
              <div class="kb-section">
                <div class="kb-label">
                  <span>从知识库检索标准条文（可选）</span>
                  <el-tooltip
                    content="选择知识库后，系统会自动检索与图纸相关的标准条文，注入到合规审查提示词中。检索失败时降级为仅使用上方手动输入的条文。"
                    placement="top"
                  >
                    <el-icon class="kb-help"><WarningFilled /></el-icon>
                  </el-tooltip>
                </div>
                <el-select
                  v-model="selectedKbId"
                  placeholder="选择知识库（留空则不启用 RAG）"
                  :loading="loadingKnowledgeBases"
                  clearable
                  style="width: 100%"
                  size="default"
                >
                  <el-option
                    v-for="kb in knowledgeBases"
                    :key="kb.id"
                    :label="kb.name + (kb.desc ? ` — ${kb.desc}` : '')"
                    :value="kb.id"
                  />
                </el-select>
                <el-input
                  v-if="selectedKbId"
                  v-model="ragQuery"
                  type="textarea"
                  :rows="2"
                  placeholder="检索查询词（可选，留空使用默认关键词：核电工程图纸设计说明 安全 材料 焊接 检验 标准引用）"
                  style="margin-top: 8px"
                />
              </div>
            </div>
          </transition>

          <div class="action-row">
            <el-button
              type="primary"
              size="large"
              :loading="analyzing"
              :disabled="!dwgFile || selectedAnalyses.length === 0"
              class="analyze-btn"
              @click="startAnalysis"
            >
              <el-icon v-if="!analyzing" style="margin-right:6px"><VideoPlay /></el-icon>
              {{ analyzing ? '分析中...' : '开始分析' }}
            </el-button>

            <!-- Task 25: 历史记录入口 -->
            <el-button
              size="large"
              plain
              class="history-btn"
              @click="openHistory"
            >
              <el-icon style="margin-right:6px"><Clock /></el-icon>
              历史记录
            </el-button>
          </div>

          <!-- 进度提示 -->
          <div v-if="analyzing" class="progress-hint">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>正在调用视觉模型分析，请耐心等待（约 1-2 分钟）...</span>
          </div>

          <!-- 视觉模型未配置警告 -->
          <el-alert
            v-if="visionStatus && !visionStatus.configured"
            type="warning"
            :closable="false"
            show-icon
            class="config-warning"
            title="视觉模型未配置"
            description="请在 系统管理 → AI配置 中配置视觉模型后再使用此功能"
          />
        </el-card>
        </template>
      </div>

      <!-- ===== 右侧：分析结果 ===== -->
      <div class="right-panel">
        <!-- 空状态 -->
        <div v-if="!result && !analyzing" class="empty-state">
          <div class="empty-icon">
            <el-icon :size="56"><PictureFilled /></el-icon>
          </div>
          <h3>暂无分析结果</h3>
          <p>上传 DWG 图纸，选择分析项后点击「开始分析」</p>
          <div class="empty-steps">
            <div class="step"><span class="step-num">1</span>上传图纸</div>
            <el-icon class="step-arrow"><Right /></el-icon>
            <div class="step"><span class="step-num">2</span>选择分析项</div>
            <el-icon class="step-arrow"><Right /></el-icon>
            <div class="step"><span class="step-num">3</span>查看结果</div>
          </div>
        </div>

        <!-- 分析中骨架 -->
        <div v-else-if="analyzing" class="loading-state">
          <div class="loading-spinner">
            <el-icon :size="44" class="is-loading"><Loading /></el-icon>
          </div>
          <h3>视觉模型分析中</h3>
          <p>正在渲染图纸并调用视觉大模型，请稍候...</p>
          <el-progress :percentage="100" :indeterminate="true" :show-text="false" class="loading-bar" />
        </div>

        <!-- 结果 -->
        <el-card v-else shadow="never" class="result-card">
          <template #header>
            <div class="result-header">
              <div class="result-title">
                <el-icon class="title-icon"><DataAnalysis /></el-icon>
                <span>分析结果</span>
              </div>
              <div class="result-meta">
                <el-tag v-if="result.modelInfo" size="small" type="success" effect="plain">
                  {{ result.modelInfo.model }} · {{ result.modelInfo.modelType }}
                </el-tag>
                <el-tag size="small" type="info" effect="plain">
                  <el-icon style="margin-right:3px"><Clock /></el-icon>
                  耗时 {{ (result.duration_ms / 1000).toFixed(1) }}s
                </el-tag>
              </div>
            </div>
          </template>

          <!-- 错误提示 -->
          <el-alert
            v-if="result.errors.length > 0"
            type="error"
            :closable="false"
            class="error-alert"
          >
            <template #title>部分分析项失败</template>
            <ul>
              <li v-for="(err, i) in result.errors" :key="i">{{ err }}</li>
            </ul>
          </el-alert>

          <el-tabs v-model="activeTab" class="result-tabs">
            <!-- 标题栏 -->
            <el-tab-pane name="titleBlock" v-if="result.titleBlock">
              <template #label>
                <span class="tab-label"><el-icon><Document /></el-icon>标题栏</span>
              </template>
              <div class="title-block-table">
                <div class="tb-row">
                  <div class="tb-cell"><span class="tb-label">图号</span><span class="tb-value strong">{{ result.titleBlock.drawingNo || '—' }}</span></div>
                  <div class="tb-cell"><span class="tb-label">版本</span><span class="tb-value">{{ result.titleBlock.revision || '—' }}</span></div>
                  <div class="tb-cell"><span class="tb-label">比例</span><span class="tb-value">{{ result.titleBlock.scale || '—' }}</span></div>
                </div>
                <div class="tb-row full">
                  <div class="tb-cell"><span class="tb-label">图名</span><span class="tb-value strong">{{ result.titleBlock.title || '—' }}</span></div>
                </div>
                <div class="tb-row">
                  <div class="tb-cell"><span class="tb-label">设计</span><span class="tb-value">{{ result.titleBlock.designer || '—' }}</span></div>
                  <div class="tb-cell"><span class="tb-label">校核</span><span class="tb-value">{{ result.titleBlock.checker || '—' }}</span></div>
                  <div class="tb-cell"><span class="tb-label">审核</span><span class="tb-value">{{ result.titleBlock.reviewer || '—' }}</span></div>
                </div>
                <div class="tb-row">
                  <div class="tb-cell"><span class="tb-label">批准</span><span class="tb-value">{{ result.titleBlock.approver || '—' }}</span></div>
                  <div class="tb-cell"><span class="tb-label">日期</span><span class="tb-value">{{ result.titleBlock.date || '—' }}</span></div>
                  <div class="tb-cell"><span class="tb-label">单位</span><span class="tb-value">{{ result.titleBlock.company || '—' }}</span></div>
                </div>
              </div>

              <!-- Task 24: OCR + VLM 交叉验证结果 -->
              <div v-if="result.ocrVerification" class="ocr-verification">
                <div class="section-title">
                  <el-icon><CircleCheck /></el-icon>OCR + VLM 交叉验证
                  <el-tag
                    size="small"
                    :type="ocrVerificationTagType(result.ocrVerification)"
                    style="margin-left: 8px"
                  >{{ ocrVerificationStatusLabel(result.ocrVerification) }}</el-tag>
                </div>
                <div v-if="result.ocrVerification.status === 'success'" class="ocr-verif-body">
                  <div v-if="result.ocrVerification.needsReview" class="ocr-needs-review">
                    <el-icon><WarningFilled /></el-icon>
                    OCR 与 VLM 在关键字段（图号/图名）存在不一致，建议人工复核
                  </div>
                  <div v-if="result.ocrVerification.mismatches.length" class="ocr-mismatches">
                    <div class="mismatch-title">不一致字段（{{ result.ocrVerification.mismatches.length }} 项）：</div>
                    <ul>
                      <li v-for="(m, i) in result.ocrVerification.mismatches" :key="i">{{ m }}</li>
                    </ul>
                  </div>
                  <div v-else-if="!result.ocrVerification.needsReview" class="ocr-consistent">
                    <el-icon><CircleCheck /></el-icon>
                    所有关键字段在 OCR 文本中均能匹配，识别结果可信
                  </div>
                  <el-collapse class="ocr-text-collapse">
                    <el-collapse-item title="查看 OCR 提取的整图文本（截断 5000 字符）">
                      <pre class="ocr-text-pre">{{ result.ocrVerification.ocrText }}</pre>
                    </el-collapse-item>
                  </el-collapse>
                </div>
                <div v-else class="ocr-verif-body ocr-degraded">
                  <el-icon><InfoFilled /></el-icon>
                  OCR 交叉验证不可用：{{ result.ocrVerification.reason || '未知原因' }}
                </div>
              </div>

              <!-- Task 20: DWG 元数据双校验结果 -->
              <div v-if="result.dwgMetadataVerification" class="ocr-verification">
                <div class="section-title">
                  <el-icon><DataAnalysis /></el-icon>DWG 元数据双校验
                  <el-tag
                    size="small"
                    :type="dwgMetadataTagType(result.dwgMetadataVerification)"
                    style="margin-left: 8px"
                  >{{ dwgMetadataStatusLabel(result.dwgMetadataVerification) }}</el-tag>
                </div>
                <div v-if="result.dwgMetadataVerification.status === 'success'" class="ocr-verif-body">
                  <div class="dwg-meta-stats">
                    <el-tag size="small" type="info">WASM 图层 {{ result.dwgMetadataVerification.wasLayerCount }}</el-tag>
                    <el-tag size="small" type="info">WASM 文本 {{ result.dwgMetadataVerification.wasTextCount }}</el-tag>
                    <el-tag size="small" type="info">WASM 标注 {{ result.dwgMetadataVerification.wasDimensionCount }}</el-tag>
                    <el-tag size="small" type="info">WASM 标准引用 {{ result.dwgMetadataVerification.wasStandardRefs.length }}</el-tag>
                  </div>
                  <div v-if="result.dwgMetadataVerification.needsReview" class="ocr-needs-review">
                    <el-icon><WarningFilled /></el-icon>
                    WASM 元数据与 VLM 识别结果存在关键不一致（疑似幻觉或漏识），建议人工复核
                  </div>
                  <div v-if="result.dwgMetadataVerification.mismatches.length" class="ocr-mismatches">
                    <div class="mismatch-title">不一致项（{{ result.dwgMetadataVerification.mismatches.length }} 项）：</div>
                    <ul>
                      <li v-for="(m, i) in result.dwgMetadataVerification.mismatches" :key="i">{{ m }}</li>
                    </ul>
                  </div>
                  <div v-else-if="!result.dwgMetadataVerification.needsReview" class="ocr-consistent">
                    <el-icon><CircleCheck /></el-icon>
                    WASM 元数据与 VLM 识别结果一致
                  </div>
                </div>
              </div>
            </el-tab-pane>

            <!-- 图例符号 -->
            <el-tab-pane name="symbols" v-if="result.symbols">
              <template #label>
                <span class="tab-label"><el-icon><Grid /></el-icon>图例符号</span>
              </template>
              <div class="summary-box">{{ result.symbols.summary }}</div>
              <el-table :data="result.symbols.symbols" stripe size="small" max-height="460"
                @row-click="onSymbolsRowClick"
                :row-class-name="symbolsRowClass"
              >
                <el-table-column prop="tag" label="位号" width="120" />
                <el-table-column prop="type" label="类型" width="110">
                  <template #default="{ row }">
                    <el-tag size="small" :type="symbolTypeTag(row.type)">{{ symbolTypeLabel(row.type) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="description" label="描述" />
                <el-table-column prop="position" label="位置" width="140" />
              </el-table>
              <div class="total-count">共识别 <b>{{ result.symbols.totalCount }}</b> 个图例符号</div>
            </el-tab-pane>

            <!-- 标注完整性 -->
            <el-tab-pane name="annotations" v-if="result.annotations">
              <template #label>
                <span class="tab-label"><el-icon><EditPen /></el-icon>标注检查</span>
              </template>
              <div class="score-card">
                <el-progress
                  type="dashboard"
                  :percentage="result.annotations.completenessScore"
                  :color="scoreColor(result.annotations.completenessScore)"
                  :width="120"
                >
                  <template #default="{ percentage }">
                    <span class="score-num">{{ percentage }}</span>
                    <span class="score-unit">分</span>
                  </template>
                </el-progress>
                <div class="score-info">
                  <div class="score-title">标注完整性评分</div>
                  <div class="score-desc">{{ result.annotations.summary }}</div>
                </div>
              </div>
              <el-table :data="result.annotations.missingItems" stripe size="small" max-height="380"
                @row-click="onAnnotationsRowClick"
                :row-class-name="annotationsRowClass"
              >
                <el-table-column prop="item" label="问题" />
                <el-table-column prop="location" label="位置" width="160" />
                <el-table-column prop="severity" label="严重度" width="90">
                  <template #default="{ row }">
                    <el-tag size="small" :type="severityTag(row.severity)">{{ severityLabel(row.severity) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="复核" width="110">
                  <template #default="{ row }">
                    <el-tag v-if="row.confidence != null && row.confidence < 0.6" type="warning" size="small">待人工复核</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <!-- 合规审查 -->
            <el-tab-pane name="compliance" v-if="result.compliance">
              <template #label>
                <span class="tab-label"><el-icon><Stamp /></el-icon>合规审查</span>
              </template>
              <div class="summary-box">{{ result.compliance.summary }}</div>

              <div v-if="result.compliance.designNotes.length" class="notes-section">
                <div class="section-title"><el-icon><Memo /></el-icon>设计说明 / 技术要求</div>
                <ul class="design-notes">
                  <li v-for="(note, i) in result.compliance.designNotes" :key="i">{{ note }}</li>
                </ul>
              </div>

              <div v-if="result.compliance.issues.length" class="notes-section">
                <div class="section-title"><el-icon><WarningFilled /></el-icon>合规问题</div>
                <el-table :data="result.compliance.issues" stripe size="small" max-height="380"
                  @row-click="onComplianceRowClick"
                  :row-class-name="complianceRowClass"
                >
                  <el-table-column prop="note" label="原文" width="200" show-overflow-tooltip />
                  <el-table-column prop="violation" label="问题" />
                  <el-table-column prop="suggestion" label="建议" />
                  <el-table-column label="区域" width="100">
                    <template #default="{ row }">
                      <el-tag v-if="row.markId != null" size="small" type="info">{{ markIdLabel(row.markId) }}</el-tag>
                      <span v-else>—</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="severity" label="严重度" width="90">
                    <template #default="{ row }">
                      <el-tag size="small" :type="severityTag(row.severity)">{{ severityLabel(row.severity) }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="复核" width="110">
                    <template #default="{ row }">
                      <el-tag v-if="row.confidence != null && row.confidence < 0.6" type="warning" size="small">待人工复核</el-tag>
                    </template>
                  </el-table-column>
                  <!-- Task 28: 规范条文链接列 -->
                  <el-table-column label="条文" width="100" fixed="right">
                    <template #default="{ row }">
                      <el-button
                        v-if="row.clauseText"
                        size="small"
                        type="primary"
                        link
                        @click.stop="openClauseDialog(row)"
                      >
                        <el-icon style="margin-right: 2px"><Document /></el-icon>查看条文
                      </el-button>
                      <span v-else>—</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </el-tab-pane>

            <!-- 规则检查（来自内置规则引擎，与 LLM 视觉识别互补） -->
            <el-tab-pane name="ruleIssues" v-if="result.ruleIssues?.length">
              <template #label>
                <span class="tab-label"><el-icon><WarningFilled /></el-icon>规则检查</span>
              </template>
              <div class="summary-box">基于内置规则引擎的检查结果（共 {{ result.ruleIssues.length }} 条），与视觉模型识别结果相互补充</div>
              <div class="rule-issues-list">
                <div
                  v-for="(rule, i) in result.ruleIssues"
                  :key="i"
                  class="rule-issue-item"
                  :class="`rule-issue-${rule.severity}`"
                >
                  <div class="rule-issue-header">
                    <el-tag size="small" :type="severityTag(rule.severity)">{{ severityLabel(rule.severity) }}</el-tag>
                    <el-tag size="small" type="info" effect="plain" class="rule-code">{{ rule.code }}</el-tag>
                  </div>
                  <div class="rule-issue-message">{{ rule.message }}</div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>

    <!-- Task 25/26: 历史记录抽屉（已拆分为子组件） -->
    <DwgVisionHistoryDrawer
      v-model:visible="historyVisible"
      v-model:currentPage="historyPage"
      :loading="historyLoading"
      :items="historyItems"
      :total="historyTotal"
      :pageSize="historyPageSize"
      :analysisLabels="analysisLabelMap"
      @replay="replayHistoryItem"
      @page-change="loadHistory"
    />

    <!-- Task 28: 规范条文原文弹窗 -->
    <el-dialog
      v-model="clauseDialogVisible"
      :title="clauseDialogTitle"
      width="600px"
      :destroy-on-close="true"
    >
      <div class="clause-dialog-body">
        <div v-if="clauseDialogContent.clauseRef" class="clause-ref">
          <el-icon><Document /></el-icon>
          <span>{{ clauseDialogContent.clauseRef }}</span>
        </div>
        <div class="clause-text">{{ clauseDialogContent.clauseText }}</div>
      </div>
      <template #footer>
        <el-button @click="clauseDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  UploadFilled, Loading, Document, View, SetUp, CircleCheckFilled, CircleCheck,
  VideoPlay, PictureFilled, Right, DataAnalysis, Clock, Grid, EditPen, Stamp,
  Memo, WarningFilled, ArrowLeft, InfoFilled,
} from '@element-plus/icons-vue'
import { dwgToPng, parseDwgFile } from '@/utils/dwg-parser'
import { analyzeDwgVision, getVisionStatus, getVisionHistory, type VisionAnalyzeResult, type VisionStatusResult, type VisionHistoryItem, type OcrVerificationResult, type DwgMetadata, type DwgMetadataVerification } from '@/api/dwg-vision'
import DwgVisionHistoryDrawer from './DwgVisionHistoryDrawer.vue'
import DwgVisionPreviewPanel from './DwgVisionPreviewPanel.vue'
import type { BboxOverlay } from '@/composables/useSvgZoomPan'
import { getKnowledgeBasesApi } from '@/api/maxkb'

const router = useRouter()

/** 返回审查模块选择页（与其他审查模式入口体验一致） */
function goBackToEntry() {
  router.push('/review')
}

// 分析选项配置
const analysisOptions = [
  { key: 'titleBlock', label: '标题栏识别', desc: '提取图号、图名、版本与审批信息', icon: Document, bg: '#eff6ff', color: '#2563eb' },
  { key: 'symbols', label: '图例符号识别', desc: '识别阀门、泵、仪表等设备符号', icon: Grid, bg: '#f0fdf4', color: '#16a34a' },
  { key: 'annotations', label: '标注完整性', desc: '检查尺寸标注与技术要求完整性', icon: EditPen, bg: '#fffbeb', color: '#d97706' },
  { key: 'compliance', label: '合规审查', desc: '对照标准条文检查设计说明', icon: Stamp, bg: '#fef2f2', color: '#dc2626' },
]

// Task 26: 分析项 label 映射（传给历史抽屉子组件）
const analysisLabelMap = computed(() => {
  const map: Record<string, string> = {}
  for (const opt of analysisOptions) map[opt.key] = opt.label
  return map
})

// 状态
const dwgFile = ref<File | null>(null)
const previewSvg = ref('')
const selectedAnalyses = ref<string[]>(['titleBlock', 'symbols', 'annotations', 'compliance'])
const refText = ref('')
const analyzing = ref(false)
const result = ref<VisionAnalyzeResult | null>(null)
const activeTab = ref('titleBlock')
const visionStatus = ref<VisionStatusResult | null>(null)
const uploadRef = ref()

// Task 15: 知识库 RAG 注入相关状态
const knowledgeBases = ref<Array<{ id: string; name: string; desc?: string }>>([])
const selectedKbId = ref<string>('')
const ragQuery = ref<string>('')
const loadingKnowledgeBases = ref(false)

// Task 25: 历史记录相关状态
const historyVisible = ref(false)
const splitView = ref(false)  // Task 27: 分屏对比模式
const historyLoading = ref(false)
const historyItems = ref<VisionHistoryItem[]>([])
const historyTotal = ref(0)
const historyPage = ref(1)
const historyPageSize = ref(10)

/** 联动用：当前高亮的 issue id（`${tab}-${index}` 格式） */
const activeIssueId = ref('')

/** Task 27: pan/zoom 目标 bbox（点击列表项时设置，DwgVisionPreviewPanel watch 此值自动定位） */
const focusBbox = ref<[number, number, number, number] | null>(null)

/** Task 28: 规范条文弹窗状态 */
const clauseDialogVisible = ref(false)
const clauseDialogTitle = ref('规范条文原文')
const clauseDialogContent = ref<{ clauseRef?: string; clauseText?: string }>({})

/** 收集所有维度的 issue，用于图纸叠框与列表双向联动 */
interface CollectedIssue {
  id: string
  tab: 'symbols' | 'annotations' | 'compliance'
  index: number
  severity: 'error' | 'warning' | 'info'
  bbox?: [number, number, number, number]
  confidence?: number
  label: string
}

const allIssues = computed<CollectedIssue[]>(() => {
  const r = result.value
  if (!r) return []
  const list: CollectedIssue[] = []
  // 图例符号：severity 统一 info（符号识别不是 issue）
  r.symbols?.symbols?.forEach((s, i) => {
    list.push({
      id: `symbols-${i}`,
      tab: 'symbols',
      index: i,
      severity: 'info',
      bbox: s.bbox,
      label: `${s.tag} ${s.description}`.trim(),
    })
  })
  // 标注完整性
  r.annotations?.missingItems?.forEach((a, i) => {
    list.push({
      id: `annotations-${i}`,
      tab: 'annotations',
      index: i,
      severity: a.severity,
      bbox: a.bbox,
      confidence: a.confidence,
      label: a.item,
    })
  })
  // 合规审查
  r.compliance?.issues?.forEach((c, i) => {
    list.push({
      id: `compliance-${i}`,
      tab: 'compliance',
      index: i,
      severity: c.severity,
      bbox: c.bbox,
      confidence: c.confidence,
      label: c.note,
    })
  })
  return list
})

/** 有 bbox 的 issue（用于渲染叠框 rect） */
const bboxIssues = computed(() => allIssues.value.filter(i => i.bbox))

/** rect 元素 ref 集合，用于 scrollIntoView */
const rectRefs = new Map<string, SVGRectElement>()
function setRectRef(el: any, id: string) {
  if (el) rectRefs.set(id, el as SVGRectElement)
  else rectRefs.delete(id)
}

/** 计算 rect 宽高（bbox 视为 [x1, y1, x2, y2]，左上原点） */
function rectWidth(bbox: [number, number, number, number]) {
  return Math.max(0, bbox[2] - bbox[0])
}
function rectHeight(bbox: [number, number, number, number]) {
  return Math.max(0, bbox[3] - bbox[1])
}

// 初始化：检查视觉模型配置
onMounted(async () => {
  try {
    const res = await getVisionStatus()
    if (res.code === 200) {
      visionStatus.value = res.data
    }
  } catch { /* ignore */ }

  // Task 15: 加载可用知识库列表（用于 compliance 维度的 RAG 注入）
  loadKnowledgeBases()
})

/** 加载 MaxKB 知识库列表 */
async function loadKnowledgeBases() {
  loadingKnowledgeBases.value = true
  try {
    const list = await getKnowledgeBasesApi()
    knowledgeBases.value = Array.isArray(list) ? list : []
  } catch (e: any) {
    console.warn('[DWG Vision] 加载知识库列表失败:', e?.message)
    knowledgeBases.value = []
  } finally {
    loadingKnowledgeBases.value = false
  }
}

/** Task 25: 加载历史记录 */
async function loadHistory() {
  historyLoading.value = true
  try {
    const res = await getVisionHistory({
      limit: historyPageSize.value,
      offset: (historyPage.value - 1) * historyPageSize.value,
    })
    if (res.code === 200) {
      historyItems.value = res.data.items
      historyTotal.value = res.data.total
    }
  } catch (e: any) {
    ElMessage.error('加载历史记录失败: ' + (e?.message || ''))
  } finally {
    historyLoading.value = false
  }
}

/** Task 25: 打开历史抽屉 */
function openHistory() {
  historyVisible.value = true
  loadHistory()
}

/** Task 25/29: 回放历史记录（增强：自动退出分屏 + 提示预览恢复） */
function replayHistoryItem(item: VisionHistoryItem) {
  result.value = item.result
  activeTab.value = 'titleBlock'
  historyVisible.value = false
  splitView.value = false  // Task 27: 回放时退出分屏
  // Task 29: 历史记录不含 SVG 预览，提示用户需重新上传恢复预览
  if (!previewSvg.value) {
    ElMessage.info(`已加载历史结果：${item.fileName || '未命名'}。如需分屏对比，请重新上传同名文件恢复预览`)
  } else {
    ElMessage.success(`已加载历史记录：${item.fileName || '未命名'}（${new Date(item.createdAt).toLocaleString('zh-CN')}）`)
  }
}

// 切换分析项
function toggleAnalysis(key: string) {
  const idx = selectedAnalyses.value.indexOf(key)
  if (idx >= 0) selectedAnalyses.value.splice(idx, 1)
  else selectedAnalyses.value.push(key)
}

// 文件大小格式化
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

// 文件选择
async function handleFileChange(uploadFile: any) {
  const file = uploadFile.raw as File
  if (!file.name.toLowerCase().endsWith('.dwg')) {
    ElMessage.warning('仅支持 .dwg 格式文件')
    uploadRef.value?.clearFiles()
    return
  }
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.warning('文件大小超过 50MB 限制')
    uploadRef.value?.clearFiles()
    return
  }
  dwgFile.value = file
  result.value = null

  // 生成 SVG 预览（轻量）
  try {
    const { dwgToSvg } = await import('@/utils/dwg-parser')
    const svgResult = await dwgToSvg(file)
    if (svgResult.svg.length < 500000) {
      previewSvg.value = svgResult.svg
    } else {
      previewSvg.value = '<div style="padding:20px;color:#999">图纸过大，跳过预览</div>'
    }
  } catch (e: any) {
    previewSvg.value = `<div style="padding:20px;color:#f56c6c">预览失败: ${e.message}</div>`
  }
}

function handleFileRemove() {
  dwgFile.value = null
  previewSvg.value = ''
  result.value = null
}

// 开始分析
async function startAnalysis() {
  if (!dwgFile.value) return

  analyzing.value = true
  result.value = null

  try {
    // 1. DWG → PNG
    ElMessage.info('正在渲染图纸为图片...')
    const imageBase64 = await dwgToPng(dwgFile.value)

    // Task 20: 并行解析 DWG 提取元数据（layers/textEntities/dimensions/standardRefs）
    // 失败不阻塞主流程，仅降级为不传元数据（后端 dwgMetadataVerification 字段为 undefined）
    let dwgMetadata: DwgMetadata | undefined
    try {
      const parsed = await parseDwgFile(dwgFile.value)
      dwgMetadata = {
        layers: parsed.layers,
        textEntities: parsed.textEntities.map(t => ({ text: t.text, layer: t.layer })),
        dimensions: parsed.dimensions.map(d => ({ text: d.text, layer: d.layer })),
        standardRefs: parsed.standardRefs.map(s => ({
          standardNo: s.standardNo,
          standardName: s.standardName,
          fullMatch: s.fullMatch,
        })),
        metadata: parsed.metadata,
      }
    } catch (e: any) {
      console.warn('[DWG Vision] WASM 元数据提取失败，降级跳过双校验:', e.message)
    }

    // 2. 调用后端 Vision 分析
    const res = await analyzeDwgVision({
      imageBase64,
      fileName: dwgFile.value.name,
      analyses: selectedAnalyses.value,
      refText: refText.value || undefined,
      kbId: selectedKbId.value || undefined,
      query: ragQuery.value || undefined,
      dwgMetadata,
    })

    if (res.code === 200) {
      result.value = res.data
      // 自动切换到第一个有结果的 tab
      if (res.data.titleBlock) activeTab.value = 'titleBlock'
      else if (res.data.symbols) activeTab.value = 'symbols'
      else if (res.data.annotations) activeTab.value = 'annotations'
      else if (res.data.compliance) activeTab.value = 'compliance'

      if (res.data.errors.length > 0) {
        ElMessage.warning(`分析完成，但有 ${res.data.errors.length} 项失败`)
      } else {
        ElMessage.success(`分析完成，耗时 ${(res.data.duration_ms / 1000).toFixed(1)}s`)
      }
    } else {
      ElMessage.error(res.message || '分析失败')
    }
  } catch (e: any) {
    ElMessage.error(e.message || '分析过程出错')
  } finally {
    analyzing.value = false
  }
}

// 辅助函数
function symbolTypeLabel(type: string): string {
  const map: Record<string, string> = {
    valve: '阀门', pump: '泵', vessel: '容器', instrument: '仪表',
    tank: '储罐', heat_exchanger: '换热器', other: '其他',
  }
  return map[type] || type
}

function symbolTypeTag(type: string): string {
  const map: Record<string, string> = {
    valve: '', pump: 'success', vessel: 'warning', instrument: 'info',
    tank: 'warning', heat_exchanger: 'danger', other: 'info',
  }
  return map[type] || 'info'
}

function severityTag(severity: string): string {
  return severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'info'
}

function severityLabel(severity: string): string {
  return severity === 'error' ? '严重' : severity === 'warning' ? '警告' : '提示'
}

// Task 21: SoM 标号 → 区域名称
const MARK_ID_LABELS: Record<number, string> = {
  1: '标题栏',
  2: '图例表',
  3: '标注',
  4: '设计说明',
  5: '图框',
  6: '主体图形',
}
function markIdLabel(markId: number): string {
  return MARK_ID_LABELS[markId] || `标号${markId}`
}

// Task 24: OCR 交叉验证状态展示
function ocrVerificationTagType(r: OcrVerificationResult): 'success' | 'warning' | 'info' | 'danger' {
  if (r.status !== 'success') return 'info'
  return r.needsReview ? 'danger' : 'success'
}
function ocrVerificationStatusLabel(r: OcrVerificationResult): string {
  if (r.status === 'unavailable') return 'OCR 不可用'
  if (r.status === 'failed') return 'OCR 失败'
  return r.needsReview ? '需人工复核' : '一致'
}

// Task 20: DWG 元数据双校验状态展示
function dwgMetadataTagType(r: DwgMetadataVerification): 'success' | 'warning' | 'info' | 'danger' {
  if (r.status !== 'success') return 'info'
  return r.needsReview ? 'danger' : 'success'
}
function dwgMetadataStatusLabel(r: DwgMetadataVerification): string {
  if (r.status === 'unavailable') return '元数据未提供'
  if (r.status === 'failed') return '校验失败'
  return r.needsReview ? '需人工复核' : '一致'
}

function scoreColor(score: number): string {
  if (score >= 80) return '#16a34a'
  if (score >= 60) return '#d97706'
  return '#dc2626'
}

// ===== 图纸叠框 ↔ 列表 双向联动 =====

/**
 * 列表行点击 → 高亮对应 rect（无 bbox 不触发图纸动作）
 * Task 27: 同时设置 focusBbox，触发 DwgVisionPreviewPanel pan/zoom 到对应区域
 */
function handleRowClick(row: any, tab: 'symbols' | 'annotations' | 'compliance') {
  let arr: any[] = []
  if (tab === 'symbols') arr = result.value?.symbols?.symbols ?? []
  else if (tab === 'annotations') arr = result.value?.annotations?.missingItems ?? []
  else if (tab === 'compliance') arr = result.value?.compliance?.issues ?? []
  const index = arr.indexOf(row)
  if (index < 0) return
  const issue = allIssues.value.find(i => i.tab === tab && i.index === index)
  if (!issue) return
  activeIssueId.value = issue.id
  if (!issue.bbox) return
  // Task 27: 触发 DwgVisionPreviewPanel pan/zoom（分屏模式下生效）
  focusBbox.value = issue.bbox
  // 正常模式下（内联 SVG 预览）仍走 rectRefs scrollIntoView
  nextTick(() => {
    const rectEl = rectRefs.get(issue.id)
    rectEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

function onSymbolsRowClick(row: any) { handleRowClick(row, 'symbols') }
function onAnnotationsRowClick(row: any) { handleRowClick(row, 'annotations') }
function onComplianceRowClick(row: any) { handleRowClick(row, 'compliance') }

/**
 * 图纸 rect 点击 → 切换 tab + 高亮列表行 + 滚动到行
 * Task 26: DwgVisionPreviewPanel emit 的 BboxOverlay 只含 id/bbox/severity，
 * 需从 allIssues 中查找原始 issue 获取 tab 信息
 */
function handleRectClick(issue: BboxOverlay) {
  activeIssueId.value = issue.id
  const original = allIssues.value.find(i => i.id === issue.id)
  if (original) {
    activeTab.value = original.tab
  }
  nextTick(() => {
    const activeRow = document.querySelector('.issue-row-active')
    activeRow?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

/** el-table 行 class（高亮当前联动的行） */
function symbolsRowClass(_row: any, rowIndex: number) {
  return activeIssueId.value === `symbols-${rowIndex}` ? 'issue-row-active' : ''
}
function annotationsRowClass(_row: any, rowIndex: number) {
  return activeIssueId.value === `annotations-${rowIndex}` ? 'issue-row-active' : ''
}
function complianceRowClass(_row: any, rowIndex: number) {
  return activeIssueId.value === `compliance-${rowIndex}` ? 'issue-row-active' : ''
}

/**
 * Task 28: 打开规范条文原文弹窗
 * 展示 issue 的 clauseRef（条文编号）和 clauseText（条文原文）
 */
function openClauseDialog(row: any) {
  clauseDialogContent.value = {
    clauseRef: row.clauseRef,
    clauseText: row.clauseText,
  }
  clauseDialogTitle.value = row.clauseRef ? `规范条文 · ${row.clauseRef}` : '规范条文原文'
  clauseDialogVisible.value = true
}
</script>

<style scoped>
.dwg-vision-page {
  padding: 20px;
  max-width: 1440px;
  margin: 0 auto;
}

/* ===== 页面头部 ===== */
.page-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: linear-gradient(135deg, #eff6ff 0%, #f5f3ff 60%, #fdf4ff 100%);
  border: 1px solid #e0e7ff;
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 20px;
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.hero-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.hero-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(135deg, #2563eb, #7c3aed);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.hero-text h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
  color: #111827;
}

.hero-text p {
  margin: 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.5;
}

/* ===== 主体布局 ===== */
.page-body {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.left-panel {
  width: 400px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.right-panel {
  flex: 1;
  min-width: 0;
}

/* ===== Task 27: 分屏对比模式 ===== */
.split-toggle-bar {
  position: absolute;
  top: 12px;
  right: 20px;
  z-index: 10;
}

.page-body.split-mode {
  position: relative;
}

.page-body.split-mode .left-panel.split-left {
  width: 50%;
  max-width: 800px;
  position: sticky;
  top: 20px;
}

.page-body.split-mode .right-panel {
  width: 50%;
}

.split-preview-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
}

.split-canvas {
  flex: 1;
  min-height: 500px;
  max-height: calc(100vh - 200px);
}

.split-canvas .preview-wrapper {
  height: 100%;
}

.split-canvas .preview-content {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.split-canvas .preview-content :deep(svg) {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}

/* ===== 卡片通用 ===== */
.panel-card {
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.panel-card :deep(.el-card__header) {
  padding: 14px 18px;
  border-bottom: 1px solid #f3f4f6;
}

.panel-card :deep(.el-card__body) {
  padding: 18px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.title-icon {
  color: #2563eb;
}

.count-tag {
  margin-left: auto;
}

/* ===== 上传区 ===== */
.dwg-upload :deep(.el-upload-dragger) {
  border-radius: 10px;
  border: 1.5px dashed #d1d5db;
  background: #fafafa;
  padding: 24px 16px;
  transition: all 0.25s;
}

.dwg-upload :deep(.el-upload-dragger:hover) {
  border-color: #2563eb;
  background: #eff6ff;
}

.upload-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upload-icon {
  font-size: 40px;
  color: #93c5fd;
}

.upload-text {
  font-size: 14px;
  color: #374151;
}

.upload-text em {
  color: #2563eb;
  font-style: normal;
  font-weight: 500;
}

.upload-hint {
  font-size: 12px;
  color: #9ca3af;
}

/* 文件信息 */
.file-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 10px 12px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
}

.file-icon {
  font-size: 22px;
  color: #0284c7;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  color: #0c4a6e;
  word-break: break-all;
}

.file-size {
  font-size: 12px;
  color: #7dd3fc;
  color: #0369a1;
}

/* SVG 预览 */
.svg-preview {
  margin-top: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}

.preview-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #6b7280;
  background: #f9fafb;
  border-bottom: 1px solid #f3f4f6;
}

.preview-canvas {
  max-height: 200px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  position: relative;
}

/* preview-wrapper 收缩到 SVG 实际尺寸，让叠框精确覆盖图纸 */
.preview-wrapper {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 200px;
  line-height: 0;
}

.preview-content :deep(svg) {
  display: block;
  max-width: 100%;
  max-height: 200px;
}

.overlay-count-tag {
  margin-left: auto;
}

/* ===== SVG 叠框层 ===== */
.overlay-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.issue-rect {
  pointer-events: visible;
  cursor: pointer;
  vector-effect: non-scaling-stroke;
  stroke-width: 2;
  fill-opacity: 0.15;
  transition: stroke-width 0.15s, fill-opacity 0.15s;
}

.issue-rect-error {
  stroke: #dc2626;
  fill: #dc2626;
}

.issue-rect-warning {
  stroke: #d97706;
  fill: #d97706;
}

.issue-rect-info {
  stroke: #2563eb;
  fill: #2563eb;
}

.issue-rect:hover {
  stroke-width: 4;
  fill-opacity: 0.3;
}

.issue-rect-active {
  stroke-width: 5;
  fill-opacity: 0.4;
  /* Task 28: 闪烁高亮动画 */
  animation: rect-pulse 1s ease-in-out 3;
}

@keyframes rect-pulse {
  0%, 100% { stroke-opacity: 1; fill-opacity: 0.4; }
  50% { stroke-opacity: 0.4; fill-opacity: 0.15; }
}

/* ===== 分析选项 ===== */
.option-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  background: #fff;
}

.option-item:hover {
  border-color: #93c5fd;
  background: #f8fafc;
}

.option-item.selected {
  border-color: #2563eb;
  background: #eff6ff;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
}

.option-icon {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.option-text {
  flex: 1;
  min-width: 0;
}

.option-label {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.option-desc {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 2px;
}

.option-check {
  color: #2563eb;
  font-size: 20px;
  flex-shrink: 0;
  width: 20px;
}

/* 参考条文 */
.ref-section {
  margin-top: 14px;
}

.ref-label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

/* Task 15: 知识库 RAG 注入区块 */
.kb-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #e5e7eb;
}

.kb-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

.kb-help {
  color: #9ca3af;
  cursor: help;
  font-size: 14px;
}

/* 按钮行（分析 + 历史） */
.action-row {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

/* 分析按钮 */
.analyze-btn {
  flex: 1;
  height: 44px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  border: none;
}

.analyze-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #1d4ed8, #4338ca);
}

.analyze-btn:disabled {
  background: #e5e7eb;
}

.history-btn {
  width: 130px;
  height: 44px;
  border-radius: 10px;
}

/* Task 25: 历史记录抽屉 */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 200px;
}

.history-item {
  padding: 12px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: #fff;
}

.history-item:hover {
  border-color: #2563eb;
  background: #f0f7ff;
}

.history-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.history-filename {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}

.history-model {
  color: #9ca3af;
  font-style: italic;
}

.history-item-analyses {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.history-item-errors {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  color: #dc2626;
  font-size: 12px;
}

/* 进度提示 */
.progress-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  color: #2563eb;
  font-size: 13px;
}

.config-warning {
  margin-top: 14px;
}

/* ===== 右侧空状态 ===== */
.empty-state {
  border: 1.5px dashed #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 70px 40px;
  text-align: center;
}

.empty-icon {
  color: #dbeafe;
  margin-bottom: 16px;
}

.empty-state h3 {
  margin: 0 0 6px;
  font-size: 17px;
  color: #374151;
}

.empty-state p {
  margin: 0 0 24px;
  color: #9ca3af;
  font-size: 13px;
}

.empty-steps {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #6b7280;
  background: #f9fafb;
  border: 1px solid #f3f4f6;
  padding: 6px 14px;
  border-radius: 20px;
}

.step-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #2563eb;
  color: #fff;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.step-arrow {
  color: #d1d5db;
}

/* ===== 分析中 ===== */
.loading-state {
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  padding: 80px 40px;
  text-align: center;
}

.loading-spinner {
  color: #2563eb;
  margin-bottom: 16px;
}

.loading-state h3 {
  margin: 0 0 6px;
  font-size: 17px;
  color: #374151;
}

.loading-state p {
  margin: 0 0 24px;
  color: #9ca3af;
  font-size: 13px;
}

.loading-bar {
  max-width: 320px;
  margin: 0 auto;
}

/* ===== 结果卡片 ===== */
.result-card {
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.result-card :deep(.el-card__header) {
  padding: 14px 18px;
  border-bottom: 1px solid #f3f4f6;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.error-alert {
  margin-bottom: 16px;
}

.error-alert ul {
  margin: 4px 0 0;
  padding-left: 16px;
}

/* Tab 标签 */
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.result-tabs :deep(.el-tabs__item) {
  font-size: 14px;
}

/* ===== 标题栏（图签样式） ===== */
.title-block-table {
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  overflow: hidden;
}

.tb-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}

.tb-row.full {
  grid-template-columns: 1fr;
}

.tb-row + .tb-row {
  border-top: 1px solid #e2e8f0;
}

.tb-cell {
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
  background: #fff;
}

.tb-row .tb-cell + .tb-cell {
  border-left: 1px solid #e2e8f0;
}

.tb-label {
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 3px;
  letter-spacing: 0.5px;
}

.tb-value {
  font-size: 14px;
  color: #334155;
}

.tb-value.strong {
  font-weight: 600;
  color: #0f172a;
}

/* ===== 摘要框 ===== */
.summary-box {
  background: #f8fafc;
  border-left: 3px solid #2563eb;
  border-radius: 0 8px 8px 0;
  padding: 10px 14px;
  margin-bottom: 16px;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
}

.total-count {
  margin-top: 12px;
  color: #9ca3af;
  font-size: 13px;
}

.total-count b {
  color: #2563eb;
}

/* ===== 评分卡 ===== */
.score-card {
  display: flex;
  align-items: center;
  gap: 24px;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 16px;
}

.score-num {
  font-size: 28px;
  font-weight: 700;
  color: #0f172a;
}

.score-unit {
  font-size: 13px;
  color: #94a3b8;
}

.score-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 4px;
}

.score-desc {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.6;
}

/* ===== 合规审查 ===== */
.notes-section {
  margin-bottom: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 10px;
}

/* ===== Task 24: OCR + VLM 交叉验证 ===== */
.ocr-verification {
  margin-top: 16px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}
.ocr-verif-body {
  margin-top: 8px;
  font-size: 13px;
  color: #475569;
}
.ocr-needs-review {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #dc2626;
  font-weight: 500;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: #fef2f2;
  border-radius: 4px;
}
.ocr-consistent {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #16a34a;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: #f0fdf4;
  border-radius: 4px;
}
.ocr-mismatches {
  margin-bottom: 8px;
}
.ocr-mismatches .mismatch-title {
  font-weight: 500;
  color: #dc2626;
  margin-bottom: 4px;
}
.ocr-mismatches ul {
  margin: 0;
  padding-left: 20px;
  color: #475569;
}
.ocr-mismatches li {
  margin: 2px 0;
}
.ocr-text-collapse {
  margin-top: 8px;
}
.ocr-text-pre {
  margin: 0;
  max-height: 200px;
  overflow: auto;
  background: #fff;
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  color: #475569;
  white-space: pre-wrap;
  word-break: break-all;
}
.ocr-degraded {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  padding: 6px 10px;
  background: #f1f5f9;
  border-radius: 4px;
}

/* Task 20: DWG 元数据双校验 */
.dwg-meta-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.design-notes {
  padding-left: 20px;
  margin: 0;
}

.design-notes li {
  margin-bottom: 5px;
  font-size: 13px;
  color: #475569;
  line-height: 1.6;
}

/* ===== 联动行高亮（el-table 行）Task 28: 增强闪烁 ===== */
.result-tabs :deep(.issue-row-active td.el-table__cell) {
  background-color: #dbeafe !important;
  animation: row-pulse 1s ease-in-out 3;
}

@keyframes row-pulse {
  0%, 100% { background-color: #dbeafe !important; }
  50% { background-color: #bfdbfe !important; }
}

/* ===== 规则检查列表 ===== */
.rule-issues-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rule-issue-item {
  border: 1px solid #e5e7eb;
  border-left: 3px solid #94a3b8;
  border-radius: 0 8px 8px 0;
  padding: 10px 14px;
  background: #f8fafc;
}

.rule-issue-error {
  border-left-color: #dc2626;
  background: #fef2f2;
}

.rule-issue-warning {
  border-left-color: #d97706;
  background: #fffbeb;
}

.rule-issue-info {
  border-left-color: #2563eb;
  background: #eff6ff;
}

.rule-issue-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.rule-code {
  font-family: monospace;
  font-size: 12px;
}

.rule-issue-message {
  font-size: 13px;
  color: #334155;
  line-height: 1.6;
}

/* ===== 响应式 ===== */
@media (max-width: 1000px) {
  .page-body {
    flex-direction: column;
  }
  .left-panel {
    width: 100%;
  }
  .page-hero {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
