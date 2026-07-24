<template>
  <div class="knowledge-config-page">
    <div class="page-intro">
      <h3>知识库配置</h3>
      <p>双源 RAG 检索：MaxKB 与 RAGFlow 并列。审查时同时/单独使用两个检索源，提升召回覆盖率。</p>
    </div>

    <!-- 上层：两个知识库连接配置卡片 -->
    <div class="sources-grid">
      <MaxKBConfigTab class="module-card" />
      <RAGFlowConfigTab class="module-card" />
    </div>

    <!-- 下层：全局协同策略面板 -->
    <KnowledgeStrategyPanel class="module-card" />
  </div>
</template>

<script setup lang="ts">
import MaxKBConfigTab from './MaxKBConfigTab.vue'
import RAGFlowConfigTab from './RAGFlowConfigTab.vue'
import KnowledgeStrategyPanel from './KnowledgeStrategyPanel.vue'
</script>

<style scoped>
.knowledge-config-page {
  padding: 20px 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-intro {
  padding: 4px 0 4px 12px;
  border-left: 3px solid #2563eb;
  margin-bottom: 4px;
}

.page-intro h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.page-intro p {
  margin: 0;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
}

.sources-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.module-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@media (max-width: 960px) {
  .sources-grid {
    grid-template-columns: 1fr;
  }
}
</style>
