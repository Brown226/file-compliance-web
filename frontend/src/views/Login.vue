<template>
  <div class="login-container">
    <!-- 左侧品牌展示区 -->
    <div class="login-brand-panel">
      <div class="brand-overlay"></div>
      <div class="brand-content">
        <!-- 顶部：公司名称图片 -->
        <div class="brand-top">
          <img src="/logo-name.jpg" alt="中国核电工程有限公司河北分公司" class="brand-top-logo-img" />
        </div>

        <!-- 中间：系统名称 + 副标题 -->
        <div class="brand-center">
          <h1 class="brand-title">核审通</h1>
          <p class="brand-subtitle">智能识别 · 精准审查 · 高效管理</p>
        </div>
      </div>
    </div>

    <!-- 右侧表单区域 -->
    <div class="login-form-panel">
      <div class="login-form-wrapper">
        <!-- 产品 Logo 和标题 -->
        <div class="login-header">
          <div class="logo-icon-wrap">
            <img src="/logo.jpg" alt="Logo" class="logo-img" />
          </div>
          <h2 class="brand-name">核审通</h2>
          <h2>欢迎登录</h2>
          <p class="login-subtitle">请输入您的账号信息</p>
        </div>

        <!-- 全局错误提示 -->
        <el-alert
          v-if="loginError"
          :title="loginError"
          type="error"
          :closable="true"
          @close="loginError = ''"
          class="login-error-alert"
          show-icon
        />

        <!-- 登录表单 -->
        <el-form
          ref="loginFormRef"
          :model="loginForm"
          :rules="loginRules"
          class="login-form"
          @keyup.enter="handleLogin"
        >
          <el-form-item prop="username">
            <el-input
              v-model="loginForm.username"
              placeholder="请输入账号"
              prefix-icon="User"
              size="large"
              autocomplete="username"
            />
          </el-form-item>
          <el-form-item prop="password">
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="请输入密码"
              prefix-icon="Lock"
              size="large"
              show-password
              autocomplete="current-password"
            />
          </el-form-item>

          <!-- 记住我和忘记密码 -->
          <div class="login-options">
            <el-checkbox v-model="loginForm.rememberMe" size="small">
              记住我
            </el-checkbox>
            <a href="javascript:void(0)" class="forgot-link" @click="handleForgotPassword">
              忘记密码？
            </a>
          </div>

          <!-- 登录按钮 -->
          <el-form-item>
            <el-button
              type="primary"
              :loading="loading"
              class="login-btn"
              size="large"
              @click="handleLogin"
            >
              <span v-if="!loading">登 录 系 统</span>
              <span v-else>正在验证...</span>
            </el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 右下角版权标识 -->
      <div class="login-copyright">
        <p>河北设管部数字化管理科出品</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { loginApi } from '@/api/auth'

const router = useRouter()
const userStore = useUserStore()

const loginFormRef = ref<FormInstance>()
const loading = ref(false)
const loginError = ref('')

const loginForm = reactive({
  username: '',
  password: '',
  rememberMe: false
})

const loginRules = reactive<FormRules>({
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
})

const handleLogin = async () => {
  if (!loginFormRef.value) return

  await loginFormRef.value.validate(async (valid) => {
    if (valid) {
      loading.value = true
      loginError.value = ''
      try {
        const loginRes = await loginApi({
          username: loginForm.username,
          password: loginForm.password,
        })
        const { token, user } = loginRes.data
        userStore.setToken(token)
        userStore.setUserInfo({
          id: user.id,
          username: user.username,
          name: user.name || user.username,
          role: user.role,
          departmentId: user.departmentId,
          departmentName: user.departmentName,
        })

        ElMessage.success('登录成功')
        router.push('/')
      } catch (error: any) {
        const errorMsg = error?.response?.data?.message || error?.message || '登录失败，请检查账号和密码'
        loginError.value = errorMsg
      } finally {
        loading.value = false
      }
    }
  })
}

const handleForgotPassword = () => {
  ElMessage.info('请联系系统管理员重置密码')
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  background: #f8fafc;
}

/* ===== 左侧品牌面板 ===== */
.login-brand-panel {
  width: 48%;
  position: relative;
  background: url('/背景图.jpg') center center / cover no-repeat;
  display: flex;
  align-items: stretch;
}

