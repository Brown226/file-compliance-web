<template>
  <div class="ai-engine-config">
    <!-- 水平导航胶囊 -->
    <nav class="engine-nav-horizontal">
      <button
        v-for="item in tabs"
        :key="item.key"
        class="engine-pill"
        :class="{ active: activeTab === item.key }"
        @click="activeTab = item.key"
        :title="item.desc"
      >
        {{ item.label }}
      </button>
    </nav>

    <!-- 内容区 -->
    <section class="engine-panel">
      <header class="panel-header">
        <div>
          <p class="panel-eyebrow">{{ currentTab?.short }}</p>
          <h3>{{ currentTab?.label }}</h3>
        </div>
        <p class="panel-desc">{{ currentTab?.desc }}</p>
      </header>

      <div class="panel-body">
        <ChatModelTab v-if="activeTab === 'chat'" />
        <EmbeddingModelTab v-else-if="activeTab === 'embedding'" />
        <RerankerModelTab v-else-if="activeTab === 'reranker'" />
        <OcrStatusTab v-else-if="activeTab === 'ocr'" />
        <VisionModelTab v-else-if="activeTab === 'vision'" />
        <MaxKBConfigTab v-else-if="activeTab === 'maxkb'" />
        <RAGFlowConfigTab v-else-if="activeTab === 'ragflow'" />
        <LlmProfilesTab v-else-if="activeTab === 'profiles'" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ChatModelTab from '@/views/LLMConfig/ChatModelTab.vue'
import EmbeddingModelTab from '@/views/LLMConfig/EmbeddingModelTab.vue'
import RerankerModelTab from '@/views/LLMConfig/RerankerModelTab.vue'
import OcrStatusTab from '@/views/LLMConfig/OcrStatusTab.vue'
import VisionModelTab from '@/views/LLMConfig/VisionModelTab.vue'
import MaxKBConfigTab from '@/views/LLMConfig/MaxKBConfigTab.vue'

import RAGFlowConfigTab from '@/views/LLMConfig/RAGFlowConfigTab.vue'
import LlmProfilesTab from '@/views/admin/LlmProfiles.vue'

const router = useRouter()

const tabs = [
  { key: 'chat', label: '对话模型', short: 'CHAT MODEL', desc: '管理主聊天模型、API 密钥与兼容接口。' },
  { key: 'embedding', label: 'Embedding 模型', short: 'EMBEDDING', desc: '管理向量化模型，供以文审文的参照文件智能检索使用。' },
  // Reranker 暂未启用（核心业务未集成），隐藏入口
  // { key: 'reranker', label: 'Reranker 模型', short: 'RERANKER', desc: '管理重排序模型，优化候选结果排序质量。' },
  { key: 'ocr', label: 'OCR 服务', short: 'OCR SERVICE', desc: '查看 doc-parser 视觉模型 OCR 运行状态。' },
  { key: 'vision', label: '视觉模型配置', short: 'VISION MODEL', desc: '配置视觉大模型用于扫描件 PDF 和图片的文字识别。' },
  { key: 'maxkb', label: 'MaxKB 知识库', short: 'MAXKB', desc: '管理 MaxKB 知识库集成，同步标准规范到向量检索引擎。' },
  { key: 'ragflow', label: 'RAGFlow 知识库', short: 'RAGFLOW', desc: '配置 RAGFlow 作为第二个知识库检索源，与 MaxKB 并列使用。' },
  { key: 'profiles', label: 'Provider 配置', short: 'PROVIDERS', desc: '管理多套 LLM 供应商配置，支持切换默认模型。' },
]

const activeTab = ref('chat')
const currentTab = computed(() => tabs.find(item => item.key === activeTab.value))
</script>

<style scoped>
.ai-engine-config {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* === 水平导航胶囊 === */
.engine-nav-horizontal {
  display: flex;
  gap: 6px;
  padding: 12px 16px;
  overflow-x: auto;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.04);
  scrollbar-width: none;
}

.engine-nav-horizontal::-webkit-scrollbar { display: none; }

.engine-pill {
  padding: 8px 16px;
  border: none;
  border-radius: 20px;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.engine-pill:hover {
  color: #1e293b;
  background: rgba(255,255,255,0.8);
}

.engine-pill.active {
  background: #1e293b;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(30,41,59,0.25);
}

/* === 内容面板 === */
.engine-panel {
  background: #fff;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f1f5f9;
}

.panel-eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: #94a3b8;
  font-weight: 600;
}

.panel-header h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
}

.panel-desc {
  margin: 0;
  max-width: 320px;
  font-size: 13px;
  line-height: 1.6;
  color: #64748b;
}

.panel-body {
  min-width: 0;
}

@media (max-width: 768px) {
  .panel-header {
    flex-direction: column;
  }
  .engine-panel {
    padding: 16px;
  }
}
</style>
