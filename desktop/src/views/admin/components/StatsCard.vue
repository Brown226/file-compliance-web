<template>
  <div class="stats-card" :class="variantClass">
    <div class="stats-card__accent"></div>
    <div class="stats-card__icon-wrap">
      <el-icon :size="18"><component :is="icon" /></el-icon>
    </div>
    <div class="stats-card__body">
      <div class="stats-card__value">{{ displayValue }}</div>
      <div class="stats-card__label">{{ label }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'

const props = withDefaults(defineProps<{
  value: number | string
  label: string
  icon: Component
  variant?: 'primary' | 'success' | 'warning' | 'info'
}>(), {
  variant: 'primary',
})

const variantClass = computed(() => `stats-card--${props.variant}`)

const displayValue = computed(() => {
  if (typeof props.value === 'string') return props.value
  if (props.value >= 10000) return (props.value / 10000).toFixed(1) + '万'
  return props.value.toLocaleString('zh-CN')
})
</script>

<style scoped>
.stats-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-5) var(--space-5) var(--space-6);
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-surface);
  position: relative;
  overflow: hidden;
  flex: 1;
  min-width: 0;
  transition: box-shadow var(--corp-transition-base), transform var(--corp-transition-base);
}
.stats-card:hover {
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}

/* 左侧色条 — 3px accent stripe with glow */
.stats-card__accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
}
.stats-card--primary .stats-card__accent {
  background: linear-gradient(180deg, var(--color-primary-400) 0%, var(--color-primary-600) 100%);
  box-shadow: 2px 0 8px rgba(59, 130, 246, 0.15);
}
.stats-card--success .stats-card__accent {
  background: linear-gradient(180deg, #34D399 0%, var(--color-success) 100%);
  box-shadow: 2px 0 8px rgba(16, 185, 129, 0.15);
}
.stats-card--warning .stats-card__accent {
  background: linear-gradient(180deg, #FBBF24 0%, var(--color-warning) 100%);
  box-shadow: 2px 0 8px rgba(245, 158, 11, 0.15);
}
.stats-card--info .stats-card__accent {
  background: linear-gradient(180deg, var(--color-primary-300) 0%, var(--color-primary-500) 100%);
  box-shadow: 2px 0 8px rgba(59, 130, 246, 0.12);
}

/* 图标容器 */
.stats-card__icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform var(--corp-transition-fast), box-shadow var(--corp-transition-fast);
}
.stats-card:hover .stats-card__icon-wrap {
  transform: scale(1.08);
}
.stats-card--primary .stats-card__icon-wrap {
  background: linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-primary-100) 100%);
  color: var(--color-primary-600);
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.1);
}
.stats-card--success .stats-card__icon-wrap {
  background: linear-gradient(135deg, #ECFDF5 0%, var(--color-success-bg) 100%);
  color: var(--color-success);
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.1);
}
.stats-card--warning .stats-card__icon-wrap {
  background: linear-gradient(135deg, #FFFBEB 0%, var(--color-warning-bg) 100%);
  color: var(--color-warning);
  box-shadow: 0 2px 6px rgba(245, 158, 11, 0.1);
}
.stats-card--info .stats-card__icon-wrap {
  background: linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-info-bg) 100%);
  color: var(--color-info);
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.08);
}

/* 内容 */
.stats-card__body {
  min-width: 0;
}
.stats-card__value {
  font-size: 22px;
  font-weight: 800;
  color: var(--corp-text-primary);
  line-height: 1.1;
  letter-spacing: -0.5px;
  font-variant-numeric: tabular-nums;
}
.stats-card__label {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  margin-top: 4px;
  font-weight: 500;
  letter-spacing: 0.2px;
}
</style>
