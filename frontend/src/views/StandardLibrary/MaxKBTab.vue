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
import { ref, watch, onMounted } from 'vue'
import { WarningFilled, Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getMaxKBStatusApi, getMaxKBKnowledgeUrlApi } from '@/api/maxkb'

const status = ref<any>(null)
const maxkbIframeUrl = ref('')
const maxkbIframeLoading = ref(false)
const maxkbIframeRef = ref<HTMLIFrameElement>()

const fetchMaxKBStatus = async () => {
  try {
    const { data } = await getMaxKBStatusApi()
    status.value = data
    // 初始化成功后自动加载 iframe
    if (data?.initialized && data?.maxkbReachable !== false && !maxkbIframeUrl.value) {
      loadMaxKBIframe()
    }
  } catch (e) {
    status.value = null
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

const onMaxKBIframeLoad = () => {
  maxkbIframeLoading.value = false
}

// 当 tab 变为可见时加载 iframe
watch(() => status.value, (newStatus) => {
  if (newStatus?.initialized && newStatus?.maxkbReachable !== false && !maxkbIframeUrl.value) {
    loadMaxKBIframe()
  }
}, { immediate: true })

onMounted(() => {
  fetchMaxKBStatus()
})
</script>

<style scoped>
.maxkb-embed-container {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 0;
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
  overflow: hidden;
  min-height: 0;
}

.maxkb-iframe {
  width: 100%;
  height: 100%;
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
