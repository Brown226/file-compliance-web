<template>
  <div class="pipeline-config-container">
    <el-card shadow="never">
      <template #header>
        <div class="panel-header">
          <div class="header-left">
            <el-icon class="header-icon"><Setting /></el-icon>
            <span>审查配置</span>
          </div>
          <div class="header-right">
            <span v-if="!loading" class="total-badge">
              共 {{ totalRules }} 条规则，已启用 {{ enabledCount }} 条
            </span>
          </div>
        </div>
      </template>

      <el-tabs v-model="activeTab" class="config-tabs">
        <!-- Tab 1: 模式能力矩阵 -->
        <el-tab-pane label="模式能力矩阵" name="capabilities">
          <ModeCapabilitiesPanel />
        </el-tab-pane>

        <!-- Tab 2: 审查模式控制 -->
        <el-tab-pane label="审查模式控制" name="stages">
          <div class="tab-desc">
            <el-alert
              title="配置各审查模式的启用/禁用状态"
              description="开启或关闭特定审查规则分类。修改即时生效：下次创建审查任务时，系统将只执行已启用的规则。规则按 3 位前缀分类（如 NAME_001、CODE_002），共 10 种审查模式。"
              type="info"
              show-icon
              :closable="false"
            />
          </div>

          <!-- 审查模式卡片 -->
          <div class="mode-cards" v-loading="loading">
            <div
              v-for="cat in categories"
              :key="cat.prefix"
              class="mode-card"
              :class="{ 'mode-disabled': cat.allDisabled, 'mode-partial': cat.partiallyEnabled }"
            >
              <div class="mode-header">
                <div class="mode-title">
                  <el-switch
                    :model-value="!cat.allDisabled"
                    :indeterminate="cat.partiallyEnabled"
                    @change="(val) => handleToggleCategory(cat, val)"
                    :loading="toggleLoading[cat.prefix]"
                  />
                  <span class="mode-name">{{ cat.label }}</span>
                  <el-tag size="small" :type="getTagType(cat.prefix)">{{ cat.label }}</el-tag>
                </div>
                <el-icon
                  v-if="cat.allEnabled"
                  class="mode-status active"
                ><CircleCheckFilled /></el-icon>
                <el-icon
                  v-else-if="cat.allDisabled"
                  class="mode-status inactive"
                ><CloseBold /></el-icon>
                <el-icon
                  v-else
                  class="mode-status partial"
                ><Warning /></el-icon>
              </div>

              <div class="mode-body">
                <div class="mode-description">{{ cat.description }}</div>
                <div class="rule-info-row">
                  <span class="rule-count">
                    <span class="count-num" :class="{ 'text-success': cat.allEnabled, 'text-danger': cat.allDisabled }">
                      {{ cat.enabledRules }}/{{ cat.totalRules }}
                    </span>
                    已启用
                  </span>
                  <span class="related-prefixes">规则编号：
                    <code v-for="(code, idx) in cat.ruleCodes.slice(0, 3)" :key="code" class="prefix-code">
                      {{ code }}{{ idx < Math.min(3, cat.ruleCodes.length) - 1 ? ',' : '' }}
                    </code>
                    <span v-if="cat.ruleCodes.length > 3" class="more-hint">等{{ cat.ruleCodes.length }}条</span>
                  </span>
                </div>
              </div>
            </div>

            <el-empty v-if="!loading && categories.length === 0" description="暂无规则数据" />
          </div>

          <div class="form-actions">
            <el-button type="primary" :loading="resetLoading" @click="handleResetDefaults">
              <el-icon><RefreshLeft /></el-icon>
              重置为默认
            </el-button>
            <el-button @click="loadPanelData">
              <el-icon><Refresh /></el-icon>
              刷新状态
            </el-button>
          </div>
        </el-tab-pane>

        <!-- Tab 2: 性能与超时 -->
        <el-tab-pane label="性能与超时" name="performance">
          <div class="section-card">
            <div class="section-title">
              <el-icon><Timer /></el-icon>
              <span>超时配置</span>
            </div>
            <el-form :model="configForm" label-width="160px" class="config-form">
              <el-form-item label="文本分片大小">
                <el-input-number v-model="configForm.chunkSize" :min="1000" :max="16000" :step="500" />
                <div class="form-tip">发送给 LLM 的单个文本块最大字符数，默认 4000</div>
              </el-form-item>

              <el-form-item label="LLM max_tokens">
                <el-input-number v-model="configForm.llmMaxTokens" :min="512" :max="100000" :step="512" />
                <div class="form-tip">LLM 响应的最大 token 数，默认 4096</div>
              </el-form-item>

              <el-form-item label="LLM 超时时间">
                <el-input-number v-model="configForm.llmTimeout" :min="10" :max="600" :step="10" />
                <span class="unit-label">秒</span>
              </el-form-item>

              <el-form-item label="MaxKB 超时时间">
                <el-input-number v-model="configForm.maxkbTimeout" :min="10" :max="600" :step="10" />
                <span class="unit-label">秒</span>
              </el-form-item>
            </el-form>
          </div>

          <div class="section-card">
            <div class="section-title">
              <el-icon><Tools /></el-icon>
              <span>并发配置</span>
            </div>
            <el-form :model="configForm" label-width="160px" class="config-form">
              <el-form-item label="最大并发审查">
                <el-input-number v-model="configForm.maxConcurrentReviews" :min="1" :max="10" />
                <div class="form-tip">每个用户同时最多处理的文档数量，默认 3。不同用户互不影响，实现多用户公平的资源分配。</div>
              </el-form-item>
            </el-form>
          </div>

          <div class="form-actions">
            <el-button type="primary" :loading="saveLoading" @click="handleSaveConfig">
              <el-icon><Check /></el-icon>
              保存配置
            </el-button>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
