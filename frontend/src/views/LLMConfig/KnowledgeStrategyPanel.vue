<template>
  <div class="strategy-panel">
    <div class="panel-header">
      <div class="panel-title">
        <el-icon :size="18"><SetUp /></el-icon>
        <div>
          <h4>双源协同策略</h4>
          <span class="panel-desc">控制 MaxKB 与 RAGFlow 检索结果的合并与去重规则</span>
        </div>
      </div>
    </div>

    <div class="panel-body">
      <el-form :model="strategy" label-width="120px" label-position="left">
        <el-form-item label="优先级策略">
          <el-radio-group v-model="strategy.priority">
            <el-radio value="parallel">双源并重</el-radio>
            <el-radio value="maxkb_first">MaxKB 优先</el-radio>
            <el-radio value="ragflow_first">RAGFlow 优先</el-radio>
          </el-radio-group>
          <div class="form-tip">
            双源并重：合并后按相似度统一排序；优先策略：该源结果全保留，另一源仅填充缺漏
          </div>
        </el-form-item>

        <el-form-item label="RAGFlow 权重">
          <el-input-number v-model="strategy.ragflowWeight" :min="0.1" :max="2" :step="0.1" :precision="2" />
          <div class="form-tip">RAGFlow 相似度分数乘以该权重后与 MaxKB 比较（MaxKB 权重始终为 1.0）</div>
        </el-form-item>

        <el-form-item label="结果去重">
          <el-switch v-model="strategy.dedupEnabled" />
          <div class="form-tip">按“文档名 + 内容前 100 字”指纹去重，保留相似度更高的那条</div>
        </el-form-item>
      </el-form>

      <div class="form-actions">
        <el-button @click="handleSave" :loading="saveLoading" type="primary">
          <el-icon><Check /></el-icon>
          保存策略
        </el-button>
        <el-button @click="loadConfig" :loading="loadLoading">
          <el-icon><Refresh /></el-icon>
          重新加载
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Refresh, SetUp } from '@element-plus/icons-vue'
import { getSystemConfigApi, saveSystemConfigApi } from '@/api/system'

const CONFIG_KEY = 'ragflow_config'

const strategy = reactive({
  priority: 'parallel' as 'parallel' | 'maxkb_first' | 'ragflow_first',
  ragflowWeight: 1.0,
  dedupEnabled: true,
})

const fullConfig = ref<Record<string, any>>({})
const saveLoading = ref(false)
const loadLoading = ref(false)

const loadConfig = async () => {
  loadLoading.value = true
  try {
    const { data } = await getSystemConfigApi(CONFIG_KEY)
    fullConfig.value = data || {}
    strategy.priority = data?.priority === 'maxkb_first' || data?.priority === 'ragflow_first' ? data.priority : 'parallel'
    strategy.ragflowWeight = typeof data?.ragflowWeight === 'number' && data.ragflowWeight > 0 ? data.ragflowWeight : 1.0
    strategy.dedupEnabled = typeof data?.dedupEnabled === 'boolean' ? data.dedupEnabled : true
  } catch {
    fullConfig.value = {}
  } finally {
    loadLoading.value = false
  }
}

const handleSave = async () => {
  saveLoading.value = true
  try {
    await saveSystemConfigApi(CONFIG_KEY, {
      ...fullConfig.value,
      priority: strategy.priority,
      ragflowWeight: strategy.ragflowWeight,
      dedupEnabled: strategy.dedupEnabled,
    })
    ElMessage.success('策略已保存')
    await loadConfig()
  } catch (e: any) {
    ElMessage.error(`保存失败：${e.message}`)
  } finally {
    saveLoading.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.strategy-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-gray-100);
  background: var(--corp-bg-sunken);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.panel-title :deep(.el-icon) {
  color: var(--corp-text-secondary);
  flex-shrink: 0;
}

.panel-title h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.panel-desc {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--corp-text-tertiary);
}

.panel-body {
  padding: 16px 20px 18px;
}

.form-tip {
  font-size: 12px;
  color: var(--corp-text-secondary);
  margin-top: 4px;
  line-height: 1.5;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--color-gray-100);
  margin-top: 4px;
}

@media (max-width: 640px) {
  .panel-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