.brand-overlay {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(160deg, rgba(15, 23, 42, 0.50) 0%, rgba(30, 58, 95, 0.40) 40%, rgba(37, 99, 235, 0.35) 100%);
}

.brand-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  padding: 40px 48px;
}

/* 顶部：公司名称图片 */
.brand-top {
  display: flex;
  align-items: flex-start;
}

.brand-top-logo-img {
  max-width: 320px;
  max-height: 60px;
  object-fit: contain;
}

/* 中间：系统图标 + 名称 + 副标题 */
.brand-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
}

.brand-title {
  font-size: 32px;
  font-weight: 800;
  margin: 0 0 16px;
  letter-spacing: 4px;
  color: #ffffff;
  text-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

.brand-subtitle {
  font-size: 17px;
  color: rgba(255, 255, 255, 0.92);
  font-weight: 500;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  letter-spacing: 2px;
  margin: 0;
}

/* ===== 右侧表单面板 ===== */
.login-form-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  background: linear-gradient(145deg, #f1f5f9 0%, #e2e8f0 100%);
}

.login-form-wrapper {
  width: 100%;
  max-width: 420px;
  padding: 40px 32px;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15), 0 8px 24px rgba(0, 0, 0, 0.1);
}

/* 右下角版权标识 */
.login-copyright {
  position: absolute;
  bottom: 24px;
  right: 32px;
}

.login-copyright p {
  margin: 0;
  font-size: 16px;
  color: #94a3b8;
  letter-spacing: 1px;
  font-weight: 500;
}

/* ===== 表单头部 ===== */
.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-icon-wrap {
  margin-bottom: 16px;
}

.logo-img {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  filter: drop-shadow(0 4px 8px rgba(37, 99, 235, 0.3));
  object-fit: cover;
}

.login-header .brand-name {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  color: var(--color-primary-600);
  letter-spacing: 1px;
}

.login-header h2 {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.5px;
}

.login-subtitle {
  margin: 0;
  font-size: 15px;
  color: #64748b;
}

/* ===== 全局错误提示 ===== */
.login-error-alert {
  margin-bottom: 16px;
  border-radius: 8px;
}

/* ===== 表单样式 ===== */
.login-form :deep(.el-input__wrapper) {
  background-color: #ffffff;
  border: 2px solid #cbd5e1;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
  transition: all 0.2s ease;
  border-radius: 8px;
  padding: 8px 16px;
}

.login-form :deep(.el-input__wrapper:hover) {
  background-color: #ffffff;
  border-color: #94a3b8;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.login-form :deep(.el-input__wrapper.is-focus) {
  background-color: #ffffff;
  border-color: var(--color-primary-600);
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15), 0 4px 8px rgba(0, 0, 0, 0.1);
}

.login-form :deep(.el-input__inner) {
  height: 42px;
  font-size: 15px;
  color: #0f172a;
  font-weight: 500;
}

.login-form :deep(.el-input__inner::placeholder) {
  color: #94a3b8;
}

.login-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.forgot-link {
  font-size: 14px;
  color: var(--color-primary-600);
  text-decoration: none;
  transition: color 0.2s;
}

.forgot-link:hover {
  color: var(--color-primary-600);
  text-decoration: underline;
}

.login-btn.el-button--primary {
  width: 100%;
  margin-top: 16px;
  height: 48px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.1em;
  border-radius: 8px;
  background: var(--color-primary-600);
  border: none;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
  color: #ffffff;
}

.login-btn.el-button--primary:hover {
  background: var(--color-primary-700);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
  transform: translateY(-1px);
}

.login-btn.el-button--primary:active {
  transform: translateY(0);
}

.login-btn.el-button--primary:disabled {
  background: var(--color-gray-300);
  box-shadow: none;
  cursor: not-allowed;
}

/* ===== 响应式设计 ===== */
@media (max-width: 1024px) {
  .login-brand-panel {
    width: 42%;
  }

  .brand-center-logo {
    max-width: 280px;
  }

  .brand-title {
    font-size: 26px;
  }
}

@media (max-width: 768px) {
  .login-brand-panel {
    display: none;
  }

  .login-form-wrapper {
    max-width: 360px;
    padding: 32px 16px;
  }
}
</style>
