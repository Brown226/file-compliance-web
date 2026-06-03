import { ref, onUnmounted } from 'vue'

/**
 * Blob 文件下载 Composable
 * - 支持 AbortController：组件卸载时自动取消进行中的下载
 * - 避免并行下载冲突：每次调用 downloadBlob 会先 abort 之前的请求
 */
export function useBlobDownload() {
  const downloading = ref(false)
  let controller: AbortController | null = null

  const abort = () => {
    if (controller) {
      controller.abort()
      controller = null
    }
  }

  const downloadBlob = async (
    url: string,
    filename: string,
    options?: RequestInit
  ) => {
    // 先取消之前的下载请求，避免并行下载冲突
    abort()
    controller = new AbortController()
    downloading.value = true
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`下载失败: ${response.statusText}`)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      throw e
    } finally {
      downloading.value = false
      controller = null
    }
  }

  onUnmounted(() => {
    abort()
  })

  return { downloading, downloadBlob, abort }
}
