<template>
  <div v-html="html" />
</template>

<script setup lang="ts">
/**
 * 流式消息 Markdown 渲染（性能优化组件）
 *
 * 背景：直接在模板里 v-html="renderMarkdown(全文)" 时，每个 text-delta 都会触发
 * 整段已积累文本的完整 markdown 重解析，长回答的总解析量是 O(n²)，越到尾部越卡。
 * 本组件对流式期间的渲染做节流（默认 150ms 一次 + 尾随补渲染保证最终态不丢）；
 * 非流式场景（历史回看 / 已结束消息）保持即时渲染，行为与原来一致。
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { useMarkdown } from '@/composables/useMarkdown'

const props = withDefaults(defineProps<{ text: string; streaming?: boolean }>(), {
  streaming: false,
})

const { renderMarkdown } = useMarkdown()
const html = ref(renderMarkdown(props.text))

let timer: number | null = null
// 以挂载时刻为节流窗口起点：首帧后 150ms 内到达的首个 delta 也走合并路径
let lastRenderAt = Date.now()
const THROTTLE_MS = 150

function renderNow() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  html.value = renderMarkdown(props.text)
  lastRenderAt = Date.now()
}

watch(() => props.text, () => {
  if (!props.streaming) {
    renderNow()
    return
  }
  const now = Date.now()
  if (now - lastRenderAt >= THROTTLE_MS) {
    renderNow()
    return
  }
  // 窗口期内只挂一个尾随定时器，最终态由它补渲染（流结束/文本停更时兜底）
  if (timer === null) {
    timer = window.setTimeout(() => {
      timer = null
      html.value = renderMarkdown(props.text)
      lastRenderAt = Date.now()
    }, THROTTLE_MS)
  }
})

onBeforeUnmount(() => {
  if (timer !== null) window.clearTimeout(timer)
})
</script>
