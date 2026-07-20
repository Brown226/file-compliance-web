<template>
  <div class="ai-engine-config">
    <section class="hero-panel">
      <div class="hero-copy">
        <p class="hero-tag">AI CONTROL CENTER</p>
        <h2>AI 引擎配置</h2>
        <p>
          这个页面只管理模型、向量和 OCR 识别能力。提示词模板属于审查策略配置，保留在独立页面维护，避免在同一处重复配置。
        </p>
      </div>
      <div class="hero-actions">
        <el-button type="primary" @click="router.push('/admin/prompts')">前往提示词模板</el-button>
        <el-button @click="router.push('/admin/system')">返回系统设置</el-button>
      </div>
    </section>

    <section class="layout-shell">
      <aside class="engine-nav">
        <button
          v-for="item in tabs"
          :key="item.key"
          class="engine-nav-item"
          :class="{ active: activeTab === item.key }"
          @click="activeTab = item.key"
        >
          <div class="nav-title">{{ item.label }}</div>
          <div class="nav-desc">{{ item.desc }}</div>
        </button>
      </aside>

      <main class="engine-main">
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
      </main>
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
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.hero-panel {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 28px;
  border-radius: 18px;
  background: linear-gradient(135deg, #111827 0%, #1f2937 60%, #374151 100%);
  color: #f9fafb;
}

.hero-tag {
  margin: 0 0 10px;
  font-size: 12px;
  letter-spacing: 0.16em;
  opacity: 0.7;
}

.hero-copy h2 {
  margin: 0 0 10px;
  font-size: 28px;
  font-weight: 700;
}

.hero-copy p:last-child {
  margin: 0;
  max-width: 760px;
  line-height: 1.7;
  color: rgba(249, 250, 251, 0.82);
}

.hero-actions {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-shrink: 0;
}

.layout-shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.engine-nav {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.engine-nav-item {
  text-align: left;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid #e5e7eb;
  background: #fff;
  cursor: pointer;
  transition: all 0.18s ease;
}

.engine-nav-item:hover {
  border-color: #94a3b8;
  transform: translateY(-1px);
}

.engine-nav-item.active {
  border-color: #2563eb;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(37, 99, 235, 0.03));
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
}

.nav-title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 4px;
}

.nav-desc {
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}

.engine-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.engine-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  padding: 20px 22px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid #eef2f7;
}

.panel-eyebrow {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: #64748b;
}

.panel-header h3 {
  margin: 0;
  font-size: 22px;
  color: #0f172a;
}

.panel-desc {
  margin: 0;
  max-width: 360px;
  font-size: 13px;
  line-height: 1.7;
  color: #64748b;
}

.panel-body {
  min-width: 0;
}

@media (max-width: 1100px) {
  .layout-shell {
    grid-template-columns: 1fr;
  }

  .engine-nav {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .panel-header {
    flex-direction: column;
  }
}

@media (max-width: 768px) {
  .ai-engine-config {
    padding: 16px;
  }

  .hero-panel {
    flex-direction: column;
    padding: 20px;
  }

  .hero-actions {
    flex-wrap: wrap;
  }
}
</style>
