<template>
  <div class="knowledge-tree-selector" :class="{ 'is-inline': inline }">
    <!-- 内联模式：直接渲染选择区域 -->
    <template v-if="inline">
      <div class="selector-layout selector-layout--inline">
        <div class="tree-panel">
          <div class="panel-header">候选知识库</div>
          <div class="filter-bar">
            <el-input v-model="filterText" placeholder="搜索知识库..." clearable prefix-icon="Search" size="small" />
          </div>
          <div class="tree-body" v-loading="loading">
            <el-tree ref="treeRef" :data="filteredTreeData" show-checkbox node-key="id" :props="treeProps" lazy :load="loadTreeNode" :filter-node-method="filterNode" :check-strictly="false" @check="handleTreeCheck">
              <template #default="{ data }">
                <span class="tree-node-content">
                  <span class="node-icon"><el-icon v-if="data.type === 'folder'"><Folder /></el-icon><el-icon v-else><Document /></el-icon></span>
                  <span class="node-label">{{ data.name }}</span>
                  <span v-if="data.type === 'knowledge'" class="node-count">({{ data.documentCount || 0 }}篇)</span>
                </span>
              </template>
            </el-tree>
            <div v-if="!loading && filteredTreeData.length === 0" class="empty-hint"><el-icon><InfoFilled /></el-icon> 暂无可选知识库</div>
          </div>
        </div>
        <div class="selected-panel">
          <div class="panel-header">已选 {{ selectedCount }}<span v-if="hasSubKb" class="sub-count">(含子库)</span></div>
          <div class="selected-body">
            <template v-if="selectedLeafNodes.length > 0">
              <div v-for="item in selectedLeafNodes" :key="item.id" class="selected-item">
                <el-icon class="item-icon"><Document /></el-icon>
                <span class="item-name">{{ item.name }}</span>
                <span class="item-docs">{{ item.documentCount || 0 }}篇</span>
                <el-icon class="remove-btn" @click="uncheckItem(item)" title="移除"><Close /></el-icon>
              </div>
            </template>
            <div v-else class="empty-selected">请从左侧勾选知识库</div>
          </div>
        </div>
      </div>
    </template>

    <!-- 弹窗模式 -->
    <template v-else>
      <el-button type="primary" plain @click="dialogVisible = true" class="trigger-btn">
        <el-icon><FolderOpened /></el-icon>
        {{ displayText }}
      </el-button>
      <div v-if="selectedItems.length > 0" class="selected-tags">
        <el-tag v-for="item in selectedItems" :key="item.id" closable size="small" @close="removeItem(item)">
          {{ item.name }} ({{ item.documentCount || 0 }}篇)
        </el-tag>
      </div>
      <el-dialog v-model="dialogVisible" title="选择依赖文档库" width="720px" :close-on-click-modal="false" append-to-body destroy-on-close>
        <div class="selector-layout">
          <div class="tree-panel">
            <div class="panel-header">候选知识库</div>
            <div class="filter-bar"><el-input v-model="filterText" placeholder="请输入关键字过滤" clearable prefix-icon="Search" size="default" /></div>
            <div class="tree-body" v-loading="loading">
              <el-tree ref="treeRef" :data="filteredTreeData" show-checkbox node-key="id" :props="treeProps" lazy :load="loadTreeNode" :filter-node-method="filterNode" :check-strictly="false" @check="handleTreeCheck">
                <template #default="{ data }">
                  <span class="tree-node-content">
                    <span class="node-icon"><el-icon v-if="data.type === 'folder'"><Folder /></el-icon><el-icon v-else><Document /></el-icon></span>
                    <span class="node-label">{{ data.name }}</span>
                    <span v-if="data.type === 'knowledge'" class="node-count">({{ data.documentCount || 0 }}篇)</span>
                  </span>
                </template>
              </el-tree>
              <div v-if="!loading && filteredTreeData.length === 0" class="empty-hint"><el-icon><InfoFilled /></el-icon> 暂无可选知识库</div>
            </div>
          </div>
          <div class="selected-panel">
            <div class="panel-header">已选库 {{ selectedCount }}<span v-if="hasSubKb" class="sub-count">(其中包含子库)</span></div>
            <div class="selected-body">
              <template v-if="selectedLeafNodes.length > 0">
                <div v-for="item in selectedLeafNodes" :key="item.id" class="selected-item">
                  <el-icon class="item-icon"><Document /></el-icon>
                  <span class="item-name">{{ item.name }}</span>
                  <span class="item-docs">{{ item.documentCount || 0 }}篇</span>
                  <el-icon class="remove-btn" @click="uncheckItem(item)" title="移除"><Close /></el-icon>
                </div>
              </template>
              <div v-else class="empty-selected">请从左侧选择知识库</div>
            </div>
          </div>
        </div>
        <template #footer>
          <div class="footer-bar">
            <span class="footer-info">当前已选择: <strong>{{ selectedCount }}</strong> 个知识库<template v-if="maxSelect > 0"> / 最多 {{ maxSelect }} 个</template></span>
            <span class="footer-actions"><el-button @click="handleCancel">取消</el-button><el-button type="primary" :disabled="!canConfirm" @click="handleConfirm">确定</el-button></span>
          </div>
        </template>
      </el-dialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { FolderOpened, Folder, Document, InfoFilled, Close } from '@element-plus/icons-vue'
