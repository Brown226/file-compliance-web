/**
 * DWG WASM 解析工具
 * 基于 @mlightcad/libredwg-web 在浏览器端直接解析 DWG 文件
 * 提取：图层、文本实体、尺寸标注、标准引用
 * 解析结果可随 FormData 传给后端，跳过 DWG→DXF→ezdxf 链路
 */

import { LibreDwg, type LibreDwgEx, type DwgDatabase } from '@mlightcad/libredwg-web'

/** WASM 解析后的结构化数据（传给后端的格式） */
export interface DwgParsedData {
  /** 拼接的纯文本（所有文本实体内容） */
  text: string
  /** 图层列表 */
  layers: string[]
  /** 文本实体 */
  textEntities: Array<{
    text: string
    layer: string
    entityType: 'TEXT' | 'MTEXT'
    handle: string
    insert?: { x: number; y: number; z?: number }
  }>
  /** 尺寸标注 */
  dimensions: Array<{
    text: string
    layer: string
    entityType: string
    handle: string
    measurement?: string | null
  }>
  /** 标准引用（前端正则提取） */
  standardRefs: Array<{
    standardNo: string
    standardName: string
    standardIdent: string
    fullMatch: string
    cadHandleId: string
  }>
  /** 元数据 */
  metadata: {
    layerCount: number
    textCount: number
    dimensionCount: number
    entityCount: number
    converted: boolean  // true = WASM直接解析（非DXF转换）
    version?: string
  }
}

/** WASM 预览信息（前端展示用，比 DwgParsedData 更轻量） */
export interface DwgPreviewInfo {
  fileName: string
  fileSize: number
  layerCount: number
  textCount: number
  dimensionCount: number
  entityCount: number
  layers: Array<{ name: string; entityCount: number }>
  thumbnail?: string  // base64 PNG
  parsingTime: number // ms
}

// ==================== 标准引用正则（与后端 main.py 保持一致） ====================

const STANDARD_REF_PATTERN = /《.*?》\s*[\(（]?\s*([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)）]?([\(（].*[\)）])?/g
const CODE_ONLY_PATTERN = /[\(（]?(GB|GB\/T|NB|NB\/T|HJ|DL|DL\/T|CECS|HAF|EJ|EJ\/T|JGJ|CJJ|JG|HG|SH|SY|YY|QB|SL|TB|JT|YB|DB|DBJ|QX|GBJ|TJ|BJG|GYJ)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)）]?([\(（].*[\)」])?/g

/** 从标准号中提取标识符（如 GB/T → GB/T） */
function getStandardIdent(standardNo: string): string {
  if (!standardNo) return ''
  let ident = ''
  for (const c of standardNo) {
    if (c === '/') { ident += c; continue }
    if (/[a-zA-Z]/.test(c)) { ident += c.toUpperCase() }
    else { break }
  }
  return ident
}

/** 从文本中提取标准引用 */
function extractStandardRefs(texts: string[]): DwgParsedData['standardRefs'] {
  const results: DwgParsedData['standardRefs'] = []
  const seen = new Set<string>()
  const allText = texts.join('\n')

  // 先用《》格式匹配
  let match: RegExpExecArray | null
  STANDARD_REF_PATTERN.lastIndex = 0
  while ((match = STANDARD_REF_PATTERN.exec(allText)) !== null) {
    const fullMatch = match[0]
    if (seen.has(fullMatch)) continue
    seen.add(fullMatch)
    const bookEnd = fullMatch.indexOf('》')
    let standardNo = ''
    let standardName = ''
    if (bookEnd >= 0) {
      const bookStart = fullMatch.indexOf('《')
      standardName = fullMatch.slice(bookStart + 1, bookEnd).trim()
      standardNo = fullMatch.slice(bookEnd + 1).trim()
    } else {
      standardNo = fullMatch.trim()
    }
    standardNo = standardNo.replace(/^[\s\(（]+|[\s\)）]+$/g, '')
    if (standardNo) {
      results.push({
        standardNo,
        standardName,
        standardIdent: getStandardIdent(standardNo),
        fullMatch,
        cadHandleId: '', // 后面从实体handle回填
      })
    }
  }

  // 再用纯编号格式匹配
  CODE_ONLY_PATTERN.lastIndex = 0
  while ((match = CODE_ONLY_PATTERN.exec(allText)) !== null) {
    const fullMatch = match[0]
    if (seen.has(fullMatch)) continue
    seen.add(fullMatch)
    const standardNo = fullMatch.trim().replace(/^[\s\(（]+|[\s\)）]+$/g, '')
    if (standardNo) {
      results.push({
        standardNo,
        standardName: '',
        standardIdent: getStandardIdent(standardNo),
        fullMatch,
        cadHandleId: '',
      })
    }
  }

  return results
}

