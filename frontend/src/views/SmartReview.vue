<template>
  <div class="smart-review">
    <div v-if="currentStep === 0" class="review-flow">
      <!-- 顶部：任务标题 -->
      <div class="flow-section flow-section--title">
        <div class="title-label">
          任务标题 <span class="required-mark">*</span>
        </div>
        <div class="title-input-row">
          <el-input
            v-model="form.title"
            :placeholder="autoTitlePreview"
            size="large"
            clearable
            maxlength="100"
            show-word-limit
            class="title-input"
          />
          <el-button
            type="primary"
            size="large"
            class="auto-title-btn"
            @click="fillAutoTitle"
          >
            <el-icon><MagicStick /></el-icon>
            {{ form.title ? '重新生成' : '自动生成' }}
          </el-button>
        </div>
      </div>

      <!-- 中部：上传文件 -->
      <div class="flow-section flow-section--upload">
        <SmartReviewUploadStep
          v-model:file-list="fileList"
          v-model:ref-file-list="refFileList"
          :entry-module="entryModule"
          :dwg-parsed-data-map="dwgParsedDataMap"
          hide-actions
        />
      </div>

      <!-- 底部：配置区 + 提交 -->
      <div class="flow-section flow-section--config">
        <div class="review-items-section">
          <div class="review-item-config">
            <!-- 目标选择（合同审查模式隐藏，锁定为 COMPARE） -->
            <div v-if="showObjectiveSelector && entryModule !== 'CONTRACT'" class="config-section">
              <div class="config-section-label">审查目标</div>
              <div class="objective-cards">
                <div v-for="option in objectiveOptions" :key="option.value" class="selectable-card" :class="{ 'selectable-card--active': (reviewPlanDraft?.objective ?? '') === option.value }" @click="reviewPlanDraft.objective = option.value as any" tabindex="0">
                  <div class="selectable-card__icon"><el-icon :size="16"><component :is="objectiveIconComponentMap[option.value]" /></el-icon></div>
                  <div class="selectable-card__content">
                    <div class="selectable-card__label">{{ option.label }}</div>
                    <div class="selectable-card__desc">{{ option.desc }}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 合同审查：显示锁定的审查目标 -->
            <div v-if="entryModule === 'CONTRACT'" class="config-section">
              <div class="config-section-label">审查目标</div>
              <div class="locked-objective">
                <el-icon :size="16"><Stamp /></el-icon>
                <span>合同风险比对</span>
                <el-tag size="small" type="info" effect="plain">已锁定</el-tag>
              </div>
            </div>

            <!-- 证据源：仅"以库审文"模式显示，让用户在知识库/条文库间选择 -->
            <template v-if="showEvidenceSection && entryModule === 'LIBRARY'">
              <div class="config-section">
                <div class="config-section-label">审查依据</div>
                <div class="evidence-cards">
                  <div v-for="option in availableEvidenceSources" :key="option.value" class="selectable-card selectable-card--compact" :class="{'selectable-card--active':(reviewPlanDraft?.evidence?.sources??[]).includes(option.value),'selectable-card--disabled':isEvidenceLocked(option.value)}" @click="handleEvidenceCardClick(option.value)" tabindex="0">
                    <div class="selectable-card__icon"><el-icon :size="14"><component :is="evidenceIconComponentMap[option.value]" /></el-icon></div>
                    <span class="selectable-card__label">{{ option.label }}</span>
                    <div class="selectable-card__check" v-if="(reviewPlanDraft?.evidence?.sources??[]).includes(option.value)"><el-icon><Check /></el-icon></div>
                  </div>
                </div>
                <div v-if="(reviewPlanDraft?.evidence?.sources??[]).includes('STANDARD')" class="selected-items-display">
                  <div class="selected-items-header"><span>已选 {{ (reviewPlanDraft?.evidence?.maxkbKnowledgeIds??[]).length }} 个知识库</span><el-button size="small" @click="openMaxKBDialog"><el-icon><Plus /></el-icon>添加</el-button></div>
                  <div v-if="(reviewPlanDraft?.evidence?.maxkbKnowledgeIds??[]).length>0" class="selected-items-tags"><el-tag v-for="id in (reviewPlanDraft?.evidence?.maxkbKnowledgeIds??[])" :key="id" closable type="primary" effect="plain" size="small" @close="removeMaxKBKnowledge(id)"><el-icon style="margin-right:4px"><Document /></el-icon>{{ getMaxKBKnowledgeName(id) }}</el-tag></div>
                </div>
                <div v-if="(reviewPlanDraft?.evidence?.sources??[]).includes('RULE_LIBRARY')" class="selected-items-display">
                  <div class="selected-items-header"><span>{{ reviewPlanDraft?.evidence?.ruleLibraryId?'已选择':'未选择' }}条文库</span><el-button size="small" @click="openRuleLibraryDialog"><el-icon><Plus /></el-icon>添加</el-button></div>
                  <div v-if="reviewPlanDraft?.evidence?.ruleLibraryId" class="selected-item-single"><el-tag closable type="info" size="small" @close="reviewPlanDraft.evidence.ruleLibraryId=null">{{ getRuleLibraryName(reviewPlanDraft?.evidence?.ruleLibraryId??'') }}</el-tag></div>
                </div>
              </div>
            </template>

            <!-- 上下文一致性：检查范围勾选项 -->
            <div v-if="entryModule === 'CONSISTENCY'" class="config-section">
              <div class="config-section-label">检查范围</div>
              <div class="consistency-checks">
                <el-checkbox v-model="reviewPlanDraft.enhancements.intraFileConsistency">文件内一致性（术语、数值、指标自洽）</el-checkbox>
                <el-checkbox v-model="reviewPlanDraft.enhancements.crossFileConsistency" :disabled="crossFileDisabled">跨文件一致性（多文件间参数核对）</el-checkbox>
              </div>
              <div class="consistency-engineering-toggle">
                <el-switch v-model="engineeringRuleEnhancement" size="small" />
                <span class="toggle-label">工程规则增强</span>
                <span class="toggle-desc">项目名一致性、目录编码与正文一致性（针对核电工程文档，非核电文档可关闭）</span>
              </div>
              <div class="config-reason config-reason--info" style="margin-top: 8px;">
                <el-icon><InfoFilled /></el-icon> 将检查文件内部及多文件间的术语、数值、指标一致性。
              </div>
            </div>

            <!-- 仅规则审查：规则范围（前缀）选择 -->
            <div v-if="entryModule === 'RULE_ONLY'" class="config-section">
              <div class="config-section-label">规则范围</div>
              <div class="rule-prefix-panel">
                <div v-for="group in rulePrefixGroups" :key="group.title" class="rule-prefix-group">
                  <div class="rule-prefix-group__header">
                    <span class="rule-prefix-group__title">{{ group.title }}</span>
                    <span class="rule-prefix-group__count">{{ group.items.length }} 项</span>
                  </div>
                  <div class="rule-prefix-group__items">
                    <div
                      v-for="item in group.items"
                      :key="item.prefix"
                      class="rule-prefix-item"
                      :class="{ 'rule-prefix-item--active': enabledRulePrefixes.includes(item.prefix) }"
                      @click="plan.togglePrefix(item.prefix)"
                      tabindex="0"
                    >
                      <div class="rule-prefix-item__info">
                        <div class="rule-prefix-item__label">{{ item.label }}</div>
                        <div class="rule-prefix-item__desc">{{ item.description }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="config-reason config-reason--info" style="margin-top: 8px;">
                <el-icon><InfoFilled /></el-icon> 不勾选任何规则时执行全部内置规则；勾选后仅执行所选规则组。结果页将按检查项分组展示。
              </div>
            </div>

            <div v-if="entryModule==='DOC_REVIEW'&&reviewPlanDraft?.objective==='COMPARE'" class="config-reason config-reason--warning">
              <el-icon><WarningFilled /></el-icon> 参照比对目标强制使用参考文件，未上传参考文件将无法提交。
            </div>

            <!-- 合同审查专用：立场选择 -->
            <div v-if="entryModule==='CONTRACT'" class="config-section">
              <div class="config-section-label">审查立场</div>
              <div class="stance-selector">
                <div
                  v-for="stance in contractStances"
                  :key="stance.value"
                  class="selectable-card selectable-card--compact"
                  :class="{ 'selectable-card--active': reviewPlanDraft?.contractStance === stance.value }"
                  @click="reviewPlanDraft.contractStance = stance.value"
                  tabindex="0"
                >
                  <div class="selectable-card__icon">
                    <el-icon :size="14"><Stamp /></el-icon>
                  </div>
                  <div class="selectable-card__content">
                    <div class="selectable-card__label">{{ stance.label }}</div>
                    <div class="selectable-card__desc">{{ stance.desc }}</div>
                  </div>
                </div>
              </div>
              <div class="config-reason config-reason--info" style="margin-top: 8px;">
                <el-icon><InfoFilled /></el-icon> 系统将从所选立场出发，重点识别对该方不利的风险条款。
              </div>
              <div v-if="reviewPlanDraft?.objective==='COMPARE'" class="config-reason config-reason--info" style="margin-top: 4px;">
                <el-icon><InfoFilled /></el-icon> 上传合同模板可进行模板比对审查；不上传则基于通用合同知识进行纯风险扫描。
              </div>
            </div>

            <!-- 合同审查专用：知识库选择（可选增强） -->
            <div v-if="entryModule==='CONTRACT'" class="config-section">
              <div class="config-section-label">知识库 <el-tag size="small" type="info" effect="plain" style="margin-left: 4px;">可选增强</el-tag></div>
              <div class="selected-items-display" style="margin-top: 0;">
                <div class="selected-items-header">
                  <span>{{ (reviewPlanDraft?.evidence?.maxkbKnowledgeIds??[]).length > 0 ? `已选 ${reviewPlanDraft.evidence.maxkbKnowledgeIds.length} 个知识库` : '选择相关知识库增强审查准确性' }}</span>
                  <el-button size="small" @click="openMaxKBDialog"><el-icon><Plus /></el-icon>添加</el-button>
                </div>
                <div v-if="(reviewPlanDraft?.evidence?.maxkbKnowledgeIds??[]).length>0" class="selected-items-tags">
                  <el-tag v-for="id in (reviewPlanDraft?.evidence?.maxkbKnowledgeIds??[])" :key="id" closable type="primary" effect="plain" size="small" @close="removeMaxKBKnowledge(id)">
                    <el-icon style="margin-right:4px"><Document /></el-icon>{{ getMaxKBKnowledgeName(id) }}
                  </el-tag>
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- 提交按钮 -->
        <div class="submit-bar">
          <el-button type="primary" size="large" :disabled="!canSubmit" @click="startAnalysis" class="submit-btn">
            <el-icon><MagicStick /></el-icon>
            {{ fileList.length > 0 ? (entryModule === 'CONTRACT' ? '开始合同风险审查' : '开始分析') : '请先上传文件' }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- 加载遮罩 -->
    <div v-if="loading && currentStep === 0" class="loading-overlay">
      <div class="loading-content">
        <p class="loading-title">{{ loadingMessage }}</p>
        <div v-if="analysisProgress.length" class="analysis-progress-steps">
          <div v-for="(item, index) in visibleAnalysisProgress" :key="index" class="progress-step" :class="`progress-step--${progressStatusClass(item.status)}`">
            <div class="progress-marker"><span v-if="item.status==='completed'">✓</span><span v-else-if="item.status==='failed'">!</span></div>
            <div class="progress-info"><div class="progress-title"><span>{{ progressStepLabel(item.step) }}</span><span class="progress-status">{{ progressStatusLabel(item.status) }}</span></div><p v-if="item.message" class="progress-message">{{ item.message }}</p></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 知识库选择弹窗 (MaxKB) -->
  <el-dialog v-model="maxkbDialogVisible" title="选择 MaxKB 知识库" width="720px" :close-on-click-modal="false" append-to-body destroy-on-close>
    <KnowledgeTreeSelector v-model="maxkbKnowledgeIds" :multiple="true" inline />
    <template #footer>
      <el-button @click="maxkbDialogVisible = false">关闭</el-button>
    </template>
  </el-dialog>
  <!-- 条文库选择对话框 -->
  <SmartReviewRuleLibraryDialog v-model:visible="ruleLibraryDialogVisible" :ruleLibraries="ruleLibraries" @confirm="handleRuleLibraryConfirm" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, MagicStick, WarningFilled, FolderOpened, Files, Link, Document, EditPen, Plus, Stamp, InfoFilled } from '@element-plus/icons-vue'
import { getKnowledgeTreeApi } from '@/api/maxkb'
import { getRuleLibrariesApi } from '@/api/rule-library'
import { getModeCapabilitiesApi } from '@/api/task'
import { getRuleRegistryApi, type RuleGroupMeta } from '@/api/system'
import SmartReviewUploadStep from './components/SmartReviewUploadStep.vue'
import KnowledgeTreeSelector from '@/components/KnowledgeTreeSelector.vue'
import SmartReviewRuleLibraryDialog from './components/SmartReviewRuleLibraryDialog.vue'
import { useSmartReviewState } from './SmartReview/composables/useSmartReviewState'
import { useReviewPlan } from './SmartReview/composables/useReviewPlan'
import { useTaskSubmission } from './SmartReview/composables/useTaskSubmission'
import { PROGRESS_STEP_LABELS, PROGRESS_STATUS_LABELS, CONTRACT_STANCES, ENTRY_MODULE_LABEL } from './SmartReview/constants/review-config'
import type { EntryModule } from './SmartReview/types/smart-review'

const state = useSmartReviewState()
const { currentStep, isFromHistory, fileList, refFileList, dwgParsedDataMap, form, entryModule, reviewPlanDraft, loading, loadingMessage, analysisProgress, backgroundStatus, submitting, visibleAnalysisProgress, showEvidenceSection, showObjectiveSelector } = state
const plan = useReviewPlan(state)
const submission = useTaskSubmission(state, plan)
const { availableEvidenceSources, isEvidenceLocked, handleEvidenceCardClick, canSubmit } = plan
const objectiveIconComponentMap: Record<string, any> = {
  COMPLIANCE: MagicStick,
  COMPARE: Document,
  PROOFREAD: EditPen,
}
const evidenceIconComponentMap: Record<string, any> = {
  STANDARD: FolderOpened,
  RULE_LIBRARY: Files,
  REFERENCE: Link,
}

// ===== 任务标题自动生成 =====
// 规则：{意图标签}·{第一个文件名(去扩展名,截断20字)}·{MM-DD HH:mm}
// 用户不输入时 placeholder 展示预览，点"自动生成"按钮填入
const buildAutoTitle = (): string => {
  const parts: string[] = []
  // 意图标签
  if (entryModule.value && ENTRY_MODULE_LABEL[entryModule.value as EntryModule]) {
    parts.push(ENTRY_MODULE_LABEL[entryModule.value as EntryModule])
  }
  // 第一个文件名（去扩展名，截断 20 字）
  const firstName = fileList.value[0]?.name
  if (firstName) {
    const baseName = firstName.replace(/\.[^.]+$/, '').slice(0, 20)
    parts.push(baseName)
  }
  // 时间戳 MM-DD HH:mm
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  parts.push(`${mm}-${dd} ${hh}:${mi}`)
  return parts.join(' · ')
}

// 实时预览（未输入时 placeholder 显示）
const autoTitlePreview = computed(() => {
  const preview = buildAutoTitle()
  return preview || '点击右侧"自动生成"或自行输入'
})

const fillAutoTitle = () => {
  form.title = buildAutoTitle()
}

// 合同审查立场选项
const contractStances = CONTRACT_STANCES

// 工程规则增强开关（CONSISTENCY 模式专用）：控制是否启用 CONSIST 前缀规则
// 默认开启（applyEntryModulePreset 中设置 enabledRulePrefixes=['CONSIST']），
// 非核电工程文档可关闭以避免误报
const engineeringRuleEnhancement = computed({
  get: () => state.enabledRulePrefixes.value.includes('CONSIST'),
  set: (val: boolean) => {
    const idx = state.enabledRulePrefixes.value.indexOf('CONSIST')
    if (val && idx < 0) {
      state.enabledRulePrefixes.value.push('CONSIST')
    } else if (!val && idx >= 0) {
      state.enabledRulePrefixes.value.splice(idx, 1)
    }
  },
})

const maxkbDialogVisible = ref(false)

// ===== 规则前缀面板（RULE_ONLY 模式：规则范围选择）=====
const rulePrefixGroups = ref<RuleGroupMeta[]>([])
const enabledRulePrefixes = computed(() => state.enabledRulePrefixes.value)
let ruleRegistryLoadedFlag = false
const loadRuleRegistry = async () => {
  if (ruleRegistryLoadedFlag) return
  ruleRegistryLoadedFlag = true
  try {
    const res = await getRuleRegistryApi()
    rulePrefixGroups.value = res.data?.groups ?? []
  } catch (e) {
    ruleRegistryLoadedFlag = false
    console.error('[SmartReview] 加载规则注册表失败:', e)
  }
}
// RULE_ONLY 模式进入时预加载规则注册表（卡片/历史恢复共用）
watch(entryModule, (v) => { if (v === 'RULE_ONLY') loadRuleRegistry() }, { immediate: true })
const ruleLibraryDialogVisible = ref(false)
const maxkbKnowledgeIds = computed({
  get: () => state.reviewPlanDraft?.evidence?.maxkbKnowledgeIds ?? [],
  set: (val) => { if (state.reviewPlanDraft?.evidence) state.reviewPlanDraft.evidence.maxkbKnowledgeIds = val }
})
const knowledgeNameMap = ref<Map<string, string>>(new Map())
const ruleLibraries = ref<Array<{ id: string; name: string; status: string; ruleCount: number; executableCount: number }>>([])

// Task 15: 模式能力配置（从后端 mode-config 拉取），用于禁用与模式能力不符的勾选项
const ENTRY_MODULE_TO_REVIEW_MODE: Record<string, string> = {
  LIBRARY: 'LIBRARY_REVIEW',
  CONSISTENCY: 'CONSISTENCY',
  PROOFREAD: 'TYPO_GRAMMAR',
  DOC_REVIEW: 'DOC_REVIEW',
  RULE_ONLY: 'RULE_ONLY',
  CONTRACT: 'CONTRACT_REVIEW',
}
const modeCapabilities = ref<Record<string, { crossFile?: boolean }>>({})
// 当前入口模式是否支持跨文件一致性（mode-config crossFile=true）
const crossFileDisabled = computed(() => {
  const mode = entryModule.value ? ENTRY_MODULE_TO_REVIEW_MODE[entryModule.value] : undefined
  if (!mode) return false
  const cfg = modeCapabilities.value[mode]
  return cfg ? cfg.crossFile !== true : false
})
// 模式不支持跨文件时，自动取消勾选，避免提交与 mode-config 矛盾的配置
watch(crossFileDisabled, (disabled) => {
  if (disabled && state.reviewPlanDraft?.enhancements?.crossFileConsistency) {
    state.reviewPlanDraft.enhancements.crossFileConsistency = false
  }
})

const progressStepLabel = (step: string) => PROGRESS_STEP_LABELS[step] || step || '处理中'
const progressStatusLabel = (status: string) => PROGRESS_STATUS_LABELS[status] || status || '处理中'
const progressStatusClass = (status: string) => { if (status==='completed') return 'completed'; if (status==='failed') return 'failed'; return 'running' }

const startAnalysis = async () => {
  if (!state.form.title.trim()) { ElMessage.warning('请输入任务标题'); return }
  if (!plan.canSubmit.value) {
    const reasons: string[] = []
    if (!state.form.title.trim()) reasons.push('请输入任务标题')
    if ((state.reviewPlanDraft?.objective??'')==='COMPARE'&&state.refFileList.value.length===0) reasons.push('以文审文/参照比对模式需要上传参照文件')
    if ((state.reviewPlanDraft?.evidence?.sources??[]).includes('RULE_LIBRARY')&&!state.reviewPlanDraft?.evidence?.ruleLibraryId) reasons.push('条文库模式需要选择具体的规则库')
    ElMessage.warning(reasons.length>0?reasons[0]:'请完善审查配置后再开始分析')
    return
  }
  await submission.submitTask()
}

const openMaxKBDialog = () => { maxkbDialogVisible.value = true }
const openRuleLibraryDialog = async () => {
  ruleLibraryDialogVisible.value = true
  try { const libRes = await getRuleLibrariesApi(); ruleLibraries.value = (libRes.data||[]).map((l:any)=>({ id:l.id, name:l.name, status:l.status||'DRAFT', description:l.description||'', ruleCount:l._count?.items||l.items?.length||0, executableCount:l.enabledExecutableItemCount||l.executableItemCount||0 })) } catch(e) { console.warn('[SmartReview] 刷新规则库列表失败:',e) }
}
const handleMaxKBConfirm = (selectedIds: string[]) => { if (state.reviewPlanDraft?.evidence) state.reviewPlanDraft.evidence.maxkbKnowledgeIds = selectedIds }
const handleRuleLibraryConfirm = (libraryId: string|null) => { if (state.reviewPlanDraft?.evidence) state.reviewPlanDraft.evidence.ruleLibraryId = libraryId }
const removeMaxKBKnowledge = (id: string) => { if (state.reviewPlanDraft?.evidence?.maxkbKnowledgeIds) { const i=state.reviewPlanDraft.evidence.maxkbKnowledgeIds.indexOf(id); if(i>-1) state.reviewPlanDraft.evidence.maxkbKnowledgeIds.splice(i,1) } }
const getMaxKBKnowledgeName = (id: string) => { return knowledgeNameMap.value.get(id) || id.slice(0, 8) + '...' }
const getRuleLibraryName = (id: string) => { const l=ruleLibraries.value.find(x=>x.id===id); return l?.name||id }

/** 从 MaxKB 知识库树构建 id→name 映射 */
const buildKnowledgeNameMap = async () => {
  try {
    const { data } = await getKnowledgeTreeApi()
    const map = new Map<string, string>()
    const walk = (nodes: any[]) => {
      for (const n of nodes) {
        if (n.type === 'knowledge' || n.type === 'dataset') map.set(n.id, n.name)
        if (n.children?.length) walk(n.children)
      }
    }
    walk(Array.isArray(data) ? data : [])
    knowledgeNameMap.value = map
  } catch { /* 静默 */ }
}

onMounted(async () => {
  const restored = state.restoreState()
  if (restored && state.currentStep.value>0) { nextTick(()=>{ if(state.currentStep.value>=1&&state.fileList.value.length===0){ ElMessage.warning('已恢复之前的配置草稿，但文件需要重新上传'); state.currentStep.value=0; state.clearSavedState() } }) }
  const entry = sessionStorage.getItem('smartReview.entryModule') as EntryModule|null
  if (entry && ['LIBRARY','CONSISTENCY','PROOFREAD','RULE_ONLY','DOC_REVIEW','CONTRACT'].includes(entry)) { state.entryModule.value=entry; plan.applyEntryModulePreset(entry) }
  try {
    await buildKnowledgeNameMap()
    const libRes = await getRuleLibrariesApi()
    ruleLibraries.value = (libRes.data||[]).map((l:any)=>({ id:l.id, name:l.name, status:l.status||'DRAFT', description:l.description||'', ruleCount:l._count?.items||l.items?.length||0, executableCount:l.enabledExecutableCount||l.executableItemCount||0 }))
  } catch(e) { console.warn('[SmartReview] 加载数据失败:',e) }
  // Task 15: 拉取 mode-config 能力配置，用于禁用与模式不符的勾选项
  try {
    const { data: caps } = await getModeCapabilitiesApi()
    if (caps && typeof caps === 'object') modeCapabilities.value = caps as Record<string, { crossFile?: boolean }>
  } catch(e) { console.warn('[SmartReview] 加载模式能力配置失败:',e) }
})
</script>

<style scoped>
/* ---- 页面容器与主流程布局（review-flow / flow-section）---- */
.smart-review {
  min-height: 100%;
}
.review-flow {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: var(--corp-max-width);
  margin: 0 auto;
  padding: 24px;
  background: #f5f6f7;
  min-height: 100vh;
}
.flow-section {
  background: #fff;
  border: none;
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 4px 12px rgba(0, 0, 0, 0.03);
  padding: 22px 24px;
}
@media (max-width: 900px) {
  .review-flow { padding: 16px; }
  .flow-section { padding: 18px 16px; }
}

/* ---- 标题 ---- */
.title-label { font-size: 14px; font-weight: 600; color: #1f2329; margin-bottom: 10px; }
.title-input-row { display: flex; gap: 10px; align-items: center; }
.title-input { flex: 1; }
.auto-title-btn {
  background: #f0f3ff;
  border: 1px solid #dfe5ff;
  color: #4e6ef2;
  border-radius: 10px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: none;
  padding: 0 18px;
  height: 40px;
}
.auto-title-btn:hover {
  background: #e4e9ff;
  border-color: #c7d2ff;
  color: #4e6ef2;
}
.required-mark { color: #e5484d; margin-left: 2px; font-weight: 700; }

/* ---- 提交按钮 ---- */
.submit-bar { margin-top: 16px; display: flex; justify-content: flex-end; padding-top: 16px; border-top: 1px solid #f0f1f3; }
.submit-btn { padding: 12px 36px; font-size: 15px; font-weight: 600; border-radius: 10px; min-width: 160px; background: #4e6ef2; border-color: #4e6ef2; box-shadow: 0 2px 8px rgba(78, 110, 242, 0.2); }

/* ---- 配置区 ---- */
.review-items-section { margin-top: var(--space-1); }
.config-section { padding: var(--space-5) 0; border-bottom: 1px solid var(--corp-border-light); }
.config-section:last-child { border-bottom: none; padding-bottom: 0; }
.config-section-label { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; color: var(--corp-text-primary); margin-bottom: 10px; }

/* ---- 可选中卡片 ---- */
.selectable-card { display: flex; align-items: center; gap: 10px; padding: var(--space-4) var(--space-5); border: 1px solid var(--corp-border-light); border-radius: var(--radius-lg); background: var(--bg-surface-hover); cursor: pointer; transition: border-color var(--corp-transition-base), background var(--corp-transition-base), box-shadow var(--corp-transition-base); user-select: none; }
.selectable-card:hover:not(.selectable-card--disabled) { border-color: var(--color-primary-300); background: var(--bg-surface); box-shadow: 0 2px 8px rgba(59,130,246,0.08); }
.selectable-card--active { border-color: var(--color-primary-600); background: var(--color-primary-50); box-shadow: 0 0 0 1px var(--color-primary-600); }
.selectable-card--disabled { opacity: 0.45; cursor: not-allowed; }
.selectable-card--compact { padding: 11px var(--space-5); }
.selectable-card--compact .selectable-card__icon { width: 28px; height: 28px; border-radius: var(--radius-md); }
.selectable-card--inline { flex: 1; justify-content: center; }
.selectable-card__icon { width: 30px; height: 30px; border-radius: var(--radius-md); background: var(--color-primary-50); color: var(--color-primary-600); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.selectable-card--active .selectable-card__icon { background: var(--color-primary-600); color: var(--bg-surface); }
.selectable-card__content { flex: 1; min-width: 0; }
.selectable-card__label { font-size: var(--text-base); font-weight: 600; color: var(--corp-text-primary); }
.selectable-card__desc { font-size: var(--text-sm); color: var(--corp-text-tertiary); margin-top: 1px; }
.selectable-card__check { margin-left: auto; width: 20px; height: 20px; border-radius: 50%; background: var(--color-primary-500); color: var(--bg-surface); display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }

/* ---- 目标选择 ---- */
.objective-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.locked-objective { display: flex; align-items: center; gap: var(--space-2); padding: 10px var(--space-5); background: var(--bg-surface-hover); border: 1px solid var(--corp-border-light); border-radius: var(--radius-md); font-size: var(--text-base); font-weight: 600; color: var(--color-gray-700); }

/* ---- 一致性检查范围 ---- */
.consistency-checks { display: flex; flex-direction: column; gap: 10px; padding: var(--space-4) var(--space-5); background: var(--bg-surface-hover); border: 1px solid var(--corp-border-light); border-radius: var(--radius-md); }
.consistency-checks :deep(.el-checkbox__label) { font-size: var(--text-base); color: var(--corp-text-primary); }
.consistency-engineering-toggle { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); padding: 10px var(--space-5); background: var(--color-primary-50); border: 1px solid var(--color-primary-200); border-radius: var(--radius-md); }
.consistency-engineering-toggle .toggle-label { font-size: var(--text-base); font-weight: 600; color: var(--color-primary-700); }
.consistency-engineering-toggle .toggle-desc { font-size: var(--text-sm); color: var(--corp-text-secondary); }

/* ---- 证据源 ---- */
.evidence-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.stance-selector { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.execution-options { display: flex; gap: var(--space-2); }

/* ---- 已选项目 ---- */
.selected-items-display { margin-top: 10px; padding: var(--space-4) var(--space-5); background: var(--bg-surface-hover); border-radius: var(--radius-md); border: 1px solid var(--corp-border-light); }
.selected-items-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2); font-size: var(--text-base); font-weight: 500; color: var(--corp-text-secondary); }
.selected-items-header span { color: var(--color-gray-700); font-weight: 600; }
.selected-items-header :deep(.el-button) { padding: 5px 12px; font-size: var(--text-sm); border-radius: var(--radius-sm); }
.selected-items-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); }

/* ---- 提示条 ---- */
.config-reason { display: flex; align-items: center; gap: var(--space-2); margin-top: 10px; padding: 10px var(--space-5); font-size: var(--text-base); border-radius: var(--radius-md); }
.config-reason--warning { background: var(--color-warning-bg); border: 1px solid var(--color-warning-600); color: var(--color-warning-text); }

/* ---- 规则前缀面板 ---- */
.rule-prefix-panel { display: flex; flex-direction: column; gap: 10px; }
.rule-prefix-group { border: 1px solid var(--corp-border-light); border-radius: var(--radius-md); overflow: hidden; }
.rule-prefix-group__header { display: flex; align-items: center; gap: var(--space-2); padding: 10px var(--space-5); background: var(--bg-surface-hover); border-bottom: 1px solid var(--corp-border-light); color: var(--color-gray-700); font-size: var(--text-base); font-weight: 600; cursor: pointer; user-select: none; }
.rule-prefix-group__header:hover { background: var(--bg-surface-active); }
.rule-prefix-group__title { flex: 1; }
.rule-prefix-group__count { font-size: var(--text-sm); color: var(--corp-text-tertiary); font-weight: 500; }
.rule-prefix-group__items { display: grid; grid-template-columns: 1fr; gap: var(--space-1); padding: var(--space-2); background: var(--bg-surface-hover); }
.rule-prefix-item { display: flex; align-items: center; gap: var(--space-2); padding: 10px var(--space-4); background: var(--bg-surface); border: 1px solid var(--corp-border-light); border-radius: var(--radius-sm); cursor: pointer; transition: border-color 0.15s, background 0.15s; user-select: none; }
.rule-prefix-item:hover { border-color: var(--color-primary-300); background: var(--bg-surface-hover); }
.rule-prefix-item--active { border-color: var(--color-primary-600); background: var(--color-primary-50); box-shadow: 0 0 0 1px var(--color-primary-600); }
.rule-prefix-item__info { flex: 1; min-width: 0; }
.rule-prefix-item__label { font-size: var(--text-base); font-weight: 500; color: var(--corp-text-primary); }
.rule-prefix-item--active .rule-prefix-item__label { color: var(--color-primary-700); font-weight: 600; }
.rule-prefix-item__desc { font-size: var(--text-sm); color: var(--corp-text-tertiary); line-height: 1.4; margin-top: 2px; white-space: normal; }

/* ---- 加载遮罩 ---- */
.loading-overlay { position: fixed; inset: 0; background: rgba(255,255,255,0.7); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.loading-content { background: var(--bg-surface); border-radius: var(--radius-xl); padding: var(--space-8); box-shadow: var(--shadow-elevated); border: 1px solid var(--corp-border-light); max-width: 480px; width: 100%; }
.loading-title { font-size: var(--text-xl); font-weight: 700; color: var(--corp-text-primary); margin: 0 0 var(--space-6); text-align: center; }
.analysis-progress-steps { display: flex; flex-direction: column; gap: var(--space-4); }
.progress-step { display: flex; align-items: flex-start; gap: var(--space-4); padding: 10px var(--space-4); border-radius: var(--radius-md); }
.progress-step--running { background: var(--color-primary-50); }
.progress-step--completed { background: var(--color-success-bg); }
.progress-step--failed { background: var(--color-danger-bg); }
.progress-marker { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: var(--text-sm); font-weight: 700; flex-shrink: 0; }
.progress-step--running .progress-marker { background: var(--color-primary-500); color: var(--bg-surface); }
.progress-step--completed .progress-marker { background: var(--color-success); color: var(--bg-surface); }
.progress-step--failed .progress-marker { background: var(--color-danger); color: var(--bg-surface); }
.progress-info { flex: 1; }
.progress-title { display: flex; align-items: center; justify-content: space-between; font-size: 14px; font-weight: 600; color: var(--corp-text-primary); }
.progress-status { font-size: var(--text-sm); font-weight: 500; color: var(--corp-text-secondary); }
.progress-message { font-size: var(--text-sm); color: var(--corp-text-secondary); margin: var(--space-1) 0 0; }
</style>
