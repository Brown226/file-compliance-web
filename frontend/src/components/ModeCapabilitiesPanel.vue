<template>
  <div class="mode-capabilities-panel">
    <!-- 提示 + 保存按钮 -->
    <div class="panel-header">
      <el-alert
        title="审查模式能力配置"
        description="配置各审查模式的能力组合。修改后点击「保存配置」生效。管理员可调整规则的启用状态、AI 审查策略等。"
        type="info"
        show-icon
        :closable="false"
        class="panel-alert"
      />
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!hasChanges"
        @click="handleSave"
      >
        保存配置
      </el-button>
    </div>

    <!-- 产品配置层 -->
    <div class="section-block">
      <div class="section-title">产品配置层（用户可见语义）</div>
      <el-table :data="modeList" border stripe class="matrix-table" v-loading="loading">
        <el-table-column label="审查模式" min-width="180">
          <template #default="{ row }">
            <div class="mode-cell">
              <el-icon :size="16" :color="row.color"><component :is="row.icon" /></el-icon>
              <div class="mode-info">
                <span class="mode-name">{{ row.displayName }}</span>
                <span class="mode-code">{{ row.mode }}</span>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="用户可用" width="100" align="center">
          <template #default="{ row, $index }">
            <el-switch v-model="row.enabled" @change="onChange($index)" />
          </template>
        </el-table-column>

        <el-table-column label="产品说明" min-width="220">
          <template #default="{ row }">
            <span class="desc-text">{{ row.description }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 引擎配置层 -->
    <div class="section-block">
      <div class="section-title">引擎配置层（执行参数）</div>
      <el-table :data="modeList" border stripe class="matrix-table" v-loading="loading">
        <el-table-column label="审查模式" min-width="160">
          <template #default="{ row }">
            <span class="mode-name">{{ row.displayName }}</span>
          </template>
        </el-table-column>

        <el-table-column label="规则引擎" width="100" align="center">
          <template #default="{ row, $index }">
            <el-switch v-model="row.rules" :disabled="!row.enabled" @change="onChange($index)" />
          </template>
        </el-table-column>

        <el-table-column label="标准引用" width="110" align="center">
          <template #default="{ row, $index }">
            <el-switch v-model="row.standardRef" :disabled="!row.enabled" @change="onChange($index)" />
          </template>
        </el-table-column>

        <el-table-column label="AI 审查" width="100" align="center">
          <template #default="{ row, $index }">
            <el-switch v-model="row.ai" :disabled="!row.enabled" @change="onChange($index)" />
          </template>
        </el-table-column>

        <el-table-column label="AI 策略" width="120" align="center">
          <template #default="{ row, $index }">
            <el-select
              v-model="row.aiStrategy"
              size="small"
              style="width: 104px"
              :disabled="!row.enabled || !row.ai"
              @change="onChange($index)"
            >
              <el-option label="标准AI" value="standard" />
              <el-option label="纯LLM" value="llmOnly" />
              <el-option label="参照比对" value="refCompare" />
              <!-- <el-option label="结构化审查" value="multimodal" /> -->
            </el-select>
          </template>
        </el-table-column>

        <el-table-column label="跨文件" width="100" align="center">
          <template #default="{ row, $index }">
            <el-switch v-model="row.crossFile" :disabled="!row.enabled" @change="onChange($index)" />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 重置按钮 -->
    <div class="panel-footer">
      <el-button @click="handleReset">重置为默认</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Reading, Files, Connection, EditPen, PictureFilled, Setting, Check
} from '@element-plus/icons-vue'
import { getModeCapabilitiesApi, saveModeCapabilitiesApi } from '@/api/task'

// 模式元信息（静态）
const modeMeta: Record<string, { displayName: string; description: string; icon: any; color: string }> = {
  LIBRARY_REVIEW: { displayName: '以库审文', description: '使用标准库+规则引擎+AI引擎进行合规检查', icon: Reading, color: '#2563EB' },
  DOC_REVIEW: { displayName: '以文审文', description: '使用上游参照文件与待审文件进行比对审查', icon: Files, color: '#10B981' },
  CONSISTENCY: { displayName: '全文一致性', description: '跨文件参数和语义一致性检查', icon: Connection, color: '#F59E0B' },
  TYPO_GRAMMAR: { displayName: '基础校对', description: '轻量级错别字和语法检查', icon: EditPen, color: '#EF4444' },
  MULTIMODAL: { displayName: '结构化审查', description: '表格结构化、公式识别、图纸智能分析', icon: PictureFilled, color: '#6366F1' },
  RULE_ONLY: { displayName: '仅规则审查', description: '仅执行预定义规则检查，不调用 AI，速度最快', icon: Setting, color: '#6B7280' },
}

