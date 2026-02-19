import { env } from '../config/env';
import { UserRepo } from '../repos/UserRepo';
import { UserStateRepo } from '../repos/UserStateRepo';
import { TelegramApi } from '../services/TelegramApi';
import type { OnboardingStep } from '../types/domain';
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from '../types/telegram';
import { logger } from '../utils/logger';
import { isValidTimeHHmm } from '../utils/time';
import { VedicHandlers } from '../vedic/handlers';

const CALLBACK = {
  JOIN: 'JOIN',
  SEND_TODAY: 'SEND_TODAY',
  SEND_TOMORROW: 'SEND_TOMORROW',
  SETTINGS_CHANGE_MORNING: 'SETTINGS_CHANGE_MORNING',
  SETTINGS_CHANGE_EVENING: 'SETTINGS_CHANGE_EVENING',
  SETTINGS_DISABLE: 'SETTINGS_DISABLE',
  SETTINGS_ENABLE: 'SETTINGS_ENABLE'
} as const;

const UPDATE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const processedUpdateIds = new Map<number, number>();

function isDuplicateUpdate(updateId: number): boolean {
  const now = Date.now();

  for (const [key, ts] of processedUpdateIds) {
    if (now - ts > UPDATE_DEDUPE_TTL_MS) {
      processedUpdateIds.delete(key);
    }
  }

  if (processedUpdateIds.has(updateId)) {
    return true;
  }

  processedUpdateIds.set(updateId, now);
  return false;
}

export class TelegramWebhookController {
  constructor(
    private readonly telegramApi: TelegramApi,
    private readonly userRepo: UserRepo,
    private readonly userStateRepo: UserStateRepo,
    private readonly vedicHandlers: VedicHandlers
  ) {}