// ==================== 常量 ====================

/** DWG 文件大小上限（50MB），超过此限制跳过 WASM 解析避免浏览器 OOM */
const DWG_MAX_FILE_SIZE = 50 * 1024 * 1024;

// ==================== WASM 模块单例 ====================

let wasmInstance: LibreDwgEx | null = null
let wasmInitPromise: Promise<LibreDwgEx> | null = null

/** 初始化 WASM 模块（懒加载，仅首次调用时下载） */
async function ensureWasm(): Promise<LibreDwgEx> {
  if (wasmInstance) return wasmInstance
  if (wasmInitPromise) return wasmInitPromise

  wasmInitPromise = (async () => {
    try {
      // ★ 修复 WASM 路径问题：
      // dist/libredwg-web.js 中 locateFile 默认在 JS 文件所在目录（dist/）查找 .wasm，
      // 但实际 .wasm 文件在 wasm/ 目录下，不在 dist/ 目录。
      // 解决方案：将 libredwg-web.wasm 复制到 public/ 目录，
      // 通过 LibreDwg.create(wasmDir) 显式指定 WASM 文件所在目录。
      // public/ 下的文件在 dev 和 build 模式下都可通过根路径访问。
      const wasmDir = ''
      console.log('[DWG WASM] 初始化, WASM 目录:', wasmDir || '(root)')
      const instance = await LibreDwg.create(wasmDir)
      wasmInstance = instance
      console.log('[DWG WASM] 初始化成功')
      return instance
    } catch (e) {
      wasmInitPromise = null
      console.error('[DWG WASM] 初始化失败:', e)
      throw e
    }
  })()

  return wasmInitPromise
}

// ==================== 核心 API ====================

/**
 * 解析 DWG 文件（浏览器端 WASM）
 * @param file DWG 文件
 * @returns 结构化解析数据
 */
