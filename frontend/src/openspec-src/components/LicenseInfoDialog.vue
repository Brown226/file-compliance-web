<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { getLicenseStatus, type LicenseStatus } from '../service/license'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
})

const loading = ref(false)
const licenseData = ref<LicenseStatus | null>(null)

watch(() => props.visible, async (val) => {
  if (val) {
    loading.value = true
    try {
      licenseData.value = await getLicenseStatus(true)
    } finally {
      loading.value = false
    }
  }
})

const featureList = computed(() => {
  if (!licenseData.value?.features) return []
  const map: Record<string, string> = {
    templateManagement: '模板管理',
    documentGeneration: '文档生成',
    knowledgeBase: '知识库管理',
    cadExport: 'CAD 导出',
  }
  return Object.entries(licenseData.value.features).map(([key, enabled]) => ({
    label: map[key] || key,
    enabled,
  }))
})
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="授权信息"
    width="440px"
    destroy-on-close
  >
    <div v-loading="loading" class="license-content">
      <template v-if="licenseData">
        <!-- 已授权 -->
        <template v-if="licenseData.valid">
          <div class="license-status licensed">
            <span class="status-dot" />
            <span>已授权</span>
          </div>

          <div class="license-info-list">
            <div v-if="licenseData.customerName" class="license-info-item">
              <span class="license-info-label">客户名称</span>
              <span class="license-info-value">{{ licenseData.customerName }}</span>
            </div>
            <div v-if="licenseData.issueDate" class="license-info-item">
              <span class="license-info-label">签发日期</span>
              <span class="license-info-value">{{ licenseData.issueDate }}</span>
            </div>
          </div>

          <div v-if="featureList.length > 0" class="license-features">
            <div class="license-features-title">功能权限</div>
            <div v-for="item in featureList" :key="item.label" class="license-feature-item">
              <span v-if="item.enabled" class="feature-check enabled">&#10003;</span>
              <span v-else class="feature-check disabled">&#10007;</span>
              <span :class="{ 'feature-disabled': !item.enabled }">{{ item.label }}</span>
            </div>
          </div>
        </template>

        <!-- 未授权 -->
        <template v-else>
          <div class="license-status free">
            <span class="status-dot" />
            <span>免费版</span>
          </div>

          <div class="license-free-desc">
            当前为免费版，部分功能受限。如需完整功能，请联系我们获取商业授权。
          </div>
        </template>
      </template>
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.license-content {
  min-height: 120px;
}

.license-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 20px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.license-status.licensed .status-dot {
  background: #10b981;
}

.license-status.free .status-dot {
  background: #9ca3af;
}

.license-info-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.license-info-item {
  display: flex;
  align-items: center;
}

.license-info-label {
  width: 80px;
  font-size: 14px;
  color: #666;
  flex-shrink: 0;
}

.license-info-value {
  font-size: 14px;
  color: #1a1a1a;
}

.license-features {
  border-top: 1px solid #f0f0f0;
  padding-top: 16px;
}

.license-features-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 12px;
}

.license-feature-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 14px;
}

.feature-check {
  width: 18px;
  text-align: center;
  font-size: 13px;
}

.feature-check.enabled {
  color: #10b981;
}

.feature-check.disabled {
  color: #d1d5db;
}

.feature-disabled {
  color: #9ca3af;
}

.license-free-desc {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
}
</style>
