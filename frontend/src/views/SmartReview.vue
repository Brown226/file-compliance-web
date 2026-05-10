<template>
  <div class="smart-review">
    <!-- 步骤条 - 参考项目风格 -->
    <div class="step-header">
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
    </div>

    <!-- Step 0: 上传区域（参考项目设计） -->
    <div v-if="currentStep === 0" class="upload-step">
      <div class="step-title">
        <h1 class="page-title">智能文件审查</h1>
        <p class="page-subtitle">上传您的文件，AI 将为您深度分析、识别风险、守护合规。</p>
      </div>

      <div class="upload-container">
        <!-- 待审文件上传区域（必选） -->
        <div class="primary-upload-section">
          <h3 class="section-title">
            <el-icon><Document /></el-icon>
            待审文件
            <el-tag type="danger" size="small">必选</el-tag>
          </h3>
          <el-upload
            ref="uploadRef"
            class="upload-dragger"
            drag
            multiple
            :auto-upload="false"
            :limit="10"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            :on-exceed="handleExceed"
            accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx,.jpg,.png,.jpeg,.txt"
            :show-file-list="false"
          >
            <div class="upload-content">
              <el-icon :size="48" class="upload-icon"><UploadFilled /></el-icon>
              <div class="upload-text">
                <span class="upload-link">点击上传</span>
                <span>或将文件拖到此处</span>
              </div>
              <p class="upload-hint">支持 .docx .pdf .dwg .xls .ppt 格式</p>
            </div>
          </el-upload>

          <!-- 已选待审文件列表 -->
          <div v-if="fileList.length > 0" class="file-list-section">
            <div class="file-list">
              <div v-for="(file, index) in fileList" :key="index" class="file-item">
                <el-icon class="file-icon"><Document /></el-icon>
                <span class="file-name">{{ file.name }}</span>
                <span class="file-size">{{ formatFileSize(file.size || 0) }}</span>
                <el-button
                  type="danger"
                  text
                  size="small"
                  @click="removeFile(index)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 参考文件上传区域（可选） -->
        <div class="reference-upload-section">
          <h3 class="section-title">
            <el-icon><Link /></el-icon>
            参考文件（用于以文审文）
            <el-tag type="info" size="small">可选</el-tag>
          </h3>
          <p class="section-description">
            上传参考文件作为审查依据，系统将基于参考文件对待审文件进行智能审查。
          </p>
          <el-upload
            ref="referenceUploadRef"
            class="reference-upload"
            drag
            multiple
            :auto-upload="false"
            :limit="5"
            :on-change="handleReferenceFileChange"
            :on-remove="handleReferenceFileRemove"
            accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx,.txt"
            :show-file-list="false"
          >
            <div class="upload-content">
              <el-icon :size="36" class="upload-icon"><FolderAdd /></el-icon>
              <div class="upload-text">
                <span class="upload-link">选择参考文件</span>
                <span>或拖到此处</span>
              </div>
              <p class="upload-hint">支持 .docx .pdf .dwg 等格式，最多 5 个文件</p>
            </div>
          </el-upload>

          <!-- 已选参考文件列表 -->
          <div v-if="refFileList.length > 0" class="file-list-section">
            <div class="file-list">
              <div v-for="(file, index) in refFileList" :key="index" class="file-item reference-file">
                <el-icon class="file-icon"><Document /></el-icon>
                <span class="file-name">{{ file.name }}</span>
                <span class="file-size">{{ formatFileSize(file.size || 0) }}</span>
                <el-button
                  type="danger"
                  text
                  size="small"
                  @click="removeReferenceFile(index)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 下一步按钮 -->
        <div class="step-actions">
          <el-button
            type="primary"
            size="large"
            :disabled="fileList.length === 0"
            @click="goToStep1"
          >
            下一步：确认信息并分析
          </el-button>
        </div>
      </div>
    </div>

    <!-- Step 1: 预审配置 - 参考项目左右分栏布局 -->
    <div v-if="currentStep === 1" class="confirm-step">
      <div v-if="preAnalyzed" class="confirm-content">
        <!-- 文件上传成功提示 -->
        <div class="upload-success">
          <p class="success-text">文件 <span class="file-name">{{ fileList.length }} 个文件</span> 已上传成功。</p>
          <p class="ai-hint" v-if="preAnalysisData.contractType">AI初步识别文件类型为：<span class="type-text">{{ preAnalysisData.contractType }}</span></p>
        </div>

        <!-- 左右分栏：审查立场 + 审查范围 -->
        <div class="config-grid">
          <!-- 左侧：审查立场 -->
          <div class="config-panel">
            <h3 class="panel-title">1. 选择您的审查立场</h3>
            <p class="panel-desc">AI将基于您的立场进行侧重分析。</p>
            <el-select 
              v-model="config.perspective" 
              placeholder="请选择您的立场" 
              class="w-full" 
              filterable 
              allow-create
              style="width: 100%; margin-top: 16px;"
            >
              <el-option label="建设方" value="builder" />
              <el-option label="施工方" value="contractor" />
              <el-option label="监理方" value="supervisor" />
              <el-option label="设计方" value="designer" />
              <el-option label="通用审查" value="general" />
            </el-select>
          </div>

          <!-- 右侧：审查范围 -->
          <div class="config-panel">
            <h3 class="panel-title">2. 确认审查范围</h3>
            <p class="panel-desc">默认已全选AI建议的审查点。</p>
            <div class="template-select">
              <label class="select-label">审查模板</label>
              <el-select v-model="selectedTemplateId" placeholder="选择审查模板" style="width: 100%; margin-top: 8px;">
                <el-option
                  v-for="template in reviewTemplates"
                  :key="template.id"
                  :label="template.name"
                  :value="template.id"
                />
              </el-select>
            </div>
            <div class="panel-actions">
              <el-button @click="goBackToUpload">重新上传</el-button>
              <el-button 
                type="primary" 
                :disabled="!config.perspective"
                @click="startAnalysis"
              >
                开始分析
              </el-button>
            </div>
          </div>
        </div>

        <!-- 底部：审查点及核心目的 -->
        <div class="review-options-panel">
          <h3 class="panel-title">审查点及核心目的</h3>
          
          <!-- 审查点选择 -->
          <div class="review-points-section">
            <h4 class="section-label">审查点选择 (可多选)</h4>
            <el-checkbox-group v-model="selectedReviewPoints" class="review-points-group">
              <el-checkbox
                v-for="point in allSuggestedReviewPoints"
                :key="point"
                :label="point"
                :value="point"
                border
              ></el-checkbox>
            </el-checkbox-group>
          </div>

          <!-- 审查核心目的 -->
          <div class="review-purposes-section">
            <h4 class="section-label">审查核心目的 (可自定义)</h4>
            <div v-for="(purpose, index) in customPurposes" :key="index" class="purpose-row">
              <el-autocomplete
                v-model="purpose.value"
                :fetch-suggestions="querySearchCorePurposes"
                placeholder="搜索或输入新目的"
                class="w-full"
                trigger-on-focus
              ></el-autocomplete>
              <el-button 
                type="text" 
                @click="removePurpose(index)"
                class="remove-btn"
              >
                <el-icon><RemoveFilled /></el-icon>
              </el-button>
            </div>
            <el-button 
              type="text" 
              @click="addPurpose" 
              class="add-purpose-btn"
            >
              <el-icon><CirclePlusFilled /></el-icon>
              添加目的
            </el-button>
          </div>
        </div>

        <!-- 预分析推荐配置 - 保留现有功能 -->
        <div class="pre-analysis-config">
          <h3 class="panel-title">AI 推荐配置</h3>
          
          <!-- 以库审文 -->
          <div class="config-item">
            <div class="config-header">
              <el-checkbox v-model="config.libraryReview" class="config-checkbox">
                <span class="config-name">以库审文（知识库审查）</span>
              </el-checkbox>
              <el-tag size="small" :type="config.libraryReview ? 'success' : 'info'" effect="plain">
                {{ config.libraryReview ? '已启用' : '推荐' }}
              </el-tag>
            </div>
            <div v-if="config.libraryReview" class="config-body">
              <el-select v-model="config.knowledgeCategoryId" placeholder="选择知识库子库" style="width: 100%">
                <el-option
                  v-for="kb in knowledgeCategories"
                  :key="kb.id"
                  :label="kb.name"
                  :value="kb.id"
                />
              </el-select>
              <div v-if="preAnalysisReasons.library" class="config-reason">
                <el-icon><InfoFilled /></el-icon>
                {{ preAnalysisReasons.library }}
              </div>
            </div>
          </div>

          <!-- 以文审文 -->
          <div v-if="refFileList.length > 0" class="config-item">
            <div class="config-header">
              <el-checkbox v-model="config.docReview" class="config-checkbox">
                <span class="config-name">以文审文（参照文件比对）</span>
              </el-checkbox>
              <el-tag size="small" type="success" effect="plain">已上传 {{ refFileList.length }} 个参照文件</el-tag>
            </div>
            <div v-if="config.docReview" class="config-body">
              <div class="config-reason">
                <el-icon><InfoFilled /></el-icon>
                参照文件将作为比对基准，检查待审文件中的差异和不一致
              </div>
            </div>
          </div>

          <!-- 规则库审查 -->
          <div class="config-item">
            <div class="config-header">
              <el-checkbox v-model="config.ruleLibrary" class="config-checkbox">
                <span class="config-name">规则库审查</span>
              </el-checkbox>
              <el-tag size="small" :type="config.ruleLibrary ? 'success' : 'info'" effect="plain">
                {{ config.ruleLibrary ? '已启用' : '可选' }}
              </el-tag>
            </div>
            <div v-if="config.ruleLibrary" class="config-body">
              <el-select v-model="config.ruleLibraryId" placeholder="选择规则库" style="width: 100%">
                <el-option
                  v-for="rl in ruleLibraries"
                  :key="rl.id"
                  :label="rl.name"
                  :value="rl.id"
                />
              </el-select>
              <div v-if="preAnalysisReasons.ruleLibrary" class="config-reason">
                <el-icon><InfoFilled /></el-icon>
                {{ preAnalysisReasons.ruleLibrary }}
              </div>
            </div>
          </div>

          <!-- 通用检查 -->
          <div class="config-item">
            <div class="config-header">
              <span class="config-name" style="font-weight: 600;">通用检查</span>
            </div>
            <div class="config-body general-checks">
              <el-checkbox v-model="config.ruleCheck">
                <span>规则检查</span>
                <span class="check-desc">格式、命名、编码等基础规则</span>
              </el-checkbox>
              <el-checkbox v-model="config.typoCheck">
                <span>错别字检查</span>
                <span class="check-desc">错别字、语法错误、术语一致性</span>
              </el-checkbox>
              <el-checkbox v-model="config.crossFileCheck" :disabled="fileList.length < 2">
                <span>跨文件一致性</span>
                <span class="check-desc">{{ fileList.length < 2 ? '需上传2个以上文件' : '跨文件参数和语义一致性' }}</span>
              </el-checkbox>
            </div>
          </div>
        </div>
      </div>

      <!-- 预分析中 -->
      <div v-else class="pre-analyzing">
        <el-skeleton :rows="8" animated />
      </div>
    </div>

    <!-- Step 2: 审查中/结果展示 -->
    <div v-if="currentStep === 2" class="review-step">
      <div class="review-header">
        <h2 class="review-title">AI 审查报告</h2>
        <div class="review-actions">
          <el-switch v-model="showPlainLanguage" active-text="大白话模式" />
          <el-button @click="exportWord">导出Word</el-button>
          <el-button @click="exportExcel">导出Excel</el-button>
          <el-button @click="goBackToConfirm">返回修改配置</el-button>
        </div>
      </div>

      <!-- Tab导航 -->
      <el-tabs v-model="activeAiTab" class="review-tabs">
        <el-tab-pane label="总览" name="summary">
          <div class="tab-content">
            <h3>争议点</h3>
            <div v-if="reviewData.dispute_points?.length" class="issues-list">
              <div v-for="(item, index) in reviewData.dispute_points" :key="index" class="issue-card">
                <p class="issue-title">{{ disputeTitle(item, index) }}</p>
                <p class="issue-desc">{{ disputeDescription(item) }}</p>
              </div>
            </div>
            <div v-else class="empty-state">未发现争议点</div>

            <h3 style="margin-top: 24px;">缺失条款</h3>
            <div v-if="reviewData.missing_clauses?.length" class="issues-list">
              <div v-for="(item, index) in reviewData.missing_clauses" :key="index" class="issue-card">
                <p class="issue-title">{{ missingClauseTitle(item, index) }}</p>
                <p class="issue-desc">{{ item.description || '该条款缺失，建议补充' }}</p>
              </div>
            </div>
            <div v-else class="empty-state">条款完整</div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="修改" name="modification">
          <div class="tab-content">
            <!-- 批量操作栏 -->
            <div v-if="reviewData.modification_suggestions?.length" class="batch-actions-bar">
              <el-checkbox
                :model-value="allSelected"
                :indeterminate="batchPartialSelected"
                @change="toggleAll"
              >
                全选 ({{ batchSelectedCount }}/{{ reviewData.modification_suggestions.length }})
              </el-checkbox>
              <el-button
                type="primary"
                size="small"
                :disabled="batchSelectedCount === 0"
                @click="batchAdopt"
              >
                一键采纳所选 ({{ batchSelectedCount }})
              </el-button>
            </div>

            <div v-if="reviewData.modification_suggestions?.length" class="suggestions-list">
              <div v-for="(item, index) in reviewData.modification_suggestions" :key="index" class="suggestion-card" :class="{ 'batch-selected': batchSelected.has(index) }">
                <div class="suggestion-header">
                  <el-checkbox
                    :model-value="batchSelected.has(index)"
                    @change="toggleItem(index)"
                  />
                  <p class="suggestion-title">{{ suggestionTitle(item, index) }}</p>
                </div>
                
                <!-- 大白话模式 -->
                <div v-if="showPlainLanguage" class="plain-language-box">
                  <p class="plain-label">📢 大白话建议：</p>
                  <p class="plain-text">{{ item.plain_language || suggestionReason(item) }}</p>
                </div>

                <!-- 详细模式 -->
                <div v-else class="detail-mode">
                  <div class="detail-item">
                    <p class="detail-label">原文：</p>
                    <blockquote class="detail-quote original">{{ suggestionOriginal(item) || 'AI 未返回可直接定位的原文，请参考建议条款手动核对。' }}</blockquote>
                  </div>
                  <div class="detail-item">
                    <p class="detail-label">建议：</p>
                    <blockquote class="detail-quote suggested">{{ suggestionText(item) }}</blockquote>
                  </div>
                  <div class="detail-item">
                    <p class="detail-label">理由：</p>
                    <p class="detail-reason">{{ suggestionReason(item) }}</p>
                  </div>
                </div>
                
                <div class="suggestion-actions">
                  <el-button size="small" @click="previewSuggestion(item)">查看变更</el-button>
                  <el-button 
                    size="small" 
                    type="primary"
                    @click="adoptSuggestion(item)"
                  >
                    {{ item.adopted ? '已采纳' : '一键采纳建议' }}
                  </el-button>
                </div>
              </div>
            </div>
            <div v-else class="empty-state">未发现修改建议</div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="依据" name="laws">
          <div class="tab-content">
            <h3>相关法律依据</h3>
            <div v-if="reviewData.relevant_laws?.length" class="laws-list">
              <div v-for="(item, index) in reviewData.relevant_laws" :key="index" class="law-card">
                <p class="law-title">{{ item.law || item.title }}</p>
                <p class="law-clause">{{ item.clause || item.article }}</p>
                <p class="law-content">{{ item.content }}</p>
              </div>
            </div>
            <div v-else class="empty-state">未检索到相关法律依据</div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="工作台" name="workspace">
          <div class="tab-content">
            <div class="workspace-section">
              <h3>选中文本专项审查</h3>
              <el-input
                v-model="focusedReviewText"
                type="textarea"
                :rows="6"
                placeholder="可从左侧选中文本后读取，也可手动粘贴某一条款或段落"
              />
              <el-input
                v-model="focusedReviewQuestion"
                placeholder="专项问题，例如：审查这段条款是否合规，并给出修改建议"
                style="margin-top: 12px;"
              />
              <div class="workspace-actions">
                <el-button 
                  type="primary" 
                  :disabled="focusedReviewLoading || !focusedReviewText.trim()"
                  @click="submitFocusedReview"
                >
                  {{ focusedReviewLoading ? '审查中...' : '开始专项审查' }}
                </el-button>
              </div>
            </div>

            <div v-if="focusedReviewResult" class="focused-result">
              <h3>专项审查结论</h3>
              <p class="result-summary">{{ focusedReviewResult.risk_summary }}</p>
              <div v-if="focusedReviewResult.plain_language" class="plain-language-box">
                <p class="plain-label">大白话说明</p>
                <p class="plain-text">{{ focusedReviewResult.plain_language }}</p>
              </div>
              <div v-if="focusedReviewResult.suggested_text" class="suggested-text-box">
                <p class="detail-label">建议替换文本</p>
                <p class="suggested-text">{{ focusedReviewResult.suggested_text }}</p>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 加载遮罩 -->
    <div v-if="loading && currentStep < 2" class="loading-overlay">
      <div class="loading-content">
        <p class="loading-title">{{ loadingMessage }}</p>
        <div v-if="analysisProgress.length" class="analysis-progress-steps">
          <div
            v-for="(item, index) in visibleAnalysisProgress"
            :key="index"
            class="progress-step"
            :class="`progress-step--${progressStatusClass(item.status)}`"
          >
            <div class="progress-marker">
              <span v-if="item.status === 'completed'">✓</span>
              <span v-else-if="item.status === 'failed'">!</span>
            </div>
            <div class="progress-info">
              <div class="progress-title">
                <span>{{ progressStepLabel(item.step) }}</span>
                <span class="progress-status">{{ progressStatusLabel(item.status) }}</span>
              </div>
              <p v-if="item.message" class="progress-message">{{ item.message }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 采纳预览对话框 -->
    <el-dialog
      v-model="previewDialogVisible"
      title="采纳变更预览"
      width="720px"
      :close-on-click-modal="false"
    >
      <div v-if="previewItem" class="preview-compare">
        <div class="preview-panel preview-before">
          <div class="preview-panel-header">
            <span class="preview-badge badge-before">采纳前</span>
          </div>
          <div class="preview-panel-body">
            <p>{{ suggestionOriginal(previewItem) || '（原文未提取）' }}</p>
          </div>
        </div>
        <div class="preview-arrow">→</div>
        <div class="preview-panel preview-after">
          <div class="preview-panel-header">
            <span class="preview-badge badge-after">采纳后</span>
          </div>
          <div class="preview-panel-body">
            <p>{{ suggestionText(previewItem) }}</p>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="previewDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="adoptFromPreview">
          {{ previewItem?.adopted ? '已采纳' : '采纳此建议' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadFile, FormInstance, FormRules } from 'element-plus'
import {
  Upload, UploadFilled, Check, MagicStick, InfoFilled, VideoPlay,
  RemoveFilled, CirclePlusFilled, Document, Link, FolderAdd, Delete,
} from '@element-plus/icons-vue'
import { createTaskApi, preAnalyzeApi, uploadOnlyApi, exportTaskReportApi, exportTaskReportWordApi } from '@/api/task'
import { getAllKnowledgeCategoriesApi } from '@/api/knowledge-category'
import { getRuleLibrariesApi } from '@/api/rule-library'
import { useUserStore } from '@/stores/user'
import DwgPreview from '@/components/DwgPreview.vue'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref<FormInstance>()

// ===== 步骤控制 =====
const currentStep = ref(0) // 0: 上传, 1: 确认, 2: 审查中

// ===== 文件上传 =====
const fileList = ref<UploadFile[]>([])
const uploadRef = ref()
const refFileList = ref<UploadFile[]>([])
const referenceUploadRef = ref()
const dwgParsedDataMap = ref<Record<string, any>>({})

const totalFileSize = computed(() =>
  fileList.value.reduce((sum, f) => sum + (f.size || 0), 0) +
  refFileList.value.reduce((sum, f) => sum + (f.size || 0), 0)
)

const dwgPreviewFiles = computed(() =>
  fileList.value.filter(f => f.name.toLowerCase().endsWith('.dwg') && f.raw)
)

const handleFileChange = (_file: UploadFile, newFileList: UploadFile[]) => {
  fileList.value = newFileList
}
const handleFileRemove = (_file: UploadFile, newFileList: UploadFile[]) => {
  fileList.value = newFileList
}
const handleExceed = (files: File[], fileList: File[]) => {
  ElMessage.warning(`最多只能选择 10 个待审文件。当前已选择 ${fileList.length} 个文件。`)
}
const removeFile = (index: number) => {
  fileList.value.splice(index, 1)
}

const handleReferenceFileChange = (_file: UploadFile, newFileList: UploadFile[]) => {
  refFileList.value = newFileList
}
const handleReferenceFileRemove = (_file: UploadFile, newFileList: UploadFile[]) => {
  refFileList.value = newFileList
}
const removeReferenceFile = (index: number) => {
  refFileList.value.splice(index, 1)
}

const onDwgParsed = (fileName: string, data: any) => {
  dwgParsedDataMap.value[fileName] = data
}
const onDwgParseError = (fileName: string, _err: any) => {
  console.warn('[SmartReview] DWG parse error:', fileName)
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ===== 表单 =====
const form = reactive({ title: '' })
const rules: FormRules = {
  title: [{ required: true, message: '请输入任务标题', trigger: 'blur' }],
}

// ===== 预分析 =====
const preAnalyzed = ref(false)
const preAnalyzing = ref(false)
const preAnalysisData = reactive({
  contractType: '',
  potentialParties: [] as string[],
  suggestedReviewPoints: [] as string[],
  suggestedCorePurposes: [] as string[],
})

let preAnalyzeTimer: ReturnType<typeof setTimeout> | null = null

// 监听文件列表变化，后台进行预分析（不自动跳转步骤）
watch(fileList, (newList) => {
  if (preAnalyzeTimer) clearTimeout(preAnalyzeTimer)
  if (newList.length > 0) {
    // 标记预分析未完成（因为文件列表变化了）
    preAnalyzed.value = false
    preAnalyzing.value = true
    // 不再自动跳转步骤，保持在当前步骤（上传页面）
    // currentStep.value = 1  // 已移除：由用户主动点击“下一步”按钮触发
    
    // 防抖：文件列表变化后 800ms 触发后台预分析
    preAnalyzeTimer = setTimeout(() => runPreAnalysis(newList), 800)
  } else {
    // 文件列表为空时，重置预分析状态
    preAnalyzed.value = false
    preAnalyzing.value = false
    // 保持在上传步骤
    // currentStep.value = 0  // 已移除：不需要自动跳转
  }
}, { deep: true })

// 使用服务器文件名进行预分析
const runPreAnalysisWithServerFiles = async (serverFiles: Array<{ name: string; size: number }>) => {
  preAnalyzing.value = true
  try {
    const { data } = await preAnalyzeApi(serverFiles)
    applyPreAnalysisData(data)
    preAnalyzed.value = true
    console.log('[SmartReview] 服务器文件预分析成功')
  } catch (e) {
    console.warn('[SmartReview] 服务器文件预分析失败:', e)
    // 不设置 preAnalyzed.value = true，让调用方决定是否降级
    throw e
  } finally {
    preAnalyzing.value = false
  }
}

// 应用预分析数据到界面
const applyPreAnalysisData = (data: any) => {
  console.log('[SmartReview] applyPreAnalysisData 接收到的数据:', JSON.stringify({
    suggestedReviewPoints: data.suggestedReviewPoints,
    suggestedCorePurposes: data.suggestedCorePurposes,
    contractType: data.contractType,
    documentTypeLabel: data.documentTypeLabel,
    recommendations: data.recommendations,
  }, null, 2))
  
  // 应用推荐结果
  if (data.suggestedPerspective) {
    config.perspective = data.suggestedPerspective
  }
  // 兼容两种字段名：contractType 或 documentType
  if (data.contractType) {
    preAnalysisData.contractType = data.contractType
  } else if (data.documentTypeLabel) {
    preAnalysisData.contractType = data.documentTypeLabel
  }
  config.libraryReview = data.recommendations.libraryReview.enabled
  if (data.recommendations.libraryReview.categoryId) {
    config.knowledgeCategoryId = data.recommendations.libraryReview.categoryId
  }
  config.ruleLibrary = data.recommendations.ruleLibrary.enabled
  if (data.recommendations.ruleLibrary.libraryId) {
    config.ruleLibraryId = data.recommendations.ruleLibrary.libraryId
  }
  config.ruleCheck = data.recommendations.generalChecks.ruleCheck.enabled
  config.typoCheck = data.recommendations.generalChecks.typoCheck.enabled
  config.crossFileCheck = data.recommendations.generalChecks.crossFileCheck.enabled

  // 保存推荐理由
  preAnalysisReasons.value = {
    library: data.recommendations.libraryReview.reason,
    ruleLibrary: data.recommendations.ruleLibrary.reason,
    typo: data.recommendations.generalChecks.typoCheck.reason,
    crossFile: data.recommendations.generalChecks.crossFileCheck.reason,
  }

  // 更新预分析数据
  const suggestedPoints = data.suggestedReviewPoints || []
  console.log('[SmartReview] suggestedReviewPoints 长度:', suggestedPoints.length, '内容:', suggestedPoints)
  if (suggestedPoints.length > 0) {
    preAnalysisData.suggestedReviewPoints = suggestedPoints
    allSuggestedReviewPoints.value = [...suggestedPoints]
    selectedReviewPoints.value = [...suggestedPoints]
    console.log('[SmartReview] 已更新审查点为AI生成的值')
  } else {
    console.warn('[SmartReview] suggestedReviewPoints 为空，保持默认值')
  }
  
  const suggestedPurposes = data.suggestedCorePurposes || []
  console.log('[SmartReview] suggestedCorePurposes 长度:', suggestedPurposes.length, '内容:', suggestedPurposes)
  if (suggestedPurposes.length > 0) {
    preAnalysisData.suggestedCorePurposes = suggestedPurposes
    allSuggestedCorePurposes.value = [...suggestedPurposes]
    customPurposes.value = suggestedPurposes.map((p: string) => ({ value: p }))
    console.log('[SmartReview] 已更新核心目的为AI生成的值')
  } else {
    console.warn('[SmartReview] suggestedCorePurposes 为空，保持默认值')
  }
}

const runPreAnalysis = async (files: UploadFile[]) => {
  preAnalyzing.value = true
  try {
    const fileListData = files.map(f => ({ name: f.name, size: f.size || 0 }))
    const { data } = await preAnalyzeApi(fileListData)
    applyPreAnalysisData(data)
    preAnalyzed.value = true
    console.log('[SmartReview] 原始文件预分析成功')
  } catch (e) {
    console.warn('[SmartReview] 原始文件预分析失败:', e)
    // 不设置 preAnalyzed.value = true，让调用方处理
    throw e
  } finally {
    preAnalyzing.value = false
  }
}

// 下一步：进入预审配置
const goToStep1 = async () => {
  console.log('[SmartReview] goToStep1 被调用')
  console.log('[SmartReview] fileList.length:', fileList.value.length)
  console.log('[SmartReview] preAnalyzed.value:', preAnalyzed.value)
  
  if (fileList.value.length === 0) {
    ElMessage.warning('请至少选择一个待审文件')
    return
  }
  
  // 触发预分析（如果还没有分析过）
  if (!preAnalyzed.value) {
    console.log('[SmartReview] 开始预分析流程...')
    let loading: any = null
    try {
      // 显示全屏加载遮罩
      console.log('[SmartReview] 显示加载遮罩...')
      loading = ElLoading.service({
        lock: true,
        text: '正在上传文件并进行AI预分析，请稍候...',
        background: 'rgba(0, 0, 0, 0.7)',
      })
      
      // 使用轻量级上传API（不需要标题），只上传文件获取服务器路径
      console.log('[SmartReview] 开始上传文件...')
      const uploadedFileNames = await uploadFilesForPreAnalysis()
      console.log('[SmartReview] 上传完成，返回文件:', uploadedFileNames)
      
      if (uploadedFileNames && uploadedFileNames.length > 0) {
        // 使用上传后的实际文件名进行预分析
        await runPreAnalysisWithServerFiles(uploadedFileNames)
      } else {
        throw new Error('文件上传返回空列表')
      }
      
      // 预分析完成后，关闭加载遮罩并跳转到步骤2
      loading.close()
      currentStep.value = 1
      ElMessage.success('预分析完成！')
    } catch (err) {
      console.error('[SmartReview] 预分析失败:', err)
      if (loading) loading.close()
      ElMessage.warning('预分析失败，将使用基础配置')
      // 降级：使用原始文件名进行预分析
      try {
        await runPreAnalysis(fileList.value)
      } catch (preErr) {
        console.error('[SmartReview] 降级预分析也失败:', preErr)
      }
      currentStep.value = 1
    }
  } else {
    // 已经预分析过，直接跳转
    currentStep.value = 1
  }
}

// 轻量级文件上传（仅用于预分析，不需要创建任务）
const uploadFilesForPreAnalysis = async (): Promise<Array<{ name: string; size: number }>> => {
  const formData = new FormData()
  
  // 添加待审文件
  for (const file of fileList.value) {
    if (file.raw) {
      formData.append('files', file.raw)
    }
  }
  
  // 添加参照文件（如果有）
  for (const refFile of refFileList.value) {
    if (refFile.raw) {
      formData.append('refFiles', refFile.raw)
    }
  }
  
  // 使用axios调用轻量级上传API
  // 注意：响应拦截器已将 response.data 提取为内部 data 对象（即 { files: [...] }）
  const response = await uploadOnlyApi(formData)
  const { files } = response.data || {}
  
  if (!files || files.length === 0) {
    throw new Error('上传返回空文件列表')
  }
  
  // 返回服务器存储的文件信息
  return files.map((f: any) => ({
    name: f.filePath ? f.filePath.split('/').pop() : f.fileName,
    size: f.fileSize || 0
  }))
}

const preAnalysisReasons = ref<Record<string, string>>({})

// ===== 审查配置 =====
const config = reactive({
  perspective: '',
  libraryReview: true,
  knowledgeCategoryId: '',
  docReview: false,
  ruleLibrary: false,
  ruleLibraryId: '',
  ruleCheck: true,
  typoCheck: false,
  crossFileCheck: false,
})

// 知识库子库列表
const knowledgeCategories = ref<Array<{ id: string; name: string }>>([])

// 规则库列表
const ruleLibraries = ref<Array<{ id: string; name: string }>>([])

// 审查模板列表
const reviewTemplates = ref<Array<{ id: string; name: string }>>([])
const selectedTemplateId = ref('general')

// 审查点和核心目的
const allSuggestedReviewPoints = ref<string[]>([])
const allSuggestedCorePurposes = ref<string[]>([])
const selectedReviewPoints = ref<string[]>([])
const customPurposes = ref<Array<{ value: string }>>([{ value: '' }])

// 监听参照文件上传，自动启用以文审文
watch(refFileList, (newList) => {
  if (newList.length > 0 && !config.docReview) {
    config.docReview = true
  }
})

// ===== 结果展示 =====
const activeAiTab = ref('summary')
const showPlainLanguage = ref(false)
const loading = ref(false)
const loadingMessage = ref('')
const analysisProgress = ref<Array<any>>([])

const visibleAnalysisProgress = computed(() => analysisProgress.value.slice(-6))

const progressStepLabels: Record<string, string> = {
  pre_analysis: '合同预分析',
  extract_text: '提取合同正文',
  knowledge_search: '检索法条与案例',
  llm_review: '生成审查结论',
  finalize: '保存审查结果',
}

const progressStatusLabels: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
}

const progressStepLabel = (step: string) => progressStepLabels[step] || step || '处理中'
const progressStatusLabel = (status: string) => progressStatusLabels[status] || status || '处理中'
const progressStatusClass = (status: string) => {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return 'running'
}

// 审查数据
const reviewData = reactive({
  dispute_points: [] as any[],
  missing_clauses: [] as any[],
  modification_suggestions: [] as any[],
  relevant_laws: [] as any[],
})

// 工具函数
const firstText = (...values: any[]) => values.find(value => typeof value === 'string' && value.trim()) || ''
const joinLines = (...values: any[]) => values.filter(value => typeof value === 'string' && value.trim()).join('\n')

const disputeTitle = (item: any, index: number) => firstText(item.title, item.type, `风险点 ${index + 1}`)
const disputeDescription = (item: any) => firstText(
  item.description,
  joinLines(
    item.original_clause && `原文：${item.original_clause}`,
    item.legal_reference && `法律依据：${item.legal_reference}`,
    item.dispute_rationale && `风险说明：${item.dispute_rationale}`,
  )
)
const missingClauseTitle = (item: any, index: number) => firstText(item.title, item.clause_type, `缺失条款 ${index + 1}`)
const suggestionTitle = (item: any, index: number) => firstText(item.title, item.clause, `修改建议 ${index + 1}`)
const suggestionOriginal = (item: any) => firstText(item.original_text, item.original_clause)
const suggestionText = (item: any) => firstText(item.suggested_text, item.modification)
const suggestionReason = (item: any) => firstText(item.reason, item.rationale)

// 专项审查
const focusedReviewText = ref('')
const focusedReviewQuestion = ref('')
const focusedReviewResult = ref<any>(null)
const focusedReviewLoading = ref(false)

// 批量采纳
const batchSelected = reactive(new Set<number>())
const batchSelectedCount = computed(() => batchSelected.size)
const allSelected = computed(() =>
  reviewData.modification_suggestions.length > 0 &&
  batchSelected.size === reviewData.modification_suggestions.length
)
const batchPartialSelected = computed(() =>
  batchSelected.size > 0 && batchSelected.size < reviewData.modification_suggestions.length
)
const toggleAll = (val: boolean) => {
  if (val) {
    reviewData.modification_suggestions.forEach((_, i) => batchSelected.add(i))
  } else {
    batchSelected.clear()
  }
}
const toggleItem = (index: number) => {
  if (batchSelected.has(index)) {
    batchSelected.delete(index)
  } else {
    batchSelected.add(index)
  }
}
const batchAdopt = () => {
  if (batchSelected.size === 0) {
    ElMessage.warning('请先选择要采纳的建议')
    return
  }
  batchSelected.forEach((i) => {
    const item = reviewData.modification_suggestions[i]
    if (item && !item.adopted) {
      item.adopted = true
    }
  })
  ElMessage.success(`已批量采纳 ${batchSelected.size} 条建议`)
  batchSelected.clear()
}

// ===== 操作函数 =====
const goBackToUpload = () => {
  currentStep.value = 0
  fileList.value = []
  refFileList.value = []
}

const goBackToConfirm = () => {
  currentStep.value = 1
}

const startAnalysis = async () => {
  if (!config.perspective) {
    ElMessage.warning('请选择您的审查立场。')
    return
  }
  loading.value = true
  loadingMessage.value = 'AI正在深度审查文件，这可能需要1-2分钟...'
  try {
    // TODO: 调用后端API开始分析
    await new Promise(resolve => setTimeout(resolve, 2000))
    currentStep.value = 2
    ElMessage.success('分析完成！')
  } catch (err) {
    ElMessage.error('分析失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

const addPurpose = () => {
  customPurposes.value.push({ value: '' })
}

const removePurpose = (index: number) => {
  customPurposes.value.splice(index, 1)
}

const querySearchCorePurposes = (queryString: string, cb: any) => {
  const results = queryString
    ? allSuggestedCorePurposes.value.filter(p => p.toLowerCase().includes(queryString.toLowerCase()))
    : allSuggestedCorePurposes.value
  cb(results.map(p => ({ value: p })))
}

// 采纳预览
const previewDialogVisible = ref(false)
const previewItem = ref<any>(null)

const previewSuggestion = (item: any) => {
  previewItem.value = item
  previewDialogVisible.value = true
}

const adoptFromPreview = () => {
  if (previewItem.value && !previewItem.value.adopted) {
    previewItem.value.adopted = true
    ElMessage.success('已采纳建议')
  }
  previewDialogVisible.value = false
}

const adoptSuggestion = (item: any) => {
  // TODO: 实现采纳功能
  item.adopted = !item.adopted
  ElMessage.success(item.adopted ? '已采纳建议' : '已取消采纳')
}

const exportWord = async () => {
  try {
    // SmartReview中暂无taskId，提示用户先完成审查
    ElMessage.info('导出Word功能在审查结果页面可用，请完成审查后导出')
  } catch (e) {
    ElMessage.error('导出Word失败')
  }
}

const exportExcel = async () => {
  try {
    ElMessage.info('导出Excel功能在审查结果页面可用，请完成审查后导出')
  } catch (e) {
    ElMessage.error('导出Excel失败')
  }
}

const submitFocusedReview = async () => {
  if (!focusedReviewText.value.trim()) return
  focusedReviewLoading.value = true
  try {
    // TODO: 调用后端API进行专项审查
    await new Promise(resolve => setTimeout(resolve, 1500))
    focusedReviewResult.value = {
      risk_summary: '专项审查完成，发现以下风险点...',
      plain_language: '用大白话来说，这段内容存在一些问题...',
      suggested_text: '建议修改为：...',
    }
    ElMessage.success('专项审查完成')
  } catch (err) {
    ElMessage.error('专项审查失败')
  } finally {
    focusedReviewLoading.value = false
  }
}

const canSubmit = computed(() => {
  if (!form.title.trim()) return false
  // 至少启用一种审查方式
  return config.libraryReview || config.docReview || config.ruleLibrary || config.ruleCheck || config.typoCheck || config.crossFileCheck
})

// ===== 提交 =====
const submitting = ref(false)

const submitTask = async () => {
  if (!userStore.token) {
    ElMessage.error('请先登录后再创建任务')
    router.push('/login')
    return
  }

  // 表单验证
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  submitting.value = true
  try {
    const fd = new FormData()
    fd.append('title', form.title)

    // 根据配置确定审查模式
    // Phase 1: 使用 FULL_REVIEW 模式，后续 Phase 2 会改为智能推荐
    let reviewMode = 'FULL_REVIEW'
    if (config.libraryReview && !config.ruleCheck && !config.typoCheck) {
      reviewMode = 'LIBRARY_REVIEW'
    } else if (config.docReview && !config.libraryReview) {
      reviewMode = 'DOC_REVIEW'
    }
    fd.append('reviewMode', reviewMode)

    // 知识库
    if (config.libraryReview && config.knowledgeCategoryId) {
      fd.append('maxkbKnowledgeIds', JSON.stringify([config.knowledgeCategoryId]))
    }

    // 文件
    fileList.value.forEach(f => { if (f.raw) fd.append('files', f.raw) })

    // DWG 解析数据
    if (Object.keys(dwgParsedDataMap.value).length > 0) {
      fd.append('dwgParsedData', JSON.stringify(dwgParsedDataMap.value))
    }

    const { data } = await createTaskApi(fd)
    ElMessage.success('审查任务已创建')
    router.push(`/review/${data.id}`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '创建任务失败')
  } finally {
    submitting.value = false
  }
}

// ===== 初始化 =====
onMounted(async () => {
  try {
    const [catRes, libRes] = await Promise.all([
      getAllKnowledgeCategoriesApi(),
      getRuleLibrariesApi(),
    ])
    knowledgeCategories.value = (catRes.data || []).map((c: any) => ({ id: c.id, name: c.name }))
    ruleLibraries.value = (libRes.data || []).map((l: any) => ({ id: l.id, name: l.name }))
    
    // TODO: 加载审查模板列表
    reviewTemplates.value = [
      { id: 'general', name: '通用审查模板' },
      { id: 'service', name: '服务/采购合同审查模板' },
    ]
  } catch (e) {
    console.warn('[SmartReview] 加载知识库/规则库列表失败:', e)
  }
})
</script>

<style scoped>
/* 步骤条 - 参考项目风格 */
.step-header {
  background: white;
  border-radius: 8px;
  padding: 12px 20px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #9CA3AF;
  transition: all 0.3s;
}

.step-item.active {
  color: #3B82F6;
}

.step-item.completed {
  color: #10B981;
}

.step-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid currentColor;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  transition: all 0.3s;
}

.step-item.active .step-circle {
  background: #3B82F6;
  border-color: #3B82F6;
  color: white;
}

.step-item.completed .step-circle {
  background: #10B981;
  border-color: #10B981;
  color: white;
}

.step-label {
  font-size: 13px;
  font-weight: 600;
}

.step-line {
  flex: 1;
  max-width: 60px;
  height: 2px;
  background: #E5E7EB;
  transition: all 0.3s;
}

.step-line.active {
  background: #3B82F6;
}

/* 主容器 */
.smart-review {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 20px;
}

/* 上传步骤 */
.upload-step {
  text-align: center;
}

.step-title {
  margin-bottom: 20px;
}

.page-title {
  font-size: 28px;
  font-weight: 800;
  color: #111827;
  margin: 0 0 6px;
}

.page-subtitle {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
}

.upload-container {
  max-width: 800px;
  margin: 0 auto;
}

/* 待审文件上传区域 */
.primary-upload-section {
  margin-bottom: 20px;
}

/* 参考文件上传区域 */
.reference-upload-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 2px dashed #E5E7EB;
}

/* 区域标题 */
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 12px;
}

.section-description {
  font-size: 13px;
  color: #6B7280;
  margin: 0 0 12px;
  line-height: 1.5;
}

/* 参考文件上传区 */
.reference-upload :deep(.el-upload-dragger) {
  padding: 24px 20px;
  border-radius: 10px;
  border: 2px dashed #D1D5DB;
  background: #F9FAFB;
  transition: all 0.15s;
}

.reference-upload :deep(.el-upload-dragger:hover) {
  border-color: #10B981;
  background: #F0FDF4;
}

.reference-upload .upload-icon {
  color: #6B7280;
}

/* 文件列表区域 */
.file-list-section {
  margin-top: 12px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
  transition: all 0.15s;
}

.file-item:hover {
  border-color: #3B82F6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.file-item.reference-file {
  background: #F9FAFB;
  border-color: #D1D5DB;
}

.file-item.reference-file:hover {
  border-color: #10B981;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.1);
}

.file-icon {
  color: #3B82F6;
  font-size: 18px;
}

.file-item.reference-file .file-icon {
  color: #10B981;
}

.file-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 11px;
  color: #9CA3AF;
  flex-shrink: 0;
}

/* 步骤操作按钮 */
.step-actions {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

/* 上传拖拽区 */
.upload-dragger :deep(.el-upload-dragger) {
  padding: 36px 20px;
  border-radius: 10px;
  border: 2px dashed #E5E7EB;
  background: #FAFAFA;
  transition: all 0.15s;
}

.upload-dragger :deep(.el-upload-dragger:hover) {
  border-color: #3B82F6;
  background: #EFF6FF;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upload-icon {
  color: #9CA3AF;
}

.upload-text {
  font-size: 15px;
  color: #6B7280;
}

.upload-link {
  font-weight: 700;
  color: #3B82F6;
  cursor: pointer;
}

.upload-hint {
  font-size: 12px;
  color: #9CA3AF;
  margin: 0;
}

/* 确认步骤 */
.confirm-step {
  max-width: 1000px;
  margin: 0 auto;
}

.upload-success {
  text-align: center;
  margin-bottom: 32px;
}

.success-text {
  font-size: 16px;
  color: #111827;
  margin: 0 0 8px;
}

.file-name {
  font-weight: 700;
  color: #3B82F6;
}

.ai-hint {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
}

.type-text {
  font-weight: 700;
  color: #111827;
}

/* 配置网格 */
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

.config-panel {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.config-panel .panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 8px;
}

.config-panel .panel-desc {
  font-size: 14px;
  color: #6B7280;
  margin: 0 0 16px;
}

.select-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 8px;
}

.config-panel .panel-actions {
  margin-top: 24px;
  justify-content: flex-end;
}

/* 审查选项面板 */
.review-options-panel {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
  margin-bottom: 24px;
}

.review-options-panel .panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 20px;
}