import { ElTree } from 'element-plus'
import { getKnowledgeTreeApi } from '@/api/maxkb'

/** 知识库节点 */
interface KbTreeNode {
  id: string
  name: string
  type: 'folder' | 'knowledge'
  documentCount?: number
  children?: KbTreeNode[]
}

const props = withDefaults(defineProps<{
  /** v-model 绑定值，支持单选(string)或多选(string[]) */
  modelValue?: string | string[]
  /** 是否多选 */
  multiple?: boolean
  /** 最大选择数，0=不限 */
  maxSelect?: number
  /** 是否内联模式（直接渲染选择区域，无需弹窗） */
  inline?: boolean
}>(), {
  modelValue: () => '',
  multiple: true,
  maxSelect: 0,
  inline: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]]
}>()

// 状态
const dialogVisible = ref(false)
const loading = ref(false)
const filterText = ref('')
const treeData = ref<KbTreeNode[]>([])
const checkedKeys = ref<(string | number)[]>([])

// 树引用
const treeRef = ref<InstanceType<typeof ElTree>>()

// el-tree 懒加载 props，使用 any 兼容 Element Plus 内部类型
const treeProps = {
  label: 'name',
  children: 'children',
  isLeaf: (data: any) => !data.children?.length,
}

// 计算属性：过滤后的数据
const filteredTreeData = computed(() => {
  if (!filterText.value) return treeData.value
  return filterTree(treeData.value, filterText.value.toLowerCase())
})

/** el-tree 懒加载回调：仅在展开时加载子节点 */
const loadTreeNode = (node: any, resolve: (data: KbTreeNode[]) => void) => {
  if (node.level === 0) {
    resolve(filteredTreeData.value)
  } else {
    resolve(node.data.children || [])
  }
}

// 计算属性：当前选中叶子节点（仅知识库）
const selectedLeafNodes = computed(() => {
  return getCheckedLeaves(treeData.value, new Set(checkedKeys.value.map(String)))
})

// 计算属性：已选数量
const selectedCount = computed(() => {
  // 统计实际选中的知识库节点数（不含文件夹）
  return selectedLeafNodes.value.length
})

// 是否包含子知识库（通过文件夹间接选中的）
const hasSubKb = computed(() => {
  const allChecked = new Set(checkedKeys.value.map(String))
  // 如果有 folder 类型的 key 被选中，说明包含了子库
  for (const node of flattenNodes(treeData.value)) {
    if (node.type === 'folder' && allChecked.has(node.id)) {
      if ((node.children || []).some(c => c.type === 'knowledge')) return true
    }
  }
  return false
})

// 触发按钮文字
const displayText = computed(() => {
  if (selectedLeafNodes.value.length === 0) return '选择知识库...'
  return `已选 ${selectedLeafNodes.value.length} 个知识库`
})

// 已选项（用于 inline tag 展示）
const selectedItems = computed(() => selectedLeafNodes.value)

// 是否可以确认
const canConfirm = computed(() => {
  return props.multiple ? selectedCount.value > 0 : selectedCount.value === 1
})

// 监听过滤文本变化
watch(filterText, (val) => {
  treeRef.value?.filter(val)
})

// 加载知识库树
async function loadTree() {
  loading.value = true
  try {
    const res = await getKnowledgeTreeApi()
    // 兼容不同封装层级：拦截器可能已解开 { code, data }，也可能未解开
    // 并将 KnowledgeTreeNode 转换为 KbTreeNode（type: 'dataset' -> 'folder', 'document' -> 'knowledge'）
    const rawArr = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : [])
    treeData.value = rawArr.map((node: any): KbTreeNode => ({
      id: node.id,
      name: node.name,
      type: node.type === 'dataset' ? 'folder' : 'knowledge',
      documentCount: node.documentCount,
      children: node.children?.map((child: any): KbTreeNode => ({
        id: child.id,
        name: child.name,
        type: child.type === 'dataset' ? 'folder' : 'knowledge',
        documentCount: child.documentCount,
        children: child.children,
      })),
    }))
  } catch (e: any) {
    // 静默降级：加载失败时置空树，不影响页面其他功能
    console.error(e)
    treeData.value = []
  } finally {
    loading.value = false
  }
}

