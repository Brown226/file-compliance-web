// RAGFlow 服务接口
import { authFetch } from '@openspec/utils/auth'

export interface OutlineItem {
  id: number
  title: string
  order: number
  expanded?: boolean
  children?: OutlineItem[]
  subtitle?: any[]
}

export interface GenerateOutlineRequest {
    prompt:string
    name: string
    abstract: string
}

export interface RagflowResponse {
    success: boolean
    data: any
    message?: string
}

// 新增：支持记忆功能的 Workflow 请求接口
export interface WorkflowChatRequest {
  message: string
  project_id?: string
  template?: string
  project_info?: string
  user_id: string  // 必填
  enable_audit?: boolean
  document_id: string  // 文档 ID（用作 thread_id）
  chapter_name?: string  // 当前生成的章节名称
  resume_session?: boolean  // 是否恢复历史 Session（默认 true）
}

const isProd = import.meta.env.MODE === 'prod' || import.meta.env.PROD
// Use relative path by default to allow Nginx/Vite proxy to handle routing
const RAGFLOW_BASE_URL = import.meta.env.AI_MID || ''


/**
 * 调用RAGFlow接口生成文档大纲
 * @param title 文章标题
 * @param summary 文章概要（可选）
 * @param projectInfo 项目信息（可选）
 * @returns Promise<RagflowResponse>
 */
export async function generateOutlineWithAssistant(
  title: string, 
  summary: string, 
): Promise<RagflowResponse> {
    const requestBody: GenerateOutlineRequest = {
        prompt:'生成目录',
        name:title,
        abstract:summary,
    }
    const url = `${RAGFLOW_BASE_URL}/agent/generate_outline`

    return await handlePostRequest(url, requestBody)

}


interface GenerateParagraphRequest {
  query:string, //chat输入
  title: string, //文档名称
  requirement:string, //模板提示词-参数-章节幻术要求
  structure:string, //模板提示词-参数-章节结构
  feature:string, //模板提示词-参数-章节特点
  chapterName:string, // 章节标题
  addition:string, // 特殊要求
  template: string,
  usePromptParams: boolean,
  // 新增字段：支持 Langfuse session 追踪
  document_id?: string, // 文档 ID（用于 session 关联）
  user_id?: string, // 用户 ID
  // 标签字段：用于动态知识库选择
  professionTagId?: number, // 专业标签 ID
  businessTypeTagId?: number, // 业态标签 ID
}

/**
 * 
 * @param title 文章标题
 * @param outline 文章大纲
 * @param chapterName 章节标题
 * @param query 用户查询
 * @param template 段落模板
 * @returns 
 */
export async function generateParagraph (
  payload:GenerateParagraphRequest,
): Promise<RagflowResponse>{
  try{
    // 构建请求参数
    const params = {
      prompt: payload.query || '生成章节',
      name: payload.title,
      chapterName: payload.chapterName,
      structure: payload.structure,
      feature: payload.feature,
      requirement: payload.requirement,
      usePromptParams: payload.usePromptParams,
    };
    const url = `${RAGFLOW_BASE_URL}/agent/generate_paragraph`
    //TODO 接口调用
    return await handlePostRequest(url, params)
  } catch (error) {
    console.error('调用RAGFlow接口失败:', error)
    return {
      success: false,
      data: [],
      message: error instanceof Error ? error.message : '未知错误'
    }
  }
}

/**
 * 批量生成章节内容（非流式）
 * 调用 /agent/workflow/chat/batch 接口
 * @param payload 生成请求参数
 * @returns Promise<RagflowResponse>
 */
