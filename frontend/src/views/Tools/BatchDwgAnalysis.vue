<template>
  <div class="batch-dwg-page">
    <!-- 页面头部 -->
    <div class="page-hero">
      <div class="hero-left">
        <div class="hero-icon">
          <el-icon :size="26"><Files /></el-icon>
        </div>
        <div class="hero-text">
          <h2>图纸批量视觉分析</h2>
          <p>批量上传多张 DWG 图纸，并行执行视觉智能分析，统一查看结果</p>
        </div>
      </div>
      <div class="hero-right">
        <el-button plain @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回单图分析
        </el-button>
      </div>
    </div>

    <!-- 上传区 -->
    <el-card class="upload-card" shadow="never">
      <el-upload
        ref="uploadRef"
        :auto-upload="false"
        multiple
        :limit="10"
        accept=".dwg"
        :on-change="handleFileAdd"
        :on-remove="handleFileRemove"
        :file-list="fileList"
        drag
        class="batch-upload"
      >
        <div class="upload-inner">
          <el-icon class="upload-icon"><UploadFilled /></el-icon>
          <div class="upload-text">拖拽多个 DWG 文件到此处，或 <em>点击选择</em></div>
          <div class="upload-hint">支持 .dwg 格式 · 单文件不超过 50MB · 最多 10 个文件</div>
        </div>
      </el-upload>

      <!-- 分析维度选择 -->
      <div class="batch-options">
        <div class="options-label">分析维度</div>
        <el-checkbox-group v-model="selectedAnalyses" :min="1">
          <el-checkbox value="titleBlock">标题栏识别</el-checkbox>
          <el-checkbox value="symbols">图例符号识别</el-checkbox>
          <el-checkbox value="annotations">标注完整性</el-checkbox>
          <el-checkbox value="compliance">合规审查</el-checkbox>
          <el-checkbox value="profession">专业审查</el-checkbox>
        </el-checkbox-group>
      </div>

      <!-- 开始分析按钮 -->
      <div class="batch-actions">
        <el-button
          type="primary"
          size="large"
          :disabled="fileList.length === 0 || selectedAnalyses.length === 0 || analyzing"
          :loading="analyzing"
          @click="startBatchAnalysis"
        >
          <el-icon style="margin-right:6px"><VideoPlay /></el-icon>
          开始批量分析（{{ fileList.length }} 个文件）
        </el-button>
        <el-button v-if="analyzing" plain @click="cancelAnalysis = true">
          取消
        </el-button>
      </div>
    </el-card>

    <!-- 进度区 -->
    <el-card v-if="analyzing || progressItems.length > 0" class="progress-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>分析进度</span>
          <el-tag v-if="analyzing" type="warning" size="small">进行中</el-tag>
          <el-tag v-else type="success" size="small">已完成</el-tag>
        </div>
      </template>
      <div class="progress-list">
        <div v-for="item in progressItems" :key="item.id" class="progress-item">
          <div class="progress-item-header">
            <el-icon><Document /></el-icon>
            <span class="progress-filename" :title="item.fileName">{{ item.fileName }}</span>
            <el-tag :type="progressTagType(item.status)" size="small">
              {{ progressStatusLabel(item.status) }}
            </el-tag>
          </div>
          <el-progress
            v-if="item.status === 'analyzing'"
            :percentage="50"
            :indeterminate="true"
            :show-text="false"
            :stroke-width="4"
          />
          <div v-if="item.status === 'success'" class="progress-result">
            <span class="result-stat">耗时 {{ (item.duration / 1000).toFixed(1) }}s</span>
            <span class="result-stat">{{ item.issueCount }} 项问题</span>
          </div>
          <div v-if="item.status === 'failed'" class="progress-error">
            <el-icon><WarningFilled /></el-icon>
            <span>{{ item.error }}</span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 结果列表 -->
    <el-card v-if="resultItems.length > 0" class="result-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>分析结果（共 {{ resultItems.length }} 个文件）</span>
          <div>
            <el-button size="small" type="warning" plain :disabled="selectedResultIds.length < 2" @click="goCrossCompare">
              <el-icon style="margin-right:3px"><Connection /></el-icon>
              跨文件比对 ({{ selectedResultIds.length }})
            </el-button>
          </div>
        </div>
      </template>
      <el-table :data="resultItems" border size="default" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="42" />
        <el-table-column label="文件名" prop="fileName" min-width="200" show-overflow-tooltip />
        <el-table-column label="耗时" width="80">
          <template #default="{ row }">{{ (row.duration / 1000).toFixed(1) }}s</template>
        </el-table-column>
        <el-table-column label="问题数" width="80">
          <template #default="{ row }">
            <el-tag :type="row.issueCount > 0 ? 'danger' : 'success'" size="small">
              {{ row.issueCount }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="维度" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="a in row.analyses" :key="a" size="small" effect="plain" style="margin-right:3px">
              {{ analysisLabelMap[a] || a }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="自动判定专业" width="120">
          <template #default="{ row }">
            <span v-if="row.detectedProfession">{{ professionLabelMap[row.detectedProfession] || row.detectedProfession }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="viewDetail(row.recordId)">
              查看详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Files, ArrowLeft, UploadFilled, VideoPlay, Document, WarningFilled, Connection,
} from '@element-plus/icons-vue'
import { dwgToPng } from '@/utils/dwg-parser'
import { analyzeDwgVision, type DwgProfession, type VisionAnalyzeResult } from '@/api/dwg-vision'

const router = useRouter()

// 文件列表
const fileList = ref<File[]>([])
const uploadRef = ref()

// 分析维度
const selectedAnalyses = ref<string[]>(['titleBlock', 'annotations', 'compliance'])

// 分析状态
const analyzing = ref(false)
const cancelAnalysis = ref(false)

// 进度项
interface ProgressItem {
  id: string
  fileName: string
  status: 'pending' | 'analyzing' | 'success' | 'failed'
  duration?: number
  issueCount?: number
  error?: string
  recordId?: string
  analyses?: string[]
  detectedProfession?: DwgProfession
}
const progressItems = ref<ProgressItem[]>([])

// 结果项（分析成功的）
const resultItems = computed(() => progressItems.value.filter(i => i.status === 'success'))

// 选中的结果（用于跨文件比对）
const selectedResultIds = ref<string[]>([])

// 维度标签映射
const analysisLabelMap: Record<string, string> = {
  titleBlock: '标题栏',
  symbols: '符号',
  annotations: '标注',
  compliance: '合规',
  profession: '专业',
  frameCheck: '图框',
}

// 专业标签映射
const professionLabelMap: Record<DwgProfession, string> = {
  building: '建筑',
  structural: '结构',
  plumbing: '给排水',
  hvac: '暖通',
  electrical: '电气',
  process: '工艺',
  nuclear: '核电',
}

// 文件操作
function handleFileAdd(uploadFile: any) {
  const file = uploadFile.raw as File
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.dwg')) {
    ElMessage.warning(`${file.name} 不是 DWG 文件，已跳过`)
    return
  }
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.warning(`${file.name} 超过 50MB，已跳过`)
    return
  }
  // 去重
  if (fileList.value.some(f => f.name === file.name && f.size === file.size)) {
    ElMessage.info(`${file.name} 已存在`)
    return
  }
  fileList.value.push(file)
}

