<template>
  <div class="empty-state">
    <div class="empty-icon">{{ icon }}</div>
    <div class="empty-title">{{ title }}</div>
    <div class="empty-description" v-if="description">{{ description }}</div>
    <el-button v-if="actionText" type="primary" @click="$emit('action')">{{ actionText }}</el-button>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  title: string
  description?: string
  actionText?: string
}>(), {
  icon: '📭',
})
defineEmits<{
  action: []
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  line-height: 1;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--corp-text-primary, #1f2937);
  margin-bottom: 8px;
}

.empty-description {
  font-size: 14px;
  color: var(--corp-text-secondary, #6b7280);
  margin-bottom: 20px;
  max-width: 320px;
  line-height: 1.5;
}
</style>
