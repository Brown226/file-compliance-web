<template>
  <div class="llm-config-container">
    <el-card shadow="never">
      <template #header>
        <div class="panel-header">
          <span>AI 引擎配置</span>
        </div>
      </template>

      <el-tabs v-model="activeTab">
        <el-tab-pane label="对话模型" name="chat">
          <ChatModelTab />
        </el-tab-pane>

        <el-tab-pane label="OCR文本识别模型" name="ocr">
          <OcrConfigTab />
        </el-tab-pane>

        <el-tab-pane label="MaxKB知识库集成" name="maxkb">
          <MaxKBConfigTab />
        </el-tab-pane>

        <el-tab-pane label="提示词模板" name="prompt">
          <PromptConfigTab />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ChatModelTab from './ChatModelTab.vue'
import OcrConfigTab from './OcrConfigTab.vue'
import MaxKBConfigTab from './MaxKBConfigTab.vue'
import PromptConfigTab from '../PromptConfig.vue'

const activeTab = ref('chat')
</script>

<style scoped>
.llm-config-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: var(--corp-text-primary);
}
</style>
