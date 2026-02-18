import { env } from '../config/env';

export interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterCompletionRequest {
  model: string;
  messages: OpenRouterChatMessage[];
  temperature?: number;
}

export interface OpenRouterCompletionResponse {
  error?: { message?: string };
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenRouterClient {
  async createChatCompletion(payload: OpenRouterCompletionRequest): Promise<Response> {
    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openrouterApiKey}`,
        'Content-Type': 'application/json',
        ...(env.openrouterReferer ? { 'HTTP-Referer': env.openrouterReferer } : {}),
        ...(env.openrouterTitle ? { 'X-Title': env.openrouterTitle } : {})
      },
      body: JSON.stringify(payload)
    });
  }
}