.review-points-section {
  margin-bottom: 24px;
}

.section-label {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 12px;
}

.review-points-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.review-points-group :deep(.el-checkbox) {
  margin-right: 0;
}

.review-purposes-section .purpose-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.remove-btn {
  color: #EF4444;
  padding: 4px;
}

.add-purpose-btn {
  margin-top: 8px;
  color: #3B82F6;
}

/* 预分析配置 */
.pre-analysis-config {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.pre-analysis-config .panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 20px;
}

.config-item {
  padding: 16px 0;
  border-bottom: 1px solid #F0F0F0;
}

.config-item:last-child {
  border-bottom: none;
}

.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.config-checkbox {
  flex: 1;
}

.config-name {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.config-body {
  margin-top: 12px;
}

.config-reason {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  font-size: 14px;
  color: #6B7280;
  line-height: 1.5;
}

.config-reason .el-icon {
  color: #3B82F6;
  margin-top: 2px;
  flex-shrink: 0;
}

.general-checks {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.general-checks .el-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.check-desc {
  display: block;
  font-size: 12px;
  color: #9CA3AF;
  margin-top: 2px;
}

.pre-analyzing {
  padding: 24px;
}

/* 审查步骤 */
.review-step {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #E5E7EB;
}

.review-title {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.review-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-tabs {
  padding: 24px;
}

.tab-content h3 {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 16px;
}

.issues-list, .suggestions-list, .laws-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.batch-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #F0F7FF;
  border: 1px solid #BAE0FF;
  border-radius: 8px;
  margin-bottom: 16px;
}

.issue-card, .suggestion-card, .law-card {
  padding: 16px;
  background: #FAFAFA;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.suggestion-card.batch-selected {
  border-color: #1890FF;
  box-shadow: 0 0 0 1px rgba(24, 144, 255, 0.2);
}

.suggestion-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.issue-title, .suggestion-title, .law-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 8px;
}

.issue-desc, .law-clause, .law-content {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
  line-height: 1.6;
}

/* 大白话模式 */
.plain-language-box {
  margin-top: 12px;
  padding: 12px;
  background: #F0FDF4;
  border-radius: 8px;
  border-left: 4px solid #10B981;
}

.plain-label {
  font-size: 12px;
  font-weight: 700;
  color: #15803D;
  margin: 0 0 4px;
}

.plain-text {
  font-size: 14px;
  color: #15803D;
  margin: 0;
  line-height: 1.6;
}

/* 详细模式 */
.detail-mode {
  margin-top: 12px;
}

.detail-item {
  margin-bottom: 12px;
}

.detail-label {
  font-size: 12px;
  font-weight: 600;
  color: #6B7280;
  margin: 0 0 4px;
}

.detail-quote {
  padding: 12px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

.detail-quote.original {
  background: #FEF2F2;
  border-left: 4px solid #EF4444;
  color: #991B1B;
}

.detail-quote.suggested {
  background: #F0FDF4;
  border-left: 4px solid #10B981;
  color: #15803D;
}

.detail-reason {
  font-size: 14px;
  color: #374151;
  margin: 0;
  line-height: 1.6;
}

.suggestion-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #E5E7EB;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.workspace-section {
  margin-bottom: 24px;
}

.workspace-actions {
  margin-top: 12px;
}

.focused-result {
  padding: 16px;
  background: #FAFAFA;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
}

.result-summary {
  font-size: 14px;
  color: #374151;
  margin: 12px 0;
  line-height: 1.6;
}

.suggested-text-box {
  margin-top: 12px;
}

.suggested-text {
  padding: 12px;
  background: #F0FDF4;
  border-radius: 6px;
  font-size: 14px;
  color: #15803D;
  line-height: 1.6;
  margin: 8px 0 0;
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: #9CA3AF;
  font-size: 14px;
}

/* 加载遮罩 */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  border: 1px solid #E5E7EB;
  max-width: 480px;
  width: 100%;
}

