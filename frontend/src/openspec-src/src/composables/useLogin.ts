/**
 * 登录相关的 Composable
 */
import { ref, type Ref } from 'vue';
import { login as loginApi } from '@openspec/service/user';
import type { LoginParams, UserData } from '@openspec/service/user';
import { authStorage } from '@openspec/utils/auth';
import type { UserInfo } from '@openspec/utils/auth';

export interface UseLoginReturn {
  loading: Ref<boolean>;
  login: (params: { email: string; password: string }) => Promise<number>;
  error: Ref<string | null>;
}

/**
 * 登录 Composable
 */
export function useLogin(): UseLoginReturn {
  const loading = ref(false);
  const error = ref<string | null>(null);

  const login = async (params: { email: string; password: string }): Promise<number> => {
    loading.value = true;
    error.value = null;

    try {
      const loginParams: LoginParams = {
        email: params.email.trim(),
        password: params.password,
      };

      const response = await loginApi(loginParams);

      if (response.code === 200 && response.data) {
        const userData = response.data;

        const userInfo: UserInfo = {
          id: userData.id,
          email: userData.email,
          name: userData.nickname,
          nickname: userData.nickname,
          avatar: userData.avatar,
        };

        authStorage.setAuthData({
          Authorization: `Bearer ${userData.access_token}`,
          Token: userData.access_token,
          userInfo: userInfo,
        });

        return 0; // 成功
      } else {
        error.value = response.message || '登录失败';
        return response.code || -1;
      }
    } catch (err: any) {
      error.value = err.message || '登录失败，请检查网络连接';
      return -1;
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    login,
    error,
  };
}