export async function generateParagraphBatch(
  payload: GenerateParagraphRequest,
): Promise<RagflowResponse> {
  try {
    // 构建请求消息：与 ChatAssistant.vue 的 buildGenerationPrompt 对齐，确保标题层级和编号一致
    const chapterMatch = payload.chapterName?.match(/^(\d+)\.(.+)$/);
    const chapterNumber = chapterMatch ? chapterMatch[1] : '';
    const chapterTitle = chapterMatch ? chapterMatch[2] : (payload.chapterName || '');

    let message: string;
    if (chapterTitle) {
      const parts: string[] = [];
      parts.push(`请根据以下信息生成《${chapterTitle}》章节的施工图设计说明。`);
      // 保留子章节结构信息
      if (payload.query) {
        parts.push(`\n${payload.query}`);
      }
      // 明确指定章节编号和标题层级
      if (chapterNumber) {
        parts.push(`\n【输出格式】\n请使用 Markdown 格式输出，章节大标题使用一级标题格式"# ${chapterNumber}. ${chapterTitle}"，符合国家建筑规范标准。`);
      } else {
        parts.push('\n【输出格式】\n请使用 Markdown 格式输出，符合国家建筑规范标准。');
      }
      message = parts.join('\n');
    } else {
      message = payload.query || '生成章节';
    }

    // 构建项目信息（包含模板参数）
    let projectInfo = `文档名称: ${payload.title || ''}`;
    if (payload.usePromptParams) {
      if (payload.structure) {
        projectInfo += `\n章节结构: ${payload.structure}`;
      }
      if (payload.feature) {
        projectInfo += `\n章节特点: ${payload.feature}`;
      }
      if (payload.requirement) {
        projectInfo += `\n编写要求: ${payload.requirement}`;
      }
    }

    const params = {
      message,
      template: payload.template || '',
      project_info: projectInfo,
      document_id: payload.document_id,  // 传递 document_id 用于 session 关联
      user_id: payload.user_id,          // 传递 user_id
      chapter_name: payload.chapterName, // 传递章节名称
      profession_tag_id: payload.professionTagId,      // 标签：专业
      business_type_tag_id: payload.businessTypeTagId,  // 标签：业态
    };

    const url = `${RAGFLOW_BASE_URL}/agent/workflow/chat/batch`;

    const response = await authFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    // 处理返回结果，适配原有的响应格式
    if (result.success) {
      return {
        success: true,
        data: {
          text: result.content || '',
          doc_reference: [],
          chunk_reference: []
        },
        message: '生成成功'
      };
    } else {
      throw new Error(result.error || '生成失败');
    }
  } catch (error) {
    console.error('调用batch接口失败:', error);
    return {
      success: false,
      data: [],
      message: error instanceof Error ? error.message : '未知错误'
    };
  }
}

    
/**
 * 发送消息到 ragflow 服务（流式输出版本）
 * @param prompt 用户提问
 * @param sessionId 会话ID（用于多轮对话）
 * @param onChunk 处理每个数据块的回调函数
 * @param onComplete 数据流完成时的回调函数
 */
