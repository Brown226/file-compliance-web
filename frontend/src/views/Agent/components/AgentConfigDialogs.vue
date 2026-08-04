<template>
  <!-- 左栏底部 Models/Skills/记忆 配置弹窗（对齐参考项目底部工具栏行为） -->
  <ModelsConfig
    v-if="modelVisible"
    @close="modelVisible = false"
    @saved="emit('models-saved')"
  />

  <!-- Skills 管理（完全复刻参考：自绘 860px 双栏弹窗） -->
  <SkillsPanel v-if="skillsVisible" @close="skillsVisible = false" />

  <el-dialog
    v-model="memoryVisible"
    title="记忆"
    width="560px"
    append-to-body
    destroy-on-close
  >
    <div class="config-body memory-body">
      <AgentMemoryPanel />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { defineModel } from 'vue'
import ModelsConfig from './ModelsConfig.vue'
import SkillsPanel from './SkillsPanel.vue'
import AgentMemoryPanel from './AgentMemoryPanel.vue'

// 弹窗可见性由左栏底部工具栏触发
const modelVisible = defineModel<boolean>('modelVisible', { default: false })
const skillsVisible = defineModel<boolean>('skillsVisible', { default: false })
const memoryVisible = defineModel<boolean>('memoryVisible', { default: false })

// 模型配置保存成功后通知父组件刷新模型下拉
const emit = defineEmits<{ 'models-saved': [] }>()
</script>

<style scoped>
.config-body {
  min-height: 200px;
  max-height: 60vh;
  overflow-y: auto;
}
.memory-body { min-height: 300px; }
</style>
