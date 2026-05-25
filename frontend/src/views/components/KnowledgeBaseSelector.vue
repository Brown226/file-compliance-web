<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="选择知识库"
    width="680px"
    :close-on-click-modal="false"
    class="kb-selector-dialog"
  >
    <div class="kb-selector-body">
      <div class="kb-selector-left">
        <div class="kb-selector-search">
          <el-input
            v-model="searchQuery"
            placeholder="搜索知识库..."
            clearable
            prefix-icon="Search"
            size="small"
          />
        </div>
        <div class="kb-selector-tree">
          <el-tree
            ref="treeRef"
            :data="filteredTree"
            :props="treeProps"
            node-key="id"
            show-checkbox
            check-strictly
            :default-expand-all="true"
            :expand-on-click-node="false"
          />
          <el-empty v-if="filteredTree.length === 0" description="未找到匹配的知识库" :image-size="60" />
        </div>
      </div>

      <div class="kb-selector-right">
        <div class="kb-selected-header">
          <span class="kb-selected-title">已选知识库</span>
          <el-tag v-if="checkedIds.length > 0" size="small" type="primary" effect="plain">
            {{ checkedIds.length }} 个
          </el-tag>
        </div>
        <div class="kb-selected-list">
          <div v-if="checkedItems.length > 0" class="kb-selected-items">
            <div v-for="item in checkedItems" :key="item.id" class="kb-selected-item">
              <el-icon class="kb-selected-item-icon"><Collection /></el-icon>
              <span class="kb-selected-item-name">{{ item.name }}</span>
              <el-button
                type="danger"
                link
                size="small"
                @click="removeItem(item.id)"
              >
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
          </div>
          <div v-else class="kb-selected-empty">
            <el-icon><FolderOpened /></el-icon>
            <span>请从左侧勾选知识库</span>
          </div>
        </div>
        <div v-if="checkedIds.length > 0" class="kb-selected-actions">
          <el-button size="small" @click="clearAll">清空全部</el-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="kb-selector-footer">
        <span class="kb-selector-footer-info">已选 {{ checkedIds.length }} 个知识库</span>
        <div class="kb-selector-footer-actions">
          <el-button @click="$emit('update:visible', false)">取消</el-button>
          <el-button type="primary" @click="handleConfirm">确认选择</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, Collection, FolderOpened, Search } from '@element-plus/icons-vue'
import type { KnowledgeTreeNode } from '@/api/knowledge-category'

const props = defineProps<{
  visible: boolean
  treeData: KnowledgeTreeNode[]
  selectedIds: string[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'confirm', ids: string[]): void
}>()

const searchQuery = ref('')
const treeRef = ref()

const treeProps = {
  label: 'name',
  children: 'children',
  icon: (node: any) => {
    if (node.isLeaf || !node.children?.length) {
      return { component: 'Collection', props: { size: 16, color: '#3B82F6' } }
    }
    return { component: 'FolderOpened', props: { size: 16, color: '#F59E0B' } }
  }
}

const filteredTree = computed(() => {
  if (!searchQuery.value.trim()) return props.treeData
  const query = searchQuery.value.toLowerCase()
  const filter = (nodes: KnowledgeTreeNode[]): KnowledgeTreeNode[] => {
    return nodes.reduce<KnowledgeTreeNode[]>((acc, node) => {
      const match = node.name.toLowerCase().includes(query)
      const filteredChildren = node.children ? filter(node.children) : []
      if (match || filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren })
      }
      return acc
    }, [])
  }
  return filter(props.treeData)
})

const findNode = (id: string, nodes: KnowledgeTreeNode[]): KnowledgeTreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(id, node.children)
      if (found) return found
    }
  }
  return null
}

const checkedIds = computed(() => treeRef.value?.getCheckedKeys() || [])

const checkedItems = computed(() => {
  return checkedIds.value
    .map((id: string) => findNode(id, props.treeData))
    .filter((n): n is KnowledgeTreeNode => !!n)
})

