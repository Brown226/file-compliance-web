<template>
  <div class="dwg-vision-page">
    <div class="page-header">
      <h2>图纸视觉智能分析</h2>
      <p class="subtitle">基于视觉大模型，对 CAD 图纸进行标题栏识别、图例符号识别、标注完整性检查和设计说明合规审查</p>
    </div>

    <div class="page-body">
      <!-- 左侧：上传与控制 -->
      <div class="left-panel">
        <el-card shadow="never">
          <template #header>
            <span>上传图纸</span>
          </template>

          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="1"
            accept=".dwg"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            drag
          >
            <el-icon class="el-icon--upload"><Upload /></el-icon>
            <div class="el-upload__text">拖拽 DWG 文件到此处，或 <em>点击选择</em></div>
            <template #tip>
              <div class="el-upload__tip">仅支持 .dwg 格式，文件大小不超过 50MB</div>
            </template>
          </el-upload>

          <!-- SVG 预览缩略图 -->
          <div v-if="previewSvg" class="svg-preview">
            <div class="preview-label">图纸预览</div>
            <div class="preview-canvas" v-html="previewSvg"></div>
          </div>
        </el-card>

        <el-card shadow="never" class="options-card">
          <template #header>
            <span>分析选项</span>
          </template>

          <el-checkbox-group v-model="selectedAnalyses">
            <el-checkbox label="titleBlock" value="titleBlock">标题栏/图签识别</el-checkbox>
            <el-checkbox label="symbols" value="symbols">图例符号识别</el-checkbox>
            <el-checkbox label="annotations" value="annotations">标注完整性检查</el-checkbox>
            <el-checkbox label="compliance" value="compliance">设计说明合规审查</el-checkbox>
          </el-checkbox-group>

          <!-- 合规审查参考条文 -->
          <div v-if="selectedAnalyses.includes('compliance')" class="ref-section">
            <el-input
              v-model="refText"
              type="textarea"
              :rows="4"
              placeholder="（可选）粘贴需要对照的标准条文/规范要求，用于合规性比对"
            />
          </div>

          <el-button
            type="primary"
            :loading="analyzing"
            :disabled="!dwgFile || selectedAnalyses.length === 0"
            class="analyze-btn"
            @click="startAnalysis"
          >
            {{ analyzing ? '分析中...' : '开始分析' }}
          </el-button>

          <!-- 进度提示 -->
          <div v-if="analyzing" class="progress-hint">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>正在调用视觉模型分析，请耐心等待（约 1-2 分钟）...</span>
          </div>

          <!-- 视觉模型状态 -->
          <div v-if="visionStatus && !visionStatus.configured" class="config-warning">
            <el-alert type="warning" :closable="false" show-icon
              title="视觉模型未配置"
              description="请在 系统管理 → AI配置 中配置视觉模型后再使用此功能"
            />
          </div>
        </el-card>
      </div>

      <!-- 右侧：分析结果 -->
      <div class="right-panel">
        <el-card v-if="!result && !analyzing" shadow="never" class="empty-card">
          <el-empty description="上传 DWG 图纸并点击「开始分析」查看结果" />
        </el-card>

        <el-card v-else shadow="never" class="result-card">
          <template #header>
            <div class="result-header">
              <span>分析结果</span>
              <el-tag v-if="result" size="small" type="info">耗时 {{ (result.duration_ms / 1000).toFixed(1) }}s</el-tag>
            </div>
          </template>

          <!-- 错误提示 -->
          <el-alert
            v-if="result && result.errors.length > 0"
            type="error"
            :closable="false"
            class="error-alert"
          >
            <template #title>部分分析项失败</template>
            <ul>
              <li v-for="(err, i) in result.errors" :key="i">{{ err }}</li>
            </ul>
          </el-alert>

          <el-tabs v-model="activeTab" v-if="result">
            <!-- 标题栏 -->
            <el-tab-pane label="标题栏" name="titleBlock" v-if="result.titleBlock">
              <div class="title-block-grid">
                <div class="tb-item"><span class="tb-label">图号</span><span class="tb-value">{{ result.titleBlock.drawingNo || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">图名</span><span class="tb-value">{{ result.titleBlock.title || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">版本</span><span class="tb-value">{{ result.titleBlock.revision || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">比例</span><span class="tb-value">{{ result.titleBlock.scale || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">设计</span><span class="tb-value">{{ result.titleBlock.designer || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">校核</span><span class="tb-value">{{ result.titleBlock.checker || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">审核</span><span class="tb-value">{{ result.titleBlock.reviewer || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">批准</span><span class="tb-value">{{ result.titleBlock.approver || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">日期</span><span class="tb-value">{{ result.titleBlock.date || '—' }}</span></div>
                <div class="tb-item"><span class="tb-label">单位</span><span class="tb-value">{{ result.titleBlock.company || '—' }}</span></div>
              </div>
            </el-tab-pane>

            <!-- 图例符号 -->
            <el-tab-pane label="图例符号" name="symbols" v-if="result.symbols">
              <div class="symbols-summary">{{ result.symbols.summary }}</div>
              <el-table :data="result.symbols.symbols" stripe size="small" max-height="500">
                <el-table-column prop="tag" label="位号" width="120" />
                <el-table-column prop="type" label="类型" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="symbolTypeTag(row.type)">{{ symbolTypeLabel(row.type) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="description" label="描述" />
                <el-table-column prop="position" label="位置" width="140" />
              </el-table>
              <div class="total-count">共识别 {{ result.symbols.totalCount }} 个图例符号</div>
            </el-tab-pane>

            <!-- 标注完整性 -->
            <el-tab-pane label="标注检查" name="annotations" v-if="result.annotations">
              <div class="score-section">
                <span>完整性评分：</span>
                <el-progress
                  :percentage="result.annotations.completenessScore"
                  :color="scoreColor(result.annotations.completenessScore)"
                  :stroke-width="18"
                  style="width: 300px; display: inline-flex"
                />
              </div>
              <div class="annotations-summary">{{ result.annotations.summary }}</div>
              <el-table :data="result.annotations.missingItems" stripe size="small" max-height="400">
                <el-table-column prop="item" label="问题" />
                <el-table-column prop="location" label="位置" width="160" />
                <el-table-column prop="severity" label="严重度" width="90">
                  <template #default="{ row }">
                    <el-tag size="small" :type="severityTag(row.severity)">{{ severityLabel(row.severity) }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>

            <!-- 合规审查 -->
            <el-tab-pane label="合规审查" name="compliance" v-if="result.compliance">
              <div class="compliance-summary">{{ result.compliance.summary }}</div>

              <h4 v-if="result.compliance.designNotes.length">设计说明/技术要求</h4>
              <ul class="design-notes" v-if="result.compliance.designNotes.length">
                <li v-for="(note, i) in result.compliance.designNotes" :key="i">{{ note }}</li>
              </ul>

              <h4 v-if="result.compliance.issues.length">合规问题</h4>
              <el-table :data="result.compliance.issues" stripe size="small" max-height="400">
                <el-table-column prop="note" label="原文" width="200" show-overflow-tooltip />
                <el-table-column prop="violation" label="问题" />
                <el-table-column prop="suggestion" label="建议" />
                <el-table-column prop="severity" label="严重度" width="90">
                  <template #default="{ row }">
                    <el-tag size="small" :type="severityTag(row.severity)">{{ severityLabel(row.severity) }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload, Loading } from '@element-plus/icons-vue'
import { dwgToPng } from '@/utils/dwg-parser'
import { analyzeDwgVision, getVisionStatus, type VisionAnalyzeResult, type VisionStatusResult } from '@/api/dwg-vision'

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

// 初始化：检查视觉模型配置
onMounted(async () => {
  try {
    const res = await getVisionStatus()
    if (res.code === 200) {
      visionStatus.value = res.data
    }
  } catch { /* ignore */ }
})

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
    // 限制预览 SVG 大小
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

    // 2. 调用后端 Vision 分析
    const res = await analyzeDwgVision({
      imageBase64,
      fileName: dwgFile.value.name,
      analyses: selectedAnalyses.value,
      refText: refText.value || undefined,
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

function scoreColor(score: number): string {
  if (score >= 80) return '#67c23a'
  if (score >= 60) return '#e6a23c'
  return '#f56c6c'
}
</script>

<style scoped>
.dwg-vision-page {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header h2 {
  margin: 0 0 8px;
}

.subtitle {
  color: #909399;
  font-size: 14px;
  margin: 0 0 20px;
}

.page-body {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.left-panel {
  width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.right-panel {
  flex: 1;
  min-width: 0;
}

.svg-preview {
  margin-top: 16px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: hidden;
}

.preview-label {
  padding: 8px 12px;
  font-size: 12px;
  color: #909399;
  background: #fafafa;
  border-bottom: 1px solid #ebeef5;
}

.preview-canvas {
  max-height: 200px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}

.preview-canvas :deep(svg) {
  max-width: 100%;
  max-height: 200px;
}

.options-card .el-checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ref-section {
  margin-top: 12px;
}

.analyze-btn {
  width: 100%;
  margin-top: 16px;
}

.progress-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  color: #409eff;
  font-size: 13px;
}

.config-warning {
  margin-top: 12px;
}

.empty-card {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.error-alert {
  margin-bottom: 16px;
}

.error-alert ul {
  margin: 4px 0 0;
  padding-left: 16px;
}

.title-block-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.tb-item {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  background: #fafafa;
  border-radius: 4px;
}

.tb-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}

.tb-value {
  font-size: 14px;
  font-weight: 500;
}

.symbols-summary,
.annotations-summary,
.compliance-summary {
  margin-bottom: 12px;
  color: #606266;
  font-size: 14px;
}

.total-count {
  margin-top: 12px;
  color: #909399;
  font-size: 13px;
}

.score-section {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.design-notes {
  padding-left: 20px;
  margin-bottom: 16px;
}

.design-notes li {
  margin-bottom: 4px;
  font-size: 13px;
  color: #606266;
}

h4 {
  margin: 16px 0 8px;
  font-size: 14px;
}

@media (max-width: 900px) {
  .page-body {
    flex-direction: column;
  }
  .left-panel {
    width: 100%;
  }
}
</style>