// 默认配置（standardRef 为 boolean）
const defaultConfig: Record<string, any> = {
  LIBRARY_REVIEW: { enabled: true, rules: true, standardRef: true, ai: true, aiStrategy: 'standard', crossFile: false },
  DOC_REVIEW: { enabled: true, rules: true, standardRef: true, ai: true, aiStrategy: 'refCompare', crossFile: false },
  CONSISTENCY: { enabled: true, rules: true, standardRef: true, ai: true, aiStrategy: 'standard', crossFile: true },
  TYPO_GRAMMAR: { enabled: true, rules: true, standardRef: false, ai: true, aiStrategy: 'llmOnly', crossFile: false },
  MULTIMODAL: { enabled: true, rules: true, standardRef: false, ai: true, aiStrategy: 'multimodal', crossFile: false },
  RULE_ONLY: { enabled: true, rules: true, standardRef: false, ai: false, aiStrategy: 'standard', crossFile: false },
}

// 原始数据（用于比较是否有修改）
const originalData = ref<Record<string, any>>({})
const modeList = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)

// 是否有修改
const hasChanges = computed(() => {
  return JSON.stringify(modeList.value.reduce((acc, m) => ({ ...acc, [m.mode]: { enabled: m.enabled, rules: m.rules, standardRef: m.standardRef, ai: m.ai, aiStrategy: m.aiStrategy, crossFile: m.crossFile } }), {})) !== JSON.stringify(originalData.value)
})

// 标记已修改
function onChange(_index: number) {
  // hasChanges 会自动响应变化
}

// 加载数据
async function fetchData() {
  loading.value = true
  try {
    const { data } = await getModeCapabilitiesApi()
    if (data && typeof data === 'object') {
      originalData.value = JSON.parse(JSON.stringify(data))
      modeList.value = Object.entries(data).map(([mode, cfg]: [string, any]) => ({
        mode,
        displayName: modeMeta[mode]?.displayName || mode,
        description: modeMeta[mode]?.description || '',
        icon: modeMeta[mode]?.icon || Setting,
        color: modeMeta[mode]?.color || '#6B7280',
        enabled: cfg.enabled !== false,
        rules: cfg.rules !== false,
        standardRef: !!cfg.standardRef,
        ai: cfg.ai !== false,
        aiStrategy: cfg.aiStrategy || 'standard',
        crossFile: cfg.crossFile === true,
      }))
    }
  } catch (e) {
    console.error('加载模式配置失败', e)
    ElMessage.error('加载配置失败，使用默认配置')
    // 使用默认配置
    originalData.value = JSON.parse(JSON.stringify(defaultConfig))
    modeList.value = Object.entries(defaultConfig).map(([mode, cfg]: [string, any]) => ({
      mode,
      displayName: modeMeta[mode]?.displayName || mode,
      description: modeMeta[mode]?.description || '',
      icon: modeMeta[mode]?.icon || Setting,
      color: modeMeta[mode]?.color || '#6B7280',
      ...cfg,
    }))
  } finally {
    loading.value = false
  }
}

// 保存
async function handleSave() {
  saving.value = true
  try {
    const config: Record<string, any> = {}
    modeList.value.forEach(m => {
      config[m.mode] = {
        enabled: m.enabled,
        rules: m.rules,
        standardRef: m.standardRef,
        ai: m.ai,
        aiStrategy: m.aiStrategy,
        crossFile: m.crossFile,
      }
    })
    console.log('[ModeCapabilities] 保存配置:', JSON.stringify(config, null, 2))
    await saveModeCapabilitiesApi(config)
    originalData.value = JSON.parse(JSON.stringify(config))
    ElMessage.success('保存成功')
  } catch (e) {
    console.error('保存配置失败', e)
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

// 重置
function handleReset() {
  originalData.value = JSON.parse(JSON.stringify(defaultConfig))
  modeList.value = Object.entries(defaultConfig).map(([mode, cfg]: [string, any]) => ({
    mode,
    displayName: modeMeta[mode]?.displayName || mode,
    description: modeMeta[mode]?.description || '',
    icon: modeMeta[mode]?.icon || Setting,
    color: modeMeta[mode]?.color || '#6B7280',
    ...cfg,
  }))
}

onMounted(() => { fetchData() })
</script>

<style scoped>
.mode-capabilities-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.panel-alert {
  flex: 1;
  border-radius: 8px;
}

.section-block {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 12px;
  background: var(--el-bg-color-page);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
}

.matrix-table {
  margin-top: 8px;
}

.mode-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mode-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-name {
  font-weight: 600;
  font-size: 14px;
}

.mode-code {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-family: monospace;
}

.desc-text {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.panel-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
