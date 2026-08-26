<template>
  <div v-if="visible" class="ask-user-mask">
    <div class="ask-user-card">
      <div class="ask-user-header">
        <el-icon :size="16"><ChatDotRound /></el-icon>
        <span>Agent 提问</span>
      </div>
      <p class="ask-user-question">{{ question }}</p>
      <div v-if="timeoutRemaining > 0" class="ask-user-timeout">
        <el-icon :size="12"><Timer /></el-icon>
        <span>{{ timeoutRemaining }} 秒后自动取消</span>
      </div>

      <!-- confirm -->
      <div v-if="method === 'confirm'" class="ask-user-body">
        <div class="ask-user-actions">
          <button class="ask-btn cancel" @click="onCancel">取消</button>
          <button class="ask-btn confirm" @click="onSubmit('确认')">确认</button>
        </div>
      </div>

      <!-- input -->
      <div v-else-if="method === 'input'" class="ask-user-body">
        <input
          v-model="inputValue"
          class="ask-user-input"
          type="text"
          placeholder="请输入…"
          @keyup.enter="onInputEnter"
        />
        <div class="ask-user-actions">
          <button class="ask-btn cancel" @click="onCancel">取消</button>
          <button class="ask-btn confirm" :disabled="!inputValue.trim()" @click="onSubmit(inputValue)">提交</button>
        </div>
      </div>

      <!-- select -->
      <div v-else-if="method === 'select'" class="ask-user-body">
        <div class="ask-user-options">
          <button
            v-for="opt in options"
            :key="opt"
            class="ask-opt"
            :class="{ active: selectValue === opt }"
            @click="selectValue = opt"
          >{{ opt }}</button>
        </div>
        <div class="ask-user-actions">
          <button class="ask-btn cancel" @click="onCancel">取消</button>
          <button class="ask-btn confirm" :disabled="!selectValue" @click="onSubmit(selectValue)">提交</button>
        </div>
      </div>

      <!-- editor -->
      <div v-else class="ask-user-body">
        <textarea
          v-model="editorValue"
          class="ask-user-editor"
          placeholder="请补充…"
          rows="4"
        ></textarea>
        <div class="ask-user-actions">
          <button class="ask-btn cancel" @click="onCancel">取消</button>
          <button class="ask-btn confirm" :disabled="!editorValue.trim()" @click="onSubmit(editorValue)">提交</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChatDotRound, Timer } from '@element-plus/icons-vue'

const props = defineProps<{
  visible: boolean
  question: string
  method: 'confirm' | 'input' | 'select' | 'editor'
  options?: string[]
  timeoutSec?: number
}>()

const emit = defineEmits<{
  (e: 'submit', answer: string): void
  (e: 'cancel'): void
}>()

const inputValue = ref('')
const selectValue = ref('')
const editorValue = ref('')
const timeoutRemaining = ref(0)
let timeoutTimer: number | null = null

// 超时倒计时：timeoutSec 到达后自动取消（修复：原实现完全未使用 timeoutSec 字段）
function startTimeout() {
  clearTimeoutTimer()
  const total = props.timeoutSec && props.timeoutSec > 0 ? props.timeoutSec : 0
  if (!total) return
  timeoutRemaining.value = total
  timeoutTimer = window.setInterval(() => {
    timeoutRemaining.value -= 1
    if (timeoutRemaining.value <= 0) {
      clearTimeoutTimer()
      emit('cancel', '')
    }
  }, 1000)
}
function clearTimeoutTimer() {
  if (timeoutTimer !== null) {
    clearInterval(timeoutTimer)
    timeoutTimer = null
  }
}

// 每次打开重置内部状态
watch(
  () => props.visible,
  (v) => {
    if (v) {
      inputValue.value = ''
      selectValue.value = props.options && props.options.length > 0 ? props.options[0] : ''
      editorValue.value = ''
      startTimeout()
    } else {
      clearTimeoutTimer()
    }
  },
)

/** IME 守卫：中文输入法候选上屏的 Enter 不提交（isComposing=true 时放行） */
function onInputEnter(e: KeyboardEvent) {
  if (e.isComposing) return
  onSubmit(inputValue)
}

function onSubmit(answer: string) {
  clearTimeoutTimer()
  emit('submit', (answer || '').toString().trim())
}
function onCancel() {
  clearTimeoutTimer()
  emit('cancel', '')
}
</script>

<style scoped>
.ask-user-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}
.ask-user-card {
  width: 420px;
  max-width: 92vw;
  /* P0-5b：原 var(--surface, var(--bg-surface)) 的 --surface 全项目未定义、
     fallback 指向全局浅色 → 暗色下弹窗恒定白底；改继承 .agent-layout(.dark) 的 --bg */
  background: var(--bg);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
  padding: 18px 20px 20px;
  color: var(--text, var(--corp-text-primary));
}
.ask-user-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--accent, var(--color-primary-600));
}
.ask-user-question {
  margin: 12px 0 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.ask-user-timeout {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
  margin: -6px 0 10px;
}
.ask-user-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
.ask-btn {
  border: none;
  border-radius: 8px;
  padding: 7px 18px;
  font-size: 14px;
  cursor: pointer;
}
.ask-btn.confirm {
  background: var(--accent, var(--color-primary-600));
  color: var(--corp-text-inverse);
}
.ask-btn.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ask-btn.cancel {
  background: var(--bg-hover, var(--bg-surface-active));
  color: var(--text, var(--corp-text-primary));
}
.ask-user-input,
.ask-user-editor {
  width: 100%;
  border: 1px solid var(--border, var(--corp-border-light));
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  background: var(--bg, var(--bg-surface));
  color: var(--text, var(--corp-text-primary));
  resize: vertical;
  box-sizing: border-box;
}
.ask-user-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ask-opt {
  text-align: left;
  border: 1px solid var(--border, var(--corp-border-light));
  background: var(--bg, var(--bg-surface));
  color: var(--text, var(--corp-text-primary));
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
  cursor: pointer;
}
.ask-opt.active {
  border-color: var(--accent, var(--color-primary-600));
  background: var(--user-bg, var(--color-primary-50));
  color: var(--accent, var(--color-primary-600));
}
</style>
