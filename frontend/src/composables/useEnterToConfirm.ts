import { watch, onUnmounted } from 'vue'
import type { Ref } from 'vue'

/**
 * 对话框 Enter 键确认 composable
 * @param visible - 对话框显示状态的 ref
 * @param onConfirm - 确认回调函数
 * @param options - 配置选项
 */
export function useEnterToConfirm(
  visible: Ref<boolean>,
  onConfirm: () => void,
  options?: {
    /** 是否禁用（某些场景需要动态禁用） */
    disabled?: Ref<boolean>
    /** 延迟时间（ms），避免对话框打开动画期间触发 */
    delay?: number
  }
) {
  const delay = options?.delay ?? 150

  const handleKeydown = (e: KeyboardEvent) => {
    // 忽略中文输入法组合状态
    if (e.isComposing) return

    // 只处理 Enter 键
    if (e.key !== 'Enter') return

    // 检查是否禁用
    if (options?.disabled?.value) return

    // 检查当前焦点元素
    const activeElement = document.activeElement as HTMLElement
    if (!activeElement) return

    // 跳过 textarea（用户可能想换行）
    if (activeElement.tagName === 'TEXTAREA') return

    // 跳过 contenteditable 元素
    if (activeElement.getAttribute('contenteditable') === 'true') return

    // 跳过 select 下拉框打开状态
    if (activeElement.classList.contains('el-select-dropdown__item')) return
    if (activeElement.closest('.el-select-dropdown')) return

    // 跳过日期选择器面板
    if (activeElement.closest('.el-date-picker')) return
    if (activeElement.closest('.el-picker-panel')) return

    // 跳过 autocomplete 下拉
    if (activeElement.closest('.el-autocomplete-suggestion')) return

    e.preventDefault()
    e.stopPropagation()
    onConfirm()
  }

  let timer: ReturnType<typeof setTimeout> | null = null

  watch(visible, (newVal) => {
    // 清除之前的定时器
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    if (newVal) {
      // 延迟添加监听，避免对话框打开动画期间触发
      timer = setTimeout(() => {
        document.addEventListener('keydown', handleKeydown, true)
      }, delay)
    } else {
      document.removeEventListener('keydown', handleKeydown, true)
    }
  }, { immediate: true })

  onUnmounted(() => {
    if (timer) {
      clearTimeout(timer)
    }
    document.removeEventListener('keydown', handleKeydown, true)
  })
}
