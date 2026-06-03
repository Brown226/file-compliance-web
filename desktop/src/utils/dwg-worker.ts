/**
 * DWG Web Worker
 * 在 Worker 线程中运行 WASM 解析，不阻塞主线程
 */

import { LibreDwg } from '@mlightcad/libredwg-web'

interface WorkerMessage {
  id: number
  type: 'dwgToSvg'
  payload: {
    buffer: ArrayBuffer
    fileName: string
  }
}

interface WorkerResponse {
  id: number
  type: 'result' | 'error'
  payload: {
    svg?: string
    handleMap?: Record<string, string>
    /** 按实体顺序排列的 handle 字符串数组，用于主线程 DOM 注入 */
    handles?: string[]
    /** 文本内容 → handle 映射表（用于标准引用自检的行→图元定位） */
    textHandleMap?: Record<string, string>
    message?: string
  }
}

let wasmInitialized = false
let wasm: any = null

async function ensureWasm(): Promise<void> {
  if (wasmInitialized) return
  // wasmDir = '' → locateFile 返回 '/libredwg-web.wasm'，从服务器根路径加载
  wasm = await LibreDwg.create('')
  wasmInitialized = true
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { id, type, payload } = e.data

  try {
    if (type !== 'dwgToSvg') return

    await ensureWasm()

    const { buffer, fileName } = payload
    const uint8 = new Uint8Array(buffer)

    // Step 1: 读取 DWG 文件
    const dataPtr = wasm.dwg_read_data(uint8, 0)
    if (!dataPtr) {
      const resp: WorkerResponse = { id, type: 'error', payload: { message: 'WASM 解析 DWG 失败：dwg_read_data 返回空指针' } }
      self.postMessage(resp)
      return
    }

    // Step 2: 转换为 DwgDatabase
    let db: any = null
    try {
      db = wasm.convert(dataPtr)
    } catch (convertErr: any) {
      wasm.dwg_free(dataPtr)
      const resp: WorkerResponse = {
        id, type: 'error',
        payload: { message: `DWG 转换失败: ${convertErr?.message || convertErr}` },
      }
      self.postMessage(resp)
      return
    }

    if (!db) {
      wasm.dwg_free(dataPtr)
      const resp: WorkerResponse = {
        id, type: 'error',
        payload: {
          message: `DWG 文件解析失败：无法将 DWG 数据转换为结构化对象。（文件: ${fileName}）`,
        },
      }
      self.postMessage(resp)
      return
    }

    // DWG 文件可能部分兼容（error code 2048），convert 返回 db 对象但 entities 为空
    if (!db.entities || !Array.isArray(db.entities) || db.entities.length === 0) {
      wasm.dwg_free(dataPtr)
      const resp: WorkerResponse = {
        id, type: 'error',
        payload: {
          message: `DWG 文件兼容性问题：图纸数据已读取，但未能提取到任何图元实体。（文件: ${fileName}，libredwg 错误码: 2048）`,
        },
      }
      self.postMessage(resp)
      return
    }

    // Step 3: 转换为 SVG
    let svg = ''
    try {
      svg = wasm.dwg_to_svg(db)
    } catch (svgErr: any) {
      wasm.dwg_free(dataPtr)
      const resp: WorkerResponse = {
        id, type: 'error',
        payload: { message: `DWG 转 SVG 失败: ${svgErr?.message || svgErr}` },
      }
      self.postMessage(resp)
      return
    }

    if (!svg || typeof svg !== 'string' || !svg.includes('<svg')) {
      wasm.dwg_free(dataPtr)
      const resp: WorkerResponse = {
        id, type: 'error',
        payload: { message: 'DWG 转 SVG 失败：生成的 SVG 内容无效' },
      }
      self.postMessage(resp)
      return
    }

    // Step 4: 构建 handleMap + handles + textHandleMap
    // handle 注入移到主线程 DwgPreviewPanel.vue，通过 DOM 遍历叶子 <g> 完成
    const handleMap: Record<string, string> = {}
    const handles: string[] = []
    const textHandleMap: Record<string, string> = {}
    const entities = db.entities as any[] | undefined
    if (entities) {
      for (let i = 0; i < entities.length; i++) {
        const h = entities[i].handle
        if (h) {
          handleMap[h] = `dwg-entity-${i}`
          handles.push(h)
          // 文本实体 → handle 映射（TEXT/MTEXT 实体的 text 内容）
          const text = entities[i].text
          if (text && typeof text === 'string' && text.trim()) {
            const trimmed = text.trim().substring(0, 200)
            if (!textHandleMap[trimmed]) {
              textHandleMap[trimmed] = h
            }
          }
        }
      }
    }

    // 释放 WASM 内存
    try { wasm.dwg_free(dataPtr) } catch { /* ignore */ }

    const resp: WorkerResponse = {
      id, type: 'result',
      payload: { svg, handleMap, handles, textHandleMap },
    }
    self.postMessage(resp)
  } catch (err: any) {
    const resp: WorkerResponse = {
      id, type: 'error',
      payload: { message: err?.message || '未知错误' },
    }
    self.postMessage(resp)
  }
}