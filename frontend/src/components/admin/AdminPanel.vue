<template>
  <section class="admin-panel">
    <header v-if="title || $slots.actions" class="admin-panel__header">
      <h3 v-if="title" class="admin-panel__title">{{ title }}</h3>
      <div v-if="$slots.actions" class="admin-panel__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="admin-panel__body" :class="{ padded }">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 后台页面统一内容卡片容器。
 * 骨架：白卡 + 统一圆角/inset 边框 + 可选卡头（标题 + 右侧操作位）。
 * padded=false 时内容区去掉内边距（适合自铺满的表格等）。
 */
withDefaults(defineProps<{
  title?: string
  padded?: boolean
}>(), {
  padded: true,
})
</script>

<style scoped>
.admin-panel {
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  border: 1px solid rgba(229, 231, 235, 0.5);
  overflow: hidden;
  transition: box-shadow var(--corp-transition-base), transform var(--corp-transition-base);
}

.admin-panel:hover {
  box-shadow: var(--border-inset), 0 10px 28px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

.admin-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--corp-border-light);
}

.admin-panel__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 1.4;
  color: var(--corp-text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.admin-panel__title::before {
  content: '';
  flex-shrink: 0;
  width: 3px;
  height: 15px;
  border-radius: 2px;
  background: var(--color-primary-600);
}

.admin-panel__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.admin-panel__body {
  padding: var(--space-6);
}

/* 自铺满的内容（表格等）去掉内边距 */
.admin-panel__body:not(.padded) {
  padding: 0;
}
</style>
