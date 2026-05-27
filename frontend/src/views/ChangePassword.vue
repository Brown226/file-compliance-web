<template>
  <div class="change-password-container">
    <div class="change-password-card">
      <div class="header">
        <h2>修改密码</h2>
        <p v-if="isForce" class="force-tip">首次登录或使用初始密码，请立即修改密码</p>
        <p v-else class="normal-tip">定期更换密码可以提高账户安全性</p>
      </div>

      <el-alert
        v-if="errorMsg"
        :title="errorMsg"
        type="error"
        show-icon
        closable
        @close="errorMsg = ''"
        class="alert"
      />

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        class="form"
        @keyup.enter="handleSubmit"
      >
        <el-form-item label="当前密码" prop="oldPassword">
          <el-input
            v-model="form.oldPassword"
            type="password"
            show-password
            placeholder="请输入当前密码"
          />
        </el-form-item>

        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            show-password
            placeholder="请输入新密码"
          />
        </el-form-item>

        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            placeholder="请再次输入新密码"
          />
        </el-form-item>

        <div class="password-rule">
          <p>密码要求：至少8位，包含大写字母、小写字母、数字、特殊符号</p>
        </div>

        <el-form-item>
          <el-button type="primary" :loading="loading" class="submit-btn" @click="handleSubmit">
            修改密码
          </el-button>
          <el-button v-if="!isForce" @click="handleCancel">取消</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { changePasswordApi } from '@/api/auth'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const isForce = computed(() => route.query.force === 'true')
const formRef = ref<FormInstance>()
const loading = ref(false)
const errorMsg = ref('')

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const validatePasswordComplexity = (_rule: any, value: string, callback: Function) => {
  if (!value) return callback(new Error('请输入新密码'))
  if (value.length < 8) return callback(new Error('密码长度不能小于8位'))
  if (!/[A-Z]/.test(value)) return callback(new Error('密码需要包含大写英文字母'))
  if (!/[a-z]/.test(value)) return callback(new Error('密码需要包含小写英文字母'))
  if (!/[0-9]/.test(value)) return callback(new Error('密码需要包含数字'))
  if (!/[!@#$%^&*()_+\-=\[\]{}|;':",.\/<>?~`\\]/.test(value)) return callback(new Error('密码需要包含特殊符号'))
  callback()
}

const validateConfirm = (_rule: any, value: string, callback: Function) => {
  if (value !== form.newPassword) return callback(new Error('两次输入的密码不一致'))
  callback()
}

const rules = reactive<FormRules>({
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { validator: validatePasswordComplexity, trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' },
  ],
})

const handleSubmit = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return

    loading.value = true
    errorMsg.value = ''
    try {
      await changePasswordApi({
        oldPassword: form.oldPassword,
        newPassword: form.newPassword,
      })

      ElMessage.success('密码修改成功')
      // 更新本地状态
      if (userStore.userInfo) {
        userStore.setUserInfo({ ...userStore.userInfo, mustChangePassword: false })
      }
      router.push('/workspace')
    } catch (err: any) {
      errorMsg.value = err?.response?.data?.message || err?.message || '修改密码失败'
    } finally {
      loading.value = false
    }
  })
}

const handleCancel = () => {
  router.push('/workspace')
}
</script>

<style scoped>
.change-password-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
}

.change-password-card {
  width: 480px;
  padding: 40px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
}

.header {
  text-align: center;
  margin-bottom: 32px;
}

.header h2 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #1a1a1a;
}

.force-tip {
  color: #e6a23c;
  font-size: 14px;
  margin: 0;
}

.normal-tip {
  color: #909399;
  font-size: 14px;
  margin: 0;
}

.alert {
  margin-bottom: 16px;
}

.form {
  margin-top: 8px;
}

.password-rule {
  margin: -8px 0 16px 100px;
}

.password-rule p {
  font-size: 12px;
  color: #909399;
  margin: 0;
}

.submit-btn {
  width: 100%;
  margin-top: 8px;
}
</style>
