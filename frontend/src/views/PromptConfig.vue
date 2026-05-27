<template>
  <div class="prompt-config-container">
    <el-card shadow="never">
      <template #header>
        <div class="panel-header">
          <span class="panel-title">提示词模板管理</span>
          <div class="header-right">
            <el-input
              v-model="searchQuery"
              placeholder="搜索模板名称、Key 或描述..."
              clearable
              :prefix-icon="Search"
              class="header-search"
              size="default"
            />
            <div class="header-actions">
              <el-button size="default" @click="handleResetAll" :loading="resetAllLoading">
                <el-icon><Refresh /></el-icon>
                全部重置
              </el-button>
              <el-button size="default" type="primary" @click="handleSeed" :loading="seedLoading">
                <el-icon><MagicStick /></el-icon>
                初始化模板
              </el-button>
            </div>
          </div>
        </div>
      </template>

      <!-- 分类分组 -->
      <div class="category-groups">
        <!-- 核心审查功能 -->
        <div class="category-group">
          <div class="category-header" @click="coreExpanded = !coreExpanded">
            <div class="category-title">
              <el-icon class="collapse-icon" :class="{ expanded: coreExpanded }">
                <ArrowRight />
              </el-icon>
              <span class="category-label">核心审查功能</span>
              <el-tag size="small" effect="plain" round>{{ coreModules.length }}</el-tag>
            </div>
            <span class="category-hint">{{ coreExpanded ? '点击收起' : '点击展开' }}</span>
          </div>
          <div v-show="coreExpanded" class="module-cards">
            <div
              v-for="mod in coreModules"
              :key="mod.key"
              class="module-card"
              :class="{ active: activeModule === mod.key }"
              @click="activeModule = mod.key"
            >
              <div class="module-icon">{{ getModuleIcon(mod.key) }}</div>
              <div class="module-info">
                <div class="module-name">{{ mod.label }}</div>
                <div class="module-count">{{ mod.count }} 个模板</div>
              </div>
              <div class="module-active-indicator" v-if="activeModule === mod.key"></div>
            </div>
          </div>
        </div>

        <!-- 辅助功能 -->
        <div class="category-group">
          <div class="category-header" @click="auxExpanded = !auxExpanded">
            <div class="category-title">
              <el-icon class="collapse-icon" :class="{ expanded: auxExpanded }">
                <ArrowRight />
              </el-icon>
              <span class="category-label">辅助功能</span>
              <el-tag size="small" effect="plain" round type="info">{{ auxModules.length }}</el-tag>
            </div>
            <span class="category-hint">{{ auxExpanded ? '点击收起' : '点击展开' }}</span>
          </div>
          <div v-show="auxExpanded" class="module-cards">
            <div
              v-for="mod in auxModules"
              :key="mod.key"
              class="module-card"
              :class="{ active: activeModule === mod.key }"
              @click="activeModule = mod.key"
            >
              <div class="module-icon">{{ getModuleIcon(mod.key) }}</div>
              <div class="module-info">
                <div class="module-name">{{ mod.label }}</div>
                <div class="module-count">{{ mod.count }} 个模板</div>
              </div>
              <div class="module-active-indicator" v-if="activeModule === mod.key"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 当前筛选信息 -->
      <div class="list-toolbar" v-if="filteredTemplates.length > 0">
        <div class="list-info">
          <span class="list-active-module" v-if="activeModule">
            <el-icon><Folder /></el-icon> {{ moduleLabel(activeModule) }}
          </span>
          <span class="list-count">共 {{ filteredTemplates.length }} 个模板</span>
          <el-button
            v-if="activeModule"
            size="small"
            text
            type="info"
            @click="activeModule = ''"
          >
            <el-icon><Close /></el-icon> 清除筛选
          </el-button>
        </div>
      </div>

      <!-- 模板列表 -->
      <div class="template-list" v-loading="loading">
        <el-empty
          v-if="!loading && filteredTemplates.length === 0"
          :description="searchQuery ? '未找到匹配的模板' : '该模块暂无提示词模板'"
        />

        <div
          v-for="tpl in filteredTemplates"
          :key="tpl.key"
          class="template-item"
          :class="{ 'disabled-item': !tpl.enabled }"
        >
          <!-- 左侧：基本信息 -->
          <div class="template-main">
            <div class="template-header">
              <div class="template-badges">
                <el-tag :type="roleTagType(tpl.role)" size="default" effect="dark">
                  {{ roleLabel(tpl.role) }}
                </el-tag>
                <el-tag v-if="tpl.isBuiltin" type="info" size="default" effect="plain">
                  <el-icon><Lock /></el-icon> 系统内置
                </el-tag>
                <el-tag v-if="tpl.isModified" type="warning" size="default" effect="plain">
                  <el-icon><Edit /></el-icon> 已自定义
                </el-tag>
                <el-tag v-if="!tpl.isModified && tpl.registryDefault && tpl.registryDefault !== tpl.content" type="success" size="default" effect="plain">
                  <el-icon><Promotion /></el-icon> 可更新
                </el-tag>
                <el-tag v-if="!tpl.enabled" type="danger" size="default" effect="plain">已禁用</el-tag>
              </div>
              <h3 class="template-name">{{ tpl.name }}</h3>
            </div>

            <p class="template-desc" v-if="tpl.description">{{ tpl.description }}</p>

            <div class="template-meta">
              <span class="template-key">
                <el-icon><Key /></el-icon> {{ tpl.key }}
              </span>
              <span class="template-module">
                <el-icon><Folder /></el-icon> {{ moduleLabel(tpl.module) }}
              </span>
            </div>

            <!-- 占位符 -->
            <div class="template-placeholders" v-if="parsePlaceholders(tpl.placeholders).length > 0">
              <span class="placeholder-label">可用变量：</span>
              <el-tag
                v-for="p in parsePlaceholders(tpl.placeholders)"
                :key="p"
                size="small"
                effect="plain"
                class="placeholder-tag"
              >{{ p }}</el-tag>
            </div>
          </div>

          <!-- 右侧：操作 -->
          <div class="template-actions">
            <el-switch
              :model-value="tpl.enabled"
              size="large"
              @change="(val: boolean) => handleToggle(tpl.key, val)"
            />
            <el-button type="primary" @click="handleEdit(tpl)" size="large">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button @click="handleReset(tpl.key)" size="large" plain class="reset-btn">
              <el-icon><RefreshRight /></el-icon>
              重置
            </el-button>
          </div>

          <!-- 内容预览 -->
          <div class="template-preview">
            <div class="preview-label">
              <el-icon><View /></el-icon> 内容预览
            </div>
            <pre class="content-preview">{{ tpl.content?.slice(0, 300) }}{{ (tpl.content?.length || 0) > 300 ? '...' : '' }}</pre>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      :title="`编辑提示词模板 — ${editingTemplate?.name || ''}`"
      width="1100px"
      :close-on-click-modal="false"
      top="5vh"
      :lock-scroll="false"
      class="prompt-edit-dialog"
    >
      <div v-if="editingTemplate" class="edit-container">
        <!-- 模板信息卡片 -->
        <div class="template-info-card">
          <div class="info-row">
            <el-tag :type="roleTagType(editingTemplate.role)" size="large" effect="dark">
              {{ roleLabel(editingTemplate.role) }}
            </el-tag>
            <span class="info-separator">|</span>
            <span class="info-module">{{ moduleLabel(editingTemplate.module) }}</span>
            <span class="info-separator">|</span>
            <code class="info-key">{{ editingTemplate.key }}</code>
          </div>
          <p class="info-desc" v-if="editingTemplate.description">{{ editingTemplate.description }}</p>
          <div class="info-builtin" v-if="editingTemplate.isBuiltin">
            <el-icon><Lock /></el-icon> 系统内置模板，修改后将创建自定义副本
          </div>
        </div>

        <!-- 占位符工具 -->
        <div class="placeholder-toolbar" v-if="parsePlaceholders(editingTemplate.placeholders).length > 0">
          <span class="toolbar-label">快速插入变量：</span>
          <div class="placeholder-buttons">
            <el-tag
              v-for="p in parsePlaceholders(editingTemplate.placeholders)"
              :key="p"
              class="placeholder-btn"
              @click="insertPlaceholder(p)"
              effect="plain"
              type="info"
            >
              {{ p }}
            </el-tag>
          </div>
        </div>

        <!-- 编辑 / 测试 / 历史 Tabs -->
        <el-tabs v-model="editTab" class="edit-tabs-large">
          <el-tab-pane label="📝 编辑模板" name="edit">
            <div class="edit-content">
              <div class="edit-panel">
                <div class="markdown-toolbar">
                  <el-button-group size="default">
                    <el-button @click="wrapText('**', '**')" title="粗体"><strong>B</strong></el-button>
                    <el-button @click="wrapText('*', '*')" title="斜体"><em>I</em></el-button>
                    <el-button @click="wrapText('# ', '')" title="标题1">H1</el-button>
                    <el-button @click="wrapText('## ', '')" title="标题2">H2</el-button>
                  </el-button-group>
                  <el-button-group size="default">
                    <el-button @click="wrapText('\n- ', '')" title="列表">☰</el-button>
                    <el-button @click="wrapText('\n1. ', '')" title="编号列表">1.</el-button>
                    <el-button @click="wrapText('> ', '')" title="引用">❝</el-button>
                  </el-button-group>
                  <el-button-group size="default">
                    <el-button @click="wrapText('`', '`')" title="行内代码">`code`</el-button>
                    <el-button @click="wrapText('\n```\n', '\n```')" title="代码块">{ }</el-button>
                  </el-button-group>
                  <el-button @click="wrapText('\n---\n', '')" size="default">
                    <el-icon><Minus /></el-icon> 分隔线
                  </el-button>
                  <div class="toolbar-spacer"></div>
                  <el-button size="default" type="info" plain @click="editContent = editingTemplate.defaultValue || ''">
                    <el-icon><RefreshLeft /></el-icon>
                    恢复默认
                  </el-button>
                </div>

                <div class="split-editor">
                  <div class="editor-pane">
                    <div class="pane-header">
                      <span><el-icon><Edit /></el-icon> 编辑</span>
                      <span class="char-count">{{ editContent.length }} 字符</span>
                    </div>
                    <div class="editor-wrapper">
                      <textarea
                        v-model="editContent"
                        class="raw-textarea"
                        placeholder="请输入提示词内容（支持 Markdown 格式）"
                        @input="updatePreview"
                      ></textarea>
                    </div>
                  </div>
                  <div class="preview-pane">
                    <div class="pane-header">
                      <span><el-icon><View /></el-icon> 预览</span>
                    </div>
                    <div class="preview-content" v-html="renderedPreview"></div>
                  </div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="🧪 测试运行" name="test">
            <div class="test-content">
              <el-alert
                title="使用当前提示词调用 LLM 进行实际测试"
                description="输入测试文本，系统将替换占位符后调用 LLM 并返回结果"
                type="info" :closable="false" show-icon
              />
              <el-form label-width="100px" class="test-form">
                <el-form-item label="测试文本">
                  <el-input v-model="testInput" type="textarea" :rows="8" placeholder="输入一段模拟的文档内容用于测试..." />
                </el-form-item>
                <el-form-item label="标准上下文">
                  <el-input v-model="testStandardContext" type="textarea" :rows="5" placeholder="输入模拟的标准上下文内容（可选）..." />
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="testRunning" size="large" @click="runTest">
                    <el-icon><VideoPlay /></el-icon> 运行测试
                  </el-button>
                  <el-button size="large" @click="clearTest">
                    <el-icon><Delete /></el-icon> 清空
                  </el-button>
                </el-form-item>
              </el-form>
              <div v-if="testResult" class="test-result-card">
                <div class="result-header">
                  <span class="result-title">测试结果</span>
                  <div class="result-meta">
                    <el-tag v-if="testModel" type="info">模型: {{ testModel }}</el-tag>
                    <el-tag v-if="testDuration" type="success">耗时: {{ testDuration }}ms</el-tag>
                    <el-tag v-if="testTokens" type="warning">Token: {{ testTokens }}</el-tag>
                  </div>
                </div>
                <div class="test-output"><pre>{{ testResult }}</pre></div>
              </div>
              <el-empty v-if="!testRunning && !testResult" description="输入测试文本后点击运行" :image-size="80" />
            </div>
          </el-tab-pane>

          <el-tab-pane label="📜 版本对比" name="history">
            <div class="history-content">
              <el-alert
                v-if="editingTemplate!.isModified"
                title="以下对比 registry.ts 最新默认值与当前自定义值的差异"
                type="success" :closable="false" show-icon
              />
              <el-alert v-else title="该模板使用 registry.ts 最新默认值，无自定义修改" type="info" :closable="false" show-icon />
              <div class="diff-view" v-if="editingTemplate!.isModified">
                <div class="diff-pane default">
                  <div class="diff-header"><el-icon><Document /></el-icon> registry 默认值</div>
                  <pre>{{ editingTemplate.registryDefault || editingTemplate.defaultValue || '(无默认值)' }}</pre>
                </div>
                <div class="diff-pane current">
                  <div class="diff-header"><el-icon><Edit /></el-icon> 当前自定义</div>
                  <pre>{{ editingTemplate.content }}</pre>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>

      <template #footer>
        <el-button size="large" @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" size="large" :loading="saveLoading" @click="handleSave">
          <el-icon><Check /></el-icon> 保存修改
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'
import {
  Edit, View, Lock, Key, Folder, Refresh, RefreshRight, Delete, Minus,
  MagicStick, VideoPlay, RefreshLeft, Document, Search, ArrowRight, Close, Promotion
} from '@element-plus/icons-vue'
import {
  getPromptTemplatesApi,
  getPromptModulesApi,
  updatePromptTemplateApi,
  resetPromptTemplateApi,
  resetAllPromptTemplatesApi,
  togglePromptTemplateApi,
  seedPromptTemplatesApi,
} from '@/api/promptTemplate'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: true, breaks: true, linkify: true })

