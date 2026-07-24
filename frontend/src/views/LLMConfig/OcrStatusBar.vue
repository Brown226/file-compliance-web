<template>
  <div class="ocr-status-bar" :class="statusClass">
    <div class="status-main">
      <span class="status-dot" :class="statusClass"></span>
      <div class="status-text">
        <span class="status-label">OCR 识别服务</span>
        <span class="status-value">{{ healthy ? '运行正常' : '连接异常' }}</span>
      </div>
      <el-button size="small" :loading="checking" @click="check">刷新检测</el-button>
    </div>

    <div v-if="info" class="status-detail">
      <span class="detail-item">
        <label>地址</label>{{ info.url }}
      </span>
      <span class="detail-item">
        <label>名称</label>{{ info.service }}
      </span>
      <span class="detail-item">
        <label>模型</label>{{ info.models?.join(', ') || '—' }}
      </span>
      <span class="detail-item">
        <label>状态</label>{{ info.status }}
      </span>
    </div>

    <el-alert v-if="errorMsg" type="error" :closable="false" class="status-alert">
      {{ errorMsg }}
    </el-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const checking = ref(false)
const healthy = ref(false)
const errorMsg = ref('')
const info = ref<{ url: string; service: string; models: string[]; status: string } | null>(null)

const statusClass = computed(() => healthy.value ? 'status-ok' : 'status-err')

const check = async () => {
  checking.value = true
  errorMsg.value = ''
  info.value = null
  try {
    const resp = await fetch('/api/system-config/ocr-status')
    const data = await resp.json()
    if (data.success) {
      healthy.value = true
      info.value = data.data
    } else {
      healthy.value = false
      errorMsg.value = data.error || '服务不可达'
    }
  } catch (e: any) {
    healthy.value = false
    errorMsg.value = e.message || '无法连接 OCR 服务'
  } finally {
    checking.value = false
  }
}

onMounted(() => check())

defineExpose({
  get hasUnsavedChanges() { return false },
  get summary() { return [{ label: 'OCR', value: healthy.value ? '正常' : '异常' }] }
})
</script>

<style scoped>
.ocr-status-bar {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px 20px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}

.status-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
}

.status-dot.status-ok {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}

.status-dot.status-err {
  background: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
}

.status-text {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.status-label {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}

.status-value {
  font-size: 12.5px;
  color: #64748b;
  font-weight: 500;
}

.status-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f1f5f9;
}

.detail-item {
  font-size: 12px;
  color: #475569;
}

.detail-item label {
  color: #94a3b8;
  margin-right: 6px;
  font-weight: 500;
}

.status-alert {
  margin-top: 10px;
}

.status-alert :deep(.el-alert__content) {
  padding: 0;
}
</style>
