<template>
  <div class="kb-page">
    <!-- 面包屑导航 -->
    <el-breadcrumb separator="/" class="kb-breadcrumb">
      <el-breadcrumb-item :to="{ path: '/admin/knowledge-categories' }">知识库管理</el-breadcrumb-item>
      <el-breadcrumb-item v-if="currentTreeNode">{{ currentTreeNode.name }}</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- 统计卡片 -->
    <div class="kb-stats">
      <StatsCard :value="treeStats.totalFolders" label="目录节点" :icon="FolderOpened" variant="primary" />
      <StatsCard :value="treeStats.totalKnowledgeBases" label="知识子库" :icon="Collection" variant="info" />
      <StatsCard :value="treeStats.totalDocuments" label="向量片段" :icon="DataAnalysis" variant="success" />
    </div>

    <!-- 主体：左右分栏 -->
    <div class="kb-main">
      <!-- 左侧目录树面板 -->
      <div class="kb-sidebar" :class="{ 'kb-sidebar--collapsed': sidebarCollapsed }">
        <div class="kb-sidebar__header">
          <span class="kb-sidebar__title">目录结构</span>
          <div class="kb-sidebar__actions">
            <el-tooltip content="新建根目录" placement="top">
              <el-button type="primary" link size="small" @click="showCreateDialog(null)">
                <el-icon><Plus /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="sidebarCollapsed ? '展开' : '收起'" placement="top">
              <el-button link size="small" @click="sidebarCollapsed = !sidebarCollapsed">
                <el-icon><DArrowLeft v-if="!sidebarCollapsed" /><DArrowRight v-else /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
        </div>

        <template v-if="!sidebarCollapsed">
          <div class="kb-sidebar__search">
            <el-input
              v-model="treeFilterText"
              placeholder="搜索目录..."
              size="small"
              clearable
              :prefix-icon="Search"
            />
          </div>
          <div class="kb-sidebar__tree">
            <el-tree
              ref="treeRef"
              :data="treeData"
              :props="treeProps"
              node-key="id"
              :filter-node-method="filterTreeNode"
              :highlight-current="true"
              :expand-on-click-node="false"
              :default-expand-all="true"
              @node-click="handleTreeNodeClick"
            >
              <template #default="{ node, data }">
                <div class="tree-node">
                  <el-icon class="tree-node__icon" :size="14">
                    <FolderOpened v-if="data.type === 'folder'" />
                    <Collection v-else />
                  </el-icon>
                  <span class="tree-node__label">{{ node.label }}</span>
                  <span v-if="data.documentCount !== undefined" class="tree-node__badge">
                    {{ data.documentCount }}
                  </span>
                  <!-- 节点操作下拉 -->
                  <el-dropdown trigger="click" @command="(cmd: string) => handleNodeCommand(cmd, data)" class="tree-node__actions">
                    <el-icon class="tree-node__more" @click.stop><MoreFilled /></el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="create">
                          <el-icon><Plus /></el-icon> 新建子节点
                        </el-dropdown-item>
                        <el-dropdown-item command="edit">
                          <el-icon><Edit /></el-icon> 编辑
                        </el-dropdown-item>
                        <el-dropdown-item command="delete" divided>
                          <el-icon><Delete /></el-icon> 删除
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </template>
            </el-tree>
          </div>
        </template>
      </div>

      <!-- 右侧内容区 -->
      <div class="kb-content">
        <!-- 未选中节点 -->
        <div v-if="!currentTreeNode" class="kb-empty-state">
          <div class="kb-empty-state__icon">
            <el-icon :size="56"><FolderOpened /></el-icon>
          </div>
          <h3 class="kb-empty-state__title">知识库管理</h3>
          <p class="kb-empty-state__desc">请从左侧目录树选择一个目录查看其下的知识库</p>
          <p class="kb-empty-state__hint">点击节点右侧 <el-icon><MoreFilled /></el-icon> 可新建子库、编辑或删除</p>
        </div>

        <!-- 选中节点：显示内容 -->
        <template v-else>
          <div class="kb-content__header">
            <div class="kb-content__title-group">
              <h3 class="kb-content__title">{{ currentTreeNode.name }}</h3>
              <el-tag v-if="currentTreeNode.type === 'folder'" type="primary" size="small" effect="plain">目录</el-tag>
              <el-tag v-else type="success" size="small" effect="plain">知识库</el-tag>
            </div>
            <div class="kb-content__actions">
              <el-button type="primary" size="small" @click="showCreateDialog(currentTreeNode)">
                <el-icon><Plus /></el-icon> 新建子节点
              </el-button>
              <el-button v-if="currentTreeNode.type === 'knowledge'" size="small" @click="showUploadDialog(currentTreeNode)">
                <el-icon><Upload /></el-icon> 上传文档
              </el-button>
            </div>
          </div>

          <!-- 知识库卡片网格 - 响应式 -->
          <div v-if="childCategories.length > 0" class="kb-card-grid">
            <el-row :gutter="16">
              <el-col
                v-for="cat in childCategories"
                :key="cat.id"
                :xs="24" :sm="12" :md="12" :lg="8" :xl="6"
              >
                <div class="kb-card" @click="handleCardClick(cat)">
                  <div class="kb-card__header">
                    <div class="kb-card__icon">
                      <el-icon :size="20"><FolderOpened v-if="hasChildren(cat)" /><Collection v-else /></el-icon>
                    </div>
                    <div class="kb-card__info">
                      <div class="kb-card__name" :title="cat.name">{{ cat.name }}</div>
                      <div class="kb-card__desc" v-if="cat.description" :title="cat.description">
                        {{ cat.description }}
                      </div>
                    </div>
                    <el-dropdown
                      trigger="click"
                      @command="(cmd: string) => handleCardCommand(cmd, cat)"
                      @click.stop
                      class="kb-card__menu"
                    >
                      <el-icon class="kb-card__more"><MoreFilled /></el-icon>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="create">
                            <el-icon><Plus /></el-icon> 新建子节点
                          </el-dropdown-item>
                          <el-dropdown-item command="upload" :disabled="hasChildren(cat)">
                            <el-icon><Upload /></el-icon> 上传文档
                          </el-dropdown-item>
                          <el-dropdown-item command="documents" :disabled="hasChildren(cat)">
                            <el-icon><Document /></el-icon> 查看文档
                          </el-dropdown-item>
                          <el-dropdown-item command="edit">
                            <el-icon><Edit /></el-icon> 编辑
                          </el-dropdown-item>
                          <el-dropdown-item command="delete" divided>
                            <el-icon><Delete /></el-icon> 删除
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                  <div class="kb-card__footer">
                    <div class="kb-card__stat">
                      <el-icon :size="13"><Document /></el-icon>
                      <span>{{ cat._count?.vectorDocuments || 0 }} 文档</span>
                    </div>
                    <div class="kb-card__divider"></div>
                    <div class="kb-card__stat">
                      <el-icon :size="13"><FolderOpened v-if="hasChildren(cat)" /><Collection v-else /></el-icon>
                      <span>{{ hasChildren(cat) ? `${cat.children?.length || 0} 个子节点` : '叶子知识库' }}</span>
                    </div>
                  </div>
                </div>
              </el-col>
            </el-row>
          </div>
          <div v-else class="kb-card-empty">
            <el-empty description="此节点下暂无子节点，点击上方按钮新建" :image-size="80" />
          </div>
        </template>
      </div>
    </div>

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑节点' : '新建节点'"
      width="560px"
      destroy-on-close
    >
      <el-form :model="formData" label-position="top" require-asterisk-position="right">
        <el-form-item label="名称" required>
          <el-input v-model="formData.name" placeholder="如：核电标准、法律法规" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="父级目录">
          <el-tree-select
            v-model="formData.parentId"
            :data="treeSelectData"
            :props="{ label: 'name', value: 'id', children: 'children' } as any"
            placeholder="不选则为根目录"
            clearable
            check-strictly
            :render-after-expand="false"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="formData.description"
            type="textarea"
            :rows="3"
            placeholder="节点用途说明"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="文档类型">
          <el-input v-model="formData.documentTypes" placeholder="standard,law,reference（逗号分隔）" />
          <div class="form-tip">不同类型用英文逗号分隔，仅对叶子知识库收录文档时生效</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 上传文档对话框 -->
    <UploadDialog
      v-model="uploadDialogVisible"
      :target-id="uploadTarget?.id || ''"
      :target-name="uploadTarget?.name || ''"
      :title="`上传文档到 ${uploadTarget?.name || ''}`"
      :upload-fn="uploadKnowledgeDocumentApi"
      @uploaded="onUploadDone"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus, Upload, Edit, Delete, Search,
  FolderOpened, Collection, Document, MoreFilled,
  DataAnalysis, DArrowLeft, DArrowRight,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatsCard from './components/StatsCard.vue'
