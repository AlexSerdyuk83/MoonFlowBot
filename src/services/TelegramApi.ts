import type { InlineKeyboardMarkup } from '../types/telegram';

interface SendMessageOptions {
  replyMarkup?: InlineKeyboardMarkup;
}

export class TelegramApi {
  private readonly baseUrl: string;

  constructor(private readonly botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(chatId: number | string, text: string, options: SendMessageOptions = {}): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: options.replyMarkup
    });
  }

  async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId
    });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram API ${method} failed: HTTP ${response.status} ${text}`);
    }

    const payload = (await response.json()) as { ok: boolean; description?: string };
    if (!payload.ok) {
      throw new Error(`Telegram API ${method} failed: ${payload.description ?? 'unknown error'}`);
    }
  }
}