export async function parseDwgFile(file: File): Promise<DwgParsedData> {
  // 文件大小检查：超过阈值跳过解析，避免浏览器 OOM
  if (file.size > DWG_MAX_FILE_SIZE) {
    throw new Error(`DWG 文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超过 ${DWG_MAX_FILE_SIZE / 1024 / 1024}MB 限制。建议压缩后重试或跳过 WASM 解析。`)
  }

  const startTime = performance.now()
  const wasm = await ensureWasm()

  // 读取文件为 ArrayBuffer
  const buffer = await file.arrayBuffer()

  // 调用 WASM 解析
  const dataPtr = wasm.dwg_read_data(new Uint8Array(buffer), 0)
  if (!dataPtr) {
    throw new Error('WASM 解析 DWG 失败：dwg_read_data 返回空指针')
  }

  try {
    // 获取版本
    const version = wasm.dwg_get_version_type(dataPtr)

    // 转换为 JS 对象
    const db: DwgDatabase | null = wasm.convert(dataPtr)
    if (!db) {
      throw new Error('WASM 解析 DWG 失败：convert 返回空结果（可能 DWG 版本不兼容或文件损坏）')
    }

    // 提取图层
    const layers: string[] = []
    const layerEntityCounts: Record<string, number> = {}
    if (db.tables?.LAYER?.entries) {
      for (const layer of db.tables.LAYER.entries) {
        layers.push(layer.name)
        layerEntityCounts[layer.name] = 0
      }
    }

    // 提取实体
    const textEntities: DwgParsedData['textEntities'] = []
    const dimensions: DwgParsedData['dimensions'] = []
    const textContents: string[] = []  // 用于标准引用正则

    if (db.entities) {
      for (const entity of db.entities) {
        const layerName = entity.layer || '0'
        // 统计每层实体数
        layerEntityCounts[layerName] = (layerEntityCounts[layerName] || 0) + 1

        // 文本实体
        if (entity.type === 'TEXT') {
          const textEntity = entity as any
          const text = textEntity.text || ''
          if (text.trim()) {
            textEntities.push({
              text,
              layer: layerName,
              entityType: 'TEXT',
              handle: entity.handle || '',
              insert: textEntity.startPoint
                ? { x: textEntity.startPoint.x, y: textEntity.startPoint.y }
                : undefined,
            })
            textContents.push(text)
          }
        }
        // 多行文本
        else if (entity.type === 'MTEXT') {
          const mtextEntity = entity as any
          const text = mtextEntity.text || ''
          if (text.trim()) {
            textEntities.push({
              text,
              layer: layerName,
              entityType: 'MTEXT',
              handle: entity.handle || '',
              insert: mtextEntity.insertionPoint
                ? { x: mtextEntity.insertionPoint.x, y: mtextEntity.insertionPoint.y, z: mtextEntity.insertionPoint.z }
                : undefined,
            })
            textContents.push(text)
          }
        }
        // 尺寸标注
        else if (entity.type === 'DIMENSION' || (entity.type && entity.type.startsWith('DIMENSION_'))) {
          const dimEntity = entity as any
          const dimText = dimEntity.text || ''
          // "": 测量值作为文本; "<>": 同; " " (空格): 抑制文本
          if (dimText && dimText !== ' ' && dimText !== '<>') {
            dimensions.push({
              text: dimText,
              layer: layerName,
              entityType: entity.type,
              handle: entity.handle || '',
              measurement: dimEntity.userText || null,
            })
          } else if (dimText === '' || dimText === '<>') {
            // 使用测量值
            dimensions.push({
              text: dimEntity.measurement ? String(dimEntity.measurement) : '',
              layer: layerName,
              entityType: entity.type,
              handle: entity.handle || '',
              measurement: dimEntity.measurement ? String(dimEntity.measurement) : null,
            })
          }
        }
      }
    }

    // 提取标准引用
    const standardRefs = extractStandardRefs(textContents)

    // 为标准引用回填 cadHandleId（找到包含该引用的文本实体的 handle）
    for (const ref of standardRefs) {
      for (const te of textEntities) {
        if (te.text.includes(ref.standardNo) || te.text.includes(ref.fullMatch)) {
          ref.cadHandleId = te.handle
          break
        }
      }
    }

    // 拼接纯文本
    const fullText = textContents.join('\n')

    const elapsed = performance.now() - startTime
    console.log(`[DWG WASM] 解析完成: ${file.name}, 耗时 ${elapsed.toFixed(0)}ms, ` +
      `图层${layers.length} 文本${textEntities.length} 标注${dimensions.length} 标准引用${standardRefs.length}`)

    return {
      text: fullText,
      layers,
      textEntities,
      dimensions,
      standardRefs,
      metadata: {
        layerCount: layers.length,
        textCount: textEntities.length,
        dimensionCount: dimensions.length,
        entityCount: db.entities?.length || 0,
        converted: true,
        version: version ? String(version) : undefined,
      },
    }
  } finally {
    // 释放 WASM 内存
    try { wasm.dwg_free(dataPtr) } catch { /* ignore */ }
  }
}

/**
 * 获取 DWG 文件预览信息（轻量，用于上传时展示摘要）
 * 复用 parseDwgFile 结果，仅缩略图需额外读取
 */
