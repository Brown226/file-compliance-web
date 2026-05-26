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

    // Step 4: 构建 handleMap 并注入 data-handle 属性
    // 注意：假设 dwg_to_svg 按实体顺序生成 <g> 元素，即 entities[i] ↔ SVG 中第 i 个 <g>
    // 如果 SVG 中有额外的包裹层 <g>（如图层编组），可能导致错位
    const handleMap: Record<string, string> = {}
    const entities = db.entities as any[] | undefined
    if (entities) {
      for (let i = 0; i < entities.length; i++) {
        if (entities[i].handle) {
          handleMap[entities[i].handle] = `dwg-entity-${i}`
        }
      }
    }

    /** 转义 HTML 属性值中的特殊字符 */
    function escapeAttr(val: string): string {
      return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    let enrichedSvg = svg
    if (entities && entities.length > 0) {
      // 匹配所有 <g 后跟空格或 > 的位置（即 <g> / <g / <g\n 等实体容器标签）
      // 注意：假设 dwg_to_svg 按 entities 顺序输出实体 <g>，不存在额外包裹层
      const positions: number[] = []
      const re = /<g[\s>]/g
      let match: RegExpExecArray | null
      while ((match = re.exec(svg)) !== null) {
        positions.push(match.index)
      }

      // 实体组数不匹配时记录警告（不影响继续执行）
      if (positions.length !== entities.length) {
        console.warn(
          `[dwg-worker] SVG <g> 元素数 (${positions.length}) 与实体数 (${entities.length}) 不一致，`,
          'handle 注入可能错位。文件:', fileName,
        )
      }

      // 反向遍历注入，避免前面的注入影响后面的位置索引
      const count = Math.min(positions.length, entities.length)
      for (let i = count - 1; i >= 0; i--) {
        const entity = entities[i]
        if (!entity.handle) continue
        // <g[\s>] 匹配 3 个字符 (<, g, \s 或 >)，insertAt = pos + 2 正好指向 g 之后
        const insertAt = positions[i] + 2
        const escapedHandle = escapeAttr(entity.handle)
        const escapedType = escapeAttr(entity.type || '')
        enrichedSvg =
          enrichedSvg.substring(0, insertAt) +
          ` data-handle="${escapedHandle}" data-entity-type="${escapedType}" id="dwg-entity-${i}"` +
          enrichedSvg.substring(insertAt)
      }
    }

    // 释放 WASM 内存
    try { wasm.dwg_free(dataPtr) } catch { /* ignore */ }

    const resp: WorkerResponse = {
      id, type: 'result',
      payload: { svg: enrichedSvg, handleMap },
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