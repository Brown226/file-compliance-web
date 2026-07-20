import os
import operator
from typing import TypedDict, Annotated, List, Union
from dotenv import load_dotenv
from langchain_community.chat_models import ChatTongyi
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, END
from ragflow_sdk import RAGFlow
from service.db.database import get_kb_id_by_project_id
from service.utils.prompt_manager import PromptManager

load_dotenv()

# 配置信息
RAGFLOW_BASE_URL = os.getenv("RAGFLOW_BASE_URL", "")
RAGFLOW_API_KEY = os.getenv("RAGFLOW_API_KEY")

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    context: str
    project_id: str
    kb_ids: List[str]
    # 可选参数
    template: str
    project_info: str
    system_prompt: str
    
def get_llm(streaming: bool = True):
    return ChatTongyi(
        model="qwen-max",
        temperature=0.1,
        streaming=streaming
    )

def retrieve_from_ragflow(state: AgentState):
    """
    调用 RAGFlow API 检索知识库
    """
    messages = state['messages']
    last_message = messages[-1]
    query = last_message.content
    
    project_id = state.get('project_id')
    kb_ids = state.get('kb_ids', [])
    
    # # 如果没有直接提供 kb_ids，尝试通过 project_id 查询
    # if not kb_ids and project_id:
    #     kb_id = get_kb_id_by_project_id(project_id)
    #     if kb_id:
    #         kb_ids = [kb_id]
            
    if not kb_ids:
        print(f"Warning: No KB IDs found for project {project_id}")
        return {"context": ""}

    print(f"正在从 RAGFlow 检索: {query}, KB_IDS: {kb_ids}")
    
    try:
        rag_object = RAGFlow(api_key=RAGFLOW_API_KEY, base_url=RAGFLOW_BASE_URL)
        
        # 调用 retrieve 接口
        chunks = rag_object.retrieve(
            question=query,
            dataset_ids=kb_ids,
            page=1,
            page_size=10,
            similarity_threshold=0.5
        )
        
        if chunks:
            context_list = []
            for chunk in chunks:
                # 兼容不同版本的 SDK 返回格式
                content = getattr(chunk, 'content_with_weight', None) or \
                          getattr(chunk, 'content', None) or \
                          (chunk.get('content_with_weight') if isinstance(chunk, dict) else None) or \
                          (chunk.get('content') if isinstance(chunk, dict) else None) or \
                          str(chunk)
                context_list.append(content)
            
            context = "\n\n".join(context_list)
        else:
            context = ""
            
    except Exception as e:
        print(f"RAGFlow 检索失败: {e}")
        context = ""

    return {"context": context}

def generate_response(state: AgentState):
    """
    根据检索内容和系统提示词生成回复
    """
    context = state['context']
    messages = state['messages']
    template = state.get('template', "")
    project_info = state.get('project_info', "")
    
    last_message = messages[-1] if messages else HumanMessage(content="")
    question = last_message.content if hasattr(last_message, "content") else ""
    
    # 优先使用 Langfuse Prompt.compile 生成完整提示词
    full_prompt = None
    try:
        prompt_manager = PromptManager()
        prompt = prompt_manager.get_prompt("construction_agent_system")
        full_prompt = prompt.compile(context=context, question=question, template=template, project_info=project_info)
    except Exception as e:
        print(f"Langfuse Prompt Compile Error: {e}")
        pass
    
    llm = get_llm()
    if full_prompt:
        response = llm.invoke([HumanMessage(content=full_prompt)])
    else:
        raise Exception("Langfuse Prompt.compile 失败或未返回完整提示词")
    
    return {"messages": [response]}

# 构建图
workflow = StateGraph(AgentState)

workflow.add_node("retrieve", retrieve_from_ragflow)
workflow.add_node("generate", generate_response)

workflow.set_entry_point("retrieve")
workflow.add_edge("retrieve", "generate")
workflow.add_edge("generate", END)

app = workflow.compile()