  async handle(update: TelegramUpdate): Promise<void> {
    try {
      if (isDuplicateUpdate(update.update_id)) {
        return;
      }

      if (update.callback_query) {
        await this.handleCallback(update.callback_query);
        return;
      }

      if (update.message) {
        await this.handleMessage(update.message);
      }
    } catch (error) {
      logger.error('Failed to process update', {
        error: error instanceof Error ? error.message : String(error),
        updateId: update.update_id
      });
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    const text = message.text?.trim();
    const from = message.from;

    if (!from) {
      return;
    }

    if (text?.startsWith('/')) {
      await this.handleCommand(message, text);
      return;
    }

    if (!text) {
      return;
    }

    const handledTextAction = await this.vedicHandlers.handleTextAction(message, text);
    if (handledTextAction) {
      return;
    }

    const state = await this.userStateRepo.getByTelegramUserId(from.id);
    if (!state || state.step === 'IDLE') {
      return;
    }

    await this.handleStateInput(message, state.step, state.payload);
  }

  private async handleCommand(message: TelegramMessage, text: string): Promise<void> {
    const chatId = message.chat.id;
    const userId = message.from?.id;
    if (!userId) {
      return;
    }

    const handledByVedic = await this.vedicHandlers.handleCommand(message, text);
    if (handledByVedic) {
      return;
    }

    if (text === '/settings') {
      const user = await this.userRepo.findByTelegramUserId(userId);
      if (!user) {
        await this.telegramApi.sendMessage(chatId, 'Сначала пройди /start и нажми «Присоединиться».');
        return;
      }

      await this.telegramApi.sendMessage(
        chatId,
        [
          'Текущие настройки:',
          `Утро: ${user.morning_time ?? 'не задано'}`,
          `Вечер: ${user.evening_time ?? 'не задано'}`,
          `Активен: ${user.is_active ? 'да' : 'нет'}`
        ].join('\n'),
        {
          replyMarkup: {
            inline_keyboard: [
              [{ text: 'На сегодня', callback_data: CALLBACK.SEND_TODAY }],
              [{ text: 'На завтра', callback_data: CALLBACK.SEND_TOMORROW }],
              [{ text: 'Изменить утро', callback_data: CALLBACK.SETTINGS_CHANGE_MORNING }],
              [{ text: 'Изменить вечер', callback_data: CALLBACK.SETTINGS_CHANGE_EVENING }],
              [{ text: 'Отключить', callback_data: CALLBACK.SETTINGS_DISABLE }],
              [{ text: 'Включить', callback_data: CALLBACK.SETTINGS_ENABLE }]
            ]
          }
        }
      );
      return;
    }

    if (text === '/stop') {
      const user = await this.userRepo.findByTelegramUserId(userId);
      if (!user) {
        await this.telegramApi.sendMessage(chatId, 'Профиль не найден. Начни с /start.');
        return;
      }
      await this.userRepo.setIsActive(user.id, false);
      await this.telegramApi.sendMessage(chatId, 'Рассылки отключены.');
      return;
    }

    if (text === '/resume') {
      const user = await this.userRepo.findByTelegramUserId(userId);
      if (!user) {
        await this.telegramApi.sendMessage(chatId, 'Профиль не найден. Начни с /start.');
        return;
      }
      await this.userRepo.setIsActive(user.id, true);
      await this.telegramApi.sendMessage(chatId, 'Рассылки снова включены.');
      return;
    }

  }

  private async handleCallback(callback: TelegramCallbackQuery): Promise<void> {
    const data = callback.data;
    const userId = callback.from.id;
    const chatId = callback.message?.chat.id;

    if (!data || !chatId) {
      return;
    }

    if (data === CALLBACK.JOIN) {
      await this.userStateRepo.upsertState(userId, 'WAITING_CITY', { source: 'join_button' });
      await this.telegramApi.sendMessage(
        chatId,
        '🕉️ Намасте. Введи свой город, и я определю таймзону для точной сводки дня. Например: Москва.',
        { replyMarkup: { remove_keyboard: true } }
      );
      await this.telegramApi.answerCallbackQuery(callback.id);
      return;
    }

    if (data === CALLBACK.SEND_TODAY) {
      await this.vedicHandlers.handleToday(chatId, userId, false);
      await this.telegramApi.answerCallbackQuery(callback.id);
      return;
    }

    if (data === CALLBACK.SEND_TOMORROW) {
      await this.vedicHandlers.handleTomorrow(chatId, userId, false);
      await this.telegramApi.answerCallbackQuery(callback.id);
      return;
    }

    const user = await this.userRepo.findByTelegramUserId(userId);
    if (!user) {
      await this.telegramApi.sendMessage(chatId, 'Профиль не найден. Начни с /start.');
      await this.telegramApi.answerCallbackQuery(callback.id);
      return;
    }

    if (data === CALLBACK.SETTINGS_CHANGE_MORNING) {
      await this.userStateRepo.upsertState(userId, 'WAITING_UPDATE_MORNING_TIME');
      await this.telegramApi.sendMessage(chatId, 'Введи новое утреннее время в формате HH:mm.');
    }

    if (data === CALLBACK.SETTINGS_CHANGE_EVENING) {
      await this.userStateRepo.upsertState(userId, 'WAITING_UPDATE_EVENING_TIME');
      await this.telegramApi.sendMessage(chatId, 'Введи новое вечернее время в формате HH:mm.');
    }

    if (data === CALLBACK.SETTINGS_DISABLE) {
      await this.userRepo.setIsActive(user.id, false);
      await this.telegramApi.sendMessage(chatId, 'Рассылки отключены.');
    }

    if (data === CALLBACK.SETTINGS_ENABLE) {
      await this.userRepo.setIsActive(user.id, true);
      await this.telegramApi.sendMessage(chatId, 'Рассылки включены.');
    }

    await this.telegramApi.answerCallbackQuery(callback.id);
  }

  private async handleStateInput(
    message: TelegramMessage,
    step: OnboardingStep,
    payload: Record<string, unknown>
  ): Promise<void> {
    const text = message.text?.trim();
    const userId = message.from?.id;
    const chatId = message.chat.id;

    if (!text || !userId) {
      return;
    }

    if (step === 'WAITING_CITY') {
      const cityInputHandler = this.vedicHandlers as unknown as {
        handleCityInput?: (chatId: number, userId: number, cityInput: string, payload: Record<string, unknown>) => Promise<void>;
      };

      if (cityInputHandler.handleCityInput) {
        await cityInputHandler.handleCityInput(chatId, userId, text, payload);
      } else {
        await this.userStateRepo.clearState(userId);
        await this.telegramApi.sendMessage(chatId, '⚠️ Обнови бота до последней версии и попробуй снова: /setcity');
      }
      return;
    }

    if (step === 'WAITING_MORNING_TIME') {
      if (!isValidTimeHHmm(text)) {
        await this.telegramApi.sendMessage(chatId, 'Нужен формат HH:mm, например 07:45. Попробуй еще раз.');
        return;
      }
      await this.userStateRepo.upsertState(userId, 'WAITING_EVENING_TIME', {
        morning_time: text
      });
      await this.telegramApi.sendMessage(chatId, 'Теперь введи время вечернего сообщения в формате HH:mm.');
      return;
    }

    if (step === 'WAITING_EVENING_TIME') {
      if (!isValidTimeHHmm(text)) {
        await this.telegramApi.sendMessage(chatId, 'Нужен формат HH:mm, например 07:45. Попробуй еще раз.');
        return;
      }
      const morning = typeof payload.morning_time === 'string' ? payload.morning_time : null;
      if (!morning || !isValidTimeHHmm(morning)) {
        await this.userStateRepo.upsertState(userId, 'WAITING_MORNING_TIME');
        await this.telegramApi.sendMessage(chatId, 'Сначала укажи утреннее время в формате HH:mm.');
        return;
      }

      const timezoneFromPayload = typeof payload.timezone === 'string' && payload.timezone.trim()
        ? payload.timezone.trim()
        : null;
      const existingUser = await this.userRepo.findByTelegramUserId(userId);
      const timezoneName = timezoneFromPayload ?? existingUser?.timezone ?? env.defaultTimezone;

      await this.userRepo.upsertOnboardingUser({
        telegramUserId: userId,
        telegramChatId: chatId,
        timezone: timezoneName,
        morningTime: morning,
        eveningTime: text
      });
      await this.userStateRepo.clearState(userId);
      await this.telegramApi.sendMessage(
        chatId,
        `🙏 Готово. Настройки сохранены:\n🌅 Утро: ${morning}\n🌙 Вечер: ${text}\n🕉️ Таймзона: ${timezoneName}`
      );
      await this.telegramApi.sendMessage(chatId, '✨ Основные действия:', {
        replyMarkup: {
          keyboard: [[{ text: '🌞 Сегодня' }], [{ text: '🌙 Завтра' }]],
          resize_keyboard: true
        }
      });
      await this.vedicHandlers.handleToday(chatId, userId, false);
      return;
    }

    if (step === 'WAITING_UPDATE_MORNING_TIME') {
      if (!isValidTimeHHmm(text)) {
        await this.telegramApi.sendMessage(chatId, 'Нужен формат HH:mm, например 07:45. Попробуй еще раз.');
        return;
      }
      const user = await this.userRepo.findByTelegramUserId(userId);
      if (!user) {
        await this.telegramApi.sendMessage(chatId, 'Профиль не найден. Начни с /start.');
        return;
      }

      await this.userRepo.updateMorningTime(user.id, text);
      await this.userStateRepo.clearState(userId);
      await this.telegramApi.sendMessage(chatId, `Утреннее время обновлено: ${text}`);
      return;
    }

    if (step === 'WAITING_UPDATE_EVENING_TIME') {
      if (!isValidTimeHHmm(text)) {
        await this.telegramApi.sendMessage(chatId, 'Нужен формат HH:mm, например 07:45. Попробуй еще раз.');
        return;
      }
      const user = await this.userRepo.findByTelegramUserId(userId);
      if (!user) {
        await this.telegramApi.sendMessage(chatId, 'Профиль не найден. Начни с /start.');
        return;
      }

      await this.userRepo.updateEveningTime(user.id, text);
      await this.userStateRepo.clearState(userId);
      await this.telegramApi.sendMessage(chatId, `Вечернее время обновлено: ${text}`);
      return;
    }
  }

}