import UploadDialog from './components/UploadDialog.vue'
import {
  getKnowledgeCategoriesApi,
  createKnowledgeCategoryApi,
  updateKnowledgeCategoryApi,
  deleteKnowledgeCategoryApi,
  uploadKnowledgeDocumentApi,
  getKnowledgeTreeApi,
  getVectorStatsApi,
  type KnowledgeCategory,
  type KnowledgeTreeNode,
} from '@/api/knowledge-category'

const router = useRouter()
const treeRef = ref<any>(null)

// ===== 侧边栏状态 =====
const sidebarCollapsed = ref(false)

// ===== 统计数据 =====
const treeStats = reactive({
  totalFolders: 0,
  totalKnowledgeBases: 0,
  totalDocuments: 0,
})

// ===== 目录树 =====
const treeData = ref<KnowledgeTreeNode[]>([])
const treeProps = { children: 'children', label: 'name' }
const treeFilterText = ref('')
const currentTreeNode = ref<KnowledgeTreeNode | null>(null)

const filterTreeNode = (value: string, data: KnowledgeTreeNode) => {
  if (!value) return true
  return (data.name || '').toLowerCase().includes(value.toLowerCase())
}

watch(treeFilterText, (val) => {
  treeRef.value?.filter(val)
})

// ===== 加载数据 =====
const fetchTree = async () => {
  try {
    const { data } = await getKnowledgeTreeApi()
    treeData.value = data || []

    let totalFolders = 0
    let totalKnowledgeBases = 0
    let totalDocuments = 0
    const countNodes = (nodes: KnowledgeTreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          totalFolders++
        } else {
          totalKnowledgeBases++
        }
        totalDocuments += node.documentCount || 0
        if (node.children) countNodes(node.children)
      }
    }
    countNodes(treeData.value)
    treeStats.totalFolders = totalFolders
    treeStats.totalKnowledgeBases = totalKnowledgeBases
    treeStats.totalDocuments = totalDocuments

    try {
      const stats = await getVectorStatsApi()
      treeStats.totalDocuments = stats.data?.totalCount || totalDocuments
    } catch (_) {}
  } catch (e) {
    console.error('获取目录树失败', e)
  }
}

