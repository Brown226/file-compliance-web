<template>
  <div class="page-intro">
    <div class="page-intro__main">
      <span class="page-intro__bar" aria-hidden="true"></span>
      <div class="page-intro__text">
        <h2 class="page-intro__title">{{ title }}</h2>
        <p v-if="description" class="page-intro__desc">{{ description }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-intro__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 后台页面统一页头骨架。
 * 用法：标题 + 一句说明 + 右侧可选操作位，全后台页共用同一形态。
 */
defineProps<{
  title: string
  description?: string
}>()
</script>

<style scoped>
.page-intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}

.page-intro__main {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

/* 品牌蓝渐变竖条：后台页头统一签名 */
.page-intro__bar {
  flex-shrink: 0;
  width: 4px;
  height: 26px;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--color-primary-400) 0%, var(--color-primary-600) 100%);
  box-shadow: 0 1px 4px rgba(37, 99, 235, 0.25);
}

.page-intro__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.page-intro__title {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 700;
  line-height: 1.3;
  color: var(--corp-text-primary);
  letter-spacing: 0.2px;
}

.page-intro__desc {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.5;
  color: var(--corp-text-secondary);
}

.page-intro__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
