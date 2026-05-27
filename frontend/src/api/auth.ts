import request from '@/utils/request'
import type { UserInfo } from '@/types/models'

// ==================== 审查平台认证 ====================

// 登录
export function loginApi(data: { username: string; password: string }) {
  return request.post<{ token: string; mustChangePassword: boolean; user: UserInfo }>('/auth/login', data)
}

// 登出
export function logoutApi() {
  return request.post<Record<string, never>>('/auth/logout')
}

// 修改密码
export function changePasswordApi(data: { oldPassword: string; newPassword: string }) {
  return request.post<{ message: string }>('/auth/change-password', {
    oldPassword: data.oldPassword,
    newPassword: data.newPassword,
  })
}

// 修改登录账号
export function changeUsernameApi(data: { newUsername: string; password: string }) {
  return request.post<{ message: string }>('/auth/change-username', data)
}
