import OpenAI from 'openai';
import type { Depth, ToolName } from '@lumina/contract';
import { env, secrets } from '../env.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ToolCallDecision {
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
  reason?: string;
}

export interface StepDecision {
  toolCalls: ToolCallDecision[];
  content?: string;
  tokensIn: number;
  tokensOut: number;
}

export function getAvailableTools(depth: Depth): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the public web for real-time information and recent facts.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query to execute.' },
            reason: { type: 'string', description: 'Why this search query is needed.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fetch_page',
        description: 'Fetch and extract the full readable content of a specific webpage URL.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The webpage URL to fetch.' },
            reason: { type: 'string', description: 'Why this webpage should be fetched.' }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_documents',
        description: 'Search indexed documents in the current space using hybrid vector and keyword search.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query.' },
            spaceId: { type: 'string', description: 'The space ID to search within.' },
            reason: { type: 'string', description: 'Why this space query is needed.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'recall_memory',
        description: 'Search user long-term memories using semantic similarity.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The memory search query.' },
            reason: { type: 'string', description: 'Why memory recall is needed.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'save_memory',
        description: 'Explicitly save a persistent user fact or preference to long-term memory.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The fact or preference to remember.' },
            reason: { type: 'string', description: 'Why this fact should be saved.' }
          },
          required: ['text']
        }
      }
    }
  ];

  // Deep search gear ONLY: plan_research
  if (depth === 'deep') {
    tools.unshift({
      type: 'function',
      function: {
        name: 'plan_research',
        description:
          'Decompose the complex user research query into 3 to 6 targeted sub-questions before retrieval.',
        parameters: {
          type: 'object',
          properties: {
            subQuestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  i: { type: 'integer', description: '1-based index of the sub-question.' },
                  question: { type: 'string', description: 'The sub-question to investigate.' },
                  reason: { type: 'string', description: 'Why this sub-question is necessary.' }
                },
                required: ['i', 'question', 'reason']
              },
              minItems: 3,
              maxItems: 6
            },
            reason: { type: 'string', description: 'High-level synthesis plan.' }
          },
          required: ['subQuestions']
        }
      }
    });
  }

  return tools;
}

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!secrets.openai) {
      throw new Error('OPENAI_API_KEY is not configured in environment');
    }
    openaiClient = new OpenAI({ apiKey: secrets.openai });
  }
  return openaiClient;
}

/**
 * Executes a reasoning step: asks the model whether to call tools or finish.
 */
export async function decideNextStep(
  messages: ChatMessage[],
  depth: Depth,
  allowedTools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  timeoutMs?: number,
  temperature = 0.2
): Promise<StepDecision> {
  const client = getOpenAIClient();
  const tools = allowedTools || getAvailableTools(depth);

  const completion = await client.chat.completions.create(
    {
      model: env.llmModel,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length === 1 ? 'required' : tools.length > 0 ? 'auto' : undefined,
      temperature
    },
    timeoutMs ? { timeout: timeoutMs } : undefined
  );

  const choice = completion.choices[0];
  const msg = choice?.message;
  const toolCalls: ToolCallDecision[] = [];

  if (msg?.tool_calls) {
    for (const tc of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      const reason = typeof args.reason === 'string' ? args.reason : undefined;
      toolCalls.push({
        id: tc.id,
        name: tc.function.name as ToolName,
        args,
        reason
      });
    }
  }

  return {
    toolCalls,
    content: msg?.content || undefined,
    tokensIn: completion.usage?.prompt_tokens ?? 0,
    tokensOut: completion.usage?.completion_tokens ?? 0
  };
}

/**
 * Streams the final synthesized answer from the model using inline citations [n].
 */
export async function* streamFinalAnswer(
  messages: ChatMessage[],
  onUsage?: (tokens: { in: number; out: number }) => void,
  temperature = 0
): AsyncGenerator<string, void, unknown> {
  const client = getOpenAIClient();

  const stream = await client.chat.completions.create({
    model: env.llmModel,
    messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    stream: true,
    stream_options: { include_usage: true },
    temperature
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      yield delta;
    }
    if (chunk.usage && onUsage) {
      onUsage({
        in: chunk.usage.prompt_tokens ?? 0,
        out: chunk.usage.completion_tokens ?? 0
      });
    }
  }
}
