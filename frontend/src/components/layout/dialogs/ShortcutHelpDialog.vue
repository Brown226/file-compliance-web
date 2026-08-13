<template>
  <el-dialog v-model="visible" title="快捷键" width="520px">
    <el-table :data="shortcutsList" border size="small">
      <el-table-column label="快捷键" width="180" align="center">
        <template #default="{ row }">
          <kbd class="kbd">{{ row.keys }}</kbd>
        </template>
      </el-table-column>
      <el-table-column label="功能" prop="desc" />
    </el-table>
    <template #footer>
      <el-button type="primary" @click="visible = false">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit('update:modelValue', val),
})

const shortcutsList = [
  { keys: 'Ctrl + K', desc: '全局搜索' },
  { keys: 'Ctrl + N', desc: '智能审查' },
  { keys: 'Esc', desc: '关闭弹窗/返回' },
  { keys: '?', desc: '显示快捷键帮助' },
  { keys: 'Ctrl + S', desc: '保存当前编辑（表单页）' },
]
</script>

<style scoped>
.kbd {
  font-size: var(--text-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-gray-100);
  color: var(--color-gray-500);
  border: 1px solid var(--color-gray-200);
  font-family: inherit;
}
</style>
