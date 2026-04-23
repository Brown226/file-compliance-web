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
}

/**
 * 将 DWG 文件转为 SVG（浏览器端 WASM）
 * 同时在 SVG 元素上注入 data-handle 属性，用于错误图元定位
 * @param file DWG 文件
 * @returns SVG 字符串和 handle 映射
 */
export async function dwgToSvg(file: File): Promise<DwgSvgResult> {
  if (file.size > DWG_MAX_FILE_SIZE) {
    throw new Error(`DWG 文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超过 ${DWG_MAX_FILE_SIZE / 1024 / 1024}MB 限制。`)
  }

  const wasm = await ensureWasm()
  const buffer = await file.arrayBuffer()
  const dataPtr = wasm.dwg_read_data(new Uint8Array(buffer), 0)
  if (!dataPtr) {
    throw new Error('WASM 解析 DWG 失败：dwg_read_data 返回空指针')
  }

  try {
    // Step 1: convert dataPtr → DwgDatabase
    // dwg_read_data 即使遇到 CRC 错误（错误码 2048）也会返回非空 dataPtr，
    // 但 convert 可能在处理有错误的数据时抛异常或返回 null
    let db: DwgDatabase | null = null
    try {
      db = wasm.convert(dataPtr)
    } catch (convertErr: any) {
      console.warn('[dwgToSvg] wasm.convert 抛出异常:', convertErr?.message || convertErr)
    }

    if (!db) {
      throw new Error(
        'DWG 文件解析失败：无法将 DWG 数据转换为结构化对象。' +
        '可能原因：DWG 版本不兼容、文件损坏或包含不支持的对象。' +
        `（文件: ${file.name}, 大小: ${(file.size / 1024).toFixed(0)}KB）`
      )
    }

    // Step 2: DwgDatabase → SVG
    let svg: string
    try {
      svg = wasm.dwg_to_svg(db)
    } catch (svgErr: any) {
      console.warn('[dwgToSvg] wasm.dwg_to_svg(db) 抛出异常:', svgErr?.message || svgErr)
      throw new Error(
        'DWG 转 SVG 失败：无法将图纸数据渲染为 SVG。' +
        '可能原因：图纸包含不支持的实体类型或几何数据异常。' +
        `（文件: ${file.name}, 实体数: ${db.entities?.length || 0}）`
      )
    }

    if (!svg || typeof svg !== 'string' || !svg.includes('<svg')) {
      throw new Error('DWG 转 SVG 失败：生成的 SVG 内容无效')
    }

    // Step 3: 注入 data-handle 属性用于错误定位
    const handleMap: Record<string, string> = {}

    if (db.entities) {
      let idx = 0
      for (const entity of db.entities) {
        if (entity.handle) {
          const svgId = `dwg-entity-${idx}`
          handleMap[entity.handle] = svgId
        }
        idx++
      }
    }

    let enrichedSvg = svg
    if (db.entities && db.entities.length > 0) {
      // 收集所有 <g 标签位置
      const positions: number[] = []
      const re = /<g\s/g
      let match: RegExpExecArray | null
      while ((match = re.exec(svg)) !== null) {
        positions.push(match.index)
      }

      // 从后往前替换（避免偏移问题）
      for (let i = Math.min(positions.length, db.entities.length) - 1; i >= 0; i--) {
        const entity = db.entities[i]
        if (entity.handle) {
          const pos = positions[i]
          // 在 <g 后面插入 data-handle 属性
          enrichedSvg =
            enrichedSvg.substring(0, pos + 2) +
            ` data-handle="${entity.handle}" data-entity-type="${entity.type || ''}" id="dwg-entity-${i}" ` +
            enrichedSvg.substring(pos + 2)
        }
      }
    }

    console.log(`[dwgToSvg] 成功: ${file.name}, 实体数=${db.entities?.length || 0}, SVG长度=${enrichedSvg.length}`)
    return { svg: enrichedSvg, handleMap }
  } finally {
    try { wasm.dwg_free(dataPtr) } catch { /* ignore */ }
  }
}

/**
 * 将 DWG 的 DwgParsedData（已有数据）重新解析为 SVG
 * 用于审查结果页面从原始 DWG 文件生成 SVG 预览
 * @param file DWG 文件
 * @returns SVG 字符串（已注入 data-handle）
 */
export async function dwgFileToSvg(file: File): Promise<string> {
  const result = await dwgToSvg(file)
  return result.svg
}