/**
 * PipelineConfig.vue - 审查模式控制面板
 *
 * 【核心功能】
 * 统一管控所有审查模式的规则启用/禁用状态。
 * - 每个卡片对应一个规则分类前缀（如 NAME、CODE、ATTR 等）
 * - 开关操作直接写入 review_rules 数据库表
 * - 规则引擎每次执行时从数据库读取 enabled 状态，变更即时生效
 *
 * 【数据流】
 *   前端开关 → POST /rules/toggle-by-prefix → 更新 review_rules.enabled
 *   规则引擎 → loadRuleConfigsFromDB() → 读取 review_rules.enabled → 跳过禁用的前缀
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Setting, Timer, Tools, Check, CircleCheckFilled, CloseBold,
  RefreshLeft, Refresh, Warning
} from '@element-plus/icons-vue'
import { getRulePanelDataApi, toggleRulesByPrefixApi, resetRulesApi } from '@/api/rule'
import { getSystemConfigApi, saveSystemConfigApi } from '@/api/system'
import ModeCapabilitiesPanel from '@/components/ModeCapabilitiesPanel.vue'

const activeTab = ref('capabilities')
const loading = ref(false)
const saveLoading = ref(false)
const resetLoading = ref(false)
const toggleLoading = reactive<Record<string, boolean>>({})

// ===== 审查模式数据类型 =====
interface RuleCategory {
  prefix: string
  label: string
  description: string
  totalRules: number
  enabledRules: number
  allEnabled: boolean
  allDisabled: boolean
  partiallyEnabled: boolean
  category: string
  ruleCodes: string[]
}

// ===== 数据 =====
const categories = ref<RuleCategory[]>([])
const totalRules = computed(() => categories.value.reduce((sum, c) => sum + c.totalRules, 0))
const enabledCount = computed(() => categories.value.reduce((sum, c) => sum + c.enabledRules, 0))

// 性能与并发配置
const configForm = reactive({
  chunkSize: 4000,
  llmMaxTokens: 4096,
  llmTimeout: 120,
  maxkbTimeout: 120,
  maxConcurrentReviews: 3,
})

// ===== 操作方法 =====

/** 从后端加载控制面板真实数据 */
const loadPanelData = async () => {
  loading.value = true
  try {
    const { data } = await getRulePanelDataApi()
    categories.value = data?.categories || []
  } catch (e) {
    console.error('加载规则面板数据失败', e)
    ElMessage.error('加载规则配置失败')
  } finally {
    loading.value = false
  }
}

