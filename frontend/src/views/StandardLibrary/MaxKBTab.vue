<template>
  <div class="maxkb-embed-container">
    <!-- 未初始化提示 -->
    <div v-if="!status?.initialized" class="maxkb-not-ready">
      <el-icon :size="48" color="var(--el-color-warning)"><WarningFilled /></el-icon>
      <h3>MaxKB 尚未初始化</h3>
      <p>请先在「系统管理 → LLM服务配置」中配置 MaxKB 连接信息并执行一键初始化</p>
      <el-button type="primary" @click="fetchMaxKBStatus">刷新状态</el-button>
    </div>
    <!-- MaxKB 不可达 -->
    <div v-else-if="status?.maxkbReachable === false" class="maxkb-not-ready">
      <el-icon :size="48" color="var(--el-color-danger)"><WarningFilled /></el-icon>
      <h3>无法连接 MaxKB 服务</h3>
      <p>请检查 MaxKB 服务是否正在运行，以及在「LLM服务配置」中配置的地址是否正确</p>
      <p style="color:var(--el-text-color-secondary);font-size:13px;">错误信息: {{ status?.maxkbError }}</p>
      <el-button type="primary" @click="fetchMaxKBStatus">重新检测</el-button>
    </div>
    <!-- iframe 嵌入 -->
    <div v-else class="maxkb-iframe-wrapper">
      <div class="maxkb-iframe-toolbar">
        <span class="maxkb-iframe-title">MaxKB 知识库管理</span>
        <div class="maxkb-iframe-actions">
          <el-button size="small" @click="refreshMaxKBIframe" :icon="Refresh">刷新</el-button>
          <el-button size="small" type="primary" @click="openMaxKBNewWindow" :icon="Link">新窗口打开</el-button>
        </div>
      </div>
      <iframe
        v-if="maxkbIframeUrl"
        ref="maxkbIframeRef"
        :src="maxkbIframeUrl"
        class="maxkb-iframe"
        frameborder="0"
        allow="clipboard-read; clipboard-write"
        @load="onMaxKBIframeLoad"
      ></iframe>
      <div v-if="maxkbIframeLoading" class="maxkb-iframe-loading">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <p>正在加载 MaxKB 知识库...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { WarningFilled, Refresh, Link, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getMaxKBStatusApi, getMaxKBKnowledgeUrlApi } from '@/api/maxkb'

const props = defineProps<{
  status: any
}>()

const emit = defineEmits<{
  'update:status': [value: any]
}>()

const maxkbIframeUrl = ref('')
const maxkbIframeLoading = ref(false)
const maxkbIframeRef = ref<HTMLIFrameElement>()

const fetchMaxKBStatus = async () => {
  try {
    const { data } = await getMaxKBStatusApi()
    emit('update:status', data)
  } catch (e) {
    emit('update:status', null)
  }
}

const loadMaxKBIframe = async () => {
  maxkbIframeLoading.value = true
  try {
    const { data } = await getMaxKBKnowledgeUrlApi()
    if (data.token) {
      maxkbIframeUrl.value = data.knowledgePageUrl
    } else {
      maxkbIframeUrl.value = data.knowledgePageUrl
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '获取 MaxKB 知识库 URL 失败')
    maxkbIframeLoading.value = false
  }
}

const refreshMaxKBIframe = () => {
  if (maxkbIframeRef.value) {
    maxkbIframeLoading.value = true
    maxkbIframeRef.value.src = maxkbIframeRef.value.src
  }
}

const openMaxKBNewWindow = async () => {
  try {
    const { data } = await getMaxKBKnowledgeUrlApi()
    // knowledgePageUrl 已包含正确的外部地址（MAXKB_PUBLIC_URL），直接使用
    if (data.knowledgePageUrl) {
      window.open(data.knowledgePageUrl, '_blank')
    } else {
      ElMessage.error('无法获取 MaxKB 地址')
    }
  } catch (e: any) {
    ElMessage.error('无法获取 MaxKB 地址')
  }
}

const onMaxKBIframeLoad = () => {
  maxkbIframeLoading.value = false
}

// 当 tab 变为可见时加载 iframe
watch(() => props.status, (newStatus) => {
  if (newStatus?.initialized && newStatus?.maxkbReachable !== false && !maxkbIframeUrl.value) {
    loadMaxKBIframe()
  }
}, { immediate: true })
</script>

<style scoped>
.maxkb-embed-container {
  position: relative;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 160px);
  min-height: 0;
}

.maxkb-not-ready {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--el-text-color-regular);
}

.maxkb-not-ready h3 {
  margin: 0;
  font-size: 18px;
  color: var(--el-text-color-primary);
}

.maxkb-not-ready p {
  margin: 0;
  font-size: 14px;
  text-align: center;
  max-width: 400px;
}

.maxkb-iframe-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  min-height: 0;
}

.maxkb-iframe-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 16px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.maxkb-iframe-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.maxkb-iframe-actions {
  display: flex;
  gap: 8px;
}

.maxkb-iframe {
  width: 100%;
  flex: 1;
  border: none;
  display: block;
}

.maxkb-iframe-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
</style>