function handleFileRemove(uploadFile: any) {
  const name = uploadFile.name
  fileList.value = fileList.value.filter(f => f.name !== name)
}

// 进度状态标签
function progressStatusLabel(status: ProgressItem['status']): string {
  return { pending: '等待中', analyzing: '分析中', success: '完成', failed: '失败' }[status]
}

function progressTagType(status: ProgressItem['status']): 'info' | 'warning' | 'success' | 'danger' {
  return { pending: 'info', analyzing: 'warning', success: 'success', failed: 'danger' }[status]
}

// 计算 issue 数量
function countIssues(result: VisionAnalyzeResult): number {
  let count = 0
  if (result.annotations?.missingItems) count += result.annotations.missingItems.length
  if (result.compliance?.issues) count += result.compliance.issues.length
  if (result.profession?.issues) count += result.profession.issues.length
  if (result.frameCheck?.issues) count += result.frameCheck.issues.length
  if (result.ruleIssues) count += result.ruleIssues.length
  if (result.crossDimensionIssues) count += result.crossDimensionIssues.length
  return count
}

// 批量分析
async function startBatchAnalysis() {
  if (fileList.value.length === 0) {
    ElMessage.warning('请先选择文件')
    return
  }
  if (selectedAnalyses.value.length === 0) {
    ElMessage.warning('请至少选择一个分析维度')
    return
  }

  analyzing.value = true
  cancelAnalysis.value = false

  // 初始化进度项
  progressItems.value = fileList.value.map((f, i) => ({
    id: `${i}-${f.name}`,
    fileName: f.name,
    status: 'pending',
  }))

  ElMessage.info(`开始批量分析 ${fileList.value.length} 个文件...`)

  // 并行分析（Promise.allSettled，不因单个失败中断）
  const tasks = fileList.value.map(async (file, index) => {
    if (cancelAnalysis.value) return

    progressItems.value[index].status = 'analyzing'

    try {
      // DWG → PNG
      const imageBase64 = await dwgToPng(file)

      // 调用分析 API
      const res = await analyzeDwgVision({
        imageBase64,
        fileName: file.name,
        analyses: selectedAnalyses.value,
        // 批量模式不传 profession，让后端自动判定（如有 profession 维度）
        profession: undefined,
      })

      if (res.code === 200 && res.data) {
        const result = res.data
        progressItems.value[index].status = 'success'
        progressItems.value[index].duration = result.duration_ms
        progressItems.value[index].issueCount = countIssues(result)
        progressItems.value[index].analyses = selectedAnalyses.value
        progressItems.value[index].detectedProfession = result.detectedProfession
        // 从历史记录 API 获取 recordId（analyzeDwgVision 返回的 result 没有 recordId，
        // 但后端已落库，可通过 imageHash 查询。这里简化：不直接获取 recordId，
        // 而是在"查看详情"时跳转到单图分析页 + 触发历史记录回放）
        progressItems.value[index].recordId = undefined
      } else {
        progressItems.value[index].status = 'failed'
        progressItems.value[index].error = res.message || '分析失败'
      }
    } catch (err: any) {
      progressItems.value[index].status = 'failed'
      progressItems.value[index].error = err?.message || '未知错误'
    }
  })

  await Promise.allSettled(tasks)

  analyzing.value = false
  const successCount = progressItems.value.filter(i => i.status === 'success').length
  const failCount = progressItems.value.filter(i => i.status === 'failed').length
  ElMessage.success(`批量分析完成：${successCount} 成功，${failCount} 失败`)
}

