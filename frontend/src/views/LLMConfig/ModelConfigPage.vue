<template>
  <div class="model-config-page">
    <!-- 顶部：OCR 状态条 -->
    <OcrStatusBar class="ocr-bar" />

    <!-- 主配置区：对话模型 -->
    <section class="config-card main-card">
      <div class="card-header">
        <h4>对话模型</h4>
        <span class="card-sub">主推理 · 审查核心 LLM</span>
      </div>
      <div class="card-body">
        <ChatModelTab />
      </div>
    </section>

    <!-- 辅助配置区：Embedding + 视觉 -->
    <div class="aux-grid">
      <section class="config-card">
        <div class="card-header">
          <h4>Embedding 模型</h4>
          <span class="card-sub">向量化</span>
        </div>
        <div class="card-body">
          <EmbeddingModelTab />
        </div>
      </section>

      <section class="config-card">
        <div class="card-header">
          <h4>视觉模型</h4>
          <span class="card-sub">扫描件 OCR</span>
        </div>
        <div class="card-body">
          <VisionModelTab />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import OcrStatusBar from './OcrStatusBar.vue'
import ChatModelTab from './ChatModelTab.vue'
import EmbeddingModelTab from './EmbeddingModelTab.vue'
import VisionModelTab from './VisionModelTab.vue'
</script>

<style scoped>
.model-config-page {
  padding: 20px 24px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1200px;
  margin: 0 auto;
}

/* 通用卡片 */
.config-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}

.card-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.card-sub {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 500;
}

.card-body {
  padding: 16px 20px 4px;
}

/* 辅助配置两列 */
.aux-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.aux-grid .config-card {
  display: flex;
  flex-direction: column;
}

.aux-grid .card-body {
  flex: 1;
}

@media (max-width: 900px) {
  .aux-grid {
    grid-template-columns: 1fr;
  }
}
</style>
