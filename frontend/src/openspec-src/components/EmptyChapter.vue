<script setup lang="ts">
import { ref } from 'vue'

const textTips = ref('请输入内容 或 点击右侧按钮生成本章内容');
const isInputting = ref(false);
let inputTimer: ReturnType<typeof setTimeout> | null = null

// 定义事件
const emit = defineEmits<{
  contentInput: [content: string]
}>()

// 处理内容输入
const handleInput = (event: Event) => {
  const target = event.target as HTMLElement
  const content = target.textContent || target.innerHTML || ''
  
  // 移除占位符文本，只保留用户输入的内容
  const cleanContent = content.replace(textTips.value, '').trim()
  
  if (cleanContent) {
    isInputting.value = true
    
    // 清除之前的定时器
    if (inputTimer) {
      clearTimeout(inputTimer)
    }
    
    // 延迟触发切换事件，避免输入过程中立即切换状态
    inputTimer = setTimeout(() => {
      emit('contentInput', cleanContent)
    }, 500) // 500ms延迟，给用户足够的输入时间
  }
}

// 处理焦点事件，清除占位符文本
const handleFocus = (event: Event) => {
  const target = event.target as HTMLElement
  if (target.textContent === textTips.value) {
    target.textContent = ''
  }
}

// 处理失焦事件，如果没有内容则恢复占位符
const handleBlur = (event: Event) => {
  const target = event.target as HTMLElement
  const content = target.textContent?.trim() || ''
  
  if (!content) {
    target.innerHTML = `<p class="placeholder-text">${textTips.value}</p>`
    isInputting.value = false
    
    // 清除定时器
    if (inputTimer) {
      clearTimeout(inputTimer)
      inputTimer = null
    }
  } else if (isInputting.value) {
    // 如果正在输入且有内容，立即触发切换
    if (inputTimer) {
      clearTimeout(inputTimer)
    }
    emit('contentInput', content)
  }
}

// 处理回车键，立即触发切换
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    const target = event.target as HTMLElement
    const content = target.textContent?.trim() || ''
    
    if (content) {
      if (inputTimer) {
        clearTimeout(inputTimer)
      }
      emit('contentInput', content)
    }
  }
}
</script>

<template>
  <div 
    class="editor-block editor-placeholder" 
    contenteditable="true"
    @input="handleInput"
    @focus="handleFocus"
    @blur="handleBlur"
    @keydown="handleKeydown"
  >
    <p class="placeholder-text">{{ textTips }}</p>
  </div>
</template>

<style scoped>
.editor-placeholder {
  background: var(--gray-50);
  border: 2px dashed var(--gray-300);
  border-radius: var(--radius-md);
  padding: 60px 48px; /* 增加垂直padding，提高高度 */
  min-height: 240px; /* 设置最小高度 */
  text-align: center;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.editor-placeholder:hover {
  border-color: var(--primary-color);
  background: var(--primary-light);
}

.editor-placeholder:focus {
  border-color: var(--primary-color);
  background: white;
  outline: none;
}

.placeholder-text {
  color: var(--gray-500);
  font-size: 15px;
  margin: 0; /* 移除margin，使用flex居中 */
  pointer-events: none; /* 防止占位符文本干扰光标定位 */
}

.generate-btn {
  margin-top: 12px;
}
</style>