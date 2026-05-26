<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="选择知识库"
    width="900px"
    :close-on-click-modal="false"
    class="knowledge-selection-dialog"
  >
    <div class="knowledge-selection-container">
      <!-- 左侧：知识库树形列表 -->
      <div class="knowledge-tree-panel">
        <div class="panel-header">
          <span class="panel-title">知识库列表</span>
          <span class="panel-count">{{ knowledgeTreeData.length }} 个分类</span>
        </div>
        <div class="panel-search">
          <el-input
            v-model="knowledgeSearchQuery"
            placeholder="搜索知识库..."
            clearable
            prefix-icon="Search"
            size="small"
          />
        </div>
        <div class="tree-container">
          <el-tree
            :data="filteredKnowledgeTree"
            :props="treeProps"
            node-key="id"
            :expand-on-click-node="false"
            :default-expand-all="true"
            highlight-current
            show-checkbox
            check-strictly
            @node-click="handleKnowledgeTreeNodeClick"
            ref="knowledgeTreeRef"
          />
          <div v-if="filteredKnowledgeTree.length === 0" class="tree-empty">
            <el-empty description="未找到匹配的知识库" :image-size="60" />
          </div>
        </div>
      </div>

      <!-- 右侧：已选知识库 -->
      <div class="selected-panel">
        <div class="panel-header">
          <span class="panel-title">已选知识库</span>
          <span class="panel-count highlight">{{ checkedIds.length }} 个</span>
        </div>
        <div class="selected-container">
          <div v-if="checkedIds.length > 0" class="selected-list">
            <div
              v-for="item in checkedKnowledge"
              :key="item.id"
              class="selected-item"
            >
              <div class="selected-item-icon">
                <el-icon><FolderOpened /></el-icon>
              </div>
              <div class="selected-item-content">
                <div class="selected-item-name">{{ item.name }}</div>
                <div class="selected-item-path">{{ getKnowledgePath(item.id) }}</div>
              </div>
              <el-button
                class="selected-item-remove"
                type="danger"
                :icon="Delete"
                circle
                size="small"
                @click="removeFromSelection(item.id)"
              />
            </div>
          </div>
          <div v-else class="selected-empty">
            <el-icon class="empty-icon"><FolderOpened /></el-icon>
            <p>尚未选择知识库</p>
            <span>从左侧列表中选择知识库</span>
          </div>
        </div>
        <div v-if="checkedIds.length > 0" class="selected-actions">
          <el-button size="small" @click="clearAllSelection">清空全部</el-button>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <span class="dialog-footer-info">已选择 {{ checkedIds.length }} 个知识库</span>
        <div class="dialog-footer-actions">
          <el-button @click="handleCancel">取消</el-button>
          <el-button type="primary" @click="handleConfirm">确认选择</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'
import { Delete, Search, FolderOpened, Collection } from '@element-plus/icons-vue'

const props = defineProps<{
  visible: boolean
  knowledgeTreeData: any[]
  currentCheckedKnowledgeIds: string[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'confirm', selectedIds: string[]): void
}>()

const knowledgeSearchQuery = ref('')
const knowledgeTreeRef = ref()

const treeProps = {
  label: 'name',
  children: 'children',
  disabled: (node: any) => !!node.children?.length,
  icon: (node: any) => {
    if (!node.children?.length || node.isLeaf) {
      return {
        component: 'Collection',
        props: { size: 16, color: '#3B82F6' }
      }
    }
    return {
      component: 'FolderOpened',
      props: { size: 16, color: '#F59E0B' }
    }
  }
}

const filteredKnowledgeTree = computed(() => {
  if (!knowledgeSearchQuery.value.trim()) return props.knowledgeTreeData
  const query = knowledgeSearchQuery.value.toLowerCase()

  const filterTree = (nodes: any[]): any[] => {
    return nodes.reduce((acc: any[], node) => {
      const matches = node.name.toLowerCase().includes(query)
      const filteredChildren = node.children ? filterTree(node.children) : []

      if (matches || filteredChildren.length > 0) {
        acc.push({
          ...node,
          children: filteredChildren
        })
      }
      return acc
    }, [])
  }

  return filterTree(props.knowledgeTreeData)
})

const findKnowledgeItem = (id: string, items: any[]): any | null => {
  for (const item of items) {
    if (item.id === id) return item
    if (item.children) {
      const found = findKnowledgeItem(id, item.children)
      if (found) return found
    }
  }
  return null
}

const getKnowledgePath = (id: string): string => {
  const paths: string[] = []
  const findPath = (id: string, items: any[], currentPath: string[]): boolean => {
    for (const item of items) {
      const newPath = [...currentPath, item.name]
      if (item.id === id) {
        paths.push(newPath.join(' / '))
        return true
      }
      if (item.children && findPath(id, item.children, newPath)) {
        return true
      }
    }
    return false
  }
  findPath(id, props.knowledgeTreeData, [])
  return paths[0] || '未知路径'
}

const handleKnowledgeTreeNodeClick = () => {}

const checkedIds = computed(() => {
  return knowledgeTreeRef.value?.getCheckedKeys() || []
})

const checkedKnowledge = computed(() => {
  return checkedIds.value.map(id => {
    const item = findKnowledgeItem(id, props.knowledgeTreeData)
    return item || { id, name: id }
  }).filter(item => item.name !== undefined)
})

