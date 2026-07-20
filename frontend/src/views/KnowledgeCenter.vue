<template>
  <div class="knowledge-center">
    <!-- 顶部 Tab 切换 -->
    <div class="kc-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="kc-tab-item"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        <el-icon :size="16"><component :is="tab.icon" /></el-icon>
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- 内容区 -->
    <div class="kc-content">
      <LocalStandardTab v-show="activeTab === 'standards'" />
      <MaxKBTab v-show="activeTab === 'maxkb'" />
      <StandardClauses v-if="activeTab === 'clauses'" />
      <TerminologyTab v-show="activeTab === 'terminology'" />
      <FalsePositiveLibraryTab v-show="activeTab === 'falsepositive'" />
      <RuleLibraries v-if="activeTab === 'rules'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Collection, FolderOpened, Reading, Notebook, CircleClose, Files } from '@element-plus/icons-vue'
import LocalStandardTab from '@/views/StandardLibrary/LocalStandardTab.vue'
import MaxKBTab from '@/views/StandardLibrary/MaxKBTab.vue'
import TerminologyTab from '@/views/StandardLibrary/TerminologyTab.vue'
import FalsePositiveLibraryTab from '@/views/StandardLibrary/FalsePositiveLibraryTab.vue'
import StandardClauses from '@/views/openspec/StandardClauses.vue'
import RuleLibraries from '@/views/admin/RuleLibraries.vue'

const route = useRoute()
const router = useRouter()

const tabs = [
  { key: 'standards', label: '标准库', icon: Collection },
  { key: 'maxkb', label: 'MaxKB 知识库', icon: FolderOpened },
  { key: 'clauses', label: '条文库', icon: Reading },
  { key: 'terminology', label: '术语表', icon: Notebook },
  { key: 'falsepositive', label: '误报库', icon: CircleClose },
  { key: 'rules', label: '语义规则库', icon: Files },
]

const activeTab = ref('standards')

// 支持 /knowledge?tab=maxkb
watch(() => route.query.tab, (tab) => {
  if (tab && tabs.some(t => t.key === tab)) {
    activeTab.value = tab as string
  }
}, { immediate: true })

function switchTab(key: string) {
  activeTab.value = key
  router.replace({ path: '/knowledge', query: key === 'standards' ? {} : { tab: key } })
}
</script>

<style scoped>
.knowledge-center {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.kc-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 20px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.kc-tab-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.kc-tab-item:hover {
  color: #111827;
  background: #f3f4f6;
}

.kc-tab-item.active {
  color: #2563eb;
  background: #eff6ff;
}

.kc-content {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
</style>