/** 切换单个分类的启用/禁用状态 */
const handleToggleCategory = async (cat: RuleCategory, enabled: boolean) => {
  // 如果当前是部分启用状态，切换到全禁用；如果已全禁用，切换到全启用
  const targetEnabled = cat.allDisabled || (!cat.allEnabled && !enabled === false) ? true : !cat.allEnabled

  toggleLoading[cat.prefix] = true
  try {
    await ElMessageBox.confirm(
      `确认${targetEnabled ? '启用' : '禁用'}「${cat.label}」分类下的所有 ${cat.totalRules} 条规则？`,
      `${targetEnabled ? '启用' : '禁用'}确认`,
      { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' }
    )

    const res = await toggleRulesByPrefixApi([cat.prefix], targetEnabled)
    if (res.data?.updatedCount > 0) {
      ElMessage.success(`${cat.label}: ${targetEnabled ? '已启用' : '已禁用'} ${res.data.updatedCount} 条规则`)
      // 立即刷新本地状态
      await loadPanelData()
    }
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('切换规则状态失败', e)
      ElMessage.error('切换规则状态失败')
    }
  } finally {
    toggleLoading[cat.prefix] = false
  }
}

/** 重置所有规则为默认配置（全部启用） */
const handleResetDefaults = async () => {
  resetLoading.value = true
  try {
    await ElMessageBox.confirm(
      '确认重置所有审查规则为默认配置？这将启用所有规则并恢复默认严重程度。',
      '重置确认',
      { confirmButtonText: '确定重置', cancelButtonText: '取消', type: 'warning' }
    )
    const res = await resetRulesApi()
    ElMessage.success(res?.data?.message || '已重置为默认配置')
    await loadPanelData()
  } catch (e: any) {
    if (e !== 'cancel') {
      console.error('重置失败', e)
      ElMessage.error('重置失败')
    }
  } finally {
    resetLoading.value = false
  }
}

/** 获取标签颜色 */
const getTagType = (prefix: string): '' | 'primary' | 'success' | 'warning' | 'danger' | 'info' => {
  const map: Record<string, '' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
    NAMING: 'primary', ENCODING: 'success', ATTRIBUTE: 'warning',
    HEADER: 'info', PAGE: 'danger', FORMAT: 'primary',
    COMPLETENESS: 'success', CONSISTENCY: 'warning', LAYOUT: 'info', TYPO: 'danger',
  }
  return map[prefix] || 'info'
}

/** 保存配置（性能与并发） */
const handleSaveConfig = async () => {
  saveLoading.value = true
  try {
    await saveSystemConfigApi('pipeline_performance_config', {
      chunkSize: configForm.chunkSize,
      llmMaxTokens: configForm.llmMaxTokens,
      llmTimeout: configForm.llmTimeout,
      maxkbTimeout: configForm.maxkbTimeout,
      maxConcurrentReviews: configForm.maxConcurrentReviews,
    })
    ElMessage.success('配置已保存')
  } catch (e) {
    console.error('保存配置失败', e)
    ElMessage.error('保存配置失败')
  } finally {
    saveLoading.value = false
  }
}