// ===== 树节点操作 =====
const handleTreeNodeClick = (data: KnowledgeTreeNode) => {
  if (data.type === 'knowledge') {
    // 叶子节点（知识库）→ 直接跳转到文档管理页
    router.push(`/admin/knowledge-categories/${data.id}/documents`)
    return
  }
  currentTreeNode.value = data
}

const handleNodeCommand = (cmd: string, data: KnowledgeTreeNode) => {
  switch (cmd) {
    case 'create': showCreateDialog(data); break
    case 'edit': showEditDialog(data); break
    case 'delete': handleDeleteNode(data); break
  }
}

// ===== 子分类 =====
const childCategories = ref<KnowledgeCategory[]>([])

const hasChildren = (cat: Partial<KnowledgeCategory>) => {
  return Boolean(cat.children && cat.children.length > 0)
}

// 展平树形结构为一维数组
const flattenTree = (nodes: KnowledgeCategory[]): KnowledgeCategory[] => {
  const result: KnowledgeCategory[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children) result.push(...flattenTree(node.children))
  }
  return result
}

watch(currentTreeNode, async (node) => {
  if (!node) {
    childCategories.value = []
    return
  }
  try {
    const { data } = await getKnowledgeCategoriesApi()
    const allCats = flattenTree(data || [])
    if (node.type === 'folder') {
      childCategories.value = allCats.filter(cat => cat.parentId === node.id)
    } else {
      childCategories.value = []
    }
  } catch (e) {
    console.error('获取子分类失败', e)
  }
})

