export interface ImportToCadRequest {
  markdown: string
  template?: {
    blockName?: string
    dwgUrl?: string
  }
  options?: {
    clearExisting?: boolean
  }
}

export interface ImportToCadResponse {
  success: boolean
  message?: string
}

const LOCAL_CAD_API_URL = 'http://localhost:19090/api/import'

export async function importToAutoCAD(
  payload: ImportToCadRequest
): Promise<ImportToCadResponse> {
  try {
    const response = await fetch(LOCAL_CAD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // 尝试解析 JSON 响应，如果失败则认为请求成功发送
    try {
      const data = await response.json()
      return { success: true, message: data.message || '导入命令已发送至 AutoCAD' }
    } catch (e) {
      return { success: true, message: '导入命令已发送至 AutoCAD' }
    }

  } catch (error) {
    console.error('Failed to import to AutoCAD:', error)
    return {
      success: false,
      message: '请先确保在本地打开 AutoCAD 2025以上版本，并安装 AIAD 协作插件，再重试。',
    }
  }
}
