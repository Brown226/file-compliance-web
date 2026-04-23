<template>
  <div class="mode-grid">
    <div
      v-for="m in reviewModes"
      :key="m.mode"
      class="mode-card"
      :class="{ selected: selectedMode === m.mode }"
      @click="emit('selectMode', m.mode)"
      @dblclick="selectedMode === m.mode && emit('next')"
    >
      <div class="mc-icon-wrap">
        <el-icon :size="22" :style="{ color: selectedMode === m.mode ? '#fff' : 'var(--corp-text-secondary)' }">
          <component :is="modeIcons[m.mode]" />
        </el-icon>
      </div>
      <div class="mc-body">
        <div class="mc-name">{{ m.displayName }}</div>
        <div class="mc-desc">{{ m.description }}</div>
        <!-- 能力标签 -->
        <div class="mc-caps" v-if="m.capabilities">
          <span v-if="m.capabilities.rules" class="cap-tag cap-rules">规则</span>
          <span v-if="m.capabilities.standardRef === 'on'" class="cap-tag cap-stdref">标准</span>
          <span v-if="m.capabilities.ai" class="cap-tag cap-ai">AI</span>
          <span v-if="m.capabilities.crossFile" class="cap-tag cap-cross">跨文件</span>
          <span v-if="m.capabilities.needsRefFiles" class="cap-tag cap-ref">参照</span>
        </div>
      </div>
      <div v-if="m.mode === 'FULL_REVIEW'" class="mc-rec-badge">推荐</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Reading, Files, Connection, EditPen,
  PictureFilled, Setting, Check
} from '@element-plus/icons-vue';

defineProps<{
  selectedMode: string;
  reviewModes: any[];
}>();

const emit = defineEmits<{
  selectMode: [mode: string];
  next: [];
}>();

const modeIcons: Record<string, any> = {
  LIBRARY_REVIEW: Reading, DOC_REVIEW: Files, CONSISTENCY: Connection,
  TYPO_GRAMMAR: EditPen, MULTIMODAL: PictureFilled, CUSTOM_RULE: Setting, FULL_REVIEW: Check,
};
</script>

<style scoped>
.mode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.mode-card {
  position: relative;
  cursor: pointer;
  background: var(--bg-surface);
  border: 1.5px solid var(--corp-border-light);
  border-radius: var(--radius-md);
  padding: 18px 16px;
  transition: all 0.2s ease;
  /* Lightning CSS 兜底：强制可交互 */
  pointer-events: auto !important;
}

.mode-card:hover {
  border-color: var(--corp-border);
}

.mode-card.selected {
  border: 2px solid var(--corp-primary);
  box-shadow: 0 0 0 3px rgba(37,99,235,0.08);
}

.mc-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--corp-bg-sunken);
  margin-bottom: var(--space-3);
  transition: all 0.2s ease;
}

.mode-card.selected .mc-icon-wrap {
  background: var(--corp-primary);
}

.mc-name {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 6px;
}

.mc-desc {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.mc-caps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cap-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
}

.cap-rules {
  background: var(--el-color-primary-light-9);
  color: var(--color-primary-700);
}

.cap-stdref {
  background: var(--corp-success-light);
  color: #065F46;
}

.cap-ai {
  background: var(--corp-info-light);
  color: #4338CA;
}

.cap-cross {
  background: var(--corp-warning-light);
  color: #92400E;
}

.cap-ref {
  background: var(--corp-danger-light);
  color: #991B1B;
}

.mc-rec-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  background: var(--corp-warning-light);
  color: #92400e;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}
</style>
