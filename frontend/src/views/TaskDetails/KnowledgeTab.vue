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
    <EmptyState
      v-else
      :icon="Reading"
      title="暂无标准引用"
      description="本次审查未命中相关标准条款"
      variant="warning"
      :icon-color="'#E6A23C'"
    >
      <template #extra>
        <div class="possible-reasons">
          <p><strong>可能的原因：</strong></p>
          <ul>
            <li>当前审查模式未启用标准比对功能</li>
            <li>文档内容与知识库中的标准条款无关联</li>
            <li>知识库尚未导入相关领域的标准文件</li>
          </ul>
        </div>
      </template>
      <template #actions>
        <el-button type="primary" @click="emit('back-to-overview')">
          ← 返回审查摘要
        </el-button>
      </template>
    </EmptyState>
  </div>
</template>

<script setup lang="ts">
import { Location, Reading } from '@element-plus/icons-vue'
import type { TaskDetail } from '@/types/models'
import { useIssueHelpers } from './composables'
import EmptyState from './EmptyState.vue'

defineProps<{
  standardRefIssues: TaskDetail[]
}>()

const emit = defineEmits<{
  (e: 'locate-item', item: TaskDetail): void
  (e: 'back-to-overview'): void
}>()

const { getStandardRefTitle } = useIssueHelpers()
</script>

<style scoped>
/* 知识库卡片列表 */
.knowledge-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.knowledge-card {
  padding: 12px;
  background: #EFF6FF;
  border-radius: 6px;
  border: 1px solid #BFDBFE;
  transition: all 0.15s ease;
}

.knowledge-card-clickable {
  cursor: pointer;
}

.knowledge-card-clickable:hover {
  border-color: #93C5FD;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.12);
  transform: translateX(3px);
}

.knowledge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.knowledge-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.knowledge-title {
  font-size: 13px;
  font-weight: 600;
  color: #1E40AF;
  margin: 0;
}

.knowledge-content {
  font-size: 12px;
  color: #374151;
  line-height: 1.6;
  margin: 0;
}

/* 标准引用空状态引导 */
.possible-reasons {
  text-align: left;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 8px;
  padding: 16px 20px;
  max-width: 440px;
}

.possible-reasons p {
  margin: 0 0 8px;
  color: #92400E;
  font-size: 13px;
}

.possible-reasons ul {
  margin: 0;
  padding-left: 20px;
  color: #78716C;
  font-size: 13px;
  line-height: 1.8;
}
</style>
