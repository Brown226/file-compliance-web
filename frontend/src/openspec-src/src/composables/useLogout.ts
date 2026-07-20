/**
 * 退出登录相关的 Composable
 */
import { ref, type Ref } from 'vue';
import { authStorage } from '@openspec/utils/auth';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';

export interface UseLogoutReturn {
  loading: Ref<boolean>;
  logout: () => Promise<void>;
  error: Ref<string | null>;
}

/**
 * 退出登录 Composable
 * JWT 无状态，退出只需清除本地 token
 */
export function useLogout(): UseLogoutReturn {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const router = useRouter();

  const logout = async (): Promise<void> => {
    loading.value = true;
    try {
      authStorage.clearAll();
      ElMessage.success('已退出登录');
      router.push('/home');
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    logout,
    error,
  };
}
