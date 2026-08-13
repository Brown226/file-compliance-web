<template>
  <span class="diff-highlight-container">
    <template v-for="(part, idx) in diffParts" :key="idx">
      <span v-if="part.type === 'same'" class="diff-same">{{ part.text }}</span>
      <span v-else-if="part.type === 'removed'" class="diff-removed">{{ part.text }}</span>
      <span v-else-if="part.type === 'added'" class="diff-added">{{ part.text }}</span>
    </template>
    <!-- 当原文和修改一样时，直接显示 -->
    <template v-if="diffParts.length === 0">
      {{ displayText }}
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface DiffPart {
  text: string
  type: 'same' | 'removed' | 'added'
}

const props = defineProps<{
  original: string
  suggested: string
  mode: 'original' | 'suggested'
}>()

/** 计算要显示的文本 */
const displayText = computed(() => {
  return props.mode === 'original' ? props.original : props.suggested
})

/**
 * 简单的 LCS（最长公共子序列）字符级 diff 算法
 * 找出 original 和 suggested 之间的差异
 */
const diffParts = computed((): DiffPart[] => {
  const o = props.original || ''
  const s = props.suggested || ''

  // 如果两者相同或其中之一为空，则不计算 diff
  if (!o || !s || o === s) return []

  // 只对较短文本做 diff（避免性能问题）
  if (o.length > 500 || s.length > 500) return []

  const lcs = computeLCS(o, s)
  const parts: DiffPart[] = []

  if (props.mode === 'original') {
    // 原文模式：高亮被删除的部分（原文中有但LCS中没有的）
    let oi = 0
    let li = 0
    let buf = ''
    while (oi < o.length) {
      if (li < lcs.length && o[oi] === lcs[li]) {
        // 在LCS中 → 相同部分
        if (buf) {
          parts.push({ text: buf, type: 'removed' })
          buf = ''
        }
        parts.push({ text: o[oi], type: 'same' })
        oi++
        li++
      } else {
        buf += o[oi]
        oi++
      }
    }
    if (buf) parts.push({ text: buf, type: 'removed' })
  } else {
    // 建议模式：高亮新增的部分（建议中有但LCS中没有的）
    let si = 0
    let li = 0
    let buf = ''
    while (si < s.length) {
      if (li < lcs.length && s[si] === lcs[li]) {
        if (buf) {
          parts.push({ text: buf, type: 'added' })
          buf = ''
        }
        parts.push({ text: s[si], type: 'same' })
        si++
        li++
      } else {
        buf += s[si]
        si++
      }
    }
    if (buf) parts.push({ text: buf, type: 'added' })
  }

  // 如果 diff 结果没有变化（LCS覆盖全部），返回空
  const hasDiff = parts.some(p => p.type !== 'same')
  if (!hasDiff) return []

  return parts
})

/** 计算两个字符串的最长公共子序列 */
function computeLCS(a: string, b: string): string {
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return ''

  // 使用一维 DP 优化空间（只需要记录方向）
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 回溯
  let i = m
  let j = n
  const result: string[] = []
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return result.join('')
}
</script>

<style scoped>
.diff-highlight-container {
  line-height: 1.6;
}
.diff-same {
  color: inherit;
}
.diff-removed {
  background-color: color-mix(in srgb, var(--color-danger) 22%, transparent);
  color: var(--color-danger-text);
  text-decoration: line-through;
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 600;
}
.diff-added {
  background-color: color-mix(in srgb, var(--color-success) 20%, transparent);
  color: var(--color-success-text);
  padding: 1px 2px;
  border-radius: 2px;
  font-weight: 700;
}
</style>
