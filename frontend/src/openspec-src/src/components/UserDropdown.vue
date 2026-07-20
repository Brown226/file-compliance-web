<script setup lang="ts">
import { computed } from 'vue'
import { SwitchButton } from '@element-plus/icons-vue'
import { useLogout } from '../composables/useLogout'
import { authStorage } from '../utils/auth'

defineProps<{
  showName?: boolean
}>()

const { logout } = useLogout()

const userInfo = computed(() => authStorage.getUserInfo())

const avatarText = computed(() =>
  userInfo.value?.nickname?.charAt(0) || userInfo.value?.name?.charAt(0) || '设'
)

const displayName = computed(() =>
  userInfo.value?.nickname || userInfo.value?.name || '用户'
)

const userEmail = computed(() => userInfo.value?.email || '')

const emit = defineEmits<{
  command: [command: string]
}>()

const onCommand = async (command: string) => {
  if (command === 'logout') {
    await logout()
  }
  emit('command', command)
}
</script>

<template>
  <el-dropdown trigger="click" @command="onCommand" placement="bottom-end" :teleported="true">
    <div class="user-dropdown-trigger" :class="{ 'with-name': showName }">
      <div class="user-dropdown-avatar">
        {{ avatarText }}
      </div>
      <span v-if="showName" class="user-dropdown-username">{{ displayName }}</span>
    </div>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item disabled>
          <div class="user-dropdown-info">
            <div class="user-dropdown-name">{{ displayName }}</div>
            <div class="user-dropdown-email">{{ userEmail }}</div>
          </div>
        </el-dropdown-item>
        <slot />
        <el-dropdown-item divided command="logout" :icon="SwitchButton">
          退出登录
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
.user-dropdown-trigger {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.user-dropdown-trigger.with-name {
  gap: 8px;
  padding: 4px 12px 4px 4px;
  border-radius: 24px;
  transition: background 0.15s ease;
}

.user-dropdown-trigger.with-name:hover {
  background: var(--gray-50);
}

.user-dropdown-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
  border: 2px solid rgba(255, 255, 255, 0.9);
  flex-shrink: 0;
}

.user-dropdown-avatar:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
}

.user-dropdown-username {
  font-size: 14px;
  font-weight: 500;
  color: var(--gray-700);
}

.user-dropdown-info {
  padding: 4px 0;
  min-width: 150px;
}

.user-dropdown-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.user-dropdown-email {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
