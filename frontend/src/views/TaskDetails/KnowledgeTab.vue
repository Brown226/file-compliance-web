<template>
  <div class="tab-pane">
    <div v-if="standardRefIssues.length > 0" class="knowledge-list">
      <div
        v-for="(item, index) in standardRefIssues"
        :key="item.id || index"
        class="knowledge-card"
        :class="{ 'knowledge-card-clickable': item.fileId && item.originalText }"
        @click="item.fileId && item.originalText && emit('locate-item', item)"
        :title="item.fileId && item.originalText ? '点击定位到文件原文' : ''"
      >
        <div class="knowledge-header">
          <p class="knowledge-title">
            {{ getStandardRefTitle(item) }}
          </p>
          <div class="knowledge-header-right">
            <el-tag
              v-if="item.fileId && item.originalText"
              type="primary"
              size="small"
              effect="plain"
            >
              <el-icon :size="12"><Location /></el-icon> 定位原文
            </el-tag>
            <el-tag
              type="success"
              size="small"
            >
              当前可参考
            </el-tag>
          </div>
        </div>
        <p class="knowledge-content">{{ item.description }}</p>
      </div>
    </div>

    <!-- 标准引用空状态引导 -->
    <div v-else class="empty-state-knowledge">
      <el-icon :size="64" color="#E6A23C"><Reading /></el-icon>
      <h4>暂无标准引用</h4>
      <p class="empty-reason">本次审查未命中相关标准条款</p>

      <div class="possible-reasons">
        <p><strong>可能的原因：</strong></p>
        <ul>
          <li>当前审查模式未启用标准比对功能</li>
          <li>文档内容与知识库中的标准条款无关联</li>
          <li>知识库尚未导入相关领域的标准文件</li>
        </ul>
      </div>

      <div class="empty-actions">
        <el-button type="primary" @click="emit('back-to-overview')">
          ← 返回审查摘要
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Location, Reading } from '@element-plus/icons-vue'
import type { TaskDetail } from '@/types/models'

defineProps<{
  standardRefIssues: TaskDetail[]
  getStandardRefTitle: (item: TaskDetail) => string
}>()

const emit = defineEmits<{
  (e: 'locate-item', item: TaskDetail): void
  (e: 'back-to-overview'): void
}>()
</script>