// ===== 卡片操作 =====
const goToDocuments = (cat: KnowledgeCategory) => {
  router.push(`/admin/knowledge-categories/${cat.id}/documents`)
}

const handleCardClick = (cat: KnowledgeCategory) => {
  if (hasChildren(cat)) {
    currentTreeNode.value = {
      id: cat.id,
      name: cat.name,
      parentId: cat.parentId || null,
      type: 'folder',
      documentCount: cat._count?.vectorDocuments || 0,
      children: [],
    }
    return
  }
  goToDocuments(cat)
}

const handleCardCommand = (cmd: string, cat: KnowledgeCategory) => {
  switch (cmd) {
    case 'create': showCreateDialog(cat); break
    case 'upload': if (!hasChildren(cat)) showUploadDialog(cat); break
    case 'documents': if (!hasChildren(cat)) goToDocuments(cat); break
    case 'edit': showEditDialog(cat); break
    case 'delete': handleDelete(cat.id); break
  }
}

// ===== 树形选择器数据 =====
const treeSelectData = ref<KnowledgeCategory[]>([])

const fetchFlatCategories = async () => {
  try {
    const { data } = await getKnowledgeCategoriesApi()
    treeSelectData.value = data || []
  } catch (_) {}
}

// ===== 新建/编辑对话框 =====
const dialogVisible = ref(false)
const isEdit = ref(false)
const editId = ref('')
const formData = reactive({ name: '', description: '', documentTypes: '', parentId: '' as string | undefined })
const submitting = ref(false)

const showCreateDialog = (parentNode: KnowledgeTreeNode | KnowledgeCategory | null) => {
  isEdit.value = false
  editId.value = ''
  formData.name = ''
  formData.description = ''
  formData.documentTypes = ''
  formData.parentId = parentNode?.id || undefined
  dialogVisible.value = true
}

const showEditDialog = (node: KnowledgeTreeNode | KnowledgeCategory) => {
  isEdit.value = true
  editId.value = node.id
  const cat = node as any
  formData.name = cat.name || ''
  formData.description = cat.description || ''
  formData.documentTypes = cat.documentTypes || ''
  formData.parentId = cat.parentId || undefined
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formData.name.trim()) { ElMessage.warning('请输入名称'); return }
  submitting.value = true
  try {
    if (isEdit.value) {
      await updateKnowledgeCategoryApi(editId.value, formData)
      ElMessage.success('更新成功')
    } else {
      await createKnowledgeCategoryApi({
        name: formData.name.trim(),
        description: formData.description,
        documentTypes: formData.documentTypes,
        parentId: formData.parentId || undefined,
      })
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    await fetchTree()
    await fetchFlatCategories()
  } catch (e) {
    ElMessage.error('操作失败')
  } finally {
    submitting.value = false
  }
}

