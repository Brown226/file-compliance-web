<template>
  <el-dialog v-model="visible" title="修改密码" width="420px" destroy-on-close>
    <el-form
      ref="passwordFormRef"
      :model="passwordForm"
      :rules="passwordRules"
      label-width="100px"
    >
      <el-form-item label="原密码" prop="oldPassword">
        <el-input v-model="passwordForm.oldPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input v-model="passwordForm.newPassword" type="password" show-password placeholder="须包含大小写字母、数字、特殊符号，至少8位" />
      </el-form-item>
      <el-form-item label="确认新密码" prop="confirmPassword">
        <el-input v-model="passwordForm.confirmPassword" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="passwordLoading" @click="submitPasswordChange">
          确认修改
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { changePasswordApi } from '@/api/auth'
import { useUserStore } from '@/stores/user'
import { useRouter } from 'vue-router'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit('update:modelValue', val),
})

const router = useRouter()
const userStore = useUserStore()

const passwordLoading = ref(false)
const passwordFormRef = ref<FormInstance>()

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const validateConfirmPassword = (_rule: any, value: string, callback: any) => {
  if (value === '') {
    callback(new Error('请再次输入新密码'))
  } else if (value !== passwordForm.newPassword) {
    callback(new Error('两次输入密码不一致'))
  } else {
    callback()
  }
}

const validatePasswordComplexity = (_rule: any, value: string, callback: any) => {
  if (value === '') {
    callback(new Error('请输入新密码'))
    return
  }
  if (value.length < 8) {
    callback(new Error('密码长度不能小于8位'))
    return
  }
  const checks = [
    { regex: /[A-Z]/, msg: '大写字母' },
    { regex: /[a-z]/, msg: '小写字母' },
    { regex: /[0-9]/, msg: '数字' },
    { regex: /[!@#$%^&*()_+\-=\[\]{}|;':",./<>?~`\\]/, msg: '特殊符号' },
  ]
  const missing = checks.filter(c => !c.regex.test(value)).map(c => c.msg)
  if (missing.length > 0) {
    callback(new Error(`密码缺少：${missing.join('、')}`))
    return
  }
  callback()
}

const passwordRules = reactive<FormRules>({
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, validator: validatePasswordComplexity, trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, validator: validateConfirmPassword, trigger: 'blur' }
  ]
})

const submitPasswordChange = async () => {
  if (!passwordFormRef.value) return
  await passwordFormRef.value.validate(async (valid) => {
    if (valid) {
      passwordLoading.value = true
      try {
        await changePasswordApi({
          oldPassword: passwordForm.oldPassword,
          newPassword: passwordForm.newPassword,
        })
        ElMessage.success('密码修改成功，请重新登录')
        visible.value = false
        userStore.logout()
        router.push('/login')
      } catch (error: any) {
        ElMessage.error(error?.response?.data?.message || '密码修改失败')
      } finally {
        passwordLoading.value = false
      }
    }
  })
}
</script>
