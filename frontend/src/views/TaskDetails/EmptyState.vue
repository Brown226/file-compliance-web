<template>
  <div :class="['empty-state', `empty-state--${variant}`]">
    <div v-if="variant !== 'default'" class="empty-state__icon-wrapper">
      <el-icon :size="iconSize" :color="iconColor">
        <component :is="icon" />
      </el-icon>
    </div>
    <el-icon v-else :size="iconSize" :color="iconColor">
      <component :is="icon" />
    </el-icon>

    <h3 class="empty-state__title">{{ title }}</h3>
    <p v-if="description" class="empty-state__desc">{{ description }}</p>

    <div v-if="$slots.extra" class="empty-state__extra">
      <slot name="extra" />
    </div>

    <div v-if="$slots.actions" class="empty-state__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(defineProps<{
  icon: Component
  title: string
  description?: string
  variant?: 'default' | 'success' | 'warning'
  iconColor?: string
  iconSize?: number
}>(), {
  variant: 'default',
  iconColor: '#C0C4CC',
  iconSize: 64,
})
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-state__icon-wrapper {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.empty-state--success .empty-state__icon-wrapper {
  background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%);
}

.empty-state--warning .empty-state__icon-wrapper {
  background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%);
}

.empty-state__title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  color: #065F46;
}

.empty-state--default .empty-state__title {
  color: #606266;
}

.empty-state--warning .empty-state__title {
  color: #92400E;
}

.empty-state__desc {
  margin: 0 0 24px;
  font-size: 14px;
  color: #6B7280;
}

.empty-state__extra {
  margin-bottom: 24px;
  max-width: 440px;
}

.empty-state__actions {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
</style>
