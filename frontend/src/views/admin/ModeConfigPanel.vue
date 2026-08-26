<template>
  <div class="mode-config-panel">
    <div class="panel-head">
      <div class="panel-title">审查模式配置</div>
      <div class="panel-desc">控制各审查模式的运行能力。判标开启后，AI 产出会打置信度（LOW 转为待人工复核），降低误报进用户视野的比例。</div>
    </div>

    <div v-loading="loading" class="mode-list">
      <div v-for="mode in modeKeys" :key="mode" class="mode-row">
        <div class="mode-info">
          <div class="mode-name">{{ getModeLabel(mode) }}</div>
          <div class="mode-tag">{{ mode }}</div>
        </div>
        <div class="mode-controls">
          <!-- 智能判标开关（2026-08-26：全模式扩展，DEC 内部已有判标阶段故不出开关） -->
          <div v-if="canToggleSmartJudge(mode)" class="control-item">
            <span class="control-label">智能判标</span>
            <el-switch v-model="draft[mode].smartJudge" size="small" />
          </div>
          <div v-else class="control-item control-item--muted">
            <span class="control-label">智能判标</span>
            <span class="muted-text">{{ mode === 'DEC_REVIEW' ? '内置' : '—' }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="panel-actions">
      <el-button :loading="saving" type="primary" @click="handleSave">保存配置</el-button>
      <el-button :disabled="saving" @click="handleReload">重新加载</el-button>
      <span v-if="saveMessage" class="save-message">{{ saveMessage }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getModeCapabilitiesApi, saveModeCapabilitiesApi } from '@/api/task'
import { getModeLabel } from '@/views/TaskDetails/composables'

/**
 * 审查模式能力配置面板（2026-08-26）
 *
 * 此前 pipeline_mode_capabilities 只有 GET/PUT API、无管理界面（AGENTS.md 声称可读改
 * 但前端无消费者）。本面板补上 smartJudge 开关编辑：save 端白名单过滤保证了只提交
 * smartJudge 字段（其余 undefined 被 JSON.stringify 丢弃 → 读回合并视为无覆盖，保持默认）。
 */

/** 可编辑的 8 个模式键（与后端 ReviewModeType 对齐） */
const MODE_KEYS = [
  'LIBRARY_REVIEW',
  'DOC_REVIEW',
  'CONTRACT_REVIEW',
  'CONSISTENCY',
  'TYPO_GRAMMAR',
  'RULE_ONLY',
  'SELF_CHECK',
  'DEC_REVIEW',
] as const

const loading = ref(false)
const saving = ref(false)
const saveMessage = ref('')
const draft = ref<Record<string, { smartJudge: boolean }>>({})

// 以固定序渲染；后端返回缺省时兜底
const modeKeys = computed(() => MODE_KEYS.filter(k => draft.value[k] !== undefined))

/** DEC 内部已含 smart_judge 阶段；RULE_ONLY/SELF_CHECK 无 AI 产出，开关无意义 */
const canToggleSmartJudge = (mode: string): boolean =>
  mode !== 'DEC_REVIEW' && mode !== 'RULE_ONLY' && mode !== 'SELF_CHECK'

const handleReload = async () => {
  loading.value = true
  saveMessage.value = ''
  try {
    const { data } = await getModeCapabilitiesApi()
    const next: Record<string, { smartJudge: boolean }> = {}
    for (const key of MODE_KEYS) {
      next[key] = { smartJudge: !!data?.[key]?.smartJudge }
    }
    draft.value = next
  } catch (e: any) {
    ElMessage.error(e?.message || '加载模式配置失败')
  } finally {
    loading.value = false
  }
}

const handleSave = async () => {
  saving.value = true
  try {
    // 仅提交 smartJudge 字段；save 端白名单过滤 + undefined 丢弃 → 其余配置保持原值
    const payload: Record<string, any> = {}
    for (const key of MODE_KEYS) {
      payload[key] = { smartJudge: draft.value[key]?.smartJudge }
    }
    await saveModeCapabilitiesApi(payload)
    saveMessage.value = '已保存，新的审查任务将生效'
    ElMessage.success('保存成功')
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(handleReload)
</script>

<style scoped>
.mode-config-panel {
  padding: 20px 24px;
  background: var(--corp-bg-sunken, #f8fafc);
  min-height: 100%;
}

.panel-head {
  margin-bottom: 16px;
}
.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--corp-text-primary, #1f2329);
  margin-bottom: 4px;
}
.panel-desc {
  font-size: 12.5px;
  color: var(--corp-text-secondary, #6b7280);
  line-height: 1.6;
  max-width: 720px;
}

.mode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: var(--bg-surface, #fff);
  border: 1px solid var(--corp-border-light, #e5e7eb);
  border-radius: 8px;
}

.mode-info {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.mode-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary, #1f2329);
}
.mode-tag {
  font-size: 11px;
  color: var(--corp-text-tertiary, #9ca3af);
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
}

.mode-controls {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
}
.control-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.control-label {
  font-size: 12.5px;
  color: var(--corp-text-secondary, #6b7280);
}
.control-item--muted .muted-text {
  font-size: 12px;
  color: var(--corp-text-tertiary, #9ca3af);
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
}
.save-message {
  font-size: 12.5px;
  color: var(--color-success-600, #16a34a);
}
</style>