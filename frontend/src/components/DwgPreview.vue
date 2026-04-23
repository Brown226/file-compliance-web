<template>
  <!-- 静默模式：完全不显示 UI（仅在父组件传入 silent 时生效，上传阶段默认使用） -->
  <template v-if="silent">
    <!-- 隐藏状态，仅触发 WASM 解析 -->
  </template>

  <!-- 加载状态 -->
  <div class="dwg-loading" v-else-if="loading">
    <el-icon :size="16" class="is-loading"><Loading /></el-icon>
    <span>DWG 解析中...</span>
  </div>

  <!-- 解析失败 -->
  <div class="dwg-error" v-else-if="error">
    <el-icon :size="14" color="var(--el-color-warning)"><WarningFilled /></el-icon>
    <span>WASM 解析失败，将仅使用文本审查</span>
  </div>

  <!-- 解析成功 -->
  <div class="dwg-ok" v-else-if="parsedData">
    <el-icon :size="14" color="var(--corp-success)"><CircleCheckFilled /></el-icon>
    <span>已解析 {{ parsedData.layers?.length || 0 }} 图层 · {{ parsedData.textEntities?.length || 0 }} 文本</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loading, WarningFilled, CircleCheckFilled } from '@element-plus/icons-vue'
import { parseDwgFile, type DwgParsedData } from '@/utils/dwg-parser'

const props = defineProps<{
  file: File | null
  /** 静默模式：隐藏所有 UI，仅后台解析（上传阶段默认使用） */
  silent?: boolean
}>()

const emit = defineEmits<{
  /** WASM 解析完成，传出结构化数据 */
  parsed: [data: DwgParsedData]
  /** WASM 解析失败 */
  error: [err: Error]
}>()

const parsedData = ref<DwgParsedData | null>(null)
const loading = ref(false)
const error = ref(false)

/** 触发 WASM 解析 */
async function doParse(file: File) {
  console.log('[DwgPreview] doParse 开始, file:', file?.name, 'size:', file?.size)
  loading.value = true
  error.value = false
  parsedData.value = null

  try {
    parsedData.value = await parseDwgFile(file)
    console.log('[DwgPreview] 解析成功:', file.name, 'layers:', parsedData.value?.layers?.length, 'text:', parsedData.value?.textEntities?.length)
    emit('parsed', parsedData.value)
  } catch (e: any) {
    console.error('[DwgPreview] WASM 解析失败:', file.name, e?.message || e)
    error.value = true
    emit('error', e instanceof Error ? e : new Error(String(e)))
  } finally {
    loading.value = false
  }
}

// 监听文件变化
watch(() => props.file, (newFile) => {
  if (newFile && newFile.name.toLowerCase().endsWith('.dwg')) {
    doParse(newFile)
  } else {
    parsedData.value = null
    error.value = false
  }
}, { immediate: true })

/** 暴露方法供外部调用 */
defineExpose({
  /** 获取解析后的完整数据 */
  getParsedData: () => parsedData.value,
})
</script>

<style scoped>
.dwg-loading {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-top: 8px;
  border-radius: 6px;
  background: var(--color-primary-50, #eff6ff);
  border: 1px solid #bfdbfe;
  font-size: 12px;
  color: var(--corp-primary, #2563eb);
}

.dwg-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-top: 8px;
  border-radius: 6px;
  background: var(--el-color-warning-light-9, #fdf6ec);
  border: 1px solid #f5dab1;
  font-size: 12px;
  color: var(--corp-text-secondary, #4b5563);
}

.dwg-ok {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-top: 8px;
  border-radius: 6px;
  background: var(--corp-success-light, #f0fdf4);
  border: 1px solid #bbf7d0;
  font-size: 12px;
  color: var(--corp-success, #27ae60);
}
</style>
