<template>
  <div class="smart-review">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">智能审查</h2>
      <p class="page-desc">上传文件，系统智能推荐最佳审查方案</p>
    </div>

    <!-- 上传区域 -->
    <div class="section-card">
      <div class="section-title">
        <el-icon><Upload /></el-icon>
        <span>上传文件</span>
      </div>

      <el-form :model="form" :rules="rules" ref="formRef" label-position="top">
        <el-form-item label="任务标题" prop="title">
          <el-input v-model="form.title" placeholder="请输入任务标题，如：XX项目设计文件审查" size="large" />
        </el-form-item>

        <el-form-item label="待审文件" prop="files">
          <el-upload
            class="upload-area"
            drag
            multiple
            :auto-upload="false"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            :file-list="fileList"
            accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx"
          >
            <el-icon :size="48" color="var(--color-primary-300)"><UploadFilled /></el-icon>
            <p class="upload-text">拖拽文件到此处，或 <em>点击浏览</em></p>
            <template #tip>
              <div class="upload-hints">
                支持格式：DWG / Word / Excel / PDF / PPT &middot; 最多 50 个文件 &middot; 建议不超过 50MB
              </div>
            </template>
          </el-upload>
          <div v-if="fileList.length > 0" class="upload-summary">
            <el-icon color="var(--color-success)" :size="16"><Check /></el-icon>
            已选 <strong>{{ fileList.length }}</strong> 个文件，共 <strong>{{ formatFileSize(totalFileSize) }}</strong>
          </div>
          <!-- DWG WASM 静默解析 -->
          <DwgPreview
            v-for="dwgFile in dwgPreviewFiles"
            :key="dwgFile.uid"
            :file="dwgFile.raw"
            :silent="true"
            @parsed="onDwgParsed(dwgFile.name, $event)"
            @error="onDwgParseError(dwgFile.name, $event)"
          />
        </el-form-item>

        <el-form-item label="参照文件（可选）">
          <el-upload
            class="upload-area ref-upload"
            drag
            multiple
            :auto-upload="false"
            :on-change="handleRefFileChange"
            :on-remove="handleRefFileRemove"
            :file-list="refFileList"
            accept=".doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx"
          >
            <div class="ref-upload-inner">
              <el-icon :size="32"><UploadFilled /></el-icon>
              <p class="upload-text">上传参照文件用于比对审查</p>
              <span class="ref-hint">支持 Word、Excel、PDF、PPT</span>
            </div>
          </el-upload>
        </el-form-item>
      </el-form>
    </div>

    <!-- 预分析区域（上传文件后显示） -->
    <div v-if="fileList.length > 0" class="section-card">
      <div class="section-title">
        <el-icon><MagicStick /></el-icon>
        <span>智能推荐</span>
        <el-tag v-if="!preAnalyzed" type="info" size="small" effect="plain">分析中...</el-tag>
        <el-tag v-else type="success" size="small" effect="plain">已分析</el-tag>
      </div>

      <div v-if="!preAnalyzed" class="pre-analyzing">
        <el-skeleton :rows="3" animated />
      </div>

      <div v-else class="review-config">
        <!-- 审查立场 -->
        <div class="config-item">
          <div class="config-label">审查立场（可选）</div>
          <el-select v-model="config.perspective" placeholder="选择审查立场" clearable style="width: 100%">
            <el-option label="建设方" value="builder" />
            <el-option label="施工方" value="contractor" />
            <el-option label="监理方" value="supervisor" />
            <el-option label="设计方" value="designer" />
          </el-select>
          <div class="config-hint">选择立场后，审查将侧重该角色关注的风险点</div>
        </div>

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
            <div class="config-reason">
              <el-icon><InfoFilled /></el-icon>
              检测到文件包含标准编号引用，推荐使用知识库审查
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
            <div class="config-reason">
              <el-icon><InfoFilled /></el-icon>
              识别为特定文档类型，推荐匹配的规则库
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

    <!-- 提交按钮 -->
    <div v-if="fileList.length > 0 && preAnalyzed" class="submit-section">
      <el-button
        type="primary"
        size="large"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submitTask"
      >
        <el-icon><VideoPlay /></el-icon>
        开始审查
      </el-button>
      <span v-if="!canSubmit" class="submit-hint">请填写任务标题并启用至少一种审查方式</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadFile, FormInstance, FormRules } from 'element-plus'