const removeFromSelection = (id: string) => {
  const keys = knowledgeTreeRef.value?.getCheckedKeys() || []
  knowledgeTreeRef.value?.setCheckedKeys(keys.filter((k: string) => k !== id))
}

const clearAllSelection = () => {
  knowledgeTreeRef.value?.setCheckedKeys([])
}

const handleConfirm = () => {
  // 确认时再次过滤，确保只返回叶子节点 ID
  const result = sanitizeCheckedIds(checkedIds.value)
  emit('confirm', result)
  emit('update:visible', false)
  ElMessage.success(`已选择 ${result.length} 个知识库`)
}

const handleCancel = () => {
  emit('update:visible', false)
}

// 收集所有叶子节点 ID（用于过滤掉目录节点）
const collectLeafIds = (nodes: any[]): string[] => {
  const leafs: string[] = []
  const walk = (items: any[]) => {
    for (const node of items) {
      if (!node.children?.length || node.isLeaf) {
        leafs.push(node.id)
      } else if (node.children) {
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return leafs
}

const validLeafIds = computed(() => collectLeafIds(props.knowledgeTreeData))

// 过滤掉非法 ID（非叶子节点 / 已不存在的节点）
const sanitizeCheckedIds = (ids: string[]): string[] => {
  const validSet = new Set(validLeafIds.value)
  return ids.filter(id => validSet.has(id))
}

useEnterToConfirm(computed(() => props.visible), handleConfirm)

watch(() => props.visible, async (val) => {
  if (val) {
    knowledgeSearchQuery.value = ''
    await nextTick()
    // 只恢复合法的叶子节点 ID，防止根目录等被错误选中
    const sanitized = sanitizeCheckedIds(props.currentCheckedKnowledgeIds)
    knowledgeTreeRef.value?.setCheckedKeys(sanitized)
  }
})
</script>

<style scoped>
.knowledge-selection-dialog :deep(.el-dialog) {
  border-radius: 16px;
  overflow: hidden;
}

.knowledge-selection-dialog :deep(.el-dialog__header) {
  padding: 20px 24px 16px;
  background: linear-gradient(135deg, #F0F5FF 0%, #EFF6FF 100%);
  border-bottom: 1px solid #E0E7FF;
}

.knowledge-selection-dialog :deep(.el-dialog__title) {
  font-size: 18px;
  font-weight: 700;
  color: #1E293B;
}

.knowledge-selection-dialog :deep(.el-dialog__body) {
  padding: 20px 24px;
  max-height: 520px;
  overflow: hidden;
}

.knowledge-selection-dialog :deep(.el-dialog__footer) {
  padding: 16px 24px 20px;
  border-top: 1px solid #E5E7EB;
}

.knowledge-selection-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  height: 450px;
}

.knowledge-tree-panel,
.selected-panel {
  display: flex;
  flex-direction: column;
  background: #FAFBFC;
  border-radius: 12px;
  border: 1px solid #E2E8F0;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #F0F5FF 0%, #EFF6FF 100%);
  border-bottom: 1px solid #E0E7FF;
}

.panel-title {
  font-size: 14px;
  font-weight: 700;
  color: #1E293B;
}

.panel-count {
  font-size: 12px;
  color: #64748B;
  font-weight: 600;
}

.panel-count.highlight {
  color: #3B82F6;
  background: #EFF6FF;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
}

.panel-search {
  padding: 12px 16px;
  border-bottom: 1px solid #E2E8F0;
}

.panel-search :deep(.el-input__wrapper) {
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}

.tree-container {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.tree-container::-webkit-scrollbar {
  width: 6px;
}

.tree-container::-webkit-scrollbar-thumb {
  background: #CBD5E1;
  border-radius: 3px;
}

.tree-container::-webkit-scrollbar-track {
  background: transparent;
}

.tree-empty {
  padding: 40px 20px;
  text-align: center;
}

.selected-container {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.selected-container::-webkit-scrollbar {
  width: 6px;
}

.selected-container::-webkit-scrollbar-thumb {
  background: #CBD5E1;
  border-radius: 3px;
}

.selected-container::-webkit-scrollbar-track {
  background: transparent;
}

.selected-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.selected-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: white;
  border-radius: 8px;
  border: 1px solid #E2E8F0;
  transition: all 0.2s ease;
}

.selected-item:hover {
  border-color: #3B82F6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.selected-item-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #EFF6FF;
  color: #3B82F6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.selected-item-content {
  flex: 1;
  min-width: 0;
}

.selected-item-name {
  font-size: 13px;
  font-weight: 600;
  color: #1E293B;
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-item-path {
  font-size: 11px;
  color: #94A3B8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-item-remove {
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.selected-item-remove:hover {
  opacity: 1;
}

.selected-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: #94A3B8;
}

.selected-empty .empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.3;
}

.selected-empty p {
  font-size: 14px;
  font-weight: 600;
  color: #64748B;
  margin: 0 0 4px 0;
}

.selected-empty span {
  font-size: 12px;
  color: #94A3B8;
}

.selected-actions {
  padding: 12px 16px;
  border-top: 1px solid #E2E8F0;
  background: #FAFBFC;
}

.selected-actions .el-button {
  width: 100%;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-footer-info {
  font-size: 13px;
  color: #64748B;
  font-weight: 500;
}

.dialog-footer-actions {
  display: flex;
  gap: 10px;
}
</style>