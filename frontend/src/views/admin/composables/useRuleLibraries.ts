/**
 * 规则库管理相关逻辑
 * 从 RuleLibraries.vue 提取
 */
import { ref, computed, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getRuleLibrariesApi,
  getRuleLibraryApi,
  createRuleLibraryApi,
  updateRuleLibraryApi,
  deleteRuleLibraryApi,
  parseRulesPreviewAsyncApi,
  getRuleParseJobApi,
  importRulePreviewItemsApi,
  addRuleItemApi,
  updateRuleItemApi,
  deleteRuleItemApi,
  type RuleLibrary,
  type RuleLibraryItem,
  type RuleLibraryPreviewItem,
} from '@/api/rule-library'

export function useRuleLibraries(canManage: any) {
  const loading = ref(false)
  const submitting = ref(false)
  const parsing = ref(false)
  const importing = ref(false)

  const libraries = ref<RuleLibrary[]>([])
  const selectedLibrary = ref<RuleLibrary | null>(null)
  const drawerVisible = ref(false)

  const searchKeyword = ref('')
  const statusFilter = ref('')

  const dialogVisible = ref(false)
  const isEdit = ref(false)
  const editId = ref('')
  const formData = reactive({ name: '', description: '' })

  const parseDialogVisible = ref(false)
  const previewDialogVisible = ref(false)
  const parseTarget = ref<RuleLibrary | null>(null)
  const parseFiles = ref<File[]>([])
  const previewItems = ref<RuleLibraryPreviewItem[]>([])
  const previewSourceFileName = ref('')
  const importMode = ref<'merge' | 'replace'>('merge')

  const itemDialogVisible = ref(false)
  const itemDialogMode = ref<'create' | 'edit'>('create')
  const editingItemId = ref('')
  const itemForm = reactive({
    ruleCode: '',
    ruleName: '',
    category: '',
    description: '',
    checkMethod: '',
    severity: 'warning',
    executionType: 'BUILTIN_PREFIX',
    builtinPrefix: '',
    targetScope: 'TEXT',
  })

  const itemFilters = reactive({
    keyword: '',
    category: '',
    severity: '',
    enabled: '',
  })

  const categoryOptions = computed(() => {
    const values = new Set<string>()
    ;(selectedLibrary.value?.items || []).forEach((item) => {
      if (item.category) values.add(item.category)
    })
    return Array.from(values)
  })

  const publishedCount = computed(() => libraries.value.filter(item => item.status === 'PUBLISHED').length)
  const executableCount = computed(() => libraries.value.reduce((sum, item) => sum + (item.enabledExecutableItemCount || 0), 0))

  const filteredItems = computed(() => {
    let items = selectedLibrary.value?.items || []
    if (itemFilters.keyword.trim()) {
      const keyword = itemFilters.keyword.trim().toLowerCase()
      items = items.filter(item =>
        [item.ruleCode, item.ruleName, item.description].some(v => (v || '').toLowerCase().includes(keyword)),
      )
    }
    if (itemFilters.category) items = items.filter(item => item.category === itemFilters.category)
    if (itemFilters.severity) items = items.filter(item => item.severity === itemFilters.severity)
    if (itemFilters.enabled === 'enabled') items = items.filter(item => item.enabled)
    if (itemFilters.enabled === 'disabled') items = items.filter(item => !item.enabled)
    return items
  })

  const filteredLibraries = computed(() => {
    let list = libraries.value
    if (searchKeyword.value.trim()) {
      const kw = searchKeyword.value.trim().toLowerCase()
      list = list.filter(lib =>
        lib.name.toLowerCase().includes(kw) ||
        (lib.description || '').toLowerCase().includes(kw)
      )
    }
    if (statusFilter.value) {
      list = list.filter(lib => lib.status === statusFilter.value)
    }
    return list
  })

  // ===== 工具函数 =====
  const getStatusClass = (status: string) => {
    const map: Record<string, string> = { DRAFT: 'status-draft', PUBLISHED: 'status-published', ARCHIVED: 'status-archived' }
    return map[status] || 'status-draft'
  }

  const getStatusTagType = (status: string): 'warning' | 'success' | 'info' => {
    const map: Record<string, 'warning' | 'success' | 'info'> = { DRAFT: 'warning', PUBLISHED: 'success', ARCHIVED: 'info' }
    return map[status] || 'warning'
  }

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = { DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档' }
    return map[status] || status
  }

  // ===== API 调用 =====
  const fetchLibraries = async () => {
    loading.value = true
    try {
      const res = await getRuleLibrariesApi()
      libraries.value = res.data || []
    } catch (e) {
      console.error('获取规则库列表失败', e)
    } finally {
      loading.value = false
    }
  }

  const openLibrary = async (lib: RuleLibrary) => {
    try {
      const res = await getRuleLibraryApi(lib.id)
      selectedLibrary.value = res.data
      drawerVisible.value = true
    } catch (e) {
      console.error('获取规则库详情失败', e)
    }
  }

  const handleCreate = () => {
    isEdit.value = false
    editId.value = ''
    formData.name = ''
    formData.description = ''
    dialogVisible.value = true
  }

  const handleEdit = (lib: RuleLibrary) => {
    isEdit.value = true
    editId.value = lib.id
    formData.name = lib.name
    formData.description = lib.description || ''
    dialogVisible.value = true
  }

  const handleSaveLibrary = async () => {
    if (!formData.name.trim()) {
      ElMessage.warning('请输入规则库名称')
      return
    }
    submitting.value = true
    try {
      if (isEdit.value) {
        await updateRuleLibraryApi(editId.value, { name: formData.name, description: formData.description })
        ElMessage.success('规则库已更新')
      } else {
        await createRuleLibraryApi({ name: formData.name, description: formData.description })
        ElMessage.success('规则库已创建')
      }
      dialogVisible.value = false
      await fetchLibraries()
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message || '操作失败')
    } finally {
      submitting.value = false
    }
  }

  const handleDelete = async (lib: RuleLibrary) => {
    try {
      await ElMessageBox.confirm(确认删除规则库 "" 吗？, '删除确认', { type: 'warning' })
      await deleteRuleLibraryApi(lib.id)
      ElMessage.success('规则库已删除')
      await fetchLibraries()
    } catch { /* cancelled */ }
  }

  // ===== 解析相关 =====
  const openParseDialog = (lib: RuleLibrary) => {
    parseTarget.value = lib
    parseFiles.value = []
    parseDialogVisible.value = true
  }

  const handleParse = async () => {
    if (!parseTarget.value || parseFiles.value.length === 0) {
      ElMessage.warning('请选择文件')
      return
    }
    parsing.value = true
    try {
      const res = await parseRulesPreviewAsyncApi(parseTarget.value.id, parseFiles.value)
      ElMessage.success('解析任务已提交')
      parseDialogVisible.value = false
      // TODO: 轮询解析进度
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message || '解析失败')
    } finally {
      parsing.value = false
    }
  }

  const handleImportPreview = async () => {
    if (!selectedLibrary.value || previewItems.value.length === 0) return
    importing.value = true
    try {
      await importRulePreviewItemsApi(selectedLibrary.value.id, {
        items: previewItems.value,
        mode: importMode.value,
      })
      ElMessage.success('导入成功')
      previewDialogVisible.value = false
      await openLibrary(selectedLibrary.value)
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message || '导入失败')
    } finally {
      importing.value = false
    }
  }

  // ===== 条目管理 =====
  const openItemDialog = (mode: 'create' | 'edit', item?: RuleLibraryItem) => {
    itemDialogMode.value = mode
    if (mode === 'edit' && item) {
      editingItemId.value = item.id
      itemForm.ruleCode = item.ruleCode || ''
      itemForm.ruleName = item.ruleName || ''
      itemForm.category = item.category || ''
      itemForm.description = item.description || ''
      itemForm.checkMethod = item.checkMethod || ''
      itemForm.severity = item.severity || 'warning'
      itemForm.executionType = item.executionType || 'BUILTIN_PREFIX'
      itemForm.builtinPrefix = item.builtinPrefix || ''
      itemForm.targetScope = item.targetScope || 'TEXT'
    } else {
      editingItemId.value = ''
      itemForm.ruleCode = ''
      itemForm.ruleName = ''
      itemForm.category = ''
      itemForm.description = ''
      itemForm.checkMethod = ''
      itemForm.severity = 'warning'
      itemForm.executionType = 'BUILTIN_PREFIX'
      itemForm.builtinPrefix = ''
      itemForm.targetScope = 'TEXT'
    }
    itemDialogVisible.value = true
  }

  const handleSaveItem = async () => {
    if (!selectedLibrary.value) return
    if (!itemForm.ruleCode.trim() || !itemForm.ruleName.trim()) {
      ElMessage.warning('请输入规则编码和名称')
      return
    }
    submitting.value = true
    try {
      if (itemDialogMode.value === 'edit') {
        await updateRuleItemApi(selectedLibrary.value.id, editingItemId.value, itemForm)
        ElMessage.success('规则已更新')
      } else {
        await addRuleItemApi(selectedLibrary.value.id, itemForm)
        ElMessage.success('规则已添加')
      }
      itemDialogVisible.value = false
      await openLibrary(selectedLibrary.value)
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message || '操作失败')
    } finally {
      submitting.value = false
    }
  }

  const handleDeleteItem = async (item: RuleLibraryItem) => {
    if (!selectedLibrary.value) return
    try {
      await ElMessageBox.confirm(确认删除规则 "" 吗？, '删除确认', { type: 'warning' })
      await deleteRuleItemApi(selectedLibrary.value.id, item.id)
      ElMessage.success('规则已删除')
      await openLibrary(selectedLibrary.value)
    } catch { /* cancelled */ }
  }

  return {
    loading, submitting, parsing, importing,
    libraries, selectedLibrary, drawerVisible,
    searchKeyword, statusFilter,
    dialogVisible, isEdit, editId, formData,
    parseDialogVisible, previewDialogVisible, parseTarget, parseFiles,
    previewItems, previewSourceFileName, importMode,
    itemDialogVisible, itemDialogMode, editingItemId, itemForm, itemFilters,
    categoryOptions, publishedCount, executableCount,
    filteredItems, filteredLibraries,
    getStatusClass, getStatusTagType, getStatusLabel,
    fetchLibraries, openLibrary,
    handleCreate, handleEdit, handleSaveLibrary, handleDelete,
    openParseDialog, handleParse, handleImportPreview,
    openItemDialog, handleSaveItem, handleDeleteItem,
  }
}
