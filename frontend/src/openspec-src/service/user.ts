/**
 * 用户相关 API 服务
 * 调用自建 Java 后端 /api/v1/user/* 接口
 */
import { getAuthorization, authStorage, redirectToLogin } from '@openspec/utils/auth';

const API_PREFIX = import.meta.env.AI_APP || '';
const API_BASE_URL = `${API_PREFIX}/api/v1`;

function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  const authorization = getAuthorization();
  if (authorization) {
    headers['Authorization'] = authorization;
  }
  return headers;
}

/**
 * API 响应格式
 */
export interface ApiResponse<T = any> {
  code: number;
  message?: string;
  data?: T;
}

/**
 * 登录请求参数
 */
export interface LoginParams {
  email: string;
  password: string;
}

/**
 * 注册请求参数
 */
export interface RegisterParams {
  email: string;
  password: string;
  nickname?: string;
}

/**
 * 用户信息
 */
export interface UserData {
  id: string;
  email: string;
  nickname: string;
  avatar?: string;
  access_token: string;
}

/**
 * 登录接口
 */
export async function login(params: LoginParams): Promise<ApiResponse<UserData>> {
  const response = await fetch(`${API_BASE_URL}/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

/**
 * 注册接口
 */
export async function register(params: RegisterParams): Promise<ApiResponse<UserData>> {
  const response = await fetch(`${API_BASE_URL}/user/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

/**
 * 获取用户信息
 */
export async function getUserInfo(): Promise<ApiResponse<UserData>> {
  const response = await fetch(`${API_BASE_URL}/user/info`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  if (response.status === 401) {
    authStorage.clearAll();
    redirectToLogin();
    throw new Error('未授权，请重新登录');
  }
  return response.json();
}

/**
 * 更新个人资料（昵称）
 */
export async function updateProfile(nickname: string): Promise<ApiResponse<UserData>> {
  const response = await fetch(`${API_BASE_URL}/user/profile`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ nickname }),
  });
  if (response.status === 401) {
    authStorage.clearAll();
    redirectToLogin();
    throw new Error('未授权，请重新登录');
  }
  return response.json();
}

/**
 * 修改密码
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<ApiResponse<void>> {
  const response = await fetch(`${API_BASE_URL}/user/password`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  if (response.status === 401) {
    authStorage.clearAll();
    redirectToLogin();
    throw new Error('未授权，请重新登录');
  }
  return response.json();
}
