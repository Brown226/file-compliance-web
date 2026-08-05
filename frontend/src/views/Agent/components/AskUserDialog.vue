<template>
  <div v-if="visible" class="ask-user-mask">
    <div class="ask-user-card">
      <div class="ask-user-header">
        <el-icon :size="16"><ChatDotRound /></el-icon>
        <span>Agent 提问</span>
      </div>
      <p class="ask-user-question">{{ question }}</p>

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
          @keyup.enter="onSubmit(inputValue)"
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
import { ChatDotRound } from '@element-plus/icons-vue'

const props = defineProps<{
  visible: boolean
  question: string
  method: 'confirm' | 'input' | 'select' | 'editor'
  options?: string[]
}>()

const emit = defineEmits<{
  (e: 'submit', answer: string): void
  (e: 'cancel'): void
}>()

const inputValue = ref('')
const selectValue = ref('')
const editorValue = ref('')

// 每次打开重置内部状态
watch(
  () => props.visible,
  (v) => {
    if (v) {
      inputValue.value = ''
      selectValue.value = props.options && props.options.length > 0 ? props.options[0] : ''
      editorValue.value = ''
    }
  },
)

function onSubmit(answer: string) {
  emit('submit', (answer || '').toString().trim())
}
function onCancel() {
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
  background: var(--surface, #fff);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
  padding: 18px 20px 20px;
  color: var(--text, #1f2329);
}
.ask-user-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--primary, #2f6fed);
}
.ask-user-question {
  margin: 12px 0 14px;
  line-height: 1.5;
  white-space: pre-wrap;
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
  background: var(--primary, #2f6fed);
  color: #fff;
}
.ask-btn.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ask-btn.cancel {
  background: var(--bg-hover, #f0f0f0);
  color: var(--text, #1f2329);
}
.ask-user-input,
.ask-user-editor {
  width: 100%;
  border: 1px solid var(--border, #dcdfe6);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  background: var(--bg, #fff);
  color: var(--text, #1f2329);
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
  border: 1px solid var(--border, #dcdfe6);
  background: var(--bg, #fff);
  color: var(--text, #1f2329);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
  cursor: pointer;
}
.ask-opt.active {
  border-color: var(--primary, #2f6fed);
  background: var(--primary-light, #eaf1fe);
  color: var(--primary, #2f6fed);
}
</style>