interface PromptTemplate {
  id: string
  key: string
  module: string
  role: string
  name: string
  description?: string
  content: string
  placeholders?: string
  defaultValue?: string
  isBuiltin: boolean
  enabled: boolean
  /** registry.ts 最新默认值（后端注入，实时同步） */
  registryDefault: string
  /** 用户是否修改过此提示词 */
  isModified: boolean
}

interface ModuleInfo {
  key: string
  label: string
  count: number
}

// ---- 模块分类定义 ----
const CORE_MODULE_KEYS = ['library_review', 'consistency', 'typo_grammar', 'doc_review', 'multimodal', 'ocr', 'semantic_spec']
const AUX_MODULE_KEYS = ['rule_library', 'review_specification', 'pre_analysis', 'contextual_retrieval', 'qa', 'langchain_qa']

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

// ---- 预览 ----
const renderedPreview = ref('')
const updatePreview = () => { renderedPreview.value = md.render(editContent.value) }

// ---- 工具栏 ----
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

// ---- 测试 ----
const testRunning = ref(false), testInput = ref(''), testStandardContext = ref('')
const testResult = ref(''), testDuration = ref(0), testModel = ref(''), testTokens = ref('')

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

// ---- 数据加载 ----
const loadData = async () => {
  loading.value = true
  try {
    const [tplRes, modRes] = await Promise.all([getPromptTemplatesApi(), getPromptModulesApi()])
    templates.value = tplRes.data || []
    modules.value = modRes.data || []
    if (modules.value.length > 0 && !activeModule.value) {
      activeModule.value = modules.value[0].key
    }
    // 若当前选中模块不再存在，自动切到第一个
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

useEnterToConfirm(editDialogVisible, handleSave, { disabled: saveLoading })

const handleReset = async (key: string) => {
  try {
    await ElMessageBox.confirm('确定要重置该模板为默认值吗？', '确认重置', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' })
    await resetPromptTemplateApi(key)
    ElMessage.success('已重置为默认值')
    await loadData()
  } catch { /* cancelled */ }
}

const handleResetAll = async () => {
  try {
    await ElMessageBox.confirm('确定要重置所有模板为默认值吗？所有自定义内容将丢失！', '确认全部重置', { confirmButtonText: '确定重置', cancelButtonText: '取消', type: 'warning' })
    resetAllLoading.value = true
    await resetAllPromptTemplatesApi()
    ElMessage.success('所有模板已重置为默认值')
    await loadData()
  } catch { /* cancelled */ }
  finally { resetAllLoading.value = false }
}

const handleToggle = async (key: string, enabled: boolean) => {
  try {
    await togglePromptTemplateApi(key, enabled)
    ElMessage.success(enabled ? '已启用' : '已禁用')
    await loadData()
  } catch (e) { console.error('切换状态失败', e) }
}

const handleSeed = async () => {
  seedLoading.value = true
  try {
    await seedPromptTemplatesApi()
    ElMessage.success('内置模板初始化完成')
    await loadData()
  } catch (e) { console.error('初始化失败', e) }
  finally { seedLoading.value = false }
}

onMounted(() => loadData())
</script>

<style scoped>
/* ============================================
   提示词模板管理 - Grouped Category Design
   主色调: Teal/Cyan  |  风格: 精致简约技术风
   ============================================ */

.prompt-config-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
  animation: containerFadeIn 0.5s ease-out;
}

@keyframes containerFadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---- Card ---- */
.prompt-config-container :deep(.el-card) {
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 24px rgba(0, 0, 0, 0.03);
  overflow: hidden;
}

.prompt-config-container :deep(.el-card__header) {
  padding: 20px 28px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  background: linear-gradient(135deg, #fafbfc 0%, #f1f5f9 100%);
}

.prompt-config-container :deep(.el-card__body) {
  padding: 0;
}

/* ---- Panel Header ---- */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.panel-title {
  font-weight: 700;
  font-size: 18px;
  letter-spacing: -0.3px;
  color: #0f172a;
  position: relative;
  padding-left: 14px;
  flex-shrink: 0;
}

.panel-title::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 22px;
  background: linear-gradient(180deg, #14b8a6, #0d9488);
  border-radius: 2px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  justify-content: flex-end;
  min-width: 0;
}

.header-search {
  max-width: 280px;
}

.header-search :deep(.el-input__wrapper) {
  border-radius: 10px;
  background: #f8fafc;
  border-color: rgba(148, 163, 184, 0.2);
  transition: all 0.25s;
}

.header-search :deep(.el-input__wrapper:hover),
.header-search :deep(.el-input__wrapper.is-focus) {
  border-color: #14b8a6;
  box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.1);
}

.header-actions {
  display: flex;
  gap: 10px;
}

.header-actions :deep(.el-button) {
  border-radius: 10px;
  font-weight: 500;
  padding: 8px 18px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.header-actions :deep(.el-button--primary) {
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  border: none;
  box-shadow: 0 2px 8px rgba(20, 184, 166, 0.3);
}

.header-actions :deep(.el-button--primary:hover) {
  box-shadow: 0 4px 16px rgba(20, 184, 166, 0.4);
  transform: translateY(-1px);
}

.header-actions :deep(.el-button:not(.el-button--primary):hover) {
  border-color: #14b8a6;
  color: #0d9488;
  background: rgba(20, 184, 166, 0.04);
}

/* ---- Category Groups ---- */
.category-groups {
  padding: 20px 28px 8px;
}

.category-group + .category-group {
  margin-top: 16px;
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, #f8fafc, #f1f5f9);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  user-select: none;
  transition: all 0.25s;
  margin-bottom: 12px;
}

.category-header:hover {
  border-color: #cbd5e1;
  background: linear-gradient(135deg, #f0fdfa, #f8fafc);
}

.category-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.category-label {
  font-size: 14.5px;
  font-weight: 700;
  color: #1e293b;
  letter-spacing: -0.2px;
}

.collapse-icon {
  font-size: 14px;
  color: #64748b;
  transition: transform 0.25s ease;
}

.collapse-icon.expanded {
  transform: rotate(90deg);
}

.category-hint {
  font-size: 11.5px;
  color: #94a3b8;
}

/* ---- Module Cards ---- */
.module-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
  gap: 12px;
  animation: gridFadeIn 0.35s ease-out;
}

@keyframes gridFadeIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.module-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.module-card::before {
  content: '';
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  background: linear-gradient(135deg, rgba(20, 184, 166, 0.03), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.module-card:hover {
  border-color: #94a3b8;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.06);
}

.module-card:hover::before { opacity: 1; }

.module-card.active {
  border-color: #14b8a6;
  background: linear-gradient(135deg, #f0fdfa, #ccfbf1);
  box-shadow: 0 4px 16px rgba(20, 184, 166, 0.15), 0 0 0 1px rgba(20, 184, 166, 0.1);
  transform: translateY(-1px);
}

.module-icon {
  font-size: 26px;
  line-height: 1;
  flex-shrink: 0;
  transition: transform 0.3s ease;
}

.module-card:hover .module-icon { transform: scale(1.12) rotate(-3deg); }

.module-info { min-width: 0; }

.module-name {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 2px;
  transition: color 0.2s;
}

.module-card.active .module-name { color: #0f766e; }

.module-count {
  font-size: 11.5px;
  color: #94a3b8;
  font-weight: 500;
}

.module-active-indicator {
  position: absolute;
  bottom: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 3px;
  background: linear-gradient(90deg, transparent, #14b8a6, transparent);
  border-radius: 2px;
}

/* ---- List Toolbar ---- */
.list-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 28px;
  border-bottom: 1px solid #f1f5f9;
}

.list-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #64748b;
}

.list-active-module {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: #0d9488;
  background: rgba(20, 184, 166, 0.08);
  padding: 4px 12px;
  border-radius: 8px;
}

.list-count {
  font-weight: 500;
}

/* ---- Template List ---- */
.template-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 28px 28px;
}

.template-item {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 24px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  animation: itemSlideIn 0.4s ease-out backwards;
}

.template-item:nth-child(1) { animation-delay: 0.05s; }
.template-item:nth-child(2) { animation-delay: 0.1s; }
.template-item:nth-child(3) { animation-delay: 0.15s; }
.template-item:nth-child(4) { animation-delay: 0.2s; }
.template-item:nth-child(5) { animation-delay: 0.25s; }
.template-item:nth-child(n+6) { animation-delay: 0.3s; }

@keyframes itemSlideIn {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

.template-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, #14b8a6, #0d9488);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.template-item:hover {
  border-color: #cbd5e1;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.03);
  transform: translateY(-2px);
}

.template-item:hover::before { opacity: 1; }

.disabled-item { opacity: 0.5; background: #f8fafc; }
.disabled-item:hover { transform: none; box-shadow: none; }

/* ---- Template Header & Badges ---- */
.template-header { margin-bottom: 14px; }

.template-badges {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.template-badges :deep(.el-tag) {
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 3px 10px;
  letter-spacing: 0.2px;
  transition: all 0.2s;
}

.template-badges :deep(.el-tag--danger) {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  border: none;
}

.template-badges :deep(.el-tag--primary) {
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  border: none;
}

.template-badges :deep(.el-tag--warning) {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  border: none;
  color: #fff;
}

.template-name {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.2px;
  line-height: 1.3;
}

.template-desc {
  font-size: 13.5px;
  color: #64748b;
  margin: 0 0 14px 0;
  line-height: 1.65;
}

/* ---- Template Meta ---- */
.template-meta {
  display: flex;
  gap: 24px;
  font-size: 12.5px;
  color: #94a3b8;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.template-key, .template-module {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
}

.template-key {
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  background: #f1f5f9;
  padding: 3px 10px;
  border-radius: 6px;
  color: #475569;
  font-size: 11.5px;
  letter-spacing: 0.2px;
  border: 1px solid #e2e8f0;
}

/* ---- Placeholders ---- */
.template-placeholders {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
}

.placeholder-label {
  color: #64748b;
  font-weight: 600;
  font-size: 12px;
}

.placeholder-tag {
  cursor: default;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  transition: all 0.2s;
  border: 1px solid rgba(20, 184, 166, 0.25);
  background: rgba(20, 184, 166, 0.06);
  color: #0d9488;
}

.placeholder-tag:hover {
  background: rgba(20, 184, 166, 0.12);
  border-color: rgba(20, 184, 166, 0.4);
  transform: scale(1.03);
}

/* ---- Template Actions ---- */
.template-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px dashed #e2e8f0;
}

.template-actions :deep(.el-switch.is-checked .el-switch__core) {
  background: linear-gradient(90deg, #14b8a6, #0d9488);
  border-color: #14b8a6;
}

.template-actions :deep(.el-switch .el-switch__core) {
  border-radius: 12px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.template-actions :deep(.el-switch .el-switch__action) {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

.template-actions :deep(.el-button) {
  border-radius: 10px;
  font-weight: 500;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  padding: 9px 20px;
}

.template-actions :deep(.el-button--primary) {
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  border: none;
  box-shadow: 0 2px 8px rgba(20, 184, 166, 0.25);
}

.template-actions :deep(.el-button--primary:hover) {
  box-shadow: 0 4px 14px rgba(20, 184, 166, 0.35);
  transform: translateY(-1px);
}

.reset-btn { border-color: #e2e8f0; color: #64748b; }
.reset-btn:hover {
  border-color: #f59e0b;
  color: #d97706;
  background: rgba(245, 158, 11, 0.04);
}

/* ---- Template Preview ---- */
.template-preview {
  margin-top: 18px;
  animation: previewFadeIn 0.4s ease-out 0.2s backwards;
}

@keyframes previewFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.preview-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.content-preview {
  background: linear-gradient(135deg, #f8fafc, #f1f5f9);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px 20px;
  font-size: 12.5px;
  color: #475569;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow: hidden;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  margin: 0;
  position: relative;
}

.content-preview::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40px;
  background: linear-gradient(transparent, rgba(248, 250, 252, 0.95));
  pointer-events: none;
  border-radius: 0 0 12px 12px;
}

/* ============================================
   Edit Dialog (unchanged from original, kept for consistency)
   ============================================ */

.prompt-edit-dialog :deep(.el-dialog) {
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.15);
}

.prompt-edit-dialog :deep(.el-dialog__header) {
  padding: 20px 28px;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(135deg, #f8fafc, #f1f5f9);
}

.prompt-edit-dialog :deep(.el-dialog__title) {
  font-weight: 700;
  font-size: 16px;
  color: #0f172a;
  letter-spacing: -0.2px;
}

.prompt-edit-dialog :deep(.el-dialog__body) { padding: 0; }

.prompt-edit-dialog :deep(.el-dialog__footer) {
  padding: 16px 28px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

.edit-container {
  padding: 24px;
  max-height: calc(90vh - 140px);
  overflow-y: auto;
}

.edit-container::-webkit-scrollbar { width: 6px; }
.edit-container::-webkit-scrollbar-track { background: transparent; }
.edit-container::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }

.template-info-card {
  background: linear-gradient(135deg, #f0fdfa, #f8fafc);
  border: 1px solid rgba(20, 184, 166, 0.15);
  border-radius: 14px;
  padding: 18px 22px;
  margin-bottom: 20px;
}

.info-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.info-separator { color: #cbd5e1; font-weight: 300; }
.info-module { font-size: 14px; color: #334155; font-weight: 600; }
.info-key {
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px; color: #0d9488; background: rgba(20, 184, 166, 0.1);
  padding: 4px 12px; border-radius: 6px; font-weight: 600;
  border: 1px solid rgba(20, 184, 166, 0.2);
}

.info-desc { font-size: 13.5px; color: #64748b; margin: 10px 0 0 0; line-height: 1.6; }

.info-builtin {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 500; color: #d97706; margin-top: 10px;
  background: rgba(245, 158, 11, 0.08); padding: 6px 12px;
  border-radius: 8px; border: 1px solid rgba(245, 158, 11, 0.15);
}

.placeholder-toolbar {
  display: flex; align-items: center; gap: 14px; margin-bottom: 20px;
  flex-wrap: wrap; padding: 14px 18px; background: #f8fafc;
  border: 1px dashed #e2e8f0; border-radius: 12px;
}

.toolbar-label {
  font-size: 12.5px; color: #64748b; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px;
}

.placeholder-buttons { display: flex; gap: 8px; flex-wrap: wrap; }

.placeholder-btn {
  cursor: pointer;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 11.5px; font-weight: 600; border-radius: 7px; transition: all 0.2s;
  border: 1px solid rgba(20, 184, 166, 0.25) !important;
  background: rgba(20, 184, 166, 0.06) !important; color: #0d9488 !important;
}

.placeholder-btn:hover {
  background: rgba(20, 184, 166, 0.14) !important;
  border-color: rgba(20, 184, 166, 0.45) !important;
  transform: translateY(-1px); box-shadow: 0 2px 8px rgba(20, 184, 166, 0.15);
}

.edit-tabs-large :deep(.el-tabs__header) { margin-bottom: 0; }
.edit-tabs-large :deep(.el-tabs__item) { font-weight: 600; font-size: 13.5px; transition: all 0.25s; }
.edit-tabs-large :deep(.el-tabs__item.is-active) { color: #0d9488; }
.edit-tabs-large :deep(.el-tabs__active-bar) {
  background: linear-gradient(90deg, #14b8a6, #0d9488); height: 3px; border-radius: 2px;
}

.edit-panel { border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.03); }

.markdown-toolbar {
  display: flex; gap: 6px; padding: 12px 18px; border-bottom: 1px solid #e2e8f0;
  flex-wrap: wrap; background: linear-gradient(135deg, #fafbfc, #f8fafc); align-items: center;
}

.markdown-toolbar :deep(.el-button) { border-radius: 8px; font-size: 13px; transition: all 0.2s; border-color: #e2e8f0; }
.markdown-toolbar :deep(.el-button:hover) { border-color: #14b8a6; color: #0d9488; background: rgba(20, 184, 166, 0.05); }
.toolbar-spacer { flex: 1; }

.split-editor { display: flex; overflow: hidden; height: 460px; background: #fff; }
.editor-pane, .preview-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; }
.editor-pane { border-right: 1px solid #e2e8f0; }
.editor-wrapper { flex: 1; display: flex; overflow: hidden; }

.raw-textarea {
  width: 100%; height: 100%; border: none; outline: none; resize: none;
  padding: 16px 20px; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 13.5px; line-height: 1.75; background: #fff; color: #334155;
}

.raw-textarea::placeholder { color: #cbd5e1; }

.pane-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 18px; background: linear-gradient(135deg, #f8fafc, #f1f5f9);
  font-size: 13px; font-weight: 700; color: #475569;
  border-bottom: 1px solid #e2e8f0; text-transform: uppercase; letter-spacing: 0.6px;
}

.char-count { font-weight: 500; font-size: 11.5px; color: #94a3b8; text-transform: none; letter-spacing: 0; }

.preview-content {
  padding: 20px; font-size: 14px; line-height: 1.85; color: #334155;
  overflow-y: auto; flex: 1; min-height: 0; background: #fafbfc;
}

.preview-content :deep(h1), .preview-content :deep(h2), .preview-content :deep(h3) {
  margin-top: 20px; margin-bottom: 10px; color: #0f172a; font-weight: 700;
}

.preview-content :deep(code) {
  background: #f1f5f9; padding: 2px 8px; border-radius: 5px; font-size: 13px;
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; color: #0d9488; border: 1px solid #e2e8f0;
}

.preview-content :deep(pre) {
  background: #1e293b; color: #e2e8f0; padding: 16px 20px; border-radius: 10px;
  overflow-x: auto; font-size: 12.5px; line-height: 1.7;
}

.preview-content :deep(blockquote) {
  border-left: 4px solid #14b8a6; padding: 12px 18px; color: #64748b;
  margin: 14px 0; background: rgba(20, 184, 166, 0.04); border-radius: 0 10px 10px 0;
}

.test-content { padding: 24px 0; }
.test-form { margin-top: 20px; }

.test-result-card { margin-top: 24px; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.03); }

.result-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px; background: linear-gradient(135deg, #f8fafc, #f1f5f9);
  border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; gap: 10px;
}

.result-title { font-weight: 700; font-size: 14px; color: #0f172a; }
.result-meta { display: flex; gap: 8px; flex-wrap: wrap; }

.test-output { background: #0f172a; color: #e2e8f0; padding: 20px; max-height: 320px; overflow-y: auto; }
.test-output pre { margin: 0; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace; font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; }

.history-content { padding: 24px 0; }

.diff-view { display: flex; gap: 20px; margin-top: 20px; }
.diff-pane { flex: 1; min-width: 0; }

.diff-header {
  display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700;
  color: #0f172a; padding: 12px 0; border-bottom: 2.5px solid #14b8a6; margin-bottom: 14px;
}

.diff-pane.default .diff-header { border-bottom-color: #94a3b8; }

.diff-pane pre {
  background: #f8fafc; padding: 18px; border-radius: 12px; font-size: 12.5px;
  line-height: 1.7; white-space: pre-wrap; word-break: break-all;
  max-height: 360px; overflow-y: auto; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  margin: 0; border: 1px solid #e2e8f0; color: #475569;
}

/* ---- Responsive ---- */
@media (max-width: 768px) {
  .panel-header { flex-direction: column; gap: 14px; align-items: stretch; }
  .header-right { flex-direction: column; width: 100%; }
  .header-search { max-width: 100%; }
  .header-actions { width: 100%; }
  .header-actions :deep(.el-button) { flex: 1; justify-content: center; }

  .category-groups { padding: 14px 18px 8px; }
  .module-cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .template-list { padding: 14px 18px 18px; }
  .template-item { padding: 18px; }
  .template-actions { flex-wrap: wrap; }
  .diff-view { flex-direction: column; }
  .split-editor { flex-direction: column; height: auto; }
  .editor-pane { border-right: none; border-bottom: 1px solid #e2e8f0; min-height: 280px; }
  .preview-pane { min-height: 240px; }
}
</style>
