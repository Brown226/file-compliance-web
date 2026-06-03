<template>
  <div class="engine-tab">
    <section class="config-section">
      <div class="status-card" :class="statusClass">
        <div class="status-header">
          <el-icon :size="28"><CircleCheckFilled v-if="healthy" /><WarningFilled v-else /></el-icon>
          <div>
            <h4>PaddleOCR 服务 — {{ healthy ? '运行正常' : '连接异常' }}</h4>
            <p class="status-desc">{{ healthy ? '内嵌 OCR 引擎已就绪，图片和扫描件识别无需额外配置。' : 'PaddleOCR 容器可能未启动或无法访问，请检查 Docker 服务。' }}</p>
          </div>
          <el-button size="small" :loading="checking" @click="check" :type="healthy ? 'success' : 'danger'">刷新检测</el-button>
        </div>
        <el-descriptions v-if="info" :column="2" border size="small" style="margin-top: 16px">
          <el-descriptions-item label="服务地址">{{ info.url }}</el-descriptions-item>
          <el-descriptions-item label="服务名称">{{ info.service }}</el-descriptions-item>
          <el-descriptions-item label="支持模型">{{ info.models?.join(', ') || '—' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ info.status }}</el-descriptions-item>
        </el-descriptions>
        <el-alert v-if="errorMsg" type="error" :closable="false" style="margin-top: 12px">
          {{ errorMsg }}
        </el-alert>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { CircleCheckFilled, WarningFilled } from '@element-plus/icons-vue'

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
  get summary() { return [{ label: 'PaddleOCR', value: healthy.value ? '✅ 正常' : '❌ 异常' }] }
})
</script>

<style scoped>
.engine-tab{display:flex;flex-direction:column;gap:18px}
.status-card{border-radius:16px;padding:24px;border:2px solid}
.status-card.status-ok{border-color:#22c55e;background:linear-gradient(180deg,#f0fdf4,#fff)}
.status-card.status-err{border-color:#ef4444;background:linear-gradient(180deg,#fef2f2,#fff)}
.status-header{display:flex;align-items:center;gap:16px}
.status-header h4{margin:0;font-size:18px;color:#0f172a}
.status-header .el-icon{color:inherit}
.status-desc{margin:4px 0 0;font-size:13px;color:#64748b;max-width:520px}
.status-ok .el-icon{color:#22c55e}
.status-err .el-icon{color:#ef4444}
</style>