const handleDeleteNode = async (node: KnowledgeTreeNode) => {
  try {
    await ElMessageBox.confirm('仅允许删除空节点。若该节点下还有子节点或文档，系统将拒绝删除。', '删除确认', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch { return }
  await handleDelete(node.id)
}

const handleDelete = async (id: string) => {
  try {
    await deleteKnowledgeCategoryApi(id)
    ElMessage.success('删除成功')
    if (currentTreeNode.value?.id === id) {
      currentTreeNode.value = null
    }
    await fetchTree()
    await fetchFlatCategories()
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  }
}

// ===== 上传对话框 =====
const uploadDialogVisible = ref(false)
const uploadTarget = ref<KnowledgeCategory | KnowledgeTreeNode | null>(null)

const showUploadDialog = (target: KnowledgeCategory | KnowledgeTreeNode) => {
  uploadTarget.value = target
  uploadDialogVisible.value = true
}

const onUploadDone = async () => {
  await fetchTree()
  await fetchFlatCategories()
}

// ===== 生命周期 =====
onMounted(async () => {
  await fetchTree()
  await fetchFlatCategories()
})
</script>

<style scoped>
.kb-page {
  padding: 0;
  animation: page-enter 0.3s ease;
}
@keyframes page-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 面包屑 */
.kb-breadcrumb {
  margin-bottom: var(--space-5);
}
.kb-breadcrumb :deep(.el-breadcrumb__inner) {
  font-weight: 500;
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
}
.kb-breadcrumb :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: var(--corp-text-primary);
  font-weight: 700;
}
.kb-breadcrumb :deep(.el-breadcrumb__separator) {
  color: var(--corp-text-tertiary);
  margin: 0 var(--space-1);
}

/* 统计卡片 */
.kb-stats {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

/* 主体分栏 */
.kb-main {
  display: flex;
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  min-height: calc(100vh - 320px);
  overflow: hidden;
  border: 1px solid var(--corp-border-light);
}

/* 左侧边栏 */
.kb-sidebar {
  width: 280px;
  min-width: 280px;
  border-right: 1px solid var(--corp-border-light);
  background: linear-gradient(180deg, #FAFBFD 0%, #F5F6FA 50%, #F2F3F8 100%);
  display: flex;
  flex-direction: column;
  transition: width var(--corp-transition-base), min-width var(--corp-transition-base);
  position: relative;
}
.kb-sidebar::after {
  content: '';
  position: absolute;
  top: 0;
  right: -1px;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, transparent 40%, transparent 60%, rgba(59, 130, 246, 0.08) 100%);
}
.kb-sidebar--collapsed {
  width: 48px;
  min-width: 48px;
}

.kb-sidebar__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-5) var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--corp-border-light);
}
.kb-sidebar__title {
  font-size: 10px;
  font-weight: 700;
  color: var(--corp-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1.5px;
}
.kb-sidebar__actions {
  display: flex;
  gap: var(--space-1);
}

.kb-sidebar__search {
  padding: var(--space-3) var(--space-3);
}

.kb-sidebar__tree {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) var(--space-2);
}

/* 树节点 */
.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  width: 0;
  padding-right: var(--space-1);
}
.tree-node__icon {
  color: var(--corp-text-tertiary);
  flex-shrink: 0;
  transition: color var(--corp-transition-fast), transform var(--corp-transition-fast);
}
.tree-node:hover .tree-node__icon {
  color: var(--corp-primary);
  transform: scale(1.1);
}
.tree-node__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-text-primary);
}
.tree-node__badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--corp-text-tertiary);
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-full);
  padding: 0 6px;
  min-width: 22px;
  height: 18px;
  line-height: 16px;
  text-align: center;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  transition: all var(--corp-transition-fast);
}
.tree-node:hover .tree-node__badge {
  border-color: var(--color-primary-200);
  color: var(--color-primary-600);
  background: var(--color-primary-50);
}
.tree-node__actions {
  opacity: 0;
  transition: opacity var(--corp-transition-fast);
  flex-shrink: 0;
}
.tree-node:hover .tree-node__actions {
  opacity: 1;
}
.tree-node__more {
  color: var(--corp-text-tertiary);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--radius-sm);
  transition: all var(--corp-transition-fast);
}
.tree-node__more:hover {
  color: var(--corp-primary);
  background: var(--color-primary-50);
}

/* 右侧内容区 */
.kb-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6) var(--space-8);
}

