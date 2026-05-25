<!--
  @deprecated 此组件已被 ImportWizard.vue 替代，分块设置已整合到导入向导 Step 2 的 Accordion 面板中。
  保留此文件仅作参考，不再被任何页面引用。
-->
<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="向量化配置"
    width="520px"
    destroy-on-close
  >
    <el-form :model="config" label-position="top" require-asterisk-position="right">
      <el-form-item label="分段策略">
        <el-radio-group v-model="config.splitStrategy" class="strategy-group">
          <el-radio value="auto">
            <div class="strategy-option">
              <span class="strategy-option__title">智能分段</span>
              <span class="strategy-option__desc">按段落自动识别分割点</span>
            </div>
          </el-radio>
          <el-radio value="fixed">
            <div class="strategy-option">
              <span class="strategy-option__title">固定长度</span>
              <span class="strategy-option__desc">按字符数均匀分割</span>
            </div>
          </el-radio>
          <el-radio value="clause">
            <div class="strategy-option">
              <span class="strategy-option__title">按条文号</span>
              <span class="strategy-option__desc">识别条文编号进行分割</span>
            </div>
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <template v-if="config.splitStrategy === 'fixed'">
        <el-form-item label="分段大小（字符）">
          <el-input-number
            v-model="config.chunkSize"
            :min="100"
            :max="5000"
            :step="100"
            style="width: 180px"
          />
          <span class="form-tip">推荐 800-1500 字符</span>
        </el-form-item>
        <el-form-item label="重叠大小（字符）">
          <el-input-number
            v-model="config.chunkOverlap"
            :min="0"
            :max="1000"
            :step="20"
            style="width: 180px"
          />
          <span class="form-tip">推荐 100-200 字符，有助于保持上下文连贯</span>
        </el-form-item>
      </template>

      <el-form-item label="嵌入模型">
        <el-select v-model="config.embeddingModel" style="width: 100%">
          <el-option
            v-for="m in availableModels"
            :key="m.value"
            :label="m.label"
            :value="m.value"
          >
            <div class="model-option">
              <span class="model-option__name">{{ m.label }}</span>
              <span class="model-option__dim" v-if="m.dimension">{{ m.dimension }}维</span>
            </div>
          </el-option>
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="handleConfirm" :loading="loading">
        确认向量化
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'

export interface VectorizeConfig {
  splitStrategy: 'auto' | 'fixed' | 'clause'
  chunkSize: number
  chunkOverlap: number
  embeddingModel: string
}

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'confirm', config: VectorizeConfig): void
}>()

const loading = ref(false)

const config = reactive<VectorizeConfig>({
  splitStrategy: 'auto',
  chunkSize: 900,
  chunkOverlap: 120,
  embeddingModel: 'default',
})

const availableModels = [
  { label: '默认嵌入模型', value: 'default', dimension: undefined },
  { label: 'BGE-Large-ZH', value: 'bge-large-zh', dimension: 1024 },
  { label: 'Text2Vec-Large-Chinese', value: 'text2vec-large-chinese', dimension: 1024 },
]

const handleConfirm = () => {
  loading.value = true
  emit('confirm', { ...config })
  // 父组件负责关闭对话框和重置loading
  setTimeout(() => { loading.value = false }, 300)
}

useEnterToConfirm(computed(() => props.modelValue), handleConfirm, { disabled: loading })
</script>

<style scoped>
.strategy-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.strategy-group :deep(.el-radio) {
  margin-right: 0;
  height: auto;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
  transition: all var(--corp-transition-fast);
  background: var(--bg-surface);
}
.strategy-group :deep(.el-radio:hover) {
  border-color: var(--corp-border);
  background: var(--bg-surface-hover);
}
.strategy-group :deep(.el-radio.is-checked) {
  border-color: var(--corp-primary);
  background: var(--color-primary-50);
  box-shadow: 0 0 0 1px var(--corp-primary);
}

.strategy-option {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.strategy-option__title {
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--corp-text-primary);
}
.strategy-option__desc {
  font-size: var(--text-xs);
  color: var(--corp-text-secondary);
  font-weight: 500;
}

.form-tip {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  margin-left: var(--space-3);
  font-weight: 500;
}

.model-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
.model-option__name {
  font-size: var(--text-base);
  font-weight: 500;
}
.model-option__dim {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
