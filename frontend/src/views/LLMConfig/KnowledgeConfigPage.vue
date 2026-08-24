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
  border-left: 4px solid transparent;
  border-image: linear-gradient(180deg, var(--color-primary-400), var(--color-primary-600)) 1;
  margin-bottom: 4px;
  border-radius: 2px;
}

.page-intro h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.page-intro p {
  margin: 0;
  font-size: 12.5px;
  color: var(--corp-text-secondary);
  line-height: 1.5;
}

.sources-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.module-card {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03), 0 6px 20px rgba(15, 23, 42, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: box-shadow var(--corp-transition-base), transform var(--corp-transition-base);
}

.module-card:hover {
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03), 0 10px 28px rgba(15, 23, 42, 0.07);
  transform: translateY(-1px);
}

@media (max-width: 960px) {
  .sources-grid {
    grid-template-columns: 1fr;
  }
}
</style>
