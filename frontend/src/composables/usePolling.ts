import { ref, onUnmounted } from 'vue'
import { useIntervalFn } from '@vueuse/core'

export interface UsePollingOptions {
  interval?: number
  immediate?: boolean
}

/**
 * 轮询 Composable，基于 @vueuse/core 的 useIntervalFn
 */
export function usePolling(
  fn: () => Promise<void>,
  options: UsePollingOptions = {}
) {
  const { interval = 5000, immediate = false } = options
  const loading = ref(false)
  const isActive = ref(false)

  const execute = async () => {
    loading.value = true
    try {
      await fn()
    } finally {
      loading.value = false
    }
  }

  const { pause, resume } = useIntervalFn(execute, interval, { immediate })

  const start = () => {
    isActive.value = true
    resume()
  }

  const stop = () => {
    isActive.value = false
    pause()
  }

  onUnmounted(() => {
    stop()
  })

  return { loading, isActive, start, stop, execute }
}
