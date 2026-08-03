<template>
  <div class="side-panel">
    <el-tabs v-model="activeTab" class="panel-tabs">
      <el-tab-pane label="记忆" name="memory">
        <div class="tab-body">
          <AgentMemoryPanel />
        </div>
      </el-tab-pane>

      <el-tab-pane label="技能" name="skills">
        <div class="tab-body">
          <SkillsPanel />
        </div>
      </el-tab-pane>

      <el-tab-pane label="工作区" name="worktrees">
        <div class="tab-body">
          <WorktreesPanel />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AgentMemoryPanel from './AgentMemoryPanel.vue'
import SkillsPanel from './SkillsPanel.vue'
import WorktreesPanel from './WorktreesPanel.vue'

defineProps<{
  currentSessionId?: string | null
}>()

// 注：执行追踪 tab 已随 AgentTrace 链路移除（2026-08-03）
const activeTab = ref<'memory' | 'skills' | 'worktrees'>('memory')
</script>

<style scoped>
.side-panel {
  height: 100%;
  background: #fafbfc;
  display: flex;
  flex-direction: column;
}

.panel-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 16px;
  background: transparent;
}

.panel-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: #eeeef2;
}

.panel-tabs :deep(.el-tabs__item) {
  font-size: 13px;
  color: #8c8c9e;
  padding: 0 16px;
  height: 40px;
  line-height: 40px;
}

.panel-tabs :deep(.el-tabs__item.is-active) {
  color: #4f6ef7;
  font-weight: 500;
}

.panel-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow: hidden;
}

.panel-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.tab-body {
  height: 100%;
  overflow-y: auto;
  padding: 12px;
}
</style>
