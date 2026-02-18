import { env } from '../config/env';
import { OpenRouterClient, type OpenRouterCompletionResponse } from './openrouterClient';
import type { MergedTheses, VedicPanchangJson } from './types';

const SYSTEM_PROMPT =
  "Ты помощник по ведическому календарю (панчанга). Используй ТОЛЬКО факты из JSON 'PANCHANG'. Не выдумывай титхи/накшатру/вару/восход/закат. Если чего-то нет в данных — честно скажи, что поле отсутствует. Сформируй ответ на русском, структурировано и человеко-понятно: 1) Сводка дня (коротко), 2) Смысл дня, 3) Как прожить, 4) Практики (3–7 пунктов), 5) Осторожности. В блоке 1 обязательно кратко расшифруй термины простым языком: тити (лунный день), накшатра (лунное созвездие/фон дня), вара (день недели в ведической традиции), йога (общее качество дня), карана (практический рабочий настрой периода). Блоки 2-5 делай подробнее и теплее: по 3-6 содержательных пунктов, с бережным духовно-дружелюбным тоном, без пафоса, в стиле доброй индийской традиции. Используй смысловые эмодзи в заголовках и списках. Строго без Markdown-оформления: не используй символы #, *, __, ---, нумерацию вида '1.' и заголовки markdown. Делай чистый текст с эмодзи и короткими абзацами. Используй тезисы из 'THESES' как основу интерпретации. Не давай медицинских/финансовых советов, не делай категоричных утверждений.";

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