/* 空状态 */
.kb-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px var(--space-8);
  text-align: center;
}
.kb-empty-state__icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-primary-100) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary-300);
  margin-bottom: var(--space-6);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.08);
}
.kb-empty-state__title {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--corp-text-primary);
  margin: 0 0 var(--space-2);
}
.kb-empty-state__desc {
  font-size: var(--text-base);
  color: var(--corp-text-tertiary);
  margin: 0;
  max-width: 320px;
  line-height: 1.6;
}
.kb-empty-state__hint {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  margin-top: var(--space-5);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--bg-surface-hover);
  border-radius: var(--radius-full);
  border: 1px solid var(--corp-border-light);
}

/* 内容区头部 */
.kb-content__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--corp-border-light);
}
.kb-content__title-group {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.kb-content__title {
  font-size: 17px;
  font-weight: 700;
  margin: 0;
  color: var(--corp-text-primary);
  letter-spacing: -0.3px;
}
.kb-content__actions {
  display: flex;
  gap: var(--space-2);
}

/* 卡片 */
.kb-card {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-surface);
  padding: var(--space-5);
  cursor: pointer;
  transition: box-shadow var(--corp-transition-base), transform var(--corp-transition-base);
  margin-bottom: var(--space-4);
  border: 1px solid var(--corp-border-light);
  border-left: 3px solid transparent;
  position: relative;
  overflow: hidden;
}
.kb-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--color-primary-400) 0%, var(--color-primary-200) 100%);
  opacity: 0;
  transition: opacity var(--corp-transition-base);
}
.kb-card:hover {
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
  border-left-color: var(--color-primary-400);
}
.kb-card:hover::before {
  opacity: 1;
}

.kb-card__header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.kb-card__icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-primary-100) 100%);
  color: var(--color-primary-600);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform var(--corp-transition-fast), box-shadow var(--corp-transition-fast);
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.08);
}
.kb-card:hover .kb-card__icon {
  transform: scale(1.08);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
}
.kb-card__info {
  flex: 1;
  min-width: 0;
}
.kb-card__name {
  font-size: 14px;
  font-weight: 700;
  color: var(--corp-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}
.kb-card__desc {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 3px;
  line-height: 1.4;
}
.kb-card__menu {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--corp-transition-fast);
}
.kb-card:hover .kb-card__menu {
  opacity: 1;
}
.kb-card__more {
  color: var(--corp-text-tertiary);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: all var(--corp-transition-fast);
}
.kb-card__more:hover {
  color: var(--corp-primary);
  background: var(--color-primary-50);
}

.kb-card__footer {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--corp-border-light);
}
.kb-card__stat {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  font-weight: 500;
}
.kb-card__stat span {
  font-variant-numeric: tabular-nums;
}
.kb-card__divider {
  width: 1px;
  height: 12px;
  background: var(--corp-border-light);
}

.kb-card-empty {
  padding: var(--space-12);
  display: flex;
  justify-content: center;
}

/* 表单提示 */
.form-tip {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  margin-top: var(--space-1);
  line-height: 1.5;
}

/* 树组件覆盖 */
:deep(.el-tree) {
  background: transparent;
}
:deep(.el-tree-node__content) {
  height: 34px;
  padding-right: 4px;
  border-radius: var(--radius-sm);
  margin-bottom: 1px;
  transition: background var(--corp-transition-fast);
}
:deep(.el-tree-node__content:hover) {
  background: rgba(59, 130, 246, 0.05);
}
:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--color-primary-50);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.12);
}
:deep(.el-tree-node.is-current > .el-tree-node__content .tree-node__icon) {
  color: var(--corp-primary);
}
:deep(.el-tree-node.is-current > .el-tree-node__content .tree-node__badge) {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
  border-color: var(--color-primary-200);
}
:deep(.el-tree-node__expand-icon) {
  color: var(--corp-text-tertiary);
  font-size: 12px;
  transition: transform var(--corp-transition-fast);
}
:deep(.el-tree-node__expand-icon.is-leaf) {
  color: transparent;
}
</style>