// 打开对话框时加载数据
watch(dialogVisible, (val) => {
  if (val) {
    loadTree()
    syncCheckFromModel()
  }
})

// 从 modelValue 初始化选中状态
function syncCheckFromModel() {
  if (!Array.isArray(props.modelValue)) {
    checkedKeys.value = [props.modelValue].filter(Boolean)
  } else {
    checkedKeys.value = [...(props.modelValue as string[])]
  }
}

onMounted(() => {
  syncCheckFromModel()
  if (props.inline) {
    loadTree()
  }
})

watch(() => props.modelValue, () => {
  if (!dialogVisible.value) {
    syncCheckFromModel()
  }
})

// ====== 事件处理 ======

function handleTreeCheck() {
  if (!treeRef.value) return
  checkedKeys.value = (treeRef.value.getCheckedKeys(true)) as string[]

  // 超出限制检查
  if (props.maxSelect > 0 && selectedCount.value > props.maxSelect) {
    const lastChecked = checkedKeys.value.pop()
    if (lastChecked) {
      treeRef.value.setChecked(lastChecked, false, false)
    }
  }

  // 内联模式：勾选即生效
  if (props.inline) {
    emit('update:modelValue',
      props.multiple
        ? selectedLeafNodes.value.map(kb => kb.id)
        : (selectedLeafNodes.value[0]?.id || '')
    )
  }
}

function handleConfirm() {
  emit('update:modelValue',
    props.multiple
      ? selectedLeafNodes.value.map(kb => kb.id)
      : (selectedLeafNodes.value[0]?.id || '')
  )
  dialogVisible.value = false
}

function handleCancel() {
  dialogVisible.value = false
  syncCheckFromModel() // 还原
}

function removeItem(item: KbTreeNode) {
  treeRef.value?.setChecked(item.id, false, false)
}

function uncheckItem(item: KbTreeNode) {
  removeItem(item)
}

function filterNode(value: string, data: any) {
  if (!value) return true
  const lower = value.toLowerCase()
  return data.name.toLowerCase().includes(lower)
}

// ====== 工具函数 ======

/** 递归过滤树 */
function filterTree(nodes: KbTreeNode[], keyword: string): KbTreeNode[] {
  const result: KbTreeNode[] = []
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(keyword)) {
      result.push({ ...node })
    } else if (node.children?.length) {
      const children = filterTree(node.children, keyword)
      if (children.length > 0) {
        result.push({ ...node, children })
      }
    }
  }
  return result
}

/** 扁平化所有节点 */
function flattenNodes(nodes: KbTreeNode[]): KbTreeNode[] {
  const result: KbTreeNode[] = []
  for (const n of nodes) {
    result.push(n)
    if (n.children?.length) result.push(...flattenNodes(n.children))
  }
  return result
}

/** 获取所有被选中的叶子节点（仅 knowledge 类型） */
function getCheckedLeaves(nodes: KbTreeNode[], checkedIds: Set<string>): KbTreeNode[] {
  const result: KbTreeNode[] = []
  for (const node of nodes) {
    if (checkedIds.has(node.id)) {
      if (node.type === 'knowledge') {
        result.push(node)
      }
      // 文件夹被选中 → 收集其所有子知识库
      else if (node.children?.length) {
        result.push(...collectChildKbs(node.children))
      }
    } else if (node.children?.length) {
      // 即使文件夹未全选，也要检查子节点是否单独被选中
      result.push(...getCheckedLeaves(node.children, checkedIds))
    }
  }
  return result
}

/** 收集文件夹下所有子知识库 */
function collectChildKbs(children: KbTreeNode[]): KbTreeNode[] {
  const result: KbTreeNode[] = []
  for (const c of children) {
    if (c.type === 'knowledge') {
      result.push(c)
    } else if (c.children?.length) {
      result.push(...collectChildKbs(c.children))
    }
  }
  return result
}
</script>

<style scoped>
.knowledge-tree-selector { width: 100%; }

.trigger-btn { width: 100%; justify-content: flex-start; }

