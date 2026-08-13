<template>
  <section class="route-panel">
    <!-- Task 30.2: DWG 视觉分析维度模型路由 -->
    <el-collapse v-model="activeNames">
      <el-collapse-item name="routes">
        <template #title>
          <div class="collapse-title">
            <el-icon><Connection /></el-icon>
            <span>DWG 维度模型路由（高级）</span>
            <el-tag v-if="configuredCount > 0" size="small" type="success" effect="plain" class="count-tag">
              {{ configuredCount }} 个维度已自定义
            </el-tag>
          </div>
        </template>

        <div class="route-hint">
          为各分析维度独立选择视觉模型。留空则使用上方「视觉模型」默认配置。
          <strong>建议</strong>：标题栏/图例符号用小模型（快），合规审查/专业审查用大模型（准）。
        </div>

        <div v-if="visionProviders.length === 0" class="empty-hint">
          没有可用的视觉 Provider，请先在上方配置视觉模型或在 Provider 管理中添加支持图片输入的 Provider。
        </div>

        <el-form v-else label-width="120px" label-position="left" class="route-form">
          <div v-for="dim in dimensions" :key="dim.key" class="route-row">
            <div class="route-label">
              <span class="dim-name">{{ dim.label }}</span>
              <span class="dim-desc">{{ dim.desc }}</span>
            </div>
            <div class="route-controls">
              <el-select
                v-model="routes[dim.key].providerId"
                placeholder="使用默认视觉模型"
                clearable
                filterable
                size="default"
                class="provider-select"
              >
                <el-option
                  v-for="p in visionProviders"
                  :key="p.id"
                  :label="`[${p.name}] ${p.model || '未设置模型'}`"
                  :value="p.id"
                />
              </el-select>
              <el-input-number
                v-model="routes[dim.key].timeout"
                :min="30"
                :max="300"
                :value-on-clear="null"
                controls-position="right"
                size="default"
                placeholder="超时"
                class="timeout-input"
              />
              <span class="timeout-unit">秒</span>
            </div>
          </div>
        </el-form>

        <div class="action-bar">
          <el-button @click="handleReset" :disabled="saveLoading">重置</el-button>
          <el-button type="primary" :loading="saveLoading" @click="handleSave" :disabled="visionProviders.length === 0">
            <el-icon><Check /></el-icon>
            保存路由配置
          </el-button>
        </div>
      </el-collapse-item>
    </el-collapse>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Connection } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi, getLlmProfilesApi, type LlmProfile } from '@/api/system'

/** Task 30.2: 单个维度的路由配置（对齐后端 getVisionConfig 读取的 dwg_vision_model_routes 结构） */
interface DimensionRoute {
  providerId?: string  // 留空 = 用默认视觉模型
  timeout?: number     // 留空 = 用默认（后端 fallback profile.timeout || 120）
}

/** 维度定义（对齐后端 VALID_ANALYSES + dimensionKeys） */
const dimensions = [
  { key: 'titleBlock', label: '标题栏识别', desc: '提取图号/图名/版本' },
  { key: 'symbols', label: '图例符号', desc: '识别阀门/泵/仪表' },
  { key: 'annotations', label: '标注完整性', desc: '检查尺寸标注' },
  { key: 'compliance', label: '合规审查', desc: '对照标准条文' },
  { key: 'profession', label: '专业审查', desc: '按专业分流 prompt' },
  { key: 'frameCheck', label: '图框规范', desc: '幅面/装订边/标题栏' },
] as const

/** 初始化路由配置（全部留空 = 全部用默认） */
function createEmptyRoutes(): Record<string, DimensionRoute> {
  const r: Record<string, DimensionRoute> = {}
  for (const d of dimensions) r[d.key] = { providerId: undefined, timeout: undefined }
  return r
}

const routes = reactive<Record<string, DimensionRoute>>(createEmptyRoutes())
const originalRoutes = ref('')
const saveLoading = ref(false)
const providers = ref<LlmProfile[]>([])
const activeNames = ref<string[]>([])  // 默认折叠

/** 视觉 Provider：usage ∈ {vision, all} 且支持 image 输入（与 VisionModelTab 过滤逻辑一致） */
const visionProviders = computed(() =>
  providers.value.filter(
    (p) =>
      ['vision', 'all'].includes(p.usage || 'chat') &&
      p.capabilities?.inputModalities?.includes('image')
  )
)

/** 已自定义配置的维度数量（providerId 或 timeout 任一非空） */
const configuredCount = computed(() =>
  dimensions.filter(d => routes[d.key].providerId || routes[d.key].timeout).length
)

const hasUnsavedChanges = computed(() => JSON.stringify(routes) !== originalRoutes.value)

async function loadProviders() {
  try {
    const res = await getLlmProfilesApi()
    const list = (res as any).data || res || []
    providers.value = Array.isArray(list) ? list.filter((p: any) => p.isEnabled) : []
  } catch { /* ignore */ }
}

async function loadRoutes() {
  try {
    const { data } = await getSystemConfigApi('dwg_vision_model_routes')
    let v = data?.value || data
    if (typeof v === 'string') v = JSON.parse(v)
    if (v && typeof v === 'object') {
      for (const d of dimensions) {
        const route = v[d.key]
        if (route && typeof route === 'object') {
          routes[d.key] = {
            providerId: typeof route.providerId === 'string' ? route.providerId : undefined,
            timeout: typeof route.timeout === 'number' ? route.timeout : undefined,
          }
        }
      }
    }
    originalRoutes.value = JSON.stringify(routes)
  } catch { /* ignore */ }
}

function handleReset() {
  Object.assign(routes, createEmptyRoutes())
}

async function handleSave() {
  saveLoading.value = true
  try {
    // 只保存有配置的维度，避免存大量空对象
    const payload: Record<string, DimensionRoute> = {}
    for (const d of dimensions) {
      const r = routes[d.key]
      if (r.providerId || r.timeout) {
        payload[d.key] = {
          providerId: r.providerId || undefined,
          timeout: r.timeout || undefined,
        }
      }
    }
    await saveSystemConfigApi('dwg_vision_model_routes', payload)
    originalRoutes.value = JSON.stringify(routes)
    ElMessage.success('DWG 维度模型路由已保存')
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || e.message || '保存失败')
  } finally {
    saveLoading.value = false
  }
}

onMounted(async () => {
  await loadProviders()
  await loadRoutes()
})

defineExpose({
  get hasUnsavedChanges() {
    return hasUnsavedChanges.value
  },
})
</script>

<style scoped>
.route-panel {
  margin-top: 12px;
  border-top: 1px dashed var(--corp-border-light);
  padding-top: 8px;
}

.collapse-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--corp-text-primary);
}

.count-tag {
  margin-left: 8px;
}

.route-hint {
  font-size: 12px;
  color: var(--corp-text-secondary);
  line-height: 1.6;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--corp-bg-sunken);
  border-radius: 4px;
}

.empty-hint {
  font-size: 12px;
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-bg); /* 原 #fde68a 浅黄边框，对齐 --color-warning-bg */
  border-radius: 4px;
  padding: 10px 12px;
}

.route-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.route-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-gray-100);
}

.route-row:last-child {
  border-bottom: none;
}

.route-label {
  flex-shrink: 0;
  width: 140px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dim-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-text-primary);
}

.dim-desc {
  font-size: 11px;
  color: var(--corp-text-tertiary);
}

.route-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.provider-select {
  flex: 1;
  min-width: 200px;
}

.timeout-input {
  width: 110px;
}

.timeout-unit {
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 12px;
}
</style>
