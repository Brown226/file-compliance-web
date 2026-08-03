<template>
  <div class="markdown-code-block">
    <div class="markdown-code-header">
      <span class="markdown-code-lang">{{ displayLang }}</span>
      <div class="markdown-code-actions">
        <button
          class="markdown-code-action"
          :class="{ 'is-active': copied }"
          :disabled="!code"
          @click="handleCopy"
        >
          {{ copied ? '已复制' : '复制' }}
        </button>
      </div>
    </div>
    <pre><code :class="codeClass" v-html="highlightedCode"></code></pre>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import hljs from 'highlight.js/lib/common'

const props = defineProps<{
  code: string
  language?: string
}>()

const copied = ref(false)
const copyTimer = ref<ReturnType<typeof setTimeout> | null>(null)

const displayLang = computed(() => {
  const lang = props.language?.trim().toLowerCase()
  return lang && lang !== 'plaintext' ? lang : 'text'
})

const codeClass = computed(() => {
  const lang = props.language?.trim().toLowerCase()
  return lang && lang !== 'plaintext' ? `hljs language-${lang}` : 'hljs'
})

const highlightedCode = computed(() => {
  if (!props.code) return ''
  const lang = props.language?.trim().toLowerCase()
  try {
    if (lang && lang !== 'plaintext' && hljs.getLanguage(lang)) {
      return hljs.highlight(props.code, { language: lang }).value
    }
    return hljs.highlightAuto(props.code).value
  } catch {
    // 降级：转义 HTML
    return escapeHtml(props.code)
  }
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function handleCopy() {
  if (!props.code) return
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    if (copyTimer.value) clearTimeout(copyTimer.value)
    copyTimer.value = setTimeout(() => { copied.value = false }, 1400)
  } catch {
    // 降级方案
    const ta = document.createElement('textarea')
    ta.value = props.code
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copied.value = true
    if (copyTimer.value) clearTimeout(copyTimer.value)
    copyTimer.value = setTimeout(() => { copied.value = false }, 1400)
  }
}
</script>
