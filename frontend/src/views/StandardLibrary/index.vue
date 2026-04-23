<template>
  <div class="standard-library-container">
    <!-- Tab 切换 -->
    <div class="tab-header">
      <!-- MaxKB 知识库 - 仅 ADMIN/MANAGER 可见 -->
      <div
        v-if="canManageKnowledge"
        class="tab-item"
        :class="{ active: activeTab === 'maxkb' }"
        @click="switchToMaxKB"
      >
        <el-icon><Connection /></el-icon>
        MaxKB 知识库
        <el-tag v-if="maxkbStatus?.initialized" size="small" type="success" style="margin-left:6px;">已连接</el-tag>
        <el-tag v-else-if="maxkbStatus?.maxkbReachable === false" size="small" type="danger" style="margin-left:6px;">未连接</el-tag>
      </div>
      <div
        class="tab-item"
        :class="{ active: activeTab === 'local' }"
        @click="activeTab = 'local'"
      >
        <el-icon><Files /></el-icon>
        标准库管理
      </div>
      <div
        class="tab-item"
        :class="{ active: activeTab === 'terminology' }"
        @click="switchToTerminology"
      >
        <el-icon><Key /></el-icon>
        白名单库
        <el-tag v-if="terminologyTotal > 0" size="small" type="info" style="margin-left:6px;">{{ terminologyTotal }}词</el-tag>
      </div>
      <div
        class="tab-item"
        :class="{ active: activeTab === 'falsePositive' }"
        @click="switchToFalsePositive"
      >
        <el-icon><Warning /></el-icon>
        误报标记库
        <el-tag v-if="fpLibraryTotal > 0" size="small" type="warning" style="margin-left:6px;">{{ fpLibraryTotal }}条</el-tag>
      </div>
    </div>

    <!-- MaxKB 知识库嵌入 - 仅 ADMIN/MANAGER -->
    <MaxKBTab
      v-if="canManageKnowledge && activeTab === 'maxkb'"
      :status="maxkbStatus"
      @update:status="maxkbStatus = $event"
    />

    <!-- 本地标准库管理 -->
    <LocalStandardTab v-show="activeTab === 'local'" />

    <!-- 白名单库 -->
    <TerminologyTab
      v-show="activeTab === 'terminology'"
      @update:total="terminologyTotal = $event"
    />

    <!-- 误报标记库 -->
    <FalsePositiveLibraryTab
      v-show="activeTab === 'falsePositive'"
      @update:total="fpLibraryTotal = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Files, Connection, Key, Warning } from '@element-plus/icons-vue'
import { getMaxKBStatusApi } from '@/api/maxkb'
import { useUserStore } from '@/stores/user'
import LocalStandardTab from './LocalStandardTab.vue'
import MaxKBTab from './MaxKBTab.vue'
import TerminologyTab from './TerminologyTab.vue'
import FalsePositiveLibraryTab from './FalsePositiveLibraryTab.vue'

const userStore = useUserStore()
const canManageKnowledge = computed(() => userStore.isAdminOrManager())

// ===== Tab 切换 =====
const activeTab = ref<'local' | 'maxkb' | 'terminology' | 'falsePositive'>('local')

// ===== MaxKB 状态 =====
const maxkbStatus = ref<any>(null)

const fetchMaxKBStatus = async () => {
  try {
    const { data } = await getMaxKBStatusApi()
    maxkbStatus.value = data
  } catch (e) {
    maxkbStatus.value = null
  }
}

const switchToMaxKB = () => {
  activeTab.value = 'maxkb'
}

// ===== 白名单术语总数 =====
const terminologyTotal = ref(0)

const switchToTerminology = () => {
  activeTab.value = 'terminology'
}

// ===== 误报标记库计数 =====
const fpLibraryTotal = ref(0)

const switchToFalsePositive = () => {
  activeTab.value = 'falsePositive'
}

onMounted(() => {
  setTimeout(() => {
    fetchMaxKBStatus()
  }, 1000)
})
</script>

<style scoped>
.standard-library-container { padding: 0; height: 100%; }

.tab-header {
  display: flex;
  gap: 0;
  margin-bottom: 8px;
  border-bottom: 2px solid var(--el-border-color-light);
  padding: 0;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
}

.tab-item:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.tab-item.active {
  color: var(--el-color-primary);
  border-bottom-color: var(--el-color-primary);
}
</style>