const removeItem = (id: string) => {
  const keys: string[] = treeRef.value?.getCheckedKeys() || []
  treeRef.value?.setCheckedKeys(keys.filter(k => k !== id))
}

const clearAll = () => {
  treeRef.value?.setCheckedKeys([])
}

const handleConfirm = () => {
  const leafIds = checkedIds.value.filter((id: string) => {
    const node = findNode(id, props.treeData)
    return node && (node.isLeaf || !node.children?.length)
  })
  emit('confirm', [...leafIds])
  emit('update:visible', false)
  ElMessage.success(`已选择 ${leafIds.length} 个知识库`)
}

watch(() => props.visible, async (val) => {
  if (val) {
    searchQuery.value = ''
    await nextTick()
    const leafIds = props.selectedIds.filter(id => {
      const node = findNode(id, props.treeData)
      return node && (node.isLeaf || !node.children?.length)
    })
    treeRef.value?.setCheckedKeys(leafIds)
  }
})
</script>

<style scoped>
.kb-selector-dialog :deep(.el-dialog) {
  border-radius: 14px;
  overflow: hidden;
}

.kb-selector-dialog :deep(.el-dialog__header) {
  padding: 18px 24px 14px;
  background: linear-gradient(135deg, #F0F5FF 0%, #EFF6FF 100%);
  border-bottom: 1px solid #E0E7FF;
}

.kb-selector-dialog :deep(.el-dialog__title) {
  font-size: 17px;
  font-weight: 700;
  color: #1E293B;
}

.kb-selector-dialog :deep(.el-dialog__body) {
  padding: 16px 20px;
}

.kb-selector-dialog :deep(.el-dialog__footer) {
  padding: 14px 20px 18px;
  border-top: 1px solid #E5E7EB;
}

.kb-selector-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  height: 400px;
}

.kb-selector-left,
.kb-selector-right {
  display: flex;
  flex-direction: column;
  background: #FAFBFC;
  border-radius: 10px;
  border: 1px solid #E2E8F0;
  overflow: hidden;
}

.kb-selector-search {
  padding: 12px;
  border-bottom: 1px solid #E2E8F0;
}

.kb-selector-search :deep(.el-input__wrapper) {
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}

.kb-selector-tree {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.kb-selector-tree::-webkit-scrollbar {
  width: 5px;
}

.kb-selector-tree::-webkit-scrollbar-thumb {
  background: #CBD5E1;
  border-radius: 3px;
}

.kb-selected-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: linear-gradient(135deg, #F0F5FF 0%, #EFF6FF 100%);
  border-bottom: 1px solid #E0E7FF;
}

.kb-selected-title {
  font-size: 14px;
  font-weight: 700;
  color: #1E293B;
}

.kb-selected-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.kb-selected-list::-webkit-scrollbar {
  width: 5px;
}

.kb-selected-list::-webkit-scrollbar-thumb {
  background: #CBD5E1;
  border-radius: 3px;
}

.kb-selected-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kb-selected-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: white;
  border-radius: 8px;
  border: 1px solid #E2E8F0;
  transition: all 0.2s;
}

.kb-selected-item:hover {
  border-color: #3B82F6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);
}

.kb-selected-item-icon {
  color: #3B82F6;
  flex-shrink: 0;
}

.kb-selected-item-name {
  flex: 1;
  font-size: 13px;
  color: #1E293B;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kb-selected-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #94A3B8;
  font-size: 13px;
  gap: 8px;
}

.kb-selected-empty .el-icon {
  font-size: 36px;
  opacity: 0.4;
}

.kb-selected-actions {
  padding: 10px 12px;
  border-top: 1px solid #E2E8F0;
}

.kb-selected-actions .el-button {
  width: 100%;
}

.kb-selector-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kb-selector-footer-info {
  font-size: 13px;
  color: #64748B;
  font-weight: 500;
}

.kb-selector-footer-actions {
  display: flex;
  gap: 10px;
}
</style>
