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

/* 单条消息 */
body > .el-message-container .el-message,
body > .el-message {
  margin-bottom: 12px !important;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%) !important;
  border: 1px solid #e2e8f0 !important;
  border-left: 4px solid var(--color-primary-600) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04) !important;
  border-radius: 10px !important;
  padding: 14px 24px !important;
  min-width: 280px !important;
  max-width: 560px !important;
  /* 避免 hover 时 transform 抖动：hover 仅增强阴影 */
}

body > .el-message-container .el-message:hover,
body > .el-message:hover {
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.12), 0 6px 16px rgba(0, 0, 0, 0.06) !important;
}

body > .el-message-container .el-message .el-message__content,
body > .el-message .el-message__content {
  color: #1e293b !important;
  font-weight: 500 !important;
  font-size: 14px !important;
  line-height: 1.5 !important;
  letter-spacing: 0.3px !important;
}

body > .el-message-container .el-message .el-message__icon,
body > .el-message .el-message__icon {
  font-size: 18px !important;
  color: var(--color-primary-600) !important;
}

/* info 类型消息 */
body > .el-message-container .el-message.el-message--info,
body > .el-message.el-message--info {
  border-left-color: #3b82f6 !important;
}

body > .el-message-container .el-message.el-message--info .el-message__icon,
body > .el-message.el-message--info .el-message__icon {
  color: #3b82f6 !important;
}

/* success 类型消息 */
body > .el-message-container .el-message.el-message--success,
body > .el-message.el-message--success {
  border-left-color: #10b981 !important;
}

body > .el-message-container .el-message.el-message--success .el-message__icon,
body > .el-message.el-message--success .el-message__icon {
  color: #10b981 !important;
}

/* warning 类型消息 */
body > .el-message-container .el-message.el-message--warning,
body > .el-message.el-message--warning {
  border-left-color: #f59e0b !important;
}

body > .el-message-container .el-message.el-message--warning .el-message__icon,
body > .el-message.el-message--warning .el-message__icon {
  color: #f59e0b !important;
}

/* error 类型消息 */
body > .el-message-container .el-message.el-message--error,
body > .el-message.el-message--error {
  border-left-color: #ef4444 !important;
}

body > .el-message-container .el-message.el-message--error .el-message__icon,
body > .el-message.el-message--error .el-message__icon {
  color: #ef4444 !important;
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
  background: #fff !important;
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
  color: #303133 !important;
}

/* 底部按钮 */
.el-message-box__btns {
  display: flex !important;
  justify-content: flex-end !important;
  gap: 10px !important;
  padding: 0 !important;
}
</style>
