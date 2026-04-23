<template>
  <span>
    <template v-for="(part, idx) in renderedParts" :key="idx">
      <span v-if="part.highlighted" :class="part.className">{{ part.text }}</span>
      <template v-else>{{ part.text }}</template>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface DiffRange {
  start: number
  length: number
}

interface RenderPart {
  text: string
  highlighted: boolean
  className: string
}

const props = defineProps<{
  text: string
  ranges: DiffRange[]
  mode: 'red' | 'green'
}>()

const renderedParts = computed(() => {
  if (!props.ranges || props.ranges.length === 0) {
    return [{ text: props.text, highlighted: false, className: '' }]
  }
  const parts: RenderPart[] = []
  let lastEnd = 0
  const className = props.mode === 'red' ? 'diff-red' : 'diff-green'
  for (const range of props.ranges) {
    if (range.start > lastEnd) {
      parts.push({ text: props.text.substring(lastEnd, range.start), highlighted: false, className: '' })
    }
    parts.push({
      text: props.text.substring(range.start, range.start + range.length),
      highlighted: true,
      className,
    })
    lastEnd = range.start + range.length
  }
  if (lastEnd < props.text.length) {
    parts.push({ text: props.text.substring(lastEnd), highlighted: false, className: '' })
  }
  return parts
})
</script>

<style scoped>
.diff-red {
  background-color: rgba(229, 62, 62, 0.18);
  color: var(--corp-danger);
  padding: 1px 3px;
  border-radius: 3px;
  font-weight: 600;
}
.diff-green {
  background-color: rgba(56, 161, 105, 0.15);
  color: var(--corp-success);
  padding: 1px 3px;
  border-radius: 3px;
  font-weight: 600;
}
</style>
