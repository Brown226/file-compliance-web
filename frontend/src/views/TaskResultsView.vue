<template>
  <div class="task-results-view">
    <!-- 步骤条头部（仅在新任务流程中显示；本组件专用于 /review/:id 历史记录入口，故默认隐藏） -->
    <!-- <div class="step-header">
      <div class="step-item" :class="{ active: currentStep >= 0, completed: currentStep > 0 }">
        <div class="step-circle">
          <span v-if="currentStep > 0">✓</span>
          <span v-else>1</span>
        </div>
        <span class="step-label">上传文件</span>
      </div>
      <div class="step-line" :class="{ active: currentStep >= 1 }"></div>
      <div class="step-item" :class="{ active: currentStep >= 1, completed: currentStep > 1 }">
        <div class="step-circle">
          <span v-if="currentStep > 1">✓</span>
          <span v-else>2</span>
        </div>
        <span class="step-label">确认信息并分析</span>
      </div>
      <div class="step-line" :class="{ active: currentStep >= 2 }"></div>
      <div class="step-item" :class="{ active: currentStep >= 2 }">
        <div class="step-circle">3</div>
        <span class="step-label">查看并编辑结果</span>
      </div>
    </div> -->

    <!-- 加载状态（仅首屏加载时显示，不阻塞审查中结果页） -->
    <div v-if="loading && !reviewing" class="loading-overlay">
      <el-icon class="is-loading" :size="48"><Loading /></el-icon>
      <p class="loading-text">{{ loadingMessage }}</p>
    </div>

    <!-- 主内容区：左右分栏 -->
    <div class="main-content">
      <!-- OCR 降级告警横幅 -->
      <div v-if="ocrDegradedFiles.length > 0" class="ocr-degraded-banner">
        <el-alert
          :title="`OCR 服务不可用：${ocrDegradedFiles.length} 个文件为扫描件但未能识别图片中的文字`"
          type="warning"
          show-icon
          :closable="true"
          @close="ocrDegradedFiles = []"
        >
          <template #default>
            <div style="margin-top:4px; font-size:13px;">
              <div v-for="f in ocrDegradedFiles" :key="f" style="margin-bottom:2px;">
                ⚠️ {{ f }}
              </div>
              <p style="margin:4px 0 0; color:#856404;">请手动检查这些文件中可能的合规问题。</p>
            </div>
          </template>
        </el-alert>
      </div>
      <!-- 左侧：文件预览 -->
      <div class="left-panel" :style="leftPanelStyle" ref="leftPanel">
        <div class="panel-header">
          <!-- 文件切换 Tab -->
          <div class="file-tabs" v-if="files.length > 1">
            <button
              v-for="f in files"
              :key="f.id"
              :class="['file-tab', { active: selectedFileId === f.id }]"
              @click="selectFile(f.id)"
              :title="f.fileName"
            >
              <span class="file-tab-icon"><el-icon :size="14"><component :is="getFileIconComponent(f.fileType)" /></el-icon></span>
              <span class="file-tab-name">{{ f.fileName }}</span>
              <span class="file-tab-count" v-if="getFileIssueCount(f.id) > 0">{{ getFileIssueCount(f.id) }}</span>
            </button>
          </div>
          <div v-else-if="files.length === 0" class="empty-file-hint">
            <el-icon :size="24" color="#C0C4CC"><FolderOpened /></el-icon>
            <span>暂无文件，请先上传文档</span>
          </div>
          <span v-else class="hint-text"><el-icon :size="14"><Document /></el-icon> 文件预览区 · 选中文本可进行专项审查</span>
        </div>

        <!-- 空状态提示（无文件时） -->
        <div v-if="files.length === 0" class="file-preview-empty-state">
          <el-empty description=" " :image-size="120">
            <template #image>
              <div class="custom-empty-image">
                <el-icon :size="64" color="#DCDFE6"><Document /></el-icon>
              </div>
            </template>
            <template #description>
              <p class="empty-title">等待文件加载</p>
              <p class="empty-desc">上传文件后将在此处显示预览内容</p>
            </template>
          </el-empty>
        </div>

        <div v-else class="editor-container">
          <!-- DWG图纸预览（保留专用组件，支持图纸交互） -->
          <DwgPreviewPanel
            ref="dwgPreviewRef"
            v-if="isDwgFileSelected && !dwgParseFailed"
            :file="dwgFileForPreview"
            :locateTarget="dwgLocateTarget"
            @locateResult="handleLocateResult"
            @fallbackToText="dwgParseFailed = true"
          />
          <!-- 统一文件预览（Word/PDF/Excel/PPT/其他） -->
          <FilePreviewPanel
            v-else
            :taskId="taskId"
            :fileId="selectedFileId"
            :fileType="selectedFileType"
            :fileName="selectedFileName"
            :locateTarget="locateTarget"
            @locateResult="handleLocateResult"
          />
        </div>

      </div>

      <!-- 可拖拽分割条 -->
      <div
        class="resize-divider"
        :class="{ active: isResizing }"
        @mousedown="startResize"
      >
        <div class="divider-line"></div>
        <div class="divider-handle">
          <span class="handle-dots">⋮</span>
        </div>
      </div>

      <!-- 右侧：审查报告面板 -->
      <div class="right-panel" :style="rightPanelStyle">
        <!-- 面板头部 -->
        <div class="panel-header">
          <div class="header-left">
            <h3 class="panel-title">{{ isSelfCheck ? '标准引用自检报告' : 'AI 审查报告' }}</h3>
            <!-- 文件筛选下拉（多文件时显示） -->
            <el-select
              v-if="files.length > 1"
              v-model="filterFileId"
              size="small"
              style="width: 160px;"
              clearable
              placeholder="全部文件"
              popper-class="file-filter-popper"
              @change="(val: string) => { if (val) switchToFileContext(val); else { selectedFileId.value = files.value[0]?.id || null } }"
            >
              <el-option
                v-for="f in files"
                :key="f.id"
                :label="f.fileName"
                :value="f.id"
              >
                <span><el-icon :size="14"><component :is="getFileIconComponent(f.fileType)" /></el-icon> {{ f.fileName }}</span>
                <span style="float: right; color: #9CA3AF; font-size: 11px;">{{ getFileIssueCount(f.id) }}</span>
              </el-option>
            </el-select>
          </div>
          <div class="header-right">
            <!-- 导出操作（降级为次级样式）-->
            <el-dropdown v-if="!isSelfCheck" @command="handleExportCommand" trigger="click">
              <el-button class="export-action-btn">
                <el-icon><Download /></el-icon> 导出报告
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="word">
                    <el-icon><Document /></el-icon>导出 Word
                  </el-dropdown-item>
                  <el-dropdown-item command="excel">
                    <el-icon><Tickets /></el-icon>导出 Excel
                  </el-dropdown-item>
                  <el-dropdown-item divided command="print">
                    <el-icon><Printer /></el-icon>打印报告
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>

            <!-- 分隔 + 导航 -->
            <div class="header-divider"></div>
            <el-tooltip content="返回任务列表" placement="bottom">
              <button class="back-btn" @click="goBack">
                返回历史
              </button>
            </el-tooltip>
          </div>
        </div>

        <!-- 审查中进度（非阻塞，嵌入结果面板） -->
        <div v-if="reviewing" class="inline-review-progress">
          <div class="progress-top">
            <div class="progress-status">
              <el-icon class="is-loading" :size="16"><Loading /></el-icon>
              <span class="progress-title">{{ isSelfCheck ? '正在执行标准引用自检' : '正在智能审查文档' }}</span>
            </div>
            <span class="progress-percent">{{ reviewProgress }}%</span>
          </div>
          <el-progress
            :percentage="reviewProgress"
            :stroke-width="6"
            :show-text="false"
            :status="reviewProgress >= 100 ? 'success' : ''"
            color="#2563EB"
          />
          <div class="progress-details">
            <p class="progress-step">{{ reviewStep || '准备中...' }}</p>
            <p class="progress-message">{{ reviewMessage }}</p>
            <div v-if="reviewFileProgress.fileName" class="chunk-progress">
              <el-icon><Document /></el-icon>
              <span class="chunk-filename">{{ reviewFileProgress.fileName }}</span>
              <el-tag size="small" type="info" round>
                分片 {{ reviewFileProgress.chunkIndex }}/{{ reviewFileProgress.totalChunks }}
              </el-tag>
            </div>
            <div v-if="totalLiveIssueCount > 0" class="live-issue-count">
              <el-icon color="#E6A23C"><Warning /></el-icon>
              已发现 <strong>{{ totalLiveIssueCount }}</strong> 个问题
            </div>
          </div>
        </div>

        <div v-if="locateFeedback" class="locate-feedback">
          <el-alert
            :title="locateFeedback.message"
            :type="locateFeedback.type"
            :closable="false"
            show-icon
          />
        </div>

        <!-- Tab导航 -->
        <div v-if="!isSelfCheck" class="tab-navigation">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            :class="['tab-item', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            <el-icon v-if="tab.icon" class="tab-icon"><component :is="tab.icon" /></el-icon>
            <span class="tab-label">{{ tab.label }}</span>

            <el-badge
              v-if="getTabBadge(tab.key)"
              :value="getTabBadge(tab.key).value"
              :type="getTabBadge(tab.key).type"
              :max="99"
              class="tab-badge"
            />
          </button>
        </div>

        <!-- ====== 标准引用自检报告（SELF_CHECK） ====== -->
        <div v-if="isSelfCheck && scReport" class="self-check-report-panel">
          <div class="sc-summary-bar">
            <el-tag type="info" effect="plain">检查 {{ scFilteredItems.length }} 条引用</el-tag>
            <el-tag type="success" effect="plain">完全匹配 {{ scFilteredItems.filter((it: any) => it.matchResult?.matched && it.errorTypes?.length === 0).length }} 条</el-tag>
            <el-tag v-if="scFilteredItems.filter((it: any) => it.errorTypes?.length > 0).length > 0" type="danger" effect="plain">存在问题 {{ scFilteredItems.filter((it: any) => it.errorTypes?.length > 0).length }} 条</el-tag>
            <el-tag v-else type="success" effect="plain">全部正确</el-tag>
            <span class="sc-lib-info">{{ scReport.standardLibraryInfo?.name }}（{{ scReport.standardLibraryInfo?.total }} 条）</span>
          </div>
          <el-table
            :data="scFilteredItems"
            border stripe size="small"
            highlight-current-row
            @current-change="scSelectItem"
          >
            <el-table-column type="index" label="#" width="42" />
            <el-table-column prop="sourceFile" label="来源文件" min-width="130" show-overflow-tooltip />
            <el-table-column label="文档中的标准" min-width="150">
              <template #default="{ row: it }">
                <div>{{ it.docStandardNo || '-' }}</div>
                <div class="sc-name-sub">{{ it.docStandardName || '' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="错误类型" min-width="170">
              <template #default="{ row: it }">
                <template v-if="it.errorTypes.length > 0">
                  <el-tag v-for="et in it.errorTypes" :key="et" :type="scErrorTagType(et)" size="small" effect="dark" style="margin-right:3px;margin-bottom:2px;">
                    {{ scErrorLabel(et) }}
                  </el-tag>
                </template>
                <el-tag v-else-if="it.matchResult.matched" type="success" size="small" effect="plain">一致</el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="正确标准" min-width="180" show-overflow-tooltip>
              <template #default="{ row: it }">
                <template v-if="it.matchResult.matched">
                  <div class="correct-text">{{ it.matchResult.libraryStandardNo || '-' }}</div>
                  <div class="sc-name-sub correct-text">{{ it.matchResult.libraryStandardName || '' }}</div>
                  <el-tag v-if="it.matchResult.libraryStandardStatus === 'ABOLISHED'" type="danger" size="mini" effect="plain" style="margin-top:2px;">已废止</el-tag>
                  <el-tag v-else-if="it.matchResult.libraryStandardStatus === 'UPCOMING'" type="warning" size="mini" effect="plain" style="margin-top:2px;">即将实施</el-tag>
                </template>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="级别" width="52">
              <template #default="{ row: it }">
                <span v-if="it.matchResult.matchLevel > 0">L{{ it.matchResult.matchLevel }}</span>
                <span v-else class="no-match">∅</span>
              </template>
            </el-table-column>
          </el-table>
          <el-button type="primary" size="small" style="margin-top:10px;" @click="handleExportScReport">
            <el-icon><Download /></el-icon> 导出 Excel 报告
          </el-button>
        </div>

        <!-- Tab内容区 -->
        <div v-if="!isSelfCheck" class="tab-content">
          <!-- Tab 1: 审查摘要 -->
          <div v-if="activeTab === 'overview'" class="tab-pane">
            <!-- ===== 统计看板（始终可见）===== -->
            <div class="stats-dashboard">
              <div class="stats-grid">
                <div class="stat-card-dash">
                  <span class="stat-icon-dash">📄</span>
                  <div class="stat-body">
                    <span class="stat-value-dash">{{ reviewSummary?.totalFiles || files.length || 0 }}</span>
                    <span class="stat-label-dash">审查文件</span>
                  </div>
                </div>
                <div class="stat-card-dash">
                  <span class="stat-icon-dash">🎯</span>
                  <div class="stat-body">
                    <span class="stat-value-dash">{{ reviewPlanSummary.taskMode }}</span>
                    <span class="stat-label-dash">审查模式</span>
                  </div>
                </div>
                <div class="stat-card-dash" :class="{ 'has-issues': issueDetails.length > 0 }">
                  <span class="stat-icon-dash">{{ issueDetails.length > 0 ? '⚠️' : '✅' }}</span>
                  <div class="stat-body">
                    <span class="stat-value-dash">{{ issueDetails.length }}</span>
                    <span class="stat-label-dash">发现问题</span>
                  </div>
                </div>
                <div class="stat-card-dash">
                  <span class="stat-icon-dash">📊</span>
                  <div class="stat-body">
                    <span class="stat-value-dash">{{ reviewSummary?.reviewMode ? getModeLabel(reviewSummary.reviewMode) : reviewPlanSummary.objective }}</span>
                    <span class="stat-label-dash">审查目标</span>
                  </div>
                </div>
              </div>

              <!-- 合同审查评分卡片 -->
              <div v-if="isContractReview && contractScoreData.score > 0" class="contract-score-card">
                <div class="score-header">
                  <div class="score-value" :class="contractScoreLevel">{{ contractScoreData.score }}</div>
                  <div class="score-meta">
                    <div class="score-label">综合评分 / 100</div>
                    <div class="score-conclusion">{{ contractScoreConclusion }}</div>
                  </div>
                </div>
                <div class="risk-summary">
                  <div class="risk-item high">
                    <span class="risk-count">{{ contractScoreData.high }}</span>
                    <span class="risk-label">高风险</span>
                  </div>
                  <div class="risk-item medium">
                    <span class="risk-count">{{ contractScoreData.medium }}</span>
                    <span class="risk-label">中风险</span>
                  </div>
                  <div class="risk-item low">
                    <span class="risk-count">{{ contractScoreData.low }}</span>
                    <span class="risk-label">低风险</span>
                  </div>
                </div>
              </div>

              <!-- AI 审查空结果警告 -->
              <div v-if="showAiWarning" class="ai-warning-banner">
                <el-icon color="#E6A23C" :size="16"><WarningFilled /></el-icon>
                <span>
                  <template v-if="(task as any)?.reviewMode === 'CONTRACT_REVIEW'">
                    合同风险审查未发现风险条款。可能原因：上传的文件不是合同文本，或合同条款对该立场无明显风险。建议更换为正式合同文件后重新审查。
                  </template>
                  <template v-else>
                    AI 审查未产出结果。
                    <template v-if="!task?.aiEngineUsed">任务未配置或未使用 AI 引擎。</template>
                    <template v-else-if="task.aiEngineUsed === 'none'">AI 引擎已禁用。</template>
                    <template v-else>引擎 {{ task.aiEngineUsed }} 已执行但未发现问题，请结合规则覆盖范围人工复核。</template>
                  </template>
                </span>
              </div>

            </div>

            <!-- ===== 审查通过（无问题）===== -->
            <div v-if="task?.status === 'COMPLETED' && issueDetails.length === 0" class="summary-pass">
              <el-icon color="#67c23a" :size="24"><CircleCheckFilled /></el-icon>
              <span>审查完成，未发现需要处理的问题</span>
            </div>

            <!-- ===== 问题预览列表 ===== -->
            <div v-if="issueDetails.length > 0" class="overview-issue-list">
              <div class="overview-issue-header">
                <h4 class="overview-section-title">问题概览</h4>
                <div class="overview-header-actions">
                  <span class="switch-label">大白话</span>
                  <el-switch v-model="showPlainLanguage" size="small" />
                </div>
              </div>

              <!-- 严重错误 -->
              <template v-if="errorIssues.length > 0">
                <div class="overview-severity-group">
                  <div class="severity-group-header severity-error">
                    <span class="severity-dot-sm error-dot"></span>
                    严重错误 · {{ errorIssues.length }} 条
                  </div>
                  <div
                    v-for="(issue, index) in errorIssues.slice(0, 5)"
                    :key="issue.id"
                    class="overview-issue-card"
                    @click="navigateToIssue(issue)"
                  >
                    <div class="oic-tags">
                      <el-tag :type="getCategoryTagType(issue.issueType)" size="small" effect="dark" round>
                        {{ getIssueTypeLabel(issue.issueType) }}
                      </el-tag>
                      <el-tag type="danger" size="small" effect="plain" round>严重</el-tag>
                    </div>
                    <p class="oic-desc">{{ issue.description || '-' }}</p>
                    <p v-if="showPlainLanguage && issue.plainLanguage" class="oic-plain">💡 {{ issue.plainLanguage }}</p>
                    <div class="oic-preview-row" v-if="issue.originalText">
                      <span class="oic-preview-label">原：</span>
                      <span class="oic-preview-text original">{{ truncateText(issue.originalText, 80) }}</span>
                    </div>
                    <div class="oic-preview-row" v-if="issue.suggestedText">
                      <span class="oic-preview-label">改：</span>
                      <span class="oic-preview-text suggested">{{ truncateText(issue.suggestedText, 80) }}</span>
                    </div>
                    <el-icon class="oic-arrow"><ArrowRight /></el-icon>
                  </div>
                  <div v-if="errorIssues.length > 5" class="view-all-wrapper">
                    <button class="view-all-btn" @click="activeTab = 'suggestions'">
                      查看全部 {{ errorIssues.length }} 条严重错误
                      <el-icon><ArrowRight /></el-icon>
                    </button>
                  </div>
                </div>
              </template>

              <!-- 警告 -->
              <template v-if="warningIssues.length > 0">
                <div class="overview-severity-group">
                  <div class="severity-group-header severity-warning">
                    <span class="severity-dot-sm warning-dot"></span>
                    警告 · {{ warningIssues.length }} 条
                  </div>
                  <div
                    v-for="(issue, index) in warningIssues.slice(0, 5)"
                    :key="issue.id"
                    class="overview-issue-card warning"
                    @click="navigateToIssue(issue)"
                  >
                    <div class="oic-tags">
                      <el-tag :type="getCategoryTagType(issue.issueType)" size="small" effect="dark" round>
                        {{ getIssueTypeLabel(issue.issueType) }}
                      </el-tag>
                      <el-tag type="warning" size="small" effect="plain" round>警告</el-tag>
                    </div>
                    <p class="oic-desc">{{ issue.description || '-' }}</p>
                    <p v-if="showPlainLanguage && issue.plainLanguage" class="oic-plain">💡 {{ issue.plainLanguage }}</p>
                    <el-icon class="oic-arrow"><ArrowRight /></el-icon>
                  </div>
                  <div v-if="warningIssues.length > 5" class="view-all-wrapper">
                    <button class="view-all-btn view-all-btn-warning" @click="activeTab = 'suggestions'">
                      查看全部 {{ warningIssues.length }} 条警告
                      <el-icon><ArrowRight /></el-icon>
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Tab 2: 问题清单（使用重构后的 IssueCardList 组件）-->
          <div v-if="activeTab === 'suggestions'" class="tab-pane" style="height:100%; display:flex; flex-direction:column;">
            <!-- 审查通过空状态 -->
            <div v-if="!loading && task?.status === 'COMPLETED' && issueDetails.length === 0" class="empty-state-pass">
              <div class="pass-icon-wrapper">
                <el-icon :size="56" color="#67C23A"><CircleCheckFilled /></el-icon>
              </div>
              <h3>审查通过</h3>
              <p class="pass-subtitle">未发现需要处理的问题，文档质量良好</p>

              <div class="empty-actions">
                <el-button type="primary" size="large" @click="handleExportReport">
                  <el-icon><Download /></el-icon> 导出审查报告
                </el-button>
                <el-button size="large" @click="activeTab = 'overview'">
                  <el-icon><DataAnalysis /></el-icon> 查看审查摘要
                </el-button>
                <el-button size="large" @click="$router.push('/tasks/new')">
                  <el-icon><Plus /></el-icon> 新建任务
                </el-button>
              </div>
            </div>

            <!-- 有问题时显示问题列表 -->
            <IssueCardList
              v-else
              ref="issueListRef"
              :details="issueDetails"
              :loading="loading"
              :selected-file-id="selectedFileId"
              :is-docx-selected="isDocxFileSelected"
              :review-mode="(task as any)?.reviewMode"
              :enabled-prefixes="(task as any)?.reviewPlan?.evidence?.enabledPrefixes"
              :original-text="proofreadOriginalText"
              @update:selected-file-id="(id) => { selectedFileId.value = id; if (id) switchToFileContext(id) }"
              @select-file-by-id="switchToFileContext"
              @copy-handle-id="handleCopyCadHandle"
              @locate-text="handleLocateTextFromIssueList"
              @open-fp-dialog="(detail) => handleFalsePositive(detail)"
              @batch-false-positive="handleBatchFalsePositiveFromIssueList"
              @batch-adopt="handleBatchAdoptFromIssueList"
              @proofread-accept="handleProofreadAccept"
              @proofread-ignore="handleProofreadIgnore"
              @proofread-accept-all="handleProofreadAcceptAll"
              @proofread-ignore-all="handleProofreadIgnoreAll"
            />
          </div>

          <!-- Tab 3: 标准引用 -->
          <div v-if="activeTab === 'knowledge'" class="tab-pane">
            <div v-if="standardRefIssues.length > 0" class="knowledge-list">
              <div
                v-for="(item, index) in standardRefIssues"
                :key="item.id || index"
                class="knowledge-card"
                :class="{ 'knowledge-card-clickable': item.fileId && item.originalText }"
                @click="item.fileId && item.originalText && handleLocateKnowledgeItem(item)"
                :title="item.fileId && item.originalText ? '点击定位到文件原文' : ''"
              >
                <div class="knowledge-header">
                  <p class="knowledge-title">
                    {{ getStandardRefTitle(item) }}
                  </p>
                  <div class="knowledge-header-right">
                    <el-tag
                      v-if="item.fileId && item.originalText"
                      type="primary"
                      size="small"
                      effect="plain"
                    >
                      <el-icon :size="12"><Location /></el-icon> 定位原文
                    </el-tag>
                    <el-tag
                      type="success"
                      size="small"
                    >
                      当前可参考
                    </el-tag>
                  </div>
                </div>
                <p class="knowledge-content">{{ item.description }}</p>
              </div>
            </div>

            <!-- 标准引用空状态引导 -->
            <div v-else class="empty-state-knowledge">
              <el-icon :size="64" color="#E6A23C"><Reading /></el-icon>
              <h4>暂无标准引用</h4>
              <p class="empty-reason">本次审查未命中相关标准条款</p>

              <div class="possible-reasons">
                <p><strong>可能的原因：</strong></p>
                <ul>
                  <li>当前审查模式未启用标准比对功能</li>
                  <li>文档内容与知识库中的标准条款无关联</li>
                  <li>知识库尚未导入相关领域的标准文件</li>
                </ul>
              </div>

              <div class="empty-actions">
                <el-button type="primary" @click="activeTab = 'overview'">
                  ← 返回审查摘要
                </el-button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- 误报标记对话框 -->
    <FalsePositiveDialog
      v-model="fpDialogVisible"
      :submitting="fpSubmitting"
      @confirm="handleConfirmFalsePositive"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Loading,
  ArrowRightBold, ArrowRight,
  WarningFilled,
  Check,
  Remove,
  CirclePlus,
  CircleCheckFilled,
  Download,
  MagicStick,
  EditPen,
  DataAnalysis,
  FolderOpened,
  Files,
  Link,
  Reading,
  Document,
  PictureFilled,
  Grid,
  Location,
  Plus,
} from '@element-plus/icons-vue'
import {
  getTaskByIdApi,
  getTaskDetailsApi,
  toggleFalsePositiveApi,
  toggleAdoptApi,
} from '@/api/task'
import { useWebSocket, type WsMessage } from '@/composables/useWebSocket'
import request from '@/utils/request'
import type { Task, TaskDetail, TaskFile } from '@/types/models'
import FilePreviewPanel from '@/views/TaskDetails/FilePreviewPanel.vue'
import DwgPreviewPanel from '@/views/TaskDetails/DwgPreviewPanel.vue'
import FalsePositiveDialog from '@/views/TaskDetails/FalsePositiveDialog.vue'
import IssueCardList from './TaskDetails/IssueCardList.vue'
import { useTaskExport, useTextLocator, useReviewStats, useWsProgress, useFalsePositive, useSelfCheck, useIssueHelpers } from './TaskDetails/composables'

const route = useRoute()
const router = useRouter()

// ===== 基础状态 =====
const taskId = computed(() => route.params.id as string)
const task = ref<Task | null>(null)
const allDetails = ref<TaskDetail[]>([])
const files = ref<TaskFile[]>([])
const loading = ref(false)
const loadingMessage = ref('正在加载审查结果...')

// ===== 文件预览/选择（提前声明，供 useSelfCheck 和 useTextLocator 使用）=====
const selectedFileId = ref<string | null>(null)
const filterFileId = ref<string>('')
const selectFile = (fileId: string) => {
  selectedFileId.value = fileId
  filterFileId.value = fileId
}

// ===== 定位系统（使用 Composable）=====
const {
  locateTarget,
  locateFeedback,
  dwgLocateTarget,
  getLocateStatus,
  handleLocateResult,
  handleLocateText,
} = useTextLocator(files, selectedFileId, (fileId, options) => {
  // 基础文件上下文切换
  selectedFileId.value = fileId
  filterFileId.value = fileId

  // 如果有定位选项，触发定位
  if (options?.locate) {
    console.log('[DEBUG locateTarget SET by callback] cadHandleId =', options.locate.cadHandleId)
    locateTarget.value = {
      originalText: options.locate.originalText || '',
      locateCandidates: options.locate.locateCandidates || [],
      textPosition: options.locate.textPosition || null,
      locateMeta: options.locate.locateMeta || null,
      cadHandleId: options.locate.cadHandleId,
      locateHint: options.locate.locateHint,
    }
  }
})

// ===== 导出功能（使用 Composable）=====
const { exportToWord: handleExportWord, exportToExcel: handleExportExcel, handleExportCommand } = useTaskExport(
  () => taskId.value,
  () => task.value?.title || '审查报告'
)

/** 快捷导出报告（无参数时默认导出 Word） */
const handleExportReport = () => handleExportWord()

// ===== 标准引用自检（SELF_CHECK）=====
const {
  isSelfCheck, scReport, scSelected, scFilteredItems, scSelectItem,
  scErrorTagType, scErrorLabel, handleExportScReport,
} = useSelfCheck(task, taskId, files, filterFileId, selectFile, locateTarget)

// AI 审查空结果警告：审查模式需要 AI 但 AI 未产出结果
const showAiWarning = computed(() => {
  const mode = (task.value as any)?.reviewMode
  if (!mode || mode === 'RULE_ONLY' || mode === 'SELF_CHECK') return false
  return (reviewSummary.value?.aiIssues ?? 0) === 0
})

// ===== 合同审查评分 =====
const isContractReview = computed(() => (task.value as any)?.reviewMode === 'CONTRACT_REVIEW')

/** 校对模式原文文本（暂无全文获取接口，预留） */
const proofreadOriginalText = computed(() => {
  // TODO: 从文件内容 API 获取全文文本后启用双栏高亮
  return undefined as string | undefined
})

const contractScoreData = computed(() => {
  const high = issueDetails.value.filter((d: any) => {
    const desc = (d.description || '').toLowerCase()
    return /高风险|严重|重大|high/i.test(desc) || d.severity === 'error'
  }).length
  const medium = issueDetails.value.filter((d: any) => {
    const desc = (d.description || '').toLowerCase()
    return (/中风险|一般|medium/i.test(desc) || d.severity === 'warning') && !(/高风险|严重|重大|high/i.test(desc) || d.severity === 'error')
  }).length
  const low = issueDetails.value.length - high - medium
  const score = Math.max(0, 100 - high * 15 - medium * 8 - low * 3)
  return { score, high, medium, low: Math.max(0, low) }
})

const contractScoreLevel = computed(() => {
  if (contractScoreData.value.score >= 80) return 'level-good'
  if (contractScoreData.value.score >= 60) return 'level-warning'
  return 'level-danger'
})

const contractScoreConclusion = computed(() => {
  if (contractScoreData.value.score >= 80) return '合同整体风险较低'
  if (contractScoreData.value.score >= 60) return '合同存在一定风险，建议重点关注中高风险项'
  return '合同风险较高，建议逐条审查并修改'
})

// 默认左侧面板宽度：自检模式 40%（右侧表格需要更多空间），普通审查 55%
const SELF_CHECK_LEFT_WIDTH = 40
const NORMAL_LEFT_WIDTH = 55
const leftPanelWidth = ref(localStorage.getItem('reviewLeftPanelWidth') ? Number(localStorage.getItem('reviewLeftPanelWidth')) : NORMAL_LEFT_WIDTH)

// 任务加载后，自检模式统一用 40% 左面板
watch(isSelfCheck, (val) => {
  if (val) {
    leftPanelWidth.value = SELF_CHECK_LEFT_WIDTH
  }
}, { immediate: true })

// ===== 审查实时进度（WebSocket 推送） =====
const { subscribeTask, connected: wsConnected } = useWebSocket()
const reviewing = ref(false)
const reviewProgress = ref(0)
const reviewStep = ref('')
const reviewMessage = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null
let reviewTimeoutTimer: ReturnType<typeof setTimeout> | null = null
const reviewFileProgress = reactive({
  fileName: '',
  chunkIndex: 0,
  totalChunks: 0,
  issueCount: 0,
})
const totalLiveIssueCount = ref(0)
const skippedNoTextFiles = ref<string[]>([])
const ocrDegradedFiles = ref<string[]>([])
const runtimeFileStatus = ref<Record<string, 'completed' | 'failed' | 'skipped'>>({})
let unsubscribeWs: (() => void) | null = null
const currentStep = ref(2)
const activeTab = ref((route.query.tab as string) || 'overview')
const showPlainLanguage = ref(false)
const leftPanel = ref<HTMLDivElement | null>(null)

// ===== 可拖拽分割条相关 =====
const isResizing = ref(false)
const startResize = (e: MouseEvent) => {
  e.preventDefault()
  isResizing.value = true

  const startX = e.clientX
  const startWidth = leftPanel.value?.offsetWidth || 0
  const mainContent = (e.currentTarget as HTMLElement).parentElement
  if (!mainContent) return
  const containerRect = mainContent.getBoundingClientRect()
  const containerWidth = containerRect.width

  const onMouseMove = (moveEvent: MouseEvent) => {
    if (!isResizing.value) return

    const deltaX = moveEvent.clientX - startX
    const newWidthPercent = ((startWidth + deltaX) / containerWidth) * 100

    leftPanelWidth.value = Math.max(20, Math.min(80, newWidthPercent))
  }

  const onMouseUp = () => {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    localStorage.setItem('reviewLeftPanelWidth', String(leftPanelWidth.value))
  }

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 左侧面板的动态样式
const leftPanelStyle = computed(() => ({
  flex: 'none',
  width: `${leftPanelWidth.value}%`,
}))

// 右侧面板：自动填充剩余空间
const rightPanelStyle = computed(() => ({
  flex: '1',
  minWidth: '0',
  overflow: 'hidden',
}))

const selectedFile = computed(() => files.value.find((f: any) => f.id === selectedFileId.value) as any)
const selectedFileType = computed(() => selectedFile.value?.fileType || selectedFile.value?.file_type || '')
const selectedFileName = computed(() => selectedFile.value?.fileName || '')

// 兼容性包装：供模板使用（内部调用 selectFile）
const switchToFileContext = (fileId: string, options?: any) => {
  selectFile(fileId)
}

const getFileNameById = (fileId: string): string => {
  const f = files.value.find((f: any) => f.id === fileId)
  return f?.fileName || '未知文件'
}

const getFileIconComponent = (fileType: string): any => {
  const t = (fileType || '').toLowerCase()
  if (t === 'docx' || t === 'doc') return Document
  if (t === 'dwg' || t === 'dxf') return Files
  if (t === 'pdf') return PictureFilled
  if (t === 'xlsx' || t === 'xls') return Grid
  return Document
}

const getFileIssueCount = (fileId: string): number => {
  return allDetails.value.filter((d: any) => d.fileId === fileId).length
}

const isDwgFileSelected = computed(() => {
  if (!selectedFileId.value) return false
  const file = files.value.find((f: any) => f.id === selectedFileId.value) as any
  return file?.fileType === 'dwg' || file?.file_type === 'dwg'
})

const isDocxFileSelected = computed(() => {
  if (!selectedFileId.value) return false
  const file = files.value.find((f: any) => f.id === selectedFileId.value) as any
  const fileType = (file?.fileType || file?.file_type || '').toLowerCase()
  return fileType === 'docx' || fileType === 'doc'
})

const dwgFileForPreview = ref<File | null>(null)
const dwgParseFailed = ref(false)
const dwgPreviewRef = ref<any>(null)

/** 下载 DWG 原始文件并在前端创建 File 对象供 WASM 解析 */
async function loadDwgFile(fileId: string) {
  dwgParseFailed.value = false
  dwgFileForPreview.value = null

  try {
    const resp = await request.get(
      `/tasks/${taskId.value}/files/${fileId}/raw`,
      { responseType: 'arraybuffer' }
    )
    const file = files.value.find((f: any) => f.id === fileId) as any
    const fileName = file?.fileName || 'drawing.dwg'
    const blob = new Blob([resp.data])
    dwgFileForPreview.value = new File([blob], fileName, { type: 'application/octet-stream' })
  } catch (e: any) {
    console.error('[TaskResultsView] DWG 文件下载失败:', e)
    dwgParseFailed.value = true
  }
}

// 监听文件切换：选中 DWG 时自动下载原始文件
watch(() => selectedFileId.value, (fileId) => {
  if (!fileId) {
    dwgFileForPreview.value = null
    dwgParseFailed.value = false
    return
  }
  const file = files.value.find((f: any) => f.id === fileId) as any
  const isDwg = file?.fileType === 'dwg' || file?.file_type === 'dwg'
  if (isDwg) {
    loadDwgFile(fileId)
  } else {
    dwgFileForPreview.value = null
    dwgParseFailed.value = false
  }
})

// ===== Tab 配置 =====
const tabs = [
  { key: 'overview', label: '审查摘要', icon: 'DataAnalysis' },
  { key: 'suggestions', label: '问题清单', icon: 'WarningFilled' },
  { key: 'knowledge', label: '标准引用', icon: 'Reading' },
]

// ===== Tab Badge / getTabBadge 已迁移到 useReviewStats composable =====

// 从审查摘要跳转到问题明细
const navigateToIssue = (issue: TaskDetail) => {
  activeTab.value = 'suggestions'

  nextTick(() => {
    issueListRef.value?.scrollToIssue?.(issue.id)
  })

  if (issue.fileId) {
    switchToFileContext(issue.fileId)
  }

  router.replace({
    query: { ...route.query, tab: 'suggestions', issueId: issue.id }
  })
}

// ===== 误报标记（使用 Composable）=====
const {
  fpDialogVisible, fpSubmitting, fpTargetDetail,
  handleFalsePositive, handleConfirmFalsePositive,
  handleBatchFalsePositiveFromIssueList,
} = useFalsePositive(allDetails)

// ===== IssueCardList 组件引用 =====
const issueListRef = ref<InstanceType<typeof IssueCardList> | null>(null)

// ===== 审查统计（使用 Composable）=====
const {
  reviewSummary, reviewPlanSummary,
  filteredDetails, noResultEntries, issueDetails, noResultReasons,
  totalIssuesExclSummary, errorIssues, warningIssues, infoIssues, standardRefIssues,
  fileStatusSummary, tabBadges, getTabBadge,
} = useReviewStats(task, allDetails, files, filterFileId, runtimeFileStatus)

// ===== 工具函数（使用 Composable）=====
const {
  getIssueTitle, getConfidenceLabel, getConfidenceTagType,
  getStandardRefTitle, getIssueTypeLabel, getCategoryTagType,
  pct, truncateText, pickLocateKeyword, collectLocateAnchors,
} = useIssueHelpers()

// ===== WebSocket 实时进度处理 =====

/** 增量追加 WS 推送的 issues 到结果列表 */
const appendNewIssues = (msg: WsMessage) => {
  if (!msg.issues?.length) return
  const newIssues = msg.issues.map((d: any) => ({
    id: d.id || `live_${Date.now()}_${Math.random()}`,
    issueType: d.issueType,
    ruleCode: d.ruleCode,
    severity: d.severity,
    originalText: d.originalText,
    suggestedText: d.suggestedText,
    description: d.description,
    plainLanguage: d.plainLanguage || null,
    cadHandleId: d.cadHandleId || null,
    standardRef: d.standardRef,
    sourceReferences: d.sourceReferences,
    matchLevel: d.matchLevel,
    similarity: d.similarity,
    diffRanges: d.diffRanges,
    textPosition: d.textPosition,
    locateMeta: d.locateMeta || null,
    fileId: msg.fileId,
    isFalsePositive: false,
    adopted: false,
    taskId: taskId.value,
    taskFileId: msg.fileId || '',
  }))
  allDetails.value = [...allDetails.value, ...newIssues]

  // 去重：基于 (fileId + issueType + originalText) 去重，移除 WS 临时 ID 和 API 真实 ID 的重复
  const seen = new Set<string>()
  allDetails.value = allDetails.value.filter((d: any) => {
    const key = `${d.fileId}:${d.issueType}:${d.originalText}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 处理 WebSocket 推送的消息 */
const handleWsMessage = (msg: WsMessage) => {
  switch (msg.type) {
    case 'task_progress':
      reviewProgress.value = msg.progress ?? reviewProgress.value
      reviewStep.value = msg.step ?? reviewStep.value
      reviewMessage.value = msg.message ?? reviewMessage.value

      // 审查完成
      if (msg.progressType === 'completed' || msg.progressType === 'failed') {
        finishReview()
      }
      // P0-4: OCR 降级告警
      if (msg.progressType === 'ocr_degraded' && msg.fileName) {
        if (!ocrDegradedFiles.value.includes(msg.fileName)) {
          ocrDegradedFiles.value.push(msg.fileName)
        }
      }
      break

    case 'chunk_result':
      reviewFileProgress.fileName = msg.fileName ?? reviewFileProgress.fileName
      reviewFileProgress.chunkIndex = (msg.chunkIndex ?? -1) + 1
      reviewFileProgress.totalChunks = msg.totalChunks ?? reviewFileProgress.totalChunks
      reviewFileProgress.issueCount += msg.issueCount ?? 0
      totalLiveIssueCount.value += msg.issueCount ?? 0
      reviewStep.value = `AI 审查中`
      reviewMessage.value = `正在审查 ${msg.fileName}（分片 ${reviewFileProgress.chunkIndex}/${reviewFileProgress.totalChunks}）`
      appendNewIssues(msg)
      break
  }
}

/** 轮询兜底检测任务完成状态（不依赖 WS 连接状态） */
const startPollFallback = () => {
  if (!reviewing.value || pollTimer) return
  pollTimer = setInterval(async () => {
    try {
      const res = await getTaskByIdApi(taskId.value)
      const status = res.data?.status
      if (status === 'COMPLETED' || status === 'FAILED') {
        task.value = res.data
        files.value = task.value?.files || []
        if (files.value.length > 0 && !selectedFileId.value) {
          switchToFileContext(files.value[0].id)
        }
        finishReview()
      }
    } catch (_) {
      // polling error — swallow, retry next tick
    }
  }, 3000)
}

/** 超时强制完成审查（防止 reviewing 永不退出） */
const startReviewTimeout = () => {
  // 30分钟后强制退出 reviewing 状态
  reviewTimeoutTimer = setTimeout(() => {
    if (reviewing.value) {
      console.warn('[TaskResultsView] ⏰ 审查超时，强制退出 reviewing 状态')
      finishReview()
    }
  }, 30 * 60 * 1000)
}

const stopPollFallback = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (reviewTimeoutTimer) {
    clearTimeout(reviewTimeoutTimer)
    reviewTimeoutTimer = null
  }
}

/** 审查完成：清理 WS 订阅 + 轮询 + 最终加载 */
const finishReview = async () => {
  reviewing.value = false
  reviewProgress.value = 100
  reviewStep.value = '审查完成'
  reviewMessage.value = '正在加载最终结果...'
  stopPollFallback()
  if (unsubscribeWs) {
    unsubscribeWs()
    unsubscribeWs = null
  }
  // 给后端一点时间完成最后的 DB 写入
  setTimeout(async () => {
    await fetchData(true)
  }, 800)
}

// ===== 数据加载 =====
const fetchData = async (silent = false) => {
  if (!silent) {
    loading.value = true
  }
  try {
    const [taskRes, detailsRes] = await Promise.all([
      getTaskByIdApi(taskId.value),
      getTaskDetailsApi(taskId.value),
    ])
    task.value = taskRes.data
    const rawDetails = detailsRes.data as any
    const detailsData = rawDetails?.details || rawDetails || []
    allDetails.value = (Array.isArray(detailsData) ? detailsData : []).map((d: any) => ({
      id: d.id,
      issueType: d.issueType,
      ruleCode: d.ruleCode,
      severity: d.severity,
      reviewSource: d.reviewSource || null,
      ruleLibraryItemId: d.ruleLibraryItemId || null,
      originalText: d.originalText,
      suggestedText: d.suggestedText,
      description: d.description,
      plainLanguage: d.plainLanguage || null,
      cadHandleId: d.cadHandleId,
      textPosition: d.textPosition || null,
      locateMeta: d.locateMeta || null,
      confidence: d.confidence || null,
      confidenceSource: d.confidenceSource || null,
      diffRanges: d.diffRanges || null,
      sourceReferences: d.sourceReferences || null,
      standardRefId: d.standardRefId,
      standardRef: d.standardRef,
      fileId: d.fileId,
      file: d.file,
      isFalsePositive: d.isFalsePositive || false,
      adopted: d.adopted || false,
      adoptedBy: d.adoptedBy || null,
      adoptedAt: d.adoptedAt || null,
      taskId: d.taskId || taskId.value,
      taskFileId: d.taskFileId || '',
    }))
    files.value = task.value?.files || []

    // ===== 状态同步：如果任务已完成但 reviewing 仍为 true，清理状态 =====
    if ((task.value?.status === 'COMPLETED' || task.value?.status === 'FAILED') && reviewing.value) {
      finishReview()
      return
    }

    // ===== 结果完整性校验（增强版） =====
    if (task.value?.status === 'COMPLETED' && files.value.length > 0) {
      const totalDetails = allDetails.value.length
      const noResultCount = allDetails.value.filter(d => d.ruleCode === 'NO_RESULT').length
      const errorDetails = allDetails.value.filter(d => d.description?.includes('审查过程中发生错误') || d.description?.includes('保存失败'))
      const validResults = totalDetails - noResultCount - errorDetails.length

      // P0-4: 检测 OCR 降级 issue
      const ocrDegradedIssues = allDetails.value.filter((d: any) => d.ruleCode === 'OCR_DEGRADED')
      for (const issue of ocrDegradedIssues) {
        const fileName = issue.originalText || issue.file?.fileName || issue.taskFileId || '未知文件'
        if (!ocrDegradedFiles.value.includes(fileName)) {
          ocrDegradedFiles.value.push(fileName)
        }
      }

      console.log(`[TaskResultsView] 📊 结果校验: 总计=${totalDetails}, 有效=${validResults}, 无结果标记=${noResultCount}, 错误记录=${errorDetails.length}`)

      // 场景0：检查是否有文件完全没有结果（既无 NO_RESULT 也无有效结果）
      const filesWithResults = new Set(allDetails.value.map((d: any) => d.fileId))
      const filesWithoutAnyResult = files.value.filter((f: any) => !filesWithResults.has(f.id))
      if (filesWithoutAnyResult.length > 0) {
        console.warn(`[TaskResultsView] ⚠️ ${filesWithoutAnyResult.length} 个文件无任何审查结果:`, filesWithoutAnyResult.map((f: any) => f.fileName).join(', '))
        if (!silent) {
          ElMessage({
            type: 'warning',
            message: `${filesWithoutAnyResult.length} 个文件无审查结果（可能解析失败或无文本内容）: ${filesWithoutAnyResult.map((f: any) => f.fileName).join('、')}`,
            duration: 8000,
            showClose: true,
          })
        }
      }

      // 场景1：有错误记录（保存失败）
      if (errorDetails.length > 0) {
        console.warn(`[TaskResultsView] ⚠️ 发现${errorDetails.length}条错误记录`)

        ElMessage({
          type: 'warning',
          message: `部分审查结果可能未成功保存（${errorDetails.length}条异常）。当前显示${validResults}条有效结果。`,
          duration: 6000,
          showClose: true,
        })
      }
      // 场景3：任务卡在PROCESSING状态超过5分钟（可能入队失败）
    } else if (task.value?.status === 'PROCESSING') {
      const taskCreatedAt = new Date(task.value.createdAt).getTime()
      const now = Date.now()
      const elapsedMinutes = (now - taskCreatedAt) / 60000

      if (elapsedMinutes > 5) {
        console.warn(`[TaskResultsView] ⚠️ 任务已处理${elapsedMinutes.toFixed(1)}分钟仍为PROCESSING状态`)

        // 仅在非静默加载时提示
        if (!silent) {
          ElMessage({
            type: 'info',
            message: '任务处理时间较长，可能遇到队列阻塞。系统将自动轮询检测完成状态...',
            duration: 5000,
            showClose: true,
          })
        }
      }
    }

    // 默认选中第一个文件
    if (files.value.length > 0 && !selectedFileId.value) {
      switchToFileContext(files.value[0].id)
    }
  } catch (e: any) {
    ElMessage.error('加载审查结果失败')
    console.error(e)
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

// ===== 操作函数 =====
// pickLocateKeyword, collectLocateAnchors 已迁移到 useIssueHelpers composable =====

// ===== IssueCardList 桥接事件处理 =====

const handleProofreadAccept = (issueId: string) => {
  console.log('[Proofread] 采纳:', issueId)
  ElMessage.success('已采纳修改建议')
}

const handleProofreadIgnore = (issueId: string) => {
  console.log('[Proofread] 忽略:', issueId)
  ElMessage.info('已忽略该问题')
}

const handleProofreadAcceptAll = () => {
  console.log('[Proofread] 全部采纳')
  ElMessage.success('已全部采纳')
}

const handleProofreadIgnoreAll = () => {
  console.log('[Proofread] 全部忽略')
  ElMessage.info('已全部忽略')
}

const handleCopyCadHandle = (handleId: string) => {
  navigator.clipboard.writeText(handleId).then(() => {
    ElMessage.success('CAD句柄已复制到剪贴板')
  }).catch(() => {
    ElMessage.error('复制失败，请手动复制')
  })
}

const handleLocateTextFromIssueList = (payload: { detail: any; elementId: string }) => {
  handleLocateText(payload.detail)
}

/** 知识库 Tab：点击标准引用卡片 → 定位到文件原文 */
const handleLocateKnowledgeItem = (item: TaskDetail) => {
  // 切换到对应文件
  if (item.fileId) {
    switchToFileContext(item.fileId)
  }
  // 定位到原文
  handleLocateText(item)
  // 切到左侧文件预览
  nextTick(() => {
    const leftPanel = document.querySelector('.left-panel')
    leftPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

const handleBatchAdoptFromIssueList = async (issueIds: string[]) => {
  if (!issueIds.length) return
  try {
    await Promise.all(issueIds.map(id => toggleAdoptApi(id, { adopted: true })))
    ElMessage.success(`已采纳 ${issueIds.length} 条建议`)
    // 刷新数据
    await fetchData(true)
  } catch (e: any) {
    console.error('批量采纳失败:', e)
    ElMessage.error('批量采纳失败')
  }
}

// handleBatchFalsePositiveFromIssueList 已迁移到 useFalsePositive composable

const goBack = () => {
  // 优先返回上一页，无历史记录时回退到任务列表
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/tasks')
  }
}

// Tab 切换时同步 URL 参数（支持浏览器前进/后退）
watch(activeTab, (newTab) => {
  if (route.query.tab !== newTab) {
    router.replace({ query: { ...route.query, tab: newTab } })
  }
})

// ===== 生命周期 =====
onMounted(async () => {
  // 进入结果页时自动收起侧边栏，给更多显示空间
  localStorage.setItem('sidebar_collapsed', 'true')
  // 触发 storage 事件让 AppLayout 响应（同页面内手动同步）
  window.dispatchEvent(new StorageEvent('storage', { key: 'sidebar_collapsed', newValue: 'true' }))

  await fetchData()

  // 如果任务状态不是 COMPLETED/FAILED，进入审查中模式，订阅 WS 实时更新
  if (task.value?.status !== 'COMPLETED' && task.value?.status !== 'FAILED') {
    reviewing.value = true
    reviewMessage.value = isSelfCheck.value ? '正在初始化自检...' : '正在初始化审查...'
    unsubscribeWs = subscribeTask(taskId.value, handleWsMessage)

    // WS 断连时使用轮询兜底（立即启动，不等待 WS 连接状态）
    startPollFallback()
    // 超时强制退出（防止 reviewing 永不退出）
    startReviewTimeout()
  }
})

onUnmounted(() => {
  stopPollFallback()
  if (unsubscribeWs) {
    unsubscribeWs()
    unsubscribeWs = null
  }
})
</script>

<style scoped>
.task-results-view {
  /* 使用视口高度精确计算：
   * 100vh - header(52px) - main-content上下padding(12px*2=24px)
   * 不依赖flex链路，确保任何情况下都填满可用空间 */
  height: calc(100vh - 76px);
  display: flex;
  flex-direction: column;
  background: #F5F7FA;
  overflow: hidden;
}

/* 步骤条 */
.step-header {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  background: white;
  border-bottom: 1px solid #E5E7EB;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-circle {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid #D1D5DB;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #9CA3AF;
}

.step-item.active .step-circle {
  border-color: #3B82F6;
  color: #3B82F6;
}

.step-item.completed .step-circle {
  background: #10B981;
  border-color: #10B981;
  color: white;
}

.step-label {
  font-size: 13px;
  font-weight: 600;
  color: #9CA3AF;
}

.step-item.active .step-label {
  color: #3B82F6;
}

.step-item.completed .step-label {
  color: #10B981;
}

.step-line {
  flex: 1;
  height: 2px;
  background: #D1D5DB;
  margin: 0 12px;
}

.step-line.active {
  background: #3B82F6;
}

/* 加载状态 */
.loading-overlay {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: #909399;
}

.loading-text {
  font-size: 14px;
}

/* 审查进度（嵌入右侧面板，非阻塞）—— 紧凑模式 */
.inline-review-progress {
  margin: 8px 12px 0;
  padding: 10px 12px;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  background: #FAFBFC;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.progress-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.progress-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.progress-percent {
  font-size: 13px;
  font-weight: 700;
  color: #409EFF;
  background: #ECF5FF;
  padding: 1px 8px;
  border-radius: 10px;
}

.progress-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #EBEEF5;
}

.progress-step {
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  margin: 4px 0 1px;
}

.progress-message {
  font-size: 11px;
  color: #909399;
  margin: 0 0 6px;
  line-height: 1.4;
}

.chunk-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #909399;
  margin-bottom: 6px;
  padding: 4px 8px;
  background: #F5F7FA;
  border-radius: 4px;
}

.chunk-filename {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.live-issue-count {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #E6A23C;
  font-weight: 600;
  margin: 0;
  padding: 4px 8px;
  background: #FDF6EC;
  border-radius: 4px;
}

/* 主内容区（紧凑模式：最大化核心内容展示） */
.main-content {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 12px;
  overflow: hidden;
  min-height: 0; /* 关键：允许flex子项收缩到小于内容高度 */
  position: relative; /* OCR 降级告警横幅定位基准 */
}

/* 左侧面板 - 尺寸由 JS leftPanelStyle 动态控制 */
.left-panel {
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  border: 1px solid #E4E7ED;
  overflow: hidden;
  min-height: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.left-panel :deep(.file-preview-panel) {
  overflow-x: auto;
  overflow-y: auto;
}

.panel-header {
  padding: 8px 12px;
  border-bottom: 1px solid #E5E7EB;
  background: #F9FAFB;
}

.hint-text {
  font-size: 12px;
  color: #909399;
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-file-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #C0C4CC;
}

.file-preview-empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  background: #FAFCFF;
  border-radius: 8px;
  margin: 12px;
  min-height: 400px;
}

.custom-empty-image {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 120px;
  background: linear-gradient(135deg, #F5F7FA 0%, #FFFFFF 100%);
  border-radius: 50%;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #606266;
  margin: 0 0 8px;
}

.empty-desc {
  font-size: 13px;
  color: #C0C4CC;
  margin: 0;
}

/* 文件切换 Tab */
.file-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.file-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  color: #6B7280;
  background: #F3F4F6;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.file-tab:hover {
  background: #EFF6FF;
  border-color: #BFDBFE;
  color: #3B82F6;
}

.file-tab.active {
  background: #3B82F6;
  border-color: #3B82F6;
  color: white;
}

.file-tab-icon {
  font-size: 13px;
}

.file-tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-tab-count {
  background: rgba(0, 0, 0, 0.1);
  padding: 0 5px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
}

.file-tab.active .file-tab-count {
  background: rgba(255, 255, 255, 0.25);
}

.editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}

.dwg-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--corp-text-secondary, #6B7280);
  font-size: 13px;
}

/* 右侧面板 */
.right-panel {
  flex: 1;
  min-width: 0; /* 关键：允许flex子项收缩 */
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  border: 1px solid #E4E7ED;
  overflow-y: hidden;
  overflow-x: auto;
  min-height: 0; /* 关键：允许在flex容器中正确收缩 */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #E5E7EB;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-width: 0;
}

/* ===== 导出报告：统一的次级下拉按钮 ===== */
.export-action-btn {
  font-weight: 500;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: 6px;
  color: #374151 !important;
  background: #FFFFFF !important;
  border: 1px solid #D1D5DB !important;
  transition: all 0.15s ease;
}

.export-action-btn:hover,
.export-action-btn:focus {
  color: #2563EB !important;
  background: #F9FAFB !important;
  border-color: #93C5FD !important;
}

/* ===== 分隔线：区分导出组和导航 ===== */
.header-divider {
  width: 1px;
  height: 22px;
  background: #E2E8F0;
  margin: 0 4px;
}

/* ===== 返回历史：导航类，最轻（纯文字按钮） ===== */
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #64748B;
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 6px;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.back-btn:hover {
  color: #334155;
  background: #F1F5F9;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0;
  white-space: nowrap;
}

.plain-mode-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.switch-label {
  font-size: 12px;
  color: #6B7280;
  white-space: nowrap;
}

/* Tab导航 */
.tab-navigation {
  display: flex;
  border-bottom: 1px solid #E5E7EB;
  padding: 0 16px;
}

.tab-item {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #6B7280;
  border: none;
  background: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab-item:hover {
  color: #3B82F6;
}

.tab-item.active {
  color: #3B82F6;
  border-bottom-color: #3B82F6;
}

.tab-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tab-icon {
  font-size: 14px;
}

.tab-label {
  white-space: nowrap;
}

.tab-badge {
  margin-left: 2px;
}

.tab-badge :deep(.el-badge__content) {
  font-size: 10px;
  padding: 0 4px;
  height: 16px;
  line-height: 16px;
}

/* Tab内容 */
.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* ===== Overview Tab: 统计看板 ===== */
.stats-dashboard {
  margin-bottom: 20px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat-card-dash {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.stat-card-dash:hover {
  border-color: #D1D5DB;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.stat-card-dash.has-issues {
  background: #FEF2F2;
  border-color: #FECACA;
}

.stat-icon-dash {
  font-size: 18px;
  flex-shrink: 0;
}

.stat-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.stat-value-dash {
  font-size: 15px;
  font-weight: 700;
  color: #111827;
  line-height: 1.2;
}

.stat-label-dash {
  font-size: 11px;
  color: #6B7280;
}

/* ===== Overview Tab: 问题预览列表 ===== */
.overview-issue-list {
  margin-top: 20px;
}

.overview-issue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.overview-section-title {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.overview-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.overview-header-actions .switch-label {
  font-size: 12px;
  color: #6B7280;
}

/* 严重度分组 */
.overview-severity-group {
  margin-bottom: 16px;
}

.severity-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 0 8px;
  margin-bottom: 6px;
  border-bottom: 1px solid #F3F4F6;
}
.severity-group-header.severity-error { color: #DC2626; }
.severity-group-header.severity-warning { color: #D97706; }

.severity-dot-sm {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.error-dot { background: #EF4444; }
.warning-dot { background: #F59E0B; }

/* 概览问题卡片 */
.overview-issue-card {
  position: relative;
  padding: 10px 36px 10px 12px;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-left: 3px solid #EF4444;
  border-radius: 6px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.overview-issue-card:hover {
  border-color: #D1D5DB;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  transform: translateX(2px);
}
.overview-issue-card.warning {
  border-left-color: #F59E0B;
}

.oic-tags {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.oic-desc {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 4px;
  line-height: 1.4;
}

.oic-plain {
  font-size: 12px;
  color: #6B7280;
  margin: 0 0 6px;
  line-height: 1.4;
}

.oic-preview-row {
  display: flex;
  gap: 4px;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 2px;
  overflow: hidden;
}

.oic-preview-label {
  color: #9CA3AF;
  flex-shrink: 0;
  font-weight: 500;
}

.oic-preview-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oic-preview-text.original {
  color: #DC2626;
  background: #FEF2F2;
  padding: 1px 6px;
  border-radius: 3px;
}
.oic-preview-text.suggested {
  color: #059669;
  background: #ECFDF5;
  padding: 1px 6px;
  border-radius: 3px;
}

.oic-arrow {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  color: #9CA3AF;
  opacity: 0;
  transition: opacity 0.15s;
}
.overview-issue-card:hover .oic-arrow {
  opacity: 1;
  color: #3B82F6;
}

/* 查看全部按钮 */
.view-all-wrapper {
  margin-top: 8px;
  text-align: center;
}

.view-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 12px;
  color: #3B82F6;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-weight: 500;
}

.view-all-btn:hover {
  background: #DBEAFE;
  border-color: #93C5FD;
  color: #2563EB;
}

.view-all-btn-warning {
  background: #FFFBEB;
  border-color: #FDE68A;
  color: #D97706;
}

.view-all-btn-warning:hover {
  background: #FEF3C7;
  border-color: #FCD34D;
  color: #B45309;
}

/* 知识库卡片 */
.knowledge-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.knowledge-card {
  padding: 12px;
  background: #EFF6FF;
  border-radius: 6px;
  border: 1px solid #BFDBFE;
  transition: all 0.15s ease;
}

.knowledge-card-clickable {
  cursor: pointer;
}

.knowledge-card-clickable:hover {
  border-color: #93C5FD;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.12);
  transform: translateX(3px);
}

.knowledge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.knowledge-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.knowledge-title {
  font-size: 13px;
  font-weight: 600;
  color: #1E40AF;
  margin: 0;
}

.knowledge-content {
  font-size: 12px;
  color: #374151;
  line-height: 1.6;
  margin: 0;
}

/* 统计分析 */
.analytics-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.stat-card {
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
}

.stat-card.total {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.stat-card.error {
  background: #FEF2F2;
  border-color: #FECACA;
}

.stat-card.warning {
  background: #FFFBEB;
  border-color: #FDE68A;
}

.stat-card.info {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.stat-number {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 4px;
}

.stat-card.total .stat-number {
  color: #3B82F6;
}

.stat-card.error .stat-number {
  color: #EF4444;
}

.stat-card.warning .stat-number {
  color: #F59E0B;
}

.stat-card.info .stat-number {
  color: #3B82F6;
}

.stat-label {
  font-size: 12px;
  color: #6B7280;
}

.analytics-section {
  margin-bottom: 24px;
}

.severity-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.severity-bar-item {
  display: grid;
  grid-template-columns: 60px 1fr 100px;
  align-items: center;
  gap: 12px;
}

.severity-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}

.severity-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.severity-bar-track {
  height: 8px;
  background: #F3F4F6;
  border-radius: 4px;
  overflow: hidden;
}

.severity-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.severity-count {
  font-size: 12px;
  color: #6B7280;
  text-align: right;
}

.category-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.category-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #F9FAFB;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
}

.category-count {
  font-size: 13px;
  font-weight: 600;
  color: #3B82F6;
}

/* 工具类 */
.w-full {
  width: 100%;
}

.mr-1 {
  margin-right: 4px;
}

.mt-3 {
  margin-top: 12px;
}

/* 审查摘要 */
.review-summary {
  padding: 24px;
}

.summary-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 16px 0;
}

.summary-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  min-width: 140px;
  border: 1px solid var(--el-border-color-lighter);
}

.summary-card.sub {
  background: transparent;
  border: none;
  min-width: 100px;
  padding: 6px 12px;
}

.summary-card.has-issues {
  border-color: var(--el-color-warning);
  background: rgba(230, 162, 60, 0.06);
}

.summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.summary-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.summary-pass {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: rgba(103, 194, 58, 0.06);
  border-radius: 8px;
  font-size: 14px;
  color: #67c23a;
  font-weight: 500;
}

.ai-warning-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-top: 8px;
  background: rgba(230, 162, 60, 0.08);
  border: 1px solid rgba(230, 162, 60, 0.25);
  border-radius: 6px;
  font-size: 13px;
  color: #90640b;
  line-height: 1.5;
}

/* ===== 合同审查评分卡片 ===== */
.contract-score-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 20px;
  margin-top: 12px;
  background: linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%);
  border: 1px solid #BAE6FD;
  border-radius: 8px;
}
.score-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.score-value {
  font-size: 42px;
  font-weight: 800;
  line-height: 1;
}
.score-value.level-good { color: #16A34A; }
.score-value.level-warning { color: #D97706; }
.score-value.level-danger { color: #DC2626; }
.score-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.score-label {
  font-size: 12px;
  color: #6B7280;
}
.score-conclusion {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}
.risk-summary {
  display: flex;
  gap: 20px;
  margin-left: auto;
}
.risk-item {
  text-align: center;
}
.risk-count {
  font-size: 22px;
  font-weight: 700;
  display: block;
}
.risk-item.high .risk-count { color: #DC2626; }
.risk-item.medium .risk-count { color: #D97706; }
.risk-item.low .risk-count { color: #16A34A; }
.risk-label {
  font-size: 11px;
  color: #6B7280;
}

/* 响应式 */
@media (max-width: 1200px) {
  .main-content {
    flex-direction: column;
  }

  .left-panel,
  .right-panel {
    flex: none;
    height: 50vh;
  }

  .analytics-overview {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* ==================== 可拖拽分割条 ==================== */
.resize-divider {
  flex: none;
  width: 8px;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background-color 0.2s ease;
  position: relative;
  user-select: none; /* 防止拖拽时选中文本 */
  z-index: 10;
}

.resize-divider:hover {
  background-color: rgba(59, 130, 246, 0.08);
}

.resize-divider.active {
  background-color: rgba(59, 130, 246, 0.12);
}

.divider-line {
  width: 2px;
  height: 100%;
  background-color: #E5E7EB;
  border-radius: 1px;
  transition: background-color 0.2s ease, width 0.2s ease;
}

.resize-divider:hover .divider-line,
.resize-divider.active .divider-line {
  background-color: #3B82F6;
  width: 3px;
}

.divider-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.resize-divider:hover .divider-handle,
.resize-divider.active .divider-handle {
  opacity: 1;
}

.handle-dots {
  font-size: 14px;
  color: #3B82F6;
  font-weight: bold;
  letter-spacing: -1px;
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

/* 拖拽时的全局样式（禁用文本选择） */
.resizing-active * {
  cursor: col-resize !important;
  user-select: none !important;
}

/* ==================== 响应式布局优化 ==================== */

/*
 * 断点设计：
 * - ≥ 1400px：大屏桌面，左右分栏（文件预览 55% : AI审查 45%）
 * - 1200px - 1399px：中屏/笔记本（如1268x800），调整比例（45% : 55%）
 * - 768px - 1199px：小窗口，左右分栏但更紧凑
 * - < 768px：小屏/手机，上下堆叠
 */

/* 笔记本/中等屏幕（1200px - 1399px）：优化1268x800等常见分辨率 */
@media (max-width: 1399px) and (min-width: 1200px) {
  .main-content {
    gap: 10px;
    padding: 10px;
  }

  .left-panel {
    flex: none;
    width: 45%;
    min-width: 320px;
  }

  .right-panel {
    flex: 1;
    min-width: 0;
  }

  .panel-header {
    padding: 6px 10px;
  }

  .header-left {
    gap: 8px;
  }

  .header-right {
    gap: 6px;
  }

  .resize-divider {
    width: 6px;
  }

  .tab-navigation {
    padding: 0 12px;
  }

  .tab-item {
    padding: 8px 12px;
    font-size: 12px;
  }

  .tab-content {
    padding: 12px;
  }

  .inline-review-progress {
    margin: 10px 12px 0;
    padding: 12px;
  }

  .file-tab-name {
    max-width: 90px;
  }

  .file-tab {
    padding: 3px 8px;
    font-size: 11px;
  }
}

/* 中等屏幕（768px - 1199px）：优化窗口缩小时的体验 */
@media (max-width: 1199px) and (min-width: 769px) {
  .main-content {
    flex-direction: row;
    gap: 8px;
    padding: 6px;
  }

  .left-panel {
    flex: none;
    min-width: 20%;
  }

  .right-panel {
    flex: 1;
    min-width: 0;
  }

  .panel-header {
    padding: 6px 10px;
  }

  .resize-divider {
    width: 6px;
  }
}

/* 小屏幕（< 768px）：完全切换为上下堆叠布局 */
@media (max-width: 768px) {
  .main-content {
    flex-direction: column;      /* 关键：改为上下堆叠 */
    gap: 8px;
    padding: 6px;
    /* 不设置height:auto，保持flex填充 */
  }

  /* 隐藏分割条（上下堆叠时不需要） */
  .resize-divider {
    display: none;
  }

  /* 左侧文件预览区：限制最大高度，可滚动 */
  .left-panel {
    flex: none;                  /* 取消flex伸缩 */
    width: 100%;
    height: 40vh;               /* 占据40%视口高度 */
    min-height: 200px;
    max-height: 350px;
  }

  /* 右侧AI审查报告：优先显示，占据剩余空间（使用calc确保填满） */
  .right-panel {
    flex: none;
    width: 100%;
    height: calc(60vh - 16px); /* 减去gap(8px)*2 */
    min-height: 300px;
  }

  /* 面板头部超紧凑 */
  .panel-header {
    padding: 6px 8px;
  }

  .hint-text {
    font-size: 11px;
  }

  /* 文件Tab适配小屏 */
  .file-tab-name {
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* 超小屏幕（< 480px）：极致紧凑模式 */
@media (max-width: 480px) {
  .main-content {
    gap: 4px;
    padding: 4px;
  }

  .left-panel {
    height: 35vh;
    min-height: 200px;
    border-radius: 4px;
  }

  .right-panel {
    height: calc(65vh - 12px);
    min-height: 350px;
    border-radius: 4px;
  }

  .panel-header {
    padding: 4px 6px;
  }

  .file-tab {
    padding: 3px 6px;
    font-size: 11px;
  }
}

/* ====== 标准引用自检报告样式 ====== */
.self-check-report-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  flex: 1;
  overflow: auto;
  min-width: 0;
  min-height: 0;
}

.sc-summary-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.sc-lib-info {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-left: auto;
}

.sc-name-sub {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.sc-detail-card {
  margin-top: 8px;
}

.sc-diff-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1.8;
}

.sc-wrong {
  color: var(--el-color-danger);
  font-family: monospace;
  background: #fde8e8;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px dashed var(--el-color-danger);
}

.sc-correct {
  color: var(--el-color-success);
  font-family: monospace;
  background: #e8f5e9;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
}

.correct-text {
  color: var(--el-color-success);
}

.no-match {
  color: var(--el-color-danger);
  font-weight: 700;
  font-size: 16px;
}

/* 响应式布局优化 */
@media (max-width: 1200px) {
  .main-content {
    gap: 12px;
    padding: 8px;
  }

  .left-panel {
    flex: 0 0 32%;
    max-width: 360px;
  }
}

@media (max-width: 1024px) {
  .main-content {
    flex-direction: column;
    gap: 12px;
  }

  .left-panel {
    flex: 0 0 auto;
    max-width: none;
    max-height: 45vh;
    min-height: 300px;
  }

  .right-panel {
    flex: 1;
    min-height: 50vh;
  }

  .resize-divider {
    display: none;
  }
}

@media (max-width: 1024px) {
  .inline-review-progress {
    margin: 6px 10px 0;
    padding: 8px 10px;
  }

  .progress-title {
    font-size: 12px;
  }

  .progress-percent {
    font-size: 12px;
    padding: 1px 6px;
  }

  .chunk-filename {
    max-width: 160px;
  }
}

@media (max-width: 768px) {
  .main-content {
    padding: 6px;
    gap: 8px;
  }

  .left-panel {
    max-height: 35vh;
    min-height: 250px;
  }

  .inline-review-progress {
    margin: 6px 8px 0;
    padding: 8px;
    border-radius: 6px;
  }

  .progress-top {
    margin-bottom: 6px;
  }

  .progress-status {
    gap: 4px;
  }

  .progress-title {
    font-size: 11px;
  }

  .progress-percent {
    font-size: 11px;
    padding: 0 6px;
  }

  .progress-details {
    margin-top: 6px;
    padding-top: 6px;
  }

  .progress-step {
    font-size: 11px;
    margin: 2px 0 0;
  }

  .progress-message {
    font-size: 10px;
    margin-bottom: 4px;
  }

  .chunk-progress {
    font-size: 10px;
    padding: 3px 6px;
    margin-bottom: 4px;
    gap: 4px;
  }

  .chunk-filename {
    max-width: 120px;
  }

  .live-issue-count {
    font-size: 11px;
    padding: 3px 6px;
  }
}

/* ===== 空状态样式 ===== */
.empty-state-pass,
.empty-state-knowledge {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.pass-icon-wrapper {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.empty-state-pass h3,
.empty-state-knowledge h4 {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  color: #065F46;
}

.pass-subtitle {
  margin: 0 0 28px;
  font-size: 14px;
  color: #6B7280;
}

.empty-state-pass p,
.empty-state-knowledge .empty-reason {
  margin: 0 0 24px;
  font-size: 14px;
  color: #6B7280;
}

.empty-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.empty-hint {
  font-size: 12px;
  color: #9CA3AF;
  max-width: 400px;
  line-height: 1.6;
}

.empty-state-knowledge .possible-reasons {
  text-align: left;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 24px;
  max-width: 440px;
}

.empty-state-knowledge .possible-reasons p {
  margin: 0 0 8px;
  color: #92400E;
  font-size: 13px;
}

.empty-state-knowledge .possible-reasons ul {
  margin: 0;
  padding-left: 20px;
  color: #78716C;
  font-size: 13px;
  line-height: 1.8;
}

/* OCR 降级告警横幅 */
.ocr-degraded-banner {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 100;
}
.ocr-degraded-banner :deep(.el-alert) {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
</style>

<!-- 全局样式：el-select popper 下拉框高度限制 -->
<style>
.file-filter-popper {
  max-height: 40vh !important;
  overflow-y: auto !important;
}
</style>

