import { env } from '../config/env';
import { OpenRouterClient, type OpenRouterCompletionResponse } from './openrouterClient';
import type { MergedTheses, VedicPanchangJson } from './types';

const SYSTEM_PROMPT =
  "Ты помощник по ведическому календарю (панчанга). Используй ТОЛЬКО факты из JSON 'PANCHANG'. Не выдумывай титхи/накшатру/вару/восход/закат. Если чего-то нет в данных — честно скажи, что поле отсутствует. Сформируй ответ на русском, структурировано: 1) Сводка дня (коротко), 2) Смысл дня, 3) Как прожить, 4) Практики (3–7 пунктов), 5) Осторожности. Используй тезисы из 'THESES' как основу интерпретации. Тон: практичный, спокойный, без мистического пафоса. Не давай медицинских/финансовых советов, не делай категоричных утверждений.";

function buildUserPrompt(panchang: VedicPanchangJson, theses: MergedTheses): string {
  return `Сгенерируй рекомендации на сегодня.\nPANCHANG: ${JSON.stringify(panchang)}\nTHESES: ${JSON.stringify(theses)}`;
}

export class OpenRouterRateLimitError extends Error {}

export class LlmService {
  constructor(private readonly client: OpenRouterClient = new OpenRouterClient()) {}

  async generateVedicDay(panchang: VedicPanchangJson, theses: MergedTheses): Promise<string> {
    if (!env.openrouterApiKey) {
      throw new Error('OPENROUTER_API_KEY is missing');
    }

    const response = await this.client.createChatCompletion({
      model: env.openrouterModel,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(panchang, theses) }
      ]
    });

    if (response.status === 429) {
      throw new OpenRouterRateLimitError('OpenRouter rate limit');
    }

    if (!response.ok) {
      const text = await response.text();
      if (/rate\s*limit/i.test(text)) {
        throw new OpenRouterRateLimitError('OpenRouter rate limit');
      }
      throw new Error(`OpenRouter request failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as OpenRouterCompletionResponse;

    if (payload.error?.message && /rate\s*limit/i.test(payload.error.message)) {
      throw new OpenRouterRateLimitError('OpenRouter rate limit');
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('OpenRouter returned empty content');
    }

    return content;
  }
}