/** 加载配置 */
const loadConfig = async () => {
  try {
    const { data: perfData } = await getSystemConfigApi('pipeline_performance_config')
    const perfConfig = perfData?.value || perfData
    if (perfConfig) {
      if (perfConfig.chunkSize) configForm.chunkSize = perfConfig.chunkSize
      if (perfConfig.llmMaxTokens) configForm.llmMaxTokens = perfConfig.llmMaxTokens
      if (perfConfig.llmTimeout) configForm.llmTimeout = perfConfig.llmTimeout
      if (perfConfig.maxkbTimeout) configForm.maxkbTimeout = perfConfig.maxkbTimeout
      if (perfConfig.maxConcurrentReviews) configForm.maxConcurrentReviews = perfConfig.maxConcurrentReviews
    }
  } catch (e) {
    console.warn('加载配置失败', e)
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  await Promise.all([loadPanelData(), loadConfig()])
})
</script>

<style scoped>
.pipeline-config-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon {
  font-size: 18px;
  color: var(--el-color-primary);
}

.total-badge {
  font-size: 13px;
  color: var(--corp-text-secondary);
  background: var(--el-fill-color-light);
  padding: 4px 12px;
  border-radius: 12px;
  font-weight: 500;
}

/* Tab 样式 */
.config-tabs :deep(.el-tabs__item) {
  font-weight: 500;
}

.config-tabs :deep(.el-tabs__item.is-active) {
  color: var(--el-color-primary);
}

.config-tabs :deep(.el-tabs__active-bar) {
  background-color: var(--el-color-primary);
}

/* 区块卡片 */
.section-card {
  background: var(--bg-surface);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.section-title .el-icon {
  color: var(--el-color-primary);
}

/* 表单样式 */
.config-form {
  max-width: 700px;
}

.form-tip {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
  line-height: 1.5;
}

.unit-label {
  margin-left: 8px;
  color: var(--corp-text-tertiary);
  font-size: 13px;
}

/* 模式卡片网格 */
.mode-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
  margin-top: 20px;
}

.mode-card {
  background: var(--bg-surface);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 16px;
  transition: all 0.25s ease;
  position: relative;
  overflow: hidden;
}

.mode-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: var(--el-color-primary);
  border-radius: 4px 0 0 4px;
  transition: background 0.2s ease;
}

.mode-card.mode-disabled::before {
  background: var(--el-color-info-light-5);
}

.mode-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.mode-card.mode-disabled {
  opacity: 0.7;
}

.mode-card.mode-partial {
  border-left: 3px solid var(--el-color-warning);
}

.mode-card.mode-partial::before {
  background: var(--el-color-warning);
}

.mode-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mode-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mode-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--corp-text-primary);
}

.mode-status {
  font-size: 18px;
}

.mode-status.active { color: var(--el-color-success); }
.mode-status.inactive { color: var(--el-color-info-light-5); }
.mode-status.partial { color: var(--el-color-warning); }

.mode-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.mode-description {
  font-size: 13px;
  color: var(--corp-text-secondary);
  line-height: 1.55;
  margin-bottom: 10px;
}

.rule-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.rule-count {
  font-size: 13px;
  color: var(--corp-text-secondary);
}

.count-num {
  font-weight: 700;
  font-size: 14px;
  color: var(--el-color-primary);
}

.count-num.text-success {
  color: var(--el-color-success);
}

.count-num.text-danger {
  color: var(--el-color-info);
}

.related-prefixes {
  font-size: 12px;
  color: var(--corp-text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.prefix-code {
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 11px;
  color: var(--el-color-primary-light-3);
  background: var(--el-fill-color-lighter);
  padding: 1px 5px;
  border-radius: 3px;
}

.more-hint {
  font-style: italic;
  color: var(--corp-text-tertiary);
  font-size: 11px;
}

/* 操作按钮 */
.form-actions {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: flex;
  gap: 10px;
}

.form-actions .el-button {
  min-width: 120px;
}

.form-actions .el-button .el-icon {
  margin-right: 4px;
}

/* Tab 描述 */
.tab-desc {
  margin-bottom: 8px;
}

.tab-desc :deep(.el-alert) {
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, var(--el-color-primary-light-9), var(--el-color-info-light-9));
}

.tab-desc :deep(.el-alert__description) {
  margin-top: 6px;
  font-size: 13px;
  color: var(--corp-text-secondary);
}
</style>
