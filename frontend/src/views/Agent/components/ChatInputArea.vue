<template>
  <div class="chat-input-area">
    <!-- 图片预览（粘贴图片） -->
    <div v-if="attachedImages.length > 0" class="image-previews">
      <div v-for="(img, i) in attachedImages" :key="i" class="img-preview">
        <img :src="img.previewUrl" alt="粘贴图片" />
        <button class="img-remove" title="移除图片" @click="removeImage(i)">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" /></svg>
        </button>
      </div>
    </div>

    <!-- 一体化输入容器 -->
    <div class="chat-input-box">
      <textarea
        ref="inputTextareaRef"
        :value="inputValue"
        class="chat-textarea"
        rows="1"
        placeholder="输入问题或审查要求…（Enter 发送，Shift+Enter 换行）"
        @input="onInput"
        @keydown.enter.exact.prevent="$emit('send')"
        @keydown.shift.enter.exact="() => {}"
        @paste="onPasteImages"
      />
      <button
        v-if="!isLoading"
        class="send-btn-inline"
        :disabled="!inputValue.trim() && attachedImages.length === 0"
        :title="'发送'"
        @click="$emit('send')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="7" x2="11" y2="7" /><polyline points="7.5 3 12 7 7.5 11" /></svg>
        <span>发送</span>
      </button>
      <button v-else class="stop-btn-inline" title="停止" @click="$emit('stop')">
        <span class="stop-icon"><svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" /></svg></span>
        <span>停止</span>
      </button>
    </div>

    <!-- 底部控制条（对齐参考：左组 attach+模型 gap2 | spacer | 右组 思考/工具/压缩 gap6） -->
    <div class="input-controls">
      <div class="ctl-left-group">
        <el-upload
          :http-request="onUpload"
          :show-file-list="false"
          :disabled="uploading"
          multiple
          class="upload-btn"
        >
          <button
            class="attach-btn"
            :class="{ 'has-images': attachedImages.length > 0 }"
            title="上传文件"
            :disabled="uploading"
          >
            <svg v-if="!uploading" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            <el-icon :size="15" v-else class="is-loading"><Loading /></el-icon>
          </button>
        </el-upload>
        <div ref="modelDropdownRef" class="model-select" :class="{ open: modelDropdownOpen }">
          <button
            class="model-select-btn"
            :disabled="isLoading"
            :title="modelButtonTitle"
            @click.stop="toggleModelDropdown"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg>
            <span class="model-current">{{ currentModelName }}</span>
          </button>
          <div v-if="modelDropdownOpen" class="model-dropdown-panel">
            <div v-if="showModelFilter" class="model-filter">
              <input
                v-model="modelFilter"
                placeholder="筛选模型"
                autocomplete="off"
                spellcheck="false"
                @keydown.esc="modelDropdownOpen = false"
              />
            </div>
            <div class="model-groups">
              <template v-for="group in modelGroups" :key="group.provider">
                <div v-if="modelGroups.length > 1" class="model-group-title">{{ group.provider }}</div>
                <button
                  v-for="opt in group.options"
                  :key="opt.key ?? 'default'"
                  class="model-option"
                  :class="{ active: isActiveModel(opt) }"
                  @click="selectModel(opt)"
                >
                  <svg v-if="isActiveModel(opt)" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opt-check"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                  <span v-else class="opt-placeholder" />
                  <span class="opt-label">{{ opt.label }}</span>
                  <svg v-if="opt.vision" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="opt-vision" title="支持图像输入"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                </button>
              </template>
              <div v-if="hasNoModels" class="model-no-results">无可用模型</div>
              <div v-else-if="hasNoMatches" class="model-no-results">无匹配模型</div>
            </div>
          </div>
        </div>
      </div>
      <div class="ctl-spacer" />
      <div class="ctl-right-group">
        <div ref="thinkingDropdownRef" class="ctl-select" :class="{ open: thinkingOpen }">
          <button class="ctl-select-btn" title="推理强度（模型不支持时忽略，模型默认 = 不覆盖）" @click.stop="toggleThinking">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" /><line x1="7" y1="18" x2="12" y2="18" /><line x1="8" y1="21" x2="11" y2="21" /></svg>
            <span>{{ thinkingLabel }}</span>
          </button>
          <div v-if="thinkingOpen" class="ctl-dropdown" style="min-width: 180px;">
            <button class="ctl-dropdown-item" :class="{ active: !thinkingLevel }" @click="selectThinking(null)">模型默认</button>
            <button
              v-for="o in thinkingOptions"
              :key="o.value"
              class="ctl-dropdown-item"
              :class="{ active: thinkingLevel === o.value }"
              @click="selectThinking(o.value)"
            >
              <svg v-if="thinkingLevel === o.value" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opt-check"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
              <span v-else class="opt-placeholder" />
              <span class="ctl-item-label">{{ o.label }}</span>
              <span class="ctl-desc">{{ o.desc }}</span>
            </button>
          </div>
        </div>
        <button
          class="ctl-kb-btn"
          :class="{ connected: toolPreset === 'qa' }"
          :title="toolPreset === 'qa' ? '已连接知识库（仅知识库检索问答）；点击断开，恢复全部工具' : '连接知识库，仅做知识库检索问答'"
          @click="toggleKnowledge"
        >
          <svg v-if="toolPreset === 'qa'" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9" /><polyline points="21 3 12 12 8 8" /><polyline points="21 3 21 8 16 8" /></svg>
          <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
          <span>{{ toolPreset === 'qa' ? '已连接知识库' : '连接知识库' }}</span>
        </button>
        <button
          class="ctl-compact-btn"
          :class="{ compacting }"
          :disabled="!canCompact || compacting"
          title="将早期消息压缩为摘要，释放上下文空间"
          @click="$emit('compact')"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" /></svg>
          <span>{{ compacting ? '压缩中…' : '压缩上下文' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import type { AgentModelOption } from '@/api/agent'

export interface AttachedImage {
  dataUrl: string
  previewUrl: string
  fileName?: string
}

const props = defineProps<{
  modelOptions: AgentModelOption[]
  modelKey: string | null
  thinkingLevel: string | null
  toolPreset: string
  isLoading: boolean
  inputValue: string
  attachedImages: AttachedImage[]
  uploading: boolean
  compacting: boolean
  canCompact: boolean
}>()

const emit = defineEmits<{
  'update:inputValue': [string]
  'update:attachedImages': [AttachedImage[]]
  send: []
  stop: []
  'model-change': [string | null]
  'thinking-change': [string | null]
  'preset-change': [string]
  compact: []
  upload: [{ file: File }]
}>()

const inputTextareaRef = ref<HTMLTextAreaElement | null>(null)

function onInput(e: Event) {
  const ta = e.target as HTMLTextAreaElement
  emit('update:inputValue', ta.value)
  ta.style.height = 'auto'
  ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`
}

function onUpload(options: { file: File }) {
  emit('upload', options)
}

function onPasteImages(e: ClipboardEvent) {
  const items = Array.from(e.clipboardData?.items ?? [])
  const imageItems = items.filter(i => i.type.startsWith('image/'))
  if (imageItems.length === 0) return
  e.preventDefault()
  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) continue
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      emit('update:attachedImages', [
        ...props.attachedImages,
        { dataUrl, previewUrl: dataUrl, fileName: file.name },
      ])
    }
    reader.readAsDataURL(file)
  }
}

function removeImage(i: number) {
  const next = props.attachedImages.slice()
  next.splice(i, 1)
  emit('update:attachedImages', next)
}

// ===== 模型选择器（对齐参考 pi-web ChatInput：按钮 + fixed 面板 + provider 分组 + 数字感知排序）=====
const modelDropdownRef = ref<HTMLDivElement | null>(null)
const modelDropdownOpen = ref(false)
const modelFilter = ref('')
const MODEL_FILTER_THRESHOLD = 8
const showModelFilter = computed(() => props.modelOptions.length > MODEL_FILTER_THRESHOLD)

/** 数字感知排序（对齐 pi-web compareModelOptions：Intl.Collator numeric + base） */
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
function compareModelOptions(a: AgentModelOption, b: AgentModelOption): number {
  const an = a.name || a.label
  const bn = b.name || b.label
  const ap = a.provider || ''
  const bp = b.provider || ''
  const am = a.modelId || a.label
  const bm = b.modelId || b.label
  return MODEL_OPTION_COLLATOR.compare(an, bn)
    || MODEL_OPTION_COLLATOR.compare(ap, bp)
    || MODEL_OPTION_COLLATOR.compare(am, bm)
}

/** 过滤：匹配 name + modelId（对齐 pi-web filterModelOptions，同时保留 label 兼容） */
function filterModelOptions(options: AgentModelOption[], query: string): AgentModelOption[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return options
  return options.filter(o => {
    const hay = `${o.name || ''} ${o.modelId || ''} ${o.label}`
    return hay.toLocaleLowerCase().includes(q)
  })
}

const currentModelName = computed(() => {
  if (!props.modelKey) {
    // 无选中时显示第一个可用模型（默认选中由父组件保证，这里兜底显示）
    const first = props.modelOptions[0]
    if (first) return first.label
    return '选择模型'
  }
  const m = props.modelOptions.find(o => o.key === props.modelKey)
  if (m) return m.label
  const last = props.modelKey.split('::').pop()
  return last ?? props.modelKey
})

const modelButtonTitle = computed(() =>
  props.modelOptions.length > 0 ? '选择会话使用的模型' : '暂无可用模型'
)

interface ModelGroup { provider: string; options: AgentModelOption[] }
const modelGroups = computed<ModelGroup[]>(() => {
  const filtered = filterModelOptions(props.modelOptions, modelFilter.value)
  const sorted = [...filtered].sort(compareModelOptions)
  const groups: ModelGroup[] = []
  for (const m of sorted) {
    const provider = m.provider || (m.key ? m.key.split('::')[0] || '其他' : '系统默认')
    const g = groups.find(x => x.provider === provider)
    if (g) g.options.push(m)
    else groups.push({ provider, options: [m] })
  }
  return groups
})

const hasNoModels = computed(() => props.modelOptions.length === 0)
const hasNoMatches = computed(() => props.modelOptions.length > 0 && modelGroups.value.length === 0)

function isActiveModel(opt: AgentModelOption): boolean {
  return opt.key === props.modelKey
}

function toggleModelDropdown() {
  modelDropdownOpen.value = !modelDropdownOpen.value
  if (!modelDropdownOpen.value) modelFilter.value = ''
}

function selectModel(opt: AgentModelOption) {
  // 对齐 pi-web：点击当前激活模型时也触发（若当前是自动选择则显式固定），否则关闭
  if (!isActiveModel(opt)) {
    emit('model-change', opt.key ?? null)
  }
  modelDropdownOpen.value = false
  modelFilter.value = ''
}

// ===== 思考强度 / 工具预设（对齐参考：自绘按钮 + 下拉面板，替代 el-select）=====
const thinkingDropdownRef = ref<HTMLDivElement | null>(null)
const thinkingOpen = ref(false)

const thinkingOptions = [
  { label: '低', value: 'low', desc: '快速响应，最少推理' },
  { label: '中', value: 'medium', desc: '平衡速度与质量' },
  { label: '高', value: 'high', desc: '深度推理，质量优先' },
]
const thinkingLabel = computed(() => {
  const o = thinkingOptions.find(x => x.value === props.thinkingLevel)
  return o ? `思考·${o.label}` : '思考·默认'
})

function toggleThinking() { thinkingOpen.value = !thinkingOpen.value }
function selectThinking(v: string | null) {
  emit('thinking-change', v)
  thinkingOpen.value = false
}
function toggleKnowledge() {
  emit('preset-change', props.toolPreset === 'qa' ? 'full' : 'qa')
}

function onDocMouseDown(e: MouseEvent) {
  const t = e.target as Node
  if (modelDropdownRef.value && !modelDropdownRef.value.contains(t)) modelDropdownOpen.value = false
  if (thinkingDropdownRef.value && !thinkingDropdownRef.value.contains(t)) thinkingOpen.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))
</script>

<style scoped>
.chat-input-area {
  width: 100%;
}

/* 图片预览（粘贴图片） */
.image-previews {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  padding-top: 8px;
}
.img-preview {
  position: relative;
  flex-shrink: 0;
}
.img-preview img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border);
  display: block;
}
.img-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  color: var(--text-muted);
  transition: color 0.12s, border-color 0.12s;
}
.img-remove:hover {
  color: var(--danger);
  border-color: var(--danger);
}

/* 一体化输入容器 */
.chat-input-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 14px;
  padding: 10px 10px 10px 14px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.10);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.chat-textarea {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  resize: none;
  color: var(--text);
  font-size: 14px;
  line-height: 1.6;
  font-family: inherit;
  min-height: 48px;
  max-height: 220px;
  overflow: auto;
  padding: 0;
}
.send-btn-inline {
  flex-shrink: 0;
  align-self: flex-end;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: var(--corp-text-inverse);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.25);
  transition: background 0.15s, box-shadow 0.15s;
}
.send-btn-inline:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send-btn-inline:disabled {
  background: var(--bg-panel);
  color: var(--text-dim);
  cursor: not-allowed;
  box-shadow: none;
}
/* 停止按钮（对齐参考：浅红底 + 红边框 + 红字 + 10px 方块图标） */
.stop-btn-inline {
  flex-shrink: 0;
  align-self: flex-end;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
  border-radius: 9px;
  color: var(--color-danger);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.stop-btn-inline:hover { background: rgba(239, 68, 68, 0.16); }
.stop-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* 底部控制条（对齐参考：左组 gap2 / 右组 gap6 / 按钮高 32 圆角 9） */
.input-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.ctl-spacer { flex: 1; }
.ctl-left-group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.ctl-right-group {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.upload-btn { display: flex; align-items: center; }

/* 思考强度 / 工具预设：自绘按钮 + 向上弹出下拉（对齐参考） */
.ctl-select {
  position: relative;
}
.ctl-select-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 9px;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.ctl-select-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
/* 连接知识库开关（替代工具预设下拉：默认全部工具，点击切换知识库检索） */
.ctl-kb-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 8px 12px;
  border: 1px solid transparent;
  background: none;
  border-radius: 9px;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.ctl-kb-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.ctl-kb-btn.connected {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}
.ctl-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 500;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.10);
  overflow: hidden;
  overflow-y: auto;
  max-height: 260px;
}
.ctl-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  text-align: left;
}
.ctl-dropdown-item:hover {
  background: var(--bg-hover);
}
.ctl-dropdown-item.active {
  background: var(--bg-selected);
  color: var(--text);
  font-weight: 600;
}
.ctl-item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ctl-desc {
  flex-shrink: 0;
  margin-left: 12px;
  color: var(--text-muted);
  opacity: 0.72;
  font-size: 11px;
  font-weight: 400;
  white-space: nowrap;
}

/* 压缩上下文：自绘按钮（对齐参考 compact 风格） */
.ctl-compact-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 8px 12px;
  border: none;
  border-radius: 9px;
  background: none;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.ctl-compact-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.ctl-compact-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ctl-compact-btn.compacting {
  background: rgba(239, 68, 68, 0.08);
  color: var(--danger);
}

/* 模型选择器（对齐参考：按钮 + 下拉面板 + provider 分组） */
.model-select {
  position: relative;
  min-width: 0;
}
.model-select-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 8px 12px;
  max-width: 220px;
  overflow: hidden;
  background: none;
  border: none;
  border-radius: 9px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s, color 0.12s;
}
.model-select-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.model-select-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.model-current {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.model-dropdown-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 500;
  min-width: 220px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.10);
  overflow: hidden;
  max-height: min(320px, calc(100vh - 90px));
}
.model-filter {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.model-filter input {
  width: 100%;
  min-width: 200px;
  font-size: 11px;
  font-family: var(--font-mono);
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  background: var(--bg);
  color: var(--text);
  box-sizing: border-box;
}
.model-filter input:focus {
  border-color: var(--accent);
}
.model-groups {
  min-height: 0;
  overflow-y: auto;
}
.model-group-title {
  padding: 6px 12px 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.07em;
  border-top: 1px solid var(--border);
}
.model-group-title:first-child {
  border-top: none;
}
.model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}
.model-option:hover:not(.active) {
  background: var(--bg-hover);
}
.model-option.active {
  background: var(--bg-selected);
  color: var(--text);
  font-weight: 600;
}
.opt-check {
  flex-shrink: 0;
  color: var(--accent);
}
.opt-placeholder {
  width: 10px;
  flex-shrink: 0;
}
.opt-label {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.opt-vision {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 8px;
  opacity: 0.75;
}
.model-option.active .opt-vision {
  stroke: var(--accent);
  opacity: 1;
}
.model-option:hover:not(.active) .opt-vision {
  stroke: var(--text-muted);
  opacity: 1;
}
.model-no-results {
  padding: 8px 12px;
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}
.attach-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 9px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.attach-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.attach-btn.has-images:not(:disabled) {
  color: var(--accent);
}
.attach-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.attach-btn .is-loading {
  animation: agent-spin 0.9s linear infinite;
}
</style>
