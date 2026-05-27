import { BaseChatModel, BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import { BaseMessage, AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { ChatGeneration, ChatResult } from '@langchain/core/outputs';
import prisma from '../../config/db';

interface LLMConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
}

async function getLLMConfig(): Promise<LLMConfig | null> {
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'llm_chat_model' } });
    if (config?.value && typeof config.value === 'object') {
      const v = config.value as any;
      if (v.apiKey && v.modelName) {
        return {
          apiBaseUrl: v.apiBaseUrl || 'https://api.siliconflow.cn/v1',
          apiKey: v.apiKey,
          modelName: v.modelName,
          maxTokens: typeof v.maxTokens === 'number' ? v.maxTokens : 8192,
          temperature: typeof v.temperature === 'number' ? v.temperature : 0.3,
          timeout: typeof v.timeout === 'number' ? v.timeout : 120,
        };
      }
    }
  } catch (e) {
    console.warn('[LangChain-LLM] 获取配置失败:', e);
  }
  return null;
}

function convertMessages(messages: BaseMessage[]): Array<{ role: string; content: string }> {
  return messages.map(msg => {
    if (msg instanceof SystemMessage) return { role: 'system', content: msg.content as string };
    if (msg instanceof HumanMessage) return { role: 'user', content: msg.content as string };
    if (msg instanceof AIMessage) return { role: 'assistant', content: msg.content as string };
    return { role: 'user', content: msg.content as string };
  });
}

export class SystemConfigChatModel extends BaseChatModel {
  lc_serializable = false;

  static async create(): Promise<SystemConfigChatModel> {
    const config = await getLLMConfig();
    if (!config) throw new Error('LLM 未配置，请在系统设置中配置 LLM 模型');
    return new SystemConfigChatModel(config);
  }

  private config: LLMConfig;

  constructor(config: LLMConfig, params?: BaseChatModelParams) {
    super(params ?? {});
    this.config = config;
  }

  async _generate(
    messages: BaseMessage[],
    options: Record<string, any>,
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const openaiMessages = convertMessages(messages);

    const response = await fetch(`${this.config.apiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.modelName,
        messages: openaiMessages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
      }),
      signal: AbortSignal.timeout(this.config.timeout * 1000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LLM API 错误 (${response.status}): ${errText}`);
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];
    if (!choice) throw new Error('LLM 返回空结果');

    const content = choice.message?.content ?? '';
    const aiMessage = new AIMessage(content);
    const generation: ChatGeneration = {
      message: aiMessage,
      text: content,
    };

    return {
      generations: [generation],
      llmOutput: {
        tokenUsage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        model: this.config.modelName,
      },
    };
  }

  _llmType(): string {
    return 'system-config-chat';
  }

  getModelName(): string {
    return this.config.modelName;
  }
}