export async function getDwgPreviewInfo(file: File): Promise<DwgPreviewInfo> {
  const startTime = performance.now()
  const parsed = await parseDwgFile(file)
  const elapsed = performance.now() - startTime

  // 尝试提取缩略图（需再次加载文件，但仅提取缩略图，不重复解析）
  let thumbnail: string | undefined
  try {
    const wasm = await ensureWasm()
    const buffer = await file.arrayBuffer()
    const dataPtr = wasm.dwg_read_data(new Uint8Array(buffer), 0)
    if (dataPtr) {
      try {
        const bmp = wasm.dwg_bmp(dataPtr)
        if (bmp && bmp.data) {
          const base64 = btoa(String.fromCharCode(...new Uint8Array(bmp.data)))
          const mimeType = bmp.type === 6 ? 'image/png' : 'image/bmp'
          thumbnail = `data:${mimeType};base64,${base64}`
        }
      } finally {
        try { wasm.dwg_free(dataPtr) } catch { /* ignore */ }
      }
    }
  } catch { /* 缩略图提取失败不影响主流程 */ }

  // 统计每层实体数（复用 parsed 数据，不重新读取文件）
  const layerEntityCounts: Record<string, number> = {}
  for (const te of parsed.textEntities) {
    layerEntityCounts[te.layer] = (layerEntityCounts[te.layer] || 0) + 1
  }
  for (const dim of parsed.dimensions) {
    layerEntityCounts[dim.layer] = (layerEntityCounts[dim.layer] || 0) + 1
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    layerCount: parsed.metadata.layerCount,
    textCount: parsed.metadata.textCount,
    dimensionCount: parsed.metadata.dimensionCount,
    entityCount: parsed.metadata.entityCount,
    layers: parsed.layers.map(name => ({
      name,
      entityCount: layerEntityCounts[name] || 0,
    })),
    thumbnail,
    parsingTime: elapsed,
  }
}

/**
 * 将 DwgParsedData 序列化为 JSON 字符串，用于 FormData 提交
 */
export function serializeDwgParsedData(data: DwgParsedData): string {
  return JSON.stringify(data)
}

/**
 * 检查 WASM 模块是否可用
 */
export async function isWasmAvailable(): Promise<boolean> {
  try {
    await ensureWasm()
    return true
  } catch {
    return false
  }
}

// ==================== SVG 转换 ====================

/** SVG 转换结果 */
export interface DwgSvgResult {
  /** SVG 字符串 */
  svg: string
  /** Handle → SVG 元素 ID 映射（用于错误定位高亮） */
  handleMap: Record<string, string>
  /** 按实体顺序排列的 handle 字符串数组（用于主线程 DOM handle 注入） */
  handles: string[]
  /** 文本内容 → handle 映射表（标准引用自检行→图元定位） */
  textHandleMap: Record<string, string>
}

// ==================== Web Worker 版 dwgToSvg ====================

let dwgWorker: Worker | null = null
let dwgRequestId = 0

function getDwgWorker(): Worker {
  if (!dwgWorker) {
    dwgWorker = new Worker(
      /* @vite-ignore */ new URL('./dwg-worker.ts', import.meta.url),
      { type: 'module' },
    )
  }
  return dwgWorker
}

/**
 * 终止 DWG Worker（释放内存和 WASM 实例）
 * 页面卸载或不再需要 DWG 预览时调用
 */
export function terminateDwgWorker(): void {
  if (dwgWorker) {
    dwgWorker.terminate()
    dwgWorker = null
  }
}

/**
 * 将 DWG 文件转为 SVG（浏览器端 WASM，在 Web Worker 中执行）
 * 同时在 SVG 元素上注入 data-handle 属性，用于错误图元定位
 * @param file DWG 文件
 * @returns SVG 字符串和 handle 映射
 */