.selected-tags {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* ===== 内联模式样式 ===== */
.selector-layout--inline {
  height: 300px;
  border-radius: 10px;
  border: 1.5px solid var(--corp-border-light);
  background: #fff;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.is-inline .tree-panel {
  width: 55%;
}

.is-inline .tree-panel .panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  padding: 10px 14px;
  background: linear-gradient(135deg, #f0f7ff 0%, #f8fafc 100%);
  color: var(--corp-primary);
}

.is-inline .selected-panel .panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  padding: 10px 14px;
  background: linear-gradient(135deg, #f0fdf4 0%, #f8fafc 100%);
  color: #16a34a;
}

.is-inline .filter-bar {
  padding: 6px 10px;
}

.is-inline .selected-item {
  padding: 6px 10px;
  border-radius: 6px;
  background: #f0fdf4;
  border: 1px solid #dcfce7;
  margin-bottom: 4px;
}

.is-inline .selected-item:hover {
  background: #dcfce7;
  border-color: #bbf7d0;
}

.is-inline .item-icon { color: #16a34a; }
.is-inline .remove-btn:hover { color: #dc2626; }
.is-inline .empty-selected { padding: 40px 20px; font-size: 12px; color: var(--color-gray-400); }

.is-inline .node-count {
  background: #eff6ff;
  color: #3b82f6;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 11px;
}

.is-inline .item-docs {
  background: #f0fdf4;
  color: #16a34a;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 11px;
}

/* ===== 对话框布局 ===== */
.selector-layout {
  display: flex;
  gap: 16px;
  height: 420px;
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tree-panel {
  width: 380px;
  border-right: 1px solid var(--corp-border-light);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.panel-header {
  padding: 10px 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
  background: var(--corp-bg-sunken);
  border-bottom: 1px solid var(--corp-border-light);
  flex-shrink: 0;
}

.filter-bar {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-gray-100);
  flex-shrink: 0;
}

.tree-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

/* ===== 树节点样式 ===== */
.tree-node-content {
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  line-height: normal;
}

.node-icon {
  color: var(--corp-text-tertiary);
  font-size: 15px;
  flex-shrink: 0;
  display: inline-flex !important;
  align-items: center;
}

.node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--corp-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
}

.node-count {
  color: var(--corp-text-tertiary);
  font-size: 12px;
  flex-shrink: 0;
}

.empty-hint {
  text-align: center;
  color: var(--color-gray-400);
  padding: 40px 20px;
  font-size: 13px;
}
.empty-hint .el-icon { font-size: 32px; margin-bottom: 8px; }

/* ===== 右侧面板 ===== */
.selected-panel {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
}
.selected-panel .panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sub-count { font-weight: normal; color: var(--corp-text-tertiary); font-size: 12px; }

.selected-body { flex: 1; overflow-y: auto; padding: 8px 12px; }

.selected-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin-bottom: 4px;
  background: var(--corp-bg-sunken);
  border-radius: var(--radius-sm);
  font-size: 13px;
  transition: background 0.2s;
}
.selected-item:hover { background: var(--color-gray-100); }

.item-icon { color: var(--corp-primary); font-size: 14px; flex-shrink: 0; }

.item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--corp-text-primary);
}
.item-docs { color: var(--corp-text-tertiary); font-size: 12px; flex-shrink: 0; }

.remove-btn {
  cursor: pointer;
  color: var(--color-gray-400);
  transition: color 0.2s;
  flex-shrink: 0;
  font-size: 13px;
}
.remove-btn:hover { color: var(--corp-danger); }

.empty-selected {
  text-align: center;
  color: var(--color-gray-400);
  padding: 60px 20px;
  font-size: 13px;
}

/* ===== 底部栏 ===== */
.footer-bar { display: flex; justify-content: space-between; align-items: center; width: 100%; }
.footer-info { color: var(--corp-text-secondary); font-size: 13px; }
.footer-info strong { color: var(--corp-primary); }
.footer-actions { display: flex; gap: 8px; }

/* ===== el-tree 深度样式修复 ===== */
::deep(.el-tree-node__content) { height: 34px; border-radius: var(--radius-sm); pointer-events: auto !important; }
::deep(.el-tree-node__content:hover) { background-color: var(--corp-primary-lighter); }
::deep(.el-checkbox__inner) { border-radius: 3px; }

/* 修复树节点中文方块乱码 + 强制可交互 + 正确字体 */
::deep(.el-tree),
::deep(.el-tree-node),
::deep(.el-tree-node__wrapper),
::deep(.el-tree-node__expand-icon),
::deep(.el-tree-node__content),
::deep(.el-tree-node__label),
::deep(.node-label),
::deep(.node-icon) {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif !important;
  pointer-events: auto !important;
}
</style>