export async function generateParagraphStream(
  payload:GenerateParagraphRequest,
  onChunk?: (chunk: { content: string, sessionId?: string, thoughts?: string, doc_reference:any[], chunk_reference:any[] }) => void,
  onComplete?: (fullResponse: { content: string, sessionId?: string, thoughts?: string }) => void,
  signal?:AbortSignal
) {
  try {   
    // 构建请求参数
    const params = {
      prompt: payload.query || '生成章节',
      name: payload.title,
      chapterName: payload.chapterName,
      structure: payload.structure,
      feature: payload.feature,
      requirement: payload.requirement,
      usePromptParams: payload.usePromptParams
    };

  const fullUrl = `${RAGFLOW_BASE_URL}/agent/generate_paragraph_stream`;
    
    console.log('Using API URL:', fullUrl);
    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      credentials: 'include',
      signal  // 添加 signal 到 fetch 请求中
    };

    // 发起流式请求
    const response = await authFetch(fullUrl, requestOptions);

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    // 检查是否支持流式读取
    if (!response.body) {
      throw new Error('ReadableStream not supported in this browser.');
    }

    // 创建流式读取器
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let fullContent = '';

    while (true) {
      // 检查是否已被中断
      if (signal?.aborted) {
        reader.cancel();
        throw new Error('AbortError');
      }

      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }

      // 解码二进制数据
      const chunk = decoder.decode(value, { stream: true });
      // console.log('RAG service chunk:', chunk);

      let chunkContent = '';
      let chunkSessionId = '';
      let doc_ref_list: any[] = [];
      let chunk_ref_list: any[] = [];
      let chunkThoughts = '';
      try {
        // 处理SSE格式的数据（以data:开头）
        if (chunk.startsWith('data:')) {
          const chunks = chunk.split('data:').filter(c => c.trim());
          for (const chunkStr of chunks) {
            const jsonChunk = JSON.parse(chunkStr);

            // 提取数据
            chunkContent += jsonChunk.text || '';
            chunkSessionId = jsonChunk.session_id;
            if (jsonChunk.thoughts) {
              chunkThoughts += jsonChunk.thoughts;
            }

            if (jsonChunk.doc_reference&&jsonChunk.doc_reference.length > 0) {
              doc_ref_list = jsonChunk.doc_reference;
            }

            if (jsonChunk.chunk_reference && jsonChunk.chunk_reference.length > 0) {
              chunk_ref_list = jsonChunk.chunk_reference;
            }
          }

        } else {
          // 尝试直接解析为JSON（兼容非SSE格式）
          const jsonChunk = JSON.parse(chunk);
          
          // 提取数据
          chunkContent = jsonChunk.data?.text || jsonChunk.text || '';
          chunkSessionId = jsonChunk.data?.session_id || jsonChunk.session_id;
          if (jsonChunk.data?.thoughts || jsonChunk.thoughts) {
            chunkThoughts = jsonChunk.data?.thoughts || jsonChunk.thoughts || '';
          }

          if (jsonChunk.doc_reference && jsonChunk.doc_reference.length > 0) {
            doc_ref_list = jsonChunk.doc_reference;
          }

          if (jsonChunk.chunk_reference && jsonChunk.chunk_reference.length > 0) {
            chunk_ref_list = jsonChunk.chunk_reference;
          }
        }

         // 更新完整内容和会话ID
         fullContent += chunkContent;
        

         // 调用回调函数处理当前数据块
        if (onChunk) {
          // console.log('oooooooooooo onchuk:', doc_ref_list, chunk_ref_list)
          onChunk({
            content: chunkContent,
            sessionId: chunkSessionId,
            thoughts: chunkThoughts,
            doc_reference: doc_ref_list,
            chunk_reference: chunk_ref_list
          });
        }
      } catch (e) {
        console.warn('Failed to parse chunk as JSON:', e);
        // 如果解析失败，可能是不完整的 JSON 或纯文本
        if (chunk.trim() && onChunk) {
          onChunk({
            content: chunk,
            thoughts: '',
            doc_reference: [],
            chunk_reference: []
          });
        }
      }
    }

    // 构建完整响应
    const fullResponse = {
      content: fullContent,
    };

    // 调用完成回调
    if (onComplete) {
      onComplete(fullResponse);
    }

    return fullResponse;
  } catch (error) {
    console.error('Error calling RAG service:', error);
    throw error;
  }
}

export async function uploadFile(file: File, datasetName: string): Promise<RagflowResponse> {
    const form = new FormData()
    form.append('file', file)
    form.append('datasetName', datasetName)
    const uploadUrl = `${RAGFLOW_BASE_URL}/agent/file/upload`
    
    try {
        const uploadRes = await authFetch(uploadUrl, {
            method: 'POST',
            body: form
        })
        
        if (!uploadRes.ok) {
            throw new Error(`Upload failed! status: ${uploadRes.status}`)
        }
        
        const uploadResult = await uploadRes.json()
        if (uploadResult.code !== 200 || !uploadResult.data || !uploadResult.data.id) {
            throw new Error(uploadResult.message || '文件上传失败')
        }
        return {
            success: true,
            data: uploadResult.data,
            message: '上传成功'
        }
    } catch (error) {
        throw error
    }
}

export async function parseFile(fileId: string, datasetName: string): Promise<RagflowResponse> {
    const parseUrl = `${RAGFLOW_BASE_URL}/agent/file/parse`
    try {
        const parseRes = await authFetch(parseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fileId: fileId,
                datasetName: datasetName
            })
        })

        if (!parseRes.ok) {
            throw new Error(`Parse failed! status: ${parseRes.status}`)
        }
        
        const parseResult = await parseRes.json()
        if (parseResult.code !== 200) {
            throw new Error(parseResult.message || '文件解析失败')
        }
        return {
            success: true,
            data: parseResult.data || {},
            message: '解析成功'
        }
    } catch (error) {
        throw error
    }
}

export async function extractKey(fileId: string, datasetName: string, input_query: string = ''): Promise<RagflowResponse> {
    const extractUrl = `${RAGFLOW_BASE_URL}/agent/file/extract_key`
    try {
        const extractRes = await authFetch(extractUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fileId: fileId,
                datasetName: datasetName,
                input_query: input_query
            })
        })

        if (!extractRes.ok) {
            throw new Error(`Extract failed! status: ${extractRes.status}`)
        }

        const extractResult = await extractRes.json()
        if (extractResult.code !== 200) {
            throw new Error(extractResult.message || '信息提取失败')
        }
        if (!extractResult.data) {
             throw new Error('信息提取返回数据为空')
        }
        return {
            success: true,
            data: extractResult.data,
            message: '提取成功'
        }
    } catch (error) {
        throw error
    }
}