export async function dwgToSvg(file: File): Promise<DwgSvgResult> {
  if (file.size > DWG_MAX_FILE_SIZE) {
    throw new Error(
      `DWG 文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超过 ${DWG_MAX_FILE_SIZE / 1024 / 1024}MB 限制。`,
    )
  }

  const buffer = await file.arrayBuffer()
  const id = ++dwgRequestId

  return new Promise((resolve, reject) => {
    const worker = getDwgWorker()

    const handler = (e: MessageEvent) => {
      const msg = e.data
      if (msg.id !== id) return

      worker.removeEventListener('message', handler)
      // 发生错误后 Worker 内部已释放内存，可直接退出
      worker.onerror = null

      if (msg.type === 'error') {
        reject(new Error(msg.payload.message || 'DWG 解析失败'))
      } else {
        resolve({
          svg: msg.payload.svg,
          handleMap: msg.payload.handleMap,
          handles: msg.payload.handles || [],
          textHandleMap: msg.payload.textHandleMap || {},
        })
      }
    }

    // Worker 未预期的错误（如网络加载失败）
    worker.onerror = (err) => {
      worker.removeEventListener('message', handler)
      worker.onerror = null
      reject(new Error(`Worker 加载失败: ${err.message}`))
    }

    worker.addEventListener('message', handler)

    try {
      worker.postMessage({ id, type: 'dwgToSvg', payload: { buffer, fileName: file.name } })
    } catch (postErr: any) {
      worker.removeEventListener('message', handler)
      worker.onerror = null
      reject(new Error(`发送消息到 Worker 失败: ${postErr?.message || postErr}`))
    }
  })
}

/**
 * 将 DWG 文件转为 SVG（Worker 版本，仅返回 SVG 字符串）
 * @param file DWG 文件
 * @returns SVG 字符串
 */
export async function dwgFileToSvg(file: File): Promise<string> {
  const result = await dwgToSvg(file)
  return result.svg
}

// ==================== PNG 导出（用于 Vision LLM 分析） ====================

/**
 * 将 DWG 文件渲染为高清 PNG base64（用于视觉模型分析）
 * 流程：DWG → SVG（WASM）→ Image → Canvas → PNG base64
 * @param file DWG 文件
 * @param scale 放大倍数（默认 2，确保清晰度）
 * @returns PNG 图片的 base64 字符串（不含 data:image/png;base64, 前缀）
 */
export async function dwgToPng(file: File, scale: number = 2): Promise<string> {
  // 1. 复用 dwgToSvg 获取 SVG 字符串
  const { svg } = await dwgToSvg(file)

  if (!svg || svg.trim().length === 0) {
    throw new Error('DWG 转 SVG 失败，无法生成图片')
  }

  // 2. 解析 SVG 尺寸
  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svg, 'image/svg+xml')
  const svgEl = svgDoc.documentElement

  // 从 viewBox 或 width/height 获取尺寸
  let width = 1200
  let height = 900
  const viewBox = svgEl.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number)
    if (parts.length === 4) {
      width = parts[2]
      height = parts[3]
    }
  } else {
    const w = parseFloat(svgEl.getAttribute('width') || '')
    const h = parseFloat(svgEl.getAttribute('height') || '')
    if (w > 0 && h > 0) {
      width = w
      height = h
    }
  }

  // 3. 创建 Image 对象加载 SVG
  const svgBase64 = btoa(unescape(encodeURIComponent(svg)))
  const svgDataUrl = `data:image/svg+xml;base64,${svgBase64}`

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('SVG 图片加载失败'))
    image.src = svgDataUrl
  })

  // 4. 绘制到 Canvas（scale 倍放大）
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D 上下文创建失败')
  }

  // 白色背景（图纸通常是白底）
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  // 5. 导出 PNG base64（去掉 data:image/png;base64, 前缀）
  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')

  // 检查大小（超过 10MB 降低 scale 重试）
  if (base64.length * 0.75 > 10 * 1024 * 1024 && scale > 1) {
    console.warn(`[DWG PNG] 图片过大 (${(base64.length * 0.75 / 1024 / 1024).toFixed(1)}MB)，降低分辨率重试`)
    return dwgToPng(file, 1)
  }

  console.log(`[DWG PNG] 导出成功: ${canvas.width}x${canvas.height}, ${(base64.length * 0.75 / 1024).toFixed(0)}KB`)
  return base64
}
