<template>
  <div class="ai-workspace">
    <!-- 顶部 Tab 切换 -->
    <div class="ai-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="ai-tab-item"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        <el-icon :size="18"><component :is="tab.icon" /></el-icon>
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- 内容区 -->
    <div class="ai-content">
      <AiAssistant v-show="activeTab === 'chat'" />
      <PolishTool v-show="activeTab === 'polish'" />
      <KnowledgeQA v-if="activeTab === 'qa'" />
      <AgentMemoryPanel v-if="activeTab === 'memory'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChatDotRound, Brush, ChatLineSquare, Memo } from '@element-plus/icons-vue'
import AiAssistant from '@/views/ai-assistant/AiAssistant.vue'
import PolishTool from '@/views/Tools/PolishTool.vue'
import KnowledgeQA from '@/views/Agent/components/KnowledgeQA.vue'
import AgentMemoryPanel from '@/views/Agent/components/AgentMemoryPanel.vue'

const route = useRoute()
const router = useRouter()

const tabs = [
  { key: 'chat', label: '智能问答', icon: ChatDotRound },
  { key: 'polish', label: 'AI 润色', icon: Brush },
  { key: 'qa', label: '项目问答', icon: ChatLineSquare },
  { key: 'memory', label: '长期记忆', icon: Memo },
]

const activeTab = ref('chat')

// 支持通过 query 参数切换 Tab: /ai?tab=polish
watch(() => route.query.tab, (tab) => {
  if (tab && tabs.some(t => t.key === tab)) {
    activeTab.value = tab as string
  }
}, { immediate: true })

// Tab 切换时更新 URL（不刷新页面）
watch(activeTab, (tab) => {
  router.replace({ path: '/ai', query: { tab } })
})
</script>

<style scoped>
.ai-workspace {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 20px 0;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}

.ai-tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s;
  border-bottom: 2px solid transparent;
}

.ai-tab-item:hover {
  color: #111827;
  background: #f9fafb;
}

.ai-tab-item.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  background: #eff6ff;
}

.ai-content {
  flex: 1;
  overflow: auto;
}

/* 让内嵌的 AiAssistant 填满容器 */
.ai-content :deep(.ai-assistant-page) {
  height: 100%;
}
</style>
