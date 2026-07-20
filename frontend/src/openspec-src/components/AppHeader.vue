<script setup lang="ts">
import HeaderLogo from './HeaderLogo.vue'
import UserDropdown from './UserDropdown.vue'

const emit = defineEmits<{
  command: [command: string]
}>()

const onCommand = (command: string) => {
  emit('command', command)
}
</script>

<template>
  <header class="app-header">
    <div class="app-header-content">
      <div class="app-header-left">
        <HeaderLogo />
        <nav v-if="$slots.nav" class="app-header-nav">
          <slot name="nav" />
        </nav>
      </div>
      <div class="app-header-right">
        <slot name="actions" />
        <UserDropdown @command="onCommand">
          <slot name="dropdown-items" />
        </UserDropdown>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  position: sticky;
  top: 0;
  z-index: 1000;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(10px);
}

.app-header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  height: 56px;
}

.app-header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
}

.app-header-nav {
  display: flex;
  gap: var(--spacing-md);
}

.app-header-nav :deep(.nav-item) {
  text-decoration: none;
  color: var(--gray-600);
  font-size: 14px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  transition: all 0.2s ease;
  font-weight: 500;
}

.app-header-nav :deep(.nav-item:hover) {
  color: var(--primary-color);
  background: var(--gray-100);
}

.app-header-nav :deep(.nav-item.active) {
  color: var(--primary-color);
  background: var(--primary-light);
  font-weight: 600;
}

.app-header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
}
</style>
