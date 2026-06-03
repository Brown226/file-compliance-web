import { shallowRef, onUnmounted, type Ref } from 'vue'
import { useResizeObserver, useDebounceFn } from '@vueuse/core'
import type { EChartsType } from 'echarts/core'

export interface UseEChartsOptions {
  /** 初始化时是否自动 resize */
  autoResize?: boolean
  /** resize 防抖延迟（ms） */
  resizeDebounce?: number
}

/**
 * ECharts 实例管理 Composable，基于 @vueuse/core 的 useResizeObserver 和 useDebounceFn
 */
export function useECharts(
  elRef: Ref<HTMLElement | null>,
  options: UseEChartsOptions = {}
) {
  const { autoResize = true, resizeDebounce = 200 } = options
  const chartInstance = shallowRef<EChartsType | null>(null)

  const initChart = (echarts: typeof import('echarts/core')) => {
    if (elRef.value && !chartInstance.value) {
      chartInstance.value = echarts.init(elRef.value)
    }
  }

  const resize = useDebounceFn(() => {
    chartInstance.value?.resize()
  }, resizeDebounce)

  const dispose = () => {
    if (chartInstance.value) {
      chartInstance.value.dispose()
      chartInstance.value = null
    }
  }

  if (autoResize) {
    useResizeObserver(elRef, () => {
      resize()
    })
  }

  onUnmounted(() => {
    dispose()
  })

  return { chartInstance, initChart, resize, dispose }
}
