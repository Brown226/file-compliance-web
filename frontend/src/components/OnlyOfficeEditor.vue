<template>
  <div class="onlyoffice-editor-wrapper">
    <div v-if="loading" class="editor-loading">
      <el-icon class="loading-spinner"><Loading /></el-icon>
      <span>正在加载文档编辑器...</span>
    </div>
    <div v-if="error" class="editor-error">
      <el-icon :size="24" color="var(--el-color-danger)"><WarningFilled /></el-icon>
      <span>{{ error }}</span>
      <el-button size="small" @click="initEditor">重试</el-button>
    </div>
    <DocumentEditor
      v-if="editorConfig && !error"
      id="docEditor"
      :documentServerUrl="onlyOfficeUrl"
      :config="editorConfig"
      :events_onDocumentReady="onDocumentReady"
      :events_onDocumentStateChange="onDocumentStateChange"
      style="width: 100%; height: 100%;"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { DocumentEditor } from '@onlyoffice/document-editor-vue'
import { Loading, WarningFilled } from '@element-plus/icons-vue'
import { getEditorConfigApi, getOnlyOfficeUrlApi } from '@/api/onlyoffice'

const props = defineProps<{
  fileId: string
}>()

const emit = defineEmits<{
  (e: 'ready'): void
  (e: 'stateChange', isDirty: boolean): void
}>()

const loading = ref(true)
const error = ref('')
const editorConfig = ref<any>(null)
const onlyOfficeUrl = ref('')
const documentReady = ref(false)

let forceSaveInterval: ReturnType<typeof setInterval> | null = null
let isDirty = false

const initEditor = async () => {
  loading.value = true
  error.value = ''
  editorConfig.value = null

  try {
    // 获取 OnlyOffice URL
    if (!onlyOfficeUrl.value) {
      const urlRes = await getOnlyOfficeUrlApi()
      onlyOfficeUrl.value = urlRes.data?.url || 'http://localhost:8082'
    }

    // 获取编辑器配置
    const res = await getEditorConfigApi(props.fileId)
    editorConfig.value = res.data
  } catch (e: any) {
    error.value = e?.response?.data?.message || '加载编辑器配置失败'
    console.error('[OnlyOfficeEditor] 初始化失败:', e)
  } finally {
    loading.value = false
  }
}

const onDocumentReady = () => {
  documentReady.value = true
  emit('ready')
  // 启动定时强制保存（每30秒）
  startForceSaveTimer()
}

const onDocumentStateChange = (event: any) => {
  // 0 = 编辑中（dirty），1 = 已保存（clean）
  isDirty = event.data === 0
  emit('stateChange', isDirty)
}

const startForceSaveTimer = () => {
  stopForceSaveTimer()
  forceSaveInterval = setInterval(() => {
    if (isDirty && documentReady.value) {
      try {
        const editor = getEditor()
        if (editor) {
          editor.serviceCommand('forcesave', {})
        }
      } catch (e) {
        // 静默失败
      }
    }
  }, 30000)
}

const stopForceSaveTimer = () => {
  if (forceSaveInterval) {
    clearInterval(forceSaveInterval)
    forceSaveInterval = null
  }
}

const getEditor = () => {
  return (window as any)?.DocEditor?.instances?.docEditor || null
}

/** 刷新编辑器（文件内容变更后重新加载） */
const refresh = async () => {
  // 移除旧编辑器
  editorConfig.value = null
  // 等待 DOM 更新
  await new Promise(resolve => setTimeout(resolve, 100))
  // 重新初始化
  await initEditor()
}

defineExpose({ refresh })

watch(() => props.fileId, (newId) => {
  if (newId) {
    initEditor()
  }
}, { immediate: true })

onUnmounted(() => {
  stopForceSaveTimer()
  // 清理 OnlyOffice 编辑器实例
  try {
    const editor = getEditor()
    if (editor?.destroyEditor) {
      editor.destroyEditor()
    }
  } catch {}
})
</script>

<style scoped>
.onlyoffice-editor-wrapper {
  width: 100%;
  height: 100%;
  min-height: 400px;
  position: relative;
}

.editor-loading,
.editor-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  min-height: 400px;
  color: var(--corp-text-secondary);
}

.loading-spinner {
  font-size: 28px;
  color: var(--corp-primary);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