// 选中结果变化
function handleSelectionChange(rows: ProgressItem[]) {
  selectedResultIds.value = rows.map(r => r.id)
}

// 跳转跨文件比对
function goCrossCompare() {
  // 跨文件比对需要 recordId，但批量分析结果没有 recordId
  // 跳转到单图分析页，让用户从历史记录选
  ElMessage.info('请前往单图分析页的历史记录中选多条做跨文件比对')
  router.push('/dwg-vision')
}

// 查看详情
function viewDetail(recordId?: string) {
  // 跳转到单图分析页（recordId 可后续通过历史记录回放）
  router.push({
    path: '/dwg-vision',
    query: recordId ? { recordId } : undefined,
  })
}

// 返回单图分析
function goBack() {
  router.push('/dwg-vision')
}
</script>

<style scoped>
.batch-dwg-page {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hero-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: linear-gradient(135deg, #7c3aed, #a855f7);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-text h2 {
  margin: 0;
  font-size: 20px;
  color: #1e293b;
}

.hero-text p {
  margin: 2px 0 0;
  font-size: 13px;
  color: #64748b;
}

.upload-card {
  margin-bottom: 16px;
}

.batch-upload :deep(.el-upload-dragger) {
  padding: 32px 20px;
}

.upload-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upload-icon {
  font-size: 40px;
  color: #7c3aed;
}

.upload-text {
  font-size: 14px;
  color: #475569;
}

.upload-hint {
  font-size: 12px;
  color: #94a3b8;
}

.batch-options {
  margin-top: 16px;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: 8px;
}

.options-label {
  font-size: 13px;
  color: #475569;
  margin-bottom: 8px;
  font-weight: 500;
}

.batch-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}

.progress-card,
.result-card {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.progress-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-item {
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.progress-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.progress-filename {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-result {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #16a34a;
}

.progress-error {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #dc2626;
}
</style>
