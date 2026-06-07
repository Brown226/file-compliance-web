/**
 * 提示词模板管理相关逻辑
 * 从 PromptConfig.vue 提取
 */
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MarkdownIt from 'markdown-it'
import {
  getPromptTemplatesApi, getPromptModulesApi,
  updatePromptTemplateApi, resetPromptTemplateApi, resetAllPromptTemplatesApi, seedPromptTemplatesApi,
} from '@/api/promptTemplate'

export interface PromptTemplate {
  key: string
  name: string
  content: string
  module?: string
  role?: string
  description?: string
  placeholders?: string
  isModified?: boolean
  enabled?: boolean
  [key: string]: any
}

export interface ModuleInfo {
  key: string
  label?: string
  [key: string]: any
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: true })

// 模块分类定义
const CORE_MODULE_KEYS = ['library_review', 'consistency', 'typo_grammar', 'doc_review', 'multimodal', 'ocr', 'semantic_spec']
const AUX_MODULE_KEYS = ['rule_library', 'review_specification', 'pre_analysis', 'contextual_retrieval', 'qa', 'langchain_qa']

export function usePromptTemplates() {
  const loading = ref(false)
  const saveLoading = ref(false)
  const resetAllLoading = ref(false)
  const seedLoading = ref(false)
  const templates = ref<PromptTemplate[]>([])
  const modules = ref<ModuleInfo[]>([])
  const activeModule = ref('')
  const searchQuery = ref('')
  const coreExpanded = ref(true)
  const auxExpanded = ref(false)

  const editDialogVisible = ref(false)
  const editingTemplate = ref<PromptTemplate | null>(null)
  const editContent = ref('')
  const editTab = ref('edit')

  // 核心模块 / 辅助模块 分组
  const coreModules = computed(() =>
    modules.value.filter(m => CORE_MODULE_KEYS.includes(m.key))
  )

  const auxModules = computed(() =>
    modules.value.filter(m => AUX_MODULE_KEYS.includes(m.key))
  )

  // 搜索 + 模块筛选
  const filteredTemplates = computed(() => {
    let list = templates.value
    if (activeModule.value) {
      list = list.filter(t => t.module === activeModule.value)
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase()
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      )
    }
    return list
  })

  const hasCustomContent = (tpl: PromptTemplate) => tpl.isModified

  const parsePlaceholders = (placeholders?: string): string[] => {
    if (!placeholders) return []
    try { return JSON.parse(placeholders) } catch { return [] }
  }

  const getModuleIcon = (key: string): string => {
    const icons: Record<string, string> = {
      library_review: '📋', consistency: '🔄', typo_grammar: '✏️',
      doc_review: '📄', multimodal: '🖼️', ocr: '🔤',
      rule_library: '📐', review_specification: '📏',
      pre_analysis: '🔍', contextual_retrieval: '🧩',
      qa: '💬', langchain_qa: '🤖', semantic_spec: '📋',
    }
    return icons[key] || '📝'
  }

  const roleLabel = (role: string): string => {
    const map: Record<string, string> = { system: '系统提示词', user: '用户提示词' }
    return map[role] || role
  }

  const roleTagType = (role: string): 'warning' | 'info' | 'success' | 'danger' | 'primary' =>
    role === 'system' ? 'danger' : 'primary'

  const moduleLabel = (mod: string): string => {
    const map: Record<string, string> = {
      library_review: '以库审文', consistency: '一致性审查', typo_grammar: '基础校对',
      doc_review: '以文审文', multimodal: '结构化审查', ocr: 'OCR文字识别',
      semantic_spec: '语义规范库审查',
      rule_library: '规则库AI解析', review_specification: '规范集AI解析',
      pre_analysis: '文件预分析', contextual_retrieval: '上下文检索增强',
      qa: '智能问答', langchain_qa: 'LangChain问答',
    }
    return map[mod] || mod
  }

  // ===== 预览 =====
  const renderedPreview = ref('')
  const updatePreview = () => { renderedPreview.value = md.render(editContent.value) }

  // ===== 工具栏 =====
  const wrapText = (before: string, after: string) => {
    const textarea = document.querySelector('.raw-textarea') as HTMLTextAreaElement
    if (!textarea) return
    const start = textarea.selectionStart, end = textarea.selectionEnd
    const selected = editContent.value.substring(start, end)
    editContent.value = editContent.value.substring(0, start) + before + selected + after + editContent.value.substring(end)
    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(start + before.length, start + before.length + selected.length) }, 0)
  }

  const insertPlaceholder = (p: string) => {
    const textarea = document.querySelector('.raw-textarea') as HTMLTextAreaElement
    if (!textarea) return
    const pos = textarea.selectionStart
    editContent.value = editContent.value.substring(0, pos) + p + editContent.value.substring(pos)
    setTimeout(() => { textarea.focus(); textarea.setSelectionRange(pos + p.length, pos + p.length) }, 0)
  }

  // ===== 测试 =====
  const testRunning = ref(false)
  const testInput = ref('')
  const testStandardContext = ref('')
  const testResult = ref('')
  const testDuration = ref(0)
  const testModel = ref('')
  const testTokens = ref('')

  const runTest = async () => {
    if (!editingTemplate.value || !testInput.value.trim()) return
    testRunning.value = true; testResult.value = ''; testModel.value = ''; testTokens.value = ''
    const startTime = Date.now()
    try {
      let prompt = editContent.value
      prompt = prompt.replace(/\$\{text\}/g, testInput.value)
      prompt = prompt.replace(/\$\{standardContext\}/g, testStandardContext.value || '')
      prompt = prompt.replace(/\$\{ragContext\}/g, testStandardContext.value || '')
      prompt = prompt.replace(/\$\{chunk\}/g, testInput.value.slice(0, 200))
      prompt = prompt.replace(/\$\{refTexts\}/g, '')
      prompt = prompt.replace(/\$\{wholeDocument\}/g, testInput.value.slice(0, 500))
      prompt = prompt.replace(/\$\{chunkContent\}/g, testInput.value.slice(0, 200))
      prompt = prompt.replace(/\{data\}/g, '').replace(/\{question\}/g, '')
      testDuration.value = Date.now() - startTime
      testResult.value = `⚠️ LLM 测试接口未配置，显示变量替换后的完整提示词：\n\n${prompt}`
      testModel.value = '本地预览'; testTokens.value = '-'
      ElMessage.success('测试完成')
    } catch (e: any) {
      testDuration.value = Date.now() - startTime
      testResult.value = `❌ 测试失败: ${e?.message || '未知错误'}`
      ElMessage.error('测试失败')
    } finally { testRunning.value = false }
  }

  const clearTest = () => {
    testInput.value = ''; testStandardContext.value = ''; testResult.value = ''
    testDuration.value = 0; testModel.value = ''; testTokens.value = ''
  }

  watch(editContent, () => updatePreview())

  // ===== 数据加载 =====
  const loadData = async () => {
    loading.value = true
    try {
      const [tplRes, modRes] = await Promise.all([getPromptTemplatesApi(), getPromptModulesApi()])
      templates.value = tplRes.data || []
      modules.value = modRes.data || []
      if (modules.value.length > 0 && !activeModule.value) {
        activeModule.value = modules.value[0].key
      }
      if (activeModule.value && !modules.value.find(m => m.key === activeModule.value)) {
        activeModule.value = modules.value[0]?.key || ''
      }
    } catch (e) {
      console.error('加载提示词模板失败', e)
    } finally { loading.value = false }
  }

  const handleEdit = (tpl: PromptTemplate) => {
    editingTemplate.value = { ...tpl }; editContent.value = tpl.content
    editDialogVisible.value = true; editTab.value = 'edit'; updatePreview()
  }

  const handleSave = async () => {
    if (!editingTemplate.value) return
    saveLoading.value = true
    try {
      await updatePromptTemplateApi(editingTemplate.value.key, editContent.value)
      ElMessage.success('提示词已保存，立即生效')
      editDialogVisible.value = false
      await loadData()
    } catch (e) { console.error('保存失败', e) }
    finally { saveLoading.value = false }
  }

  const handleReset = async (key: string) => {
    try {
      await ElMessageBox.confirm('确定要重置该提示词为系统默认值吗？', '重置确认', { type: 'warning' })
      await resetPromptTemplateApi(key)
      ElMessage.success('已重置为默认值')
      await loadData()
      if (editingTemplate.value?.key === key) {
        const updated = templates.value.find(t => t.key === key)
        if (updated) { editingTemplate.value = { ...updated }; editContent.value = updated.content; updatePreview() }
      }
    } catch { /* cancelled */ }
  }

  const handleResetAll = async () => {
    try {
      await ElMessageBox.confirm('确定要重置所有提示词为系统默认值吗？此操作不可恢复！', '重置全部', { type: 'warning' })
      resetAllLoading.value = true
      await resetAllPromptTemplatesApi()
      ElMessage.success('所有提示词已重置为默认值')
      await loadData()
    } catch { /* cancelled */ }
    finally { resetAllLoading.value = false }
  }

  const handleToggle = async (key: string, enabled: boolean) => {
    try {
      await updatePromptTemplateApi(key, undefined, enabled)
      ElMessage.success(enabled ? '已启用' : '已禁用')
      await loadData()
    } catch (e) { console.error('切换失败', e) }
  }

  const handleSeed = async () => {
    try {
      await ElMessageBox.confirm('将初始化系统默认提示词模板，已有模板不会被覆盖。继续？', '初始化模板', { type: 'info' })
      seedLoading.value = true
      const res = await seedPromptTemplatesApi()
      ElMessage.success(res.data?.message || '初始化完成')
      await loadData()
    } catch { /* cancelled */ }
    finally { seedLoading.value = false }
  }

  return {
    loading, saveLoading, resetAllLoading, seedLoading,
    templates, modules, activeModule, searchQuery,
    coreExpanded, auxExpanded,
    editDialogVisible, editingTemplate, editContent, editTab,
    coreModules, auxModules, filteredTemplates,
    hasCustomContent, parsePlaceholders, getModuleIcon,
    roleLabel, roleTagType, moduleLabel,
    renderedPreview, updatePreview, wrapText, insertPlaceholder,
    testRunning, testInput, testStandardContext, testResult, testDuration, testModel, testTokens,
    runTest, clearTest,
    loadData, handleEdit, handleSave, handleReset, handleResetAll, handleToggle, handleSeed,
  }
}
