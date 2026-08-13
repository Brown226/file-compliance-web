<script setup lang="ts">
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
</script>

<template>
  <ElConfigProvider
    :z-index="9999"
    :locale="zhCn"
    :message="{ max: 3, duration: 2000, offset: 60 }"
  >
    <router-view />
  </ElConfigProvider>
</template>

<style>
html, body {
  margin: 0;
  padding: 0;
  overflow-x: hidden;
}

#app {
  width: 100%;
  min-height: 100vh;
  margin: 0;
  padding: 0;
}

/* ============================================================
   ElMessage / ElNotification 定位修复 — 强制顶部居中
   ============================================================ */

/* 消息组件根容器 */
body > .el-message-container,
body > .el-message {
  position: fixed !important;
  top: 60px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  right: auto !important;
  bottom: auto !important;
  z-index: 99999 !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  /* 禁用 transition 防止布局抖动 */
  transition: none !important;
}

/* 通知组件 */
body > .el-notification {
  right: 24px !important;
  top: 80px !important;
}

/* ============================================================
   ElMessageBox 居中修复
   ============================================================ */

/* 遮罩层居中 */
.el-overlay.is-message-box {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

/* Dialog 居中 */
.el-overlay-dialog {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

/* 弹窗基础样式 */
.el-message-box {
  background: var(--bg-surface) !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
  padding: 20px !important;
  min-width: 320px !important;
}

/* 隐藏标题栏 */
.el-message-box__header {
  display: none !important;
}

/* 弹窗内容布局 */
.el-message-box__content {
  display: flex !important;
  align-items: flex-start !important;
  gap: 12px !important;
  padding: 0 !important;
  margin-bottom: 20px !important;
}

/* 图标样式 */
.el-message-box__status {
  font-size: 22px !important;
  flex-shrink: 0 !important;
  margin-top: 2px !important;
}

/* 消息文字 */
.el-message-box__message {
  flex: 1 !important;
}
.el-message-box__message p {
  margin: 0 !important;
  line-height: 1.6 !important;
  color: var(--color-gray-700) !important;
}

/* 底部按钮 */
.el-message-box__btns {
  display: flex !important;
  justify-content: flex-end !important;
  gap: 10px !important;
  padding: 0 !important;
}
</style>