export async function uploadAndParseFile(file: File, datasetName = 'test_ygy'): Promise<RagflowResponse> {
  try {
    // 1. 上传文件
    const uploadRes = await uploadFile(file, datasetName)
    const fileId = uploadRes.data.id
    const fileName = uploadRes.data.name

    // 2. 解析文件
    const parseRes = await parseFile(fileId, datasetName)

    // 3. 提取关键信息
    const extractRes = await extractKey(fileId, datasetName)

    // 构造符合前端预期的返回结构
    return {
        success: true,
        data: {
            filename: fileName,
            results: [parseRes.data], // 保持数组结构兼容
            extracted: extractRes.data.extracted
        },
        message: '解析成功'
    }

  } catch (error) {
    return {
      success: false,
      data: [],
      message: error instanceof Error ? error.message : '未知错误'
    }
  }
}

async function handlePostRequest(url: string, requestBody: any):Promise<RagflowResponse>{
     try {
       const response = await authFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      })
      // console.log('ppppppppppppp res:', response)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()
      // console.log('222222222222222 res:', result)
      
      // 确保返回的数据格式正确
      if (result.code==200) {
          //TODO-数据处理
          return {
              success: true,
              data: result.data,
              message: result.message
          }
      } else {
        throw new Error(result.message || '接口返回数据格式错误')
      }
     } catch (error) {
        console.error('调用RAGFlow接口失败:', error)
        return {
          success: false,
          data: [],
          message: error instanceof Error ? error.message : '未知错误'
        }
     }
}

/**
 * 新增：支持记忆功能的流式生成章节接口
 * 调用 /agent/workflow/chat/stream 接口
 * @param payload Workflow 请求参数
 * @param onChunk 处理每个数据块的回调函数
 * @param onComplete 数据流完成时的回调函数
 * @param signal AbortSignal 用于取消请求
 */
export async function generateParagraphStreamWithMemory(
  payload: WorkflowChatRequest,
  onChunk?: (chunk: { content: string, node?: string, timestamp?: number }) => void,
  onComplete?: (fullResponse: { content: string }) => void,
  signal?: AbortSignal
) {
  try {
    const fullUrl = `${RAGFLOW_BASE_URL}/agent/workflow/chat/stream`;

    console.log('Using Workflow API URL:', fullUrl);
    console.log('Request payload:', payload);

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      credentials: 'include',
      signal
    };

    // 发起流式请求
    const response = await authFetch(fullUrl, requestOptions);

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    // 检查是否支持流式读取
    if (!response.body) {
      throw new Error('ReadableStream not supported in this browser.');
    }

    // 创建流式读取器
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let fullContent = '';
    let buffer = '';

    while (true) {
      // 检查是否已被中断
      if (signal?.aborted) {
        reader.cancel();
        throw new Error('AbortError');
      }

      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // 解码二进制数据
      buffer += decoder.decode(value, { stream: true });

      // 处理 SSE 格式的数据
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留最后一行（可能不完整）

      for (const line of lines) {
        if (!line.trim() || line.startsWith(':')) {
          continue; // 跳过空行和注释
        }

        if (line.startsWith('event:')) {
          // 事件类型行，暂时跳过
          continue;
        }

        if (line.startsWith('data:')) {
          try {
            const jsonStr = line.substring(5).trim();
            const data = JSON.parse(jsonStr);

            // 处理 token 事件（流式内容）
            if (data.content) {
              fullContent += data.content;

              if (onChunk) {
                onChunk({
                  content: data.content,
                  node: data.node,
                  timestamp: data.timestamp
                });
              }
            }

            // 处理其他事件类型（timeline_step, tool_call, error, done）
            // 可以根据需要添加更多处理逻辑

          } catch (e) {
            console.warn('Failed to parse SSE data:', line, e);
          }
        }
      }
    }

    // 完成回调
    if (onComplete) {
      onComplete({ content: fullContent });
    }

  } catch (error) {
    console.error('调用 Workflow Stream 接口失败:', error);
    throw error;
  }
}