import {
  Upload, UploadFilled, Check, MagicStick, InfoFilled, VideoPlay,
} from '@element-plus/icons-vue'
import { createTaskApi } from '@/api/task'
import { useUserStore } from '@/stores/user'
import DwgPreview from '@/components/DwgPreview.vue'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref<FormInstance>()

// ===== 文件上传 =====
const fileList = ref<UploadFile[]>([])
const refFileList = ref<UploadFile[]>([])
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
const handleRefFileChange = (_file: UploadFile, newFileList: UploadFile[]) => {
  refFileList.value = newFileList
}
const handleRefFileRemove = (_file: UploadFile, newFileList: UploadFile[]) => {
  refFileList.value = newFileList
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

// ===== 预分析（Phase 1 为 mock）=====
const preAnalyzed = ref(false)
let preAnalyzeTimer: ReturnType<typeof setTimeout> | null = null

watch(fileList, (newList) => {
  if (preAnalyzeTimer) clearTimeout(preAnalyzeTimer)
  if (newList.length > 0) {
    preAnalyzed.value = false
    // Phase 1: mock 预分析（2秒后显示推荐）
    preAnalyzeTimer = setTimeout(() => {
      preAnalyzed.value = true
    }, 2000)
  } else {
    preAnalyzed.value = false
  }
}, { deep: true })

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

// 知识库子库列表（Phase 1 为 mock 数据）
const knowledgeCategories = ref([
  { id: '1', name: '核电设计规范库' },
  { id: '2', name: '新闻稿写作规范库' },
  { id: '3', name: '申报书模板库' },
  { id: '4', name: '规格书标准库' },
])

// 规则库列表（Phase 1 为 mock 数据）
const ruleLibraries = ref([
  { id: '1', name: '新闻稿规则库' },
  { id: '2', name: '合同审查规则库' },
  { id: '3', name: '申报书规则库' },
])

// 监听参照文件上传，自动启用以文审文
watch(refFileList, (newList) => {
  if (newList.length > 0 && !config.docReview) {
    config.docReview = true
  }
})

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
onMounted(() => {
  // Phase 2: 加载真实的知识库子库和规则库列表
})
</script>

<style scoped>
.smart-review {
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--corp-text-primary);
  margin: 0 0 4px;
}

.page-desc {
  font-size: 14px;
  color: var(--corp-text-secondary);
  margin: 0;
}

.section-card {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 20px;
}

.section-title .el-icon {
  font-size: 20px;
  color: var(--corp-primary);
}

/* 上传区域 */
.upload-area :deep(.el-upload-dragger) {
  padding: 32px 20px;
  border-radius: 8px;
}

.upload-text {
  font-size: 14px;
  color: var(--corp-text-secondary);
  margin: 8px 0 0;
}

.upload-text em {
  color: var(--corp-primary);
  font-style: normal;
  font-weight: 500;
}

.upload-hints {
  font-size: 12px;
  color: var(--corp-text-placeholder);
  margin-top: 8px;
}

.upload-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--corp-text-secondary);
}

.ref-upload :deep(.el-upload-dragger) {
  padding: 20px;
  background: var(--color-primary-50);
  border-color: var(--color-primary-200);
}

.ref-upload-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.ref-hint {
  font-size: 12px;
  color: var(--corp-text-placeholder);
}

/* 预分析 */
.pre-analyzing {
  padding: 12px 0;
}

/* 审查配置 */
.review-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-item {
  padding: 16px;
  background: var(--color-gray-50);
  border-radius: 8px;
  border: 1px solid var(--corp-border-light);
}

.config-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--corp-text-primary);
  margin-bottom: 8px;
}

.config-hint {
  font-size: 12px;
  color: var(--corp-text-placeholder);
  margin-top: 6px;
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
  font-size: 14px;
  font-weight: 500;
  color: var(--corp-text-primary);
}

.config-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--corp-border-light);
}

.config-reason {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: var(--corp-text-secondary);
  line-height: 1.5;
}

.config-reason .el-icon {
  color: var(--corp-primary);
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
  color: var(--corp-text-placeholder);
  margin-top: 2px;
}

/* 提交区域 */
.submit-section {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
}

.submit-section .el-button {
  min-width: 160px;
  height: 44px;
  font-size: 16px;
}

.submit-hint {
  font-size: 13px;
  color: var(--corp-text-placeholder);
}
</style>