.loading-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 16px;
  text-align: center;
}

.analysis-progress-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px;
  border-radius: 6px;
}

.progress-step--running {
  background: #EFF6FF;
}

.progress-step--completed {
  background: #F0FDF4;
}

.progress-step--failed {
  background: #FEF2F2;
}

.progress-marker {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.progress-step--running .progress-marker {
  background: #3B82F6;
  color: white;
}

.progress-step--completed .progress-marker {
  background: #10B981;
  color: white;
}

.progress-step--failed .progress-marker {
  background: #EF4444;
  color: white;
}

.progress-info {
  flex: 1;
}

.progress-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.progress-status {
  font-size: 12px;
  font-weight: 500;
  color: #6B7280;
}

.progress-message {
  font-size: 12px;
  color: #6B7280;
  margin: 4px 0 0;
}

/* 采纳预览对话框 */
.preview-compare {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.preview-panel {
  flex: 1;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #E5E7EB;
}

.preview-panel-header {
  padding: 8px 12px;
  background: #F9FAFB;
  border-bottom: 1px solid #E5E7EB;
}

.preview-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 4px;
}

.badge-before {
  background: #FEF2F2;
  color: #DC2626;
}

.badge-after {
  background: #F0FDF4;
  color: #16A34A;
}

.preview-panel-body {
  padding: 14px;
  font-size: 14px;
  line-height: 1.7;
  color: #374151;
}

.preview-before .preview-panel-body {
  background: #FEF2F2;
}

.preview-after .preview-panel-body {
  background: #F0FDF4;
}

.preview-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: #9CA3AF;
  min-width: 40px;
  padding-top: 40px;
}
</style>
