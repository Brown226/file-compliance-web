<template>
  <div class="kb-page">
    <div class="kb-layout">
      <!-- 左侧：扁平化目录列表（最多2层） -->
      <aside class="kb-sidebar">
        <div class="kb-sidebar__head">
          <span class="kb-sidebar__title">知识库</span>
          <el-button v-if="canManage" type="primary" link size="small" @click="showCreateFolderDialog">
            <el-icon><Plus /></el-icon>
          </el-button>
        </div>

        <div class="kb-sidebar__search">
          <el-input
            v-model="filterText"
            placeholder="搜索..."
            size="small"
            clearable
            :prefix-icon="Search"
          />
        </div>

        <el-scrollbar class="kb-sidebar__list-wrap">
          <!-- 根级目录（可展开/折叠） -->
          <div v-for="root in filteredSidebarItems" :key="root.id" class="kb-sidebar__group">
            <div
              class="kb-sidebar__group-header"
              :class="{ 'is-active': expandedGroups.has(root.id) }"
            >
              <div class="kb-sidebar__group-left" @click="toggleGroup(root)">
                <el-icon class="kb-sidebar__arrow" :size="12">
                  <ArrowRight v-if="!expandedGroups.has(root.id)" />
                  <ArrowDown v-else />
                </el-icon>
                <el-icon class="kb-sidebar__group-icon" :size="16"><FolderOpened /></el-icon>
                <span class="kb-sidebar__group-name">{{ root.name }}</span>
                <span class="kb-sidebar__group-count">{{ root.childCount }}</span>
              </div>
              <div v-if="canManage" class="kb-sidebar__group-actions" @click.stop>
                <el-dropdown trigger="click" @command="(cmd: string) => handleRootGroupCommand(cmd, root)">
                  <el-icon class="kb-sidebar__group-more"><MoreFilled /></el-icon>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="createFolder">
                        <el-icon><Plus /></el-icon> 新建子文件夹
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
            </div>

            <!-- 子项（平铺展示，不再递归嵌套） -->
            <div v-show="expandedGroups.has(root.id)" class="kb-sidebar__children">
              <div
                v-for="child in root.children"
                :key="child.id"
                class="kb-sidebar__child-item"
                :class="{ 'is-current': currentNodeId === child.id, 'is-folder': !child.isLeaf, 'is-leaf': child.isLeaf }"
                @click="handleNodeClick(child)"
              >
                <el-icon class="kb-sidebar__child-icon" :size="15">
                  <FolderOpened v-if="!child.isLeaf" /><Collection v-else />
                </el-icon>
                <span class="kb-sidebar__child-label" :title="child.name">{{ child.name }}</span>
                <div v-if="canManage" class="kb-sidebar__child-actions" @click.stop>
                  <el-dropdown trigger="click" @command="(cmd: string) => handleTreeCommand(cmd, child)">
                    <el-icon class="kb-sidebar__child-more"><MoreFilled /></el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="createFolder">
                          <el-icon><Plus /></el-icon> 新建子文件夹
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
              </div>

              <!-- 子项为空时提示 -->
              <div v-if="!root.children?.length" class="kb-sidebar__empty-hint">暂无子项</div>
            </div>
          </div>

          <!-- 无数据 -->
          <div v-if="filteredSidebarItems.length === 0 && !filterText" class="kb-sidebar__empty">
            暂无知识库分类
          </div>
        </el-scrollbar>
      </aside>

      <!-- 右侧：内容区 -->
      <main class="kb-main">
        <div class="kb-main__header">
          <div class="kb-main__header-left">
            <!-- 面包屑导航 -->
            <div v-if="breadcrumbPath.length > 0" class="kb-breadcrumb">
              <span
                class="kb-breadcrumb__item kb-breadcrumb__root"
                @click="handleBreadcrumbClick(null)"
              >知识库</span>
              <template v-for="(crumb, idx) in breadcrumbPath" :key="crumb.id">
                <el-icon class="kb-breadcrumb__sep" :size="12"><ArrowRight /></el-icon>
                <span
                  class="kb-breadcrumb__item"
                  :class="{ 'is-current': idx === breadcrumbPath.length - 1 }"
                  @click="handleBreadcrumbClick(crumb)"
                >{{ crumb.name }}</span>
              </template>
            </div>
            <h2 v-else class="kb-main__title">我的知识库</h2>
          </div>
          <div class="kb-main__header-actions">
            <el-input
              v-model="filterText"
              placeholder="知识库名称"
              size="default"
              clearable
              :prefix-icon="Search"
              style="width: 240px"
            />
            <el-button v-if="canManage" type="primary" @click="showCreateKbDialog">
              <el-icon><Plus /></el-icon> 新建
            </el-button>
          </div>
        </div>

        <!-- 卡片网格 -->
        <div v-if="displayItems.length > 0" class="kb-grid">
          <div
            v-for="item in displayItems"
            :key="item.id"
            class="kb-card"
            @click="handleCardClick(item)"
          >
            <div class="kb-card__top">
              <div class="kb-card__avatar kb-card__avatar--kb">
                <el-icon :size="18"><Collection /></el-icon>
              </div>
              <div class="kb-card__name-row">
                <span class="kb-card__name">{{ item.name }}</span>
                <span class="kb-card__tag">知识库</span>
              </div>
              <div class="kb-card__more-wrap" @click.stop>
                <el-dropdown trigger="click" @command="(cmd: string) => handleCardCommand(cmd, item)">
                  <div class="kb-card__more-btn">
                    <el-icon :size="14"><MoreFilled /></el-icon>
                  </div>
                  <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item v-if="canManage" command="upload">
                          <el-icon><Upload /></el-icon> 上传文档
                        </el-dropdown-item>
                        <el-dropdown-item command="documents">
                          <el-icon><Document /></el-icon> 查看文档
                        </el-dropdown-item>
                        <el-dropdown-item v-if="canManage" command="edit">
                          <el-icon><Edit /></el-icon> 编辑信息
                        </el-dropdown-item>
                        <el-dropdown-item v-if="canManage" command="move" divided>
                          <el-icon><FolderOpened /></el-icon> 移动
                        </el-dropdown-item>
                        <el-dropdown-item v-if="canManage" command="permission">
                          <el-icon><Lock /></el-icon> 权限
                        </el-dropdown-item>
                        <el-dropdown-item command="export">
                          <el-icon><Document /></el-icon> 导出
                        </el-dropdown-item>
                        <el-dropdown-item v-if="canManage" command="delete" divided>
                          <el-icon><Delete /></el-icon> 删除
                        </el-dropdown-item>
                      </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>

            <div class="kb-card__desc">
              {{ item.description || '暂无描述' }}
            </div>

            <div class="kb-card__bottom">
              <span class="kb-card__meta">
                <el-icon :size="12"><Document /></el-icon>
                {{ item._count?.documents || 0 }} 文档
              </span>
            </div>

            <div class="kb-card__tags">
              <span class="kb-card__perm-tag kb-card__perm-tag--member">
                <el-icon :size="12"><User /></el-icon> Member
              </span>
              <span class="kb-card__perm-tag kb-card__perm-tag--private">
                <el-icon :size="12"><Lock /></el-icon> 私有
              </span>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="kb-empty">
          <div class="kb-empty__icon">
            <el-icon :size="48" color="#c0c4cc"><FolderOpened /></el-icon>
          </div>
          <p class="kb-empty__text">{{ currentNodeId ? '此目录下暂无知识库' : '暂无知识库' }}</p>
          <el-button v-if="canManage" type="primary" @click="showCreateKbDialog">
            <el-icon><Plus /></el-icon> 新建知识库
          </el-button>
        </div>
      </main>
    </div>

    <!-- 新建/编辑对话框（照搬 MaxKB CreateFolderDialog） -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="440px"
      destroy-on-close
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-position="top" require-asterisk-position="right">
        <el-form-item label="名称" prop="name">
          <el-input
            v-model="formData.name"
            placeholder="请输入名称"
            maxlength="64"
            show-word-limit
            @blur="formData.name = formData.name.trim()"
          />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="formData.description"
            type="textarea"
            placeholder="可选，简要描述用途"
            maxlength="128"
            show-word-limit
            :autosize="{ minRows: 3, maxRows: 6 }"
            @blur="formData.description = formData.description.trim()"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">{{ isEdit ? '确定' : '添加' }}</el-button>
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
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'
import {
  Plus, Upload, Edit, Delete, Search,
  FolderOpened, Collection, Document, MoreFilled,
  User, Lock, ArrowRight, ArrowDown,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import UploadDialog from './components/UploadDialog.vue'
import {
  getKnowledgeCategoriesApi,
  createKnowledgeCategoryApi,
  updateKnowledgeCategoryApi,
  deleteKnowledgeCategoryApi,
  uploadKnowledgeDocumentApi,
  getKnowledgeTreeApi,
  type KnowledgeCategory,
  type KnowledgeTreeNode,
} from '@/api/knowledge-category'

const router = useRouter()
const userStore = useUserStore()
const canManage = computed(() => userStore.isAdminOrManager())

// ===== 扁平化目录列表 =====
const treeData = ref<KnowledgeTreeNode[]>([])
const allCategories = ref<KnowledgeCategory[]>([])
const filterText = ref('')
const currentNodeId = ref<string>('')
const treeLoading = ref(false)

const expandedGroups = ref<Set<string>>(new Set())

interface SidebarGroup {
  id: string
  name: string
  isLeaf: boolean
  childCount: number
  children: KnowledgeTreeNode[]
}

const sidebarGroups = computed<SidebarGroup[]>(() => {
  return (treeData.value || []).map(root => ({
    id: root.id,
    name: root.name,
    isLeaf: root.isLeaf,
    childCount: (root.children || []).length,
    children: (root.children || []).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  }))
})

const filteredSidebarItems = computed<SidebarGroup[]>(() => {
  if (!filterText.value.trim()) return sidebarGroups.value
  const q = filterText.value.trim().toLowerCase()
  return sidebarGroups.value.filter(group => {
    if (group.name.toLowerCase().includes(q)) return true
    return group.children.some(c => c.name.toLowerCase().includes(q))
  }).map(group => ({
    ...group,
    children: group.children.filter(c => c.name.toLowerCase().includes(q) || group.name.toLowerCase().includes(q)),
  }))
})

// ===== 面包屑导航 =====
interface BreadcrumbNode { id: string; name: string }

const breadcrumbPath = computed<BreadcrumbNode[]>(() => {
  if (!currentNodeId.value) return []
  const path: BreadcrumbNode[] = []
  const findPath = (nodes: KnowledgeTreeNode[], targetId: string, currentPath: BreadcrumbNode[]): boolean => {
    for (const node of nodes) {
      const newPath = [...currentPath, { id: node.id, name: node.name }]
      if (node.id === targetId) {
        path.push(...newPath)
        return true
      }
      if (node.children?.length && findPath(node.children, targetId, newPath)) return true
    }
    return false
  }
  findPath(treeData.value, currentNodeId.value, [])
  return path
})

const toggleGroup = (group: SidebarGroup) => {
  if (expandedGroups.value.has(group.id)) {
    expandedGroups.value.delete(group.id)
  } else {
    expandedGroups.value.add(group.id)
  }
  expandedGroups.value = new Set(expandedGroups.value)
}

const handleBreadcrumbClick = (crumb: BreadcrumbNode | null) => {
  if (!crumb) {
    currentNodeId.value = ''
    return
  }
  currentNodeId.value = crumb.id
}

const currentNodeName = computed(() => {
  if (!currentNodeId.value) return ''
  const find = (nodes: KnowledgeTreeNode[]): string | null => {
    for (const n of nodes) { if (n.id === currentNodeId.value) return n.name; if (n.children?.length) { const r = find(n.children); if (r) return r } }
    return null
  }
  return find(treeData.value)
})

const flatCategories = computed(() => {
  const result: KnowledgeCategory[] = []
  const flatten = (items: KnowledgeCategory[]) => {
    for (const item of items) {
      result.push(item)
      if (item.children?.length) flatten(item.children)
    }
  }
  flatten(allCategories.value)
  return result
})

const displayItems = computed(() => {
  if (!currentNodeId.value) return flatCategories.value.filter(c => !c.parentId && c.isLeaf)
  const descendantIds = new Set<string>()
  const collect = (parentId: string) => {
    descendantIds.add(parentId)
    for (const c of flatCategories.value) {
      if (c.parentId === parentId) collect(c.id)
    }
  }
  collect(currentNodeId.value)
  return flatCategories.value.filter(c => c.isLeaf && descendantIds.has(c.parentId || ''))
})

// ===== 工具函数 =====
const filterNode = (value: string, data: any) => {
  if (!value) return true
  return (data.name || '').toLowerCase().includes(value.toLowerCase())
}

watch(filterText, () => {})

// ===== 加载数据 =====
const fetchTree = async () => {
  treeLoading.value = true
  try { const { data } = await getKnowledgeTreeApi(); treeData.value = data || [] }
  catch (_) {}
  finally { treeLoading.value = false }
}

const fetchCategories = async () => {
  try { const { data } = await getKnowledgeCategoriesApi(); allCategories.value = data || [] }
  catch (_) {}
}

// ===== 树交互 =====
const handleNodeClick = (data: KnowledgeTreeNode) => {
  currentNodeId.value = data.id
  if (data.isLeaf) {
    router.push(`/admin/knowledge-categories/${data.id}/documents`)
  }
}

const handleTreeCommand = (cmd: string, data: KnowledgeTreeNode) => {
  switch (cmd) {
    case 'createFolder': showCreateFolderDialog(data); break
    case 'edit': showEditDialog(data); break
    case 'delete':
      ElMessageBox.confirm(`确认删除「${data.name}」？`, '删除确认', { type: 'warning' })
        .then(() => handleDelete(data.id)).catch(() => {})
      break
  }
}

const handleRootGroupCommand = (cmd: string, group: SidebarGroup) => {
  const findNodeById = (nodes: KnowledgeTreeNode[], id: string): KnowledgeTreeNode | undefined => {
    for (const n of nodes) { if (n.id === id) return n; if (n.children?.length) { const f = findNodeById(n.children, id); if (f) return f } }
    return undefined
  }
  const node = findNodeById(treeData.value, group.id)
  const target = node || { id: group.id, name: group.name }
  switch (cmd) {
    case 'createFolder':
      showCreateFolderDialog(target as any)
      break
    case 'edit':
      showEditDialog(target as any)
      break
    case 'delete':
      ElMessageBox.confirm(`确认删除「${group.name}」及其所有子项？`, '删除确认', { type: 'warning' })
        .then(() => handleDelete(group.id)).catch(() => {})
      break
  }
}

// ===== 卡片交互 =====
const handleCardClick = (cat: KnowledgeCategory) => {
  router.push(`/admin/knowledge-categories/${cat.id}/documents`)
}

const handleCardCommand = (cmd: string, cat: KnowledgeCategory) => {
  switch (cmd) {
    case 'upload': showUploadDialog(cat); break
    case 'documents': router.push(`/admin/knowledge-categories/${cat.id}/documents`); break
    case 'edit': showEditDialog(cat); break
    case 'move':
      ElMessage.info('移动功能开发中')
      break
    case 'permission':
      ElMessage.info('权限管理功能开发中')
      break
    case 'export':
      ElMessage.info('导出功能开发中')
      break
    case 'delete':
      ElMessageBox.confirm(`确认删除「${cat.name}」？`, '删除确认', { type: 'warning' })
        .then(() => handleDelete(cat.id)).catch(() => {})
      break
  }
}

// ===== 对话框（照搬 MaxKB CreateFolderDialog） =====
const dialogVisible = ref(false)
const formRef = ref<FormInstance>()
const isEdit = ref(false)
const editId = ref('')
const submitting = ref(false)
const dialogMode = ref<'kb' | 'folder'>('kb')

const dialogTitle = computed(() => {
  if (isEdit.value) return '编辑'
  return dialogMode.value === 'kb' ? '新建知识库' : '新建文件夹'
})

const formData = reactive({ name: '', description: '', parentId: '' as string | undefined })

const formRules: FormRules = {
  name: [
    { required: true, message: '请输入名称', trigger: 'blur' },
    { min: 1, max: 64, message: '名称长度为 1-64 个字符', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (!value) { callback(); return }
        const v = value.trim()
        if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(v)) {
          callback(new Error('名称需包含至少1个汉字、字母或数字'))
          return
        }
        if (/^[\;\.\,\s]+$/.test(v)) {
          callback(new Error('名称不能仅为标点符号'))
          return
        }
        if (/^[a-zA-Z]v[a-zA-Z]*$/i.test(v) || /^v+$/i.test(v)) {
          callback(new Error('名称格式不合法'))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
  description: [
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (!value || !value.trim()) { callback(); return }
        if (!/[\u4e00-\u9fa5A-Za-z0-9]{2,}/.test(value.trim())) {
          callback(new Error('描述需包含至少2个连续的有效字符'))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
}

const showCreateKbDialog = () => {
  isEdit.value = false; editId.value = ''
  dialogMode.value = 'kb'
  formData.name = ''; formData.description = ''
  formData.parentId = currentNodeId.value || undefined
  dialogVisible.value = true
}

const showCreateFolderDialog = (parent?: KnowledgeTreeNode | KnowledgeCategory | null) => {
  isEdit.value = false; editId.value = ''
  dialogMode.value = 'folder'
  formData.name = ''; formData.description = ''
  formData.parentId = parent?.id || currentNodeId.value || undefined
  dialogVisible.value = true
}

const showEditDialog = (node: KnowledgeTreeNode | KnowledgeCategory) => {
  isEdit.value = true; editId.value = node.id
  const cat = node as any
  formData.name = cat.name || ''; formData.description = cat.description || ''
  formData.parentId = cat.parentId || undefined
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    submitting.value = true
    try {
      const cleanName = (raw: string) => raw.trim().replace(/\s{2,}/g, ' ')
      const payload: any = {
        name: cleanName(formData.name),
        parentId: formData.parentId,
        isLeaf: dialogMode.value === 'kb',
      }
      if (formData.description?.trim()) {
        payload.description = formData.description.trim()
      }
      if (isEdit.value) {
        await updateKnowledgeCategoryApi(editId.value, payload)
        ElMessage.success('编辑成功')
      } else {
        await createKnowledgeCategoryApi(payload)
        ElMessage.success('创建成功')
      }
      dialogVisible.value = false
      await Promise.all([fetchTree(), fetchCategories()])
    } catch (_) { ElMessage.error('操作失败') }
    finally { submitting.value = false }
  })
}

useEnterToConfirm(dialogVisible, handleSubmit, { disabled: submitting })

const handleDelete = async (id: string) => {
  try {
    await deleteKnowledgeCategoryApi(id)
    ElMessage.success('已删除')
    if (currentNodeId.value === id) currentNodeId.value = ''
    await Promise.all([fetchTree(), fetchCategories()])
  } catch (e: any) { ElMessage.error(e?.message || '删除失败') }
}

// ===== 上传 =====
const uploadDialogVisible = ref(false)
const uploadTarget = ref<KnowledgeCategory | null>(null)

const showUploadDialog = (cat: KnowledgeCategory) => { uploadTarget.value = cat; uploadDialogVisible.value = true }

const onUploadDone = async () => { await Promise.all([fetchTree(), fetchCategories()]) }

// ===== 生命周期 =====
onMounted(async () => {
  await Promise.all([fetchTree(), fetchCategories()])
  await nextTick()
  if (treeData.value.length > 0) {
    const firstNode = treeData.value[0]
    if (firstNode) {
      currentNodeId.value = firstNode.id
      expandedGroups.value.add(firstNode.id)
    }
  }
})
</script>

<style scoped>
/* 布局 */
.kb-page { height: calc(100vh - 84px); margin: 0 auto; }
.kb-layout {
  display: flex;
  height: 100%;
  background: #fff;
  border-radius: 10px;
  border: 1px solid #e8eaed;
  overflow: hidden;
}

/* 左侧扁平化列表栏 */
.kb-sidebar {
  width: 248px; min-width: 248px;
  display: flex; flex-direction: column;
  border-right: 1px solid #f0f0f2;
  background: #fafbfc;
}
.kb-sidebar__head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 12px;
}
.kb-sidebar__title { font-size: 15px; font-weight: 700; color: #1f2937; }
.kb-sidebar__search { padding: 0 16px 10px; }
.kb-sidebar__search :deep(.el-input__wrapper) { border-radius: 6px; box-shadow: 0 0 0 1px #e5e7eb inset; }
.kb-sidebar__list-wrap { flex: 1; overflow: hidden; }
.kb-sidebar__list-wrap :deep(.el-scrollbar) { height: 100%; }

/* 分组 */
.kb-sidebar__group { margin-bottom: 2px; }
.kb-sidebar__group-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px 8px 12px;
  cursor: pointer;
  border-radius: 6px;
  margin: 2px 8px;
  transition: background 0.15s, color 0.15s;
}
.kb-sidebar__group-left {
  display: flex; align-items: center; gap: 6px;
  flex: 1; min-width: 0;
  user-select: none;
}
.kb-sidebar__group-header:hover { background: rgba(59, 130, 246, 0.06); }
.kb-sidebar__group-header.is-active { background: rgba(59, 130, 246, 0.08); }
.kb-sidebar__arrow {
  color: #9ca3af; transition: transform 0.2s;
  flex-shrink: 0;
}
.kb-sidebar__group-icon { color: #f59e0b; flex-shrink: 0; }
.kb-sidebar__group-name {
  flex: 1; font-size: 13px; font-weight: 600; color: #374151;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.kb-sidebar__group-count {
  font-size: 11px; color: #9ca3af; background: #f3f4f6;
  padding: 0 6px; border-radius: 10px; line-height: 18px;
}
.kb-sidebar__group-actions {
  flex-shrink: 0;
}
.kb-sidebar__group-more {
  cursor: pointer; padding: 4px; border-radius: 4px;
  color: #9ca3af; font-size: 13px; transition: background 0.15s, color 0.15s;
}
.kb-sidebar__group-more:hover { background: #e5e7eb; color: #374151; }

/* 子项（平铺） */
.kb-sidebar__children {
  padding-left: 20px;
}
.kb-sidebar__child-item {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px 6px 10px;
  cursor: pointer;
  border-radius: 6px;
  margin: 1px 8px;
  transition: all 0.15s;
}
.kb-sidebar__child-item:hover { background: rgba(59, 130, 246, 0.06); }
.kb-sidebar__child-item.is-current { background: rgba(59, 130, 246, 0.1); font-weight: 600; }
.kb-sidebar__child-item.is-current .kb-sidebar__child-icon { color: #3b82f6; }
.kb-sidebar__child-item.is-current .kb-sidebar__child-label { color: #1d4ed8; }
.kb-sidebar__child-icon { color: #9ca3af; flex-shrink: 0; transition: color 0.15s; }
.kb-sidebar__child-label {
  flex: 1; font-size: 13px; font-weight: 500; color: #374151;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4;
}
.kb-sidebar__child-actions { flex-shrink: 0; opacity: 0; transition: opacity 0.15s; }
.kb-sidebar__child-item:hover .kb-sidebar__child-actions { opacity: 1; }
.kb-sidebar__child-more {
  cursor: pointer; padding: 3px; border-radius: 4px;
  color: #9ca3af; font-size: 13px; transition: background 0.15s, color 0.15s;
}
.kb-sidebar__child-more:hover { background: #e5e7eb; color: #374151; }

.kb-sidebar__empty-hint {
  padding: 12px 14px; font-size: 12px; color: #9ca3af; text-align: center;
}
.kb-sidebar__empty {
  padding: 32px 16px; text-align: center; font-size: 13px; color: #9ca3af;
}

/* 右侧主区域 */
.kb-main {
  flex: 1; overflow-y: auto;
  padding: 24px 28px; display: flex; flex-direction: column;
}
.kb-main__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.kb-main__header-left {
  display: flex;
  align-items: center;
  min-width: 0;
}
.kb-main__header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

/* 面包屑导航 */
.kb-breadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
}
.kb-breadcrumb__item {
  font-size: 15px;
  font-weight: 700;
  color: #6b7280;
  cursor: pointer;
  transition: color 0.15s;
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kb-breadcrumb__item:hover { color: #3b82f6; }
.kb-breadcrumb__item.is-current { color: #1a1a2e; cursor: default; }
.kb-breadcrumb__root {
  color: #9ca3af;
  font-size: 14px;
  font-weight: 600;
}
.kb-breadcrumb__root:hover { color: #3b82f6; }
.kb-breadcrumb__sep { color: #d1d5db; margin: 0 4px; flex-shrink: 0; }

.kb-main__title { font-size: 18px; font-weight: 700; margin: 0; color: #1a1a2e; letter-spacing: -0.3px; }

/* 卡片网格 */
.kb-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 1100px) { .kb-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 720px) { .kb-grid { grid-template-columns: 1fr; } .kb-main { padding: 16px; } .kb-sidebar { display: none; } }

/* 卡片 */
.kb-card {
  display: flex; flex-direction: column;
  background: #fff; border: 1.5px solid #e8eaed; border-radius: 10px;
  padding: 18px 16px 14px; cursor: pointer; min-height: 148px;
  transition: border-color 0.2s, box-shadow 0.2s; position: relative;
}
.kb-card:hover { border-color: #93c5fd; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06); }
.kb-card:hover .kb-card__more-wrap { opacity: 1; }

.kb-card__top { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.kb-card__avatar {
  width: 30px; height: 30px; border-radius: 7px;
  background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
  color: #6b7280; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.kb-card__avatar--kb {
  background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%);
  color: #3b82f6;
}
.kb-card__name-row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.kb-card__name { font-size: 14px; font-weight: 600; color: #1f2937; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }
.kb-card__tag {
  font-size: 11px; font-weight: 500; color: #3b82f6;
  background: #eff6ff; padding: 1px 8px; border-radius: 4px;
  flex-shrink: 0; white-space: nowrap;
}
.kb-card__more-wrap { opacity: 0; transition: opacity 0.2s; flex-shrink: 0; }
.kb-card__more-btn {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border-radius: 6px; color: #9ca3af; cursor: pointer; transition: background 0.15s, color 0.15s;
}
.kb-card__more-btn:hover { background: #f3f4f6; color: #374151; }
.kb-card__desc {
  flex: 1; font-size: 12px; color: #9ca3af; line-height: 1.6;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3;
  -webkit-box-orient: vertical; word-break: break-word; margin-bottom: 12px;
}
.kb-card__bottom {
  display: flex; align-items: center; gap: 14px;
  font-size: 12px; color: #9ca3af; padding-top: 10px; border-top: 1px solid #f3f4f6;
}
.kb-card__meta { display: flex; align-items: center; gap: 4px; }

.kb-card__tags {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
}
.kb-card__perm-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
  line-height: 20px;
}
.kb-card__perm-tag--member {
  background: #ecfdf5;
  color: #059669;
}
.kb-card__perm-tag--private {
  background: #f0f4ff;
  color: #4f6ef7;
}

/* 空状态 */
.kb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; }
.kb-empty__icon { margin-bottom: 16px; opacity: 0.45; }
.kb-empty__text { font-size: 14px; color: #9ca3af; margin: 0 0 20px; }

/* 对话框 */
:deep(.el-dialog__header) { padding: 20px 24px 0; }
:deep(.el-dialog__body) { padding: 16px 24px; }
:deep(.el-dialog__footer) { padding: 0 24px 20px; }
</style>
