import { env } from '../config/env';
import { UserStateRepo } from '../repos/UserStateRepo';
import { TelegramApi } from '../services/TelegramApi';
import type { TelegramMessage } from '../types/telegram';
import type { ReplyKeyboardMarkup } from '../types/telegram';
import { logger } from '../utils/logger';
import { getNowInTimezone } from '../utils/time';
import { LlmService, OpenRouterRateLimitError } from './llmService';
import { VedicPanchangService } from './panchangService';
import { VedicStorage } from './storage';
import { VedicThesesService } from './vedicTheses';

const CANCEL_TEXT = 'Отмена';
const BUTTON_JOIN = 'Присоединиться';
const BUTTON_TODAY = 'Сообщение на сегодня';
const BUTTON_TOMORROW = 'Анонс на завтра';

function removeKeyboard() {
  return { remove_keyboard: true } as const;
}

function locationKeyboard() {
  const keyboard: ReplyKeyboardMarkup = {
    keyboard: [[{ text: 'Send location', request_location: true }], [{ text: CANCEL_TEXT }]],
    resize_keyboard: true,
    one_time_keyboard: true
  };
  return keyboard;
}

function controlKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: BUTTON_JOIN }, { text: BUTTON_TODAY }, { text: BUTTON_TOMORROW }]],
    resize_keyboard: true
  };
}

function fieldOrNA(value: string | null): string {
  return value ?? 'данных нет';
}

function summaryBlock(dateLocal: string, panchangJson: {
  tithi: { name: string | null };
  nakshatra: { name: string | null };
  vara: string | null;
  sunrise: string | null;
  sunset: string | null;
}): string {
  return [
    `Сегодня (${dateLocal}):`,
    `• Титхи: ${fieldOrNA(panchangJson.tithi.name)}`,
    `• Накшатра: ${fieldOrNA(panchangJson.nakshatra.name)}`,
    `• Вара: ${fieldOrNA(panchangJson.vara)}`,
    `• Восход: ${fieldOrNA(panchangJson.sunrise)}`,
    `• Закат: ${fieldOrNA(panchangJson.sunset)}`
  ].join('\n');
}

function isValidTimezone(timezoneName: string): boolean {
  try {
    Intl.DateTimeFormat('ru-RU', { timeZone: timezoneName }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export class VedicHandlers {
  constructor(
    private readonly telegramApi: TelegramApi,
    private readonly userStateRepo: UserStateRepo,
    private readonly storage: VedicStorage,
    private readonly panchangService: VedicPanchangService,
    private readonly thesesService: VedicThesesService,
    private readonly llmService: LlmService
  ) {}

  async handleCommand(message: TelegramMessage, text: string): Promise<boolean> {
    const chatId = message.chat.id;
    const userId = message.from?.id;
    if (!userId) {
      return true;
    }

    if (text === '/start') {
      await this.requestLocation(chatId, userId, 'start');
      return true;
    }

    if (text === '/setlocation') {
      await this.requestLocation(chatId, userId, 'setlocation');
      return true;
    }

    if (text === '/today') {
      await this.handleToday(chatId, userId, false);
      return true;
    }

    if (text === '/refresh') {
      await this.handleToday(chatId, userId, true);
      return true;
    }

    if (text.startsWith('/settimezone')) {
      const tzRaw = text.replace('/settimezone', '').trim();
      if (!tzRaw) {
        await this.telegramApi.sendMessage(chatId, 'Укажи таймзону: /settimezone Europe/Moscow');
        return true;
      }

      if (!isValidTimezone(tzRaw)) {
        await this.telegramApi.sendMessage(chatId, 'Неверная таймзона. Пример: Europe/Moscow');
        return true;
      }

      await this.storage.saveTimezone({ userId, chatId, timezone: tzRaw });
      await this.userStateRepo.clearState(userId);
      await this.telegramApi.sendMessage(chatId, `Таймзона сохранена: ${tzRaw}`, {
        replyMarkup: removeKeyboard()
      });
      return true;
    }

    if (text === '/debug') {
      const isAllowed = env.nodeEnv !== 'production' || env.adminTelegramUserId === String(userId);
      if (!isAllowed) {
        return true;
      }

      const location = await this.storage.getUserLocation(userId);
      if (!location || location.lat == null || location.lon == null) {
        await this.telegramApi.sendMessage(chatId, 'Сначала отправь локацию: /setlocation');
        return true;
      }

      try {
        const nowLocal = getNowInTimezone(location.timezone || env.defaultTimezone);
        const panchang = await this.panchangService.computePanchang({
          date: nowLocal.toDate(),
          timezone: location.timezone,
          lat: location.lat,
          lon: location.lon
        });
        await this.telegramApi.sendMessage(chatId, JSON.stringify(panchang, null, 2));
      } catch (error) {
        await this.telegramApi.sendMessage(chatId, `Не удалось посчитать панчангу: ${this.errorMessage(error)}`);
      }

      return true;
    }

    if (text === '/cancel' || text === CANCEL_TEXT) {
      await this.userStateRepo.clearState(userId);
      await this.telegramApi.sendMessage(chatId, 'Отменено.', {
        replyMarkup: removeKeyboard()
      });
      return true;
    }

    return false;
  }

  async handleTextAction(message: TelegramMessage, text: string): Promise<boolean> {
    const userId = message.from?.id;
    if (!userId) {
      return false;
    }

    if (text === BUTTON_JOIN) {
      await this.requestLocation(message.chat.id, userId, 'join_button');
      return true;
    }

    if (text === BUTTON_TODAY) {
      await this.handleToday(message.chat.id, userId, false);
      return true;
    }

    return false;
  }

  async handleLocationMessage(message: TelegramMessage): Promise<boolean> {
    const userId = message.from?.id;
    const location = message.location;
    if (!userId || !location) {
      return false;
    }

    const chatId = message.chat.id;
    const state = await this.userStateRepo.getByTelegramUserId(userId);
    const existing = await this.storage.getUserLocation(userId);
    const detectedTimezone = await this.detectTimezoneByCoordinates(location.latitude, location.longitude);
    const timezoneName = detectedTimezone ?? existing?.timezone ?? env.defaultTimezone;

    await this.storage.saveLocation({
      userId,
      chatId,
      lat: location.latitude,
      lon: location.longitude,
      timezone: timezoneName
    });

    await this.userStateRepo.clearState(userId);
    const source = typeof state?.payload?.source === 'string' ? state.payload.source : '';
    const detectedHint = detectedTimezone
      ? ''
      : `\nНе удалось точно определить таймзону по координатам, использую: ${timezoneName}. Можно изменить: /settimezone Europe/Moscow`;

    if (source === 'start' || source === 'join_button') {
      await this.telegramApi.sendMessage(
        chatId,
        `Локация сохранена: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}.\nТаймзона: ${timezoneName}.${detectedHint}\n\nПодключение завершено. Выбери действие кнопками ниже.`,
        { replyMarkup: controlKeyboard() }
      );
      return true;
    }

    await this.telegramApi.sendMessage(chatId, `Локация сохранена: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}.\nТаймзона: ${timezoneName}.${detectedHint}`, {
      replyMarkup: controlKeyboard()
    });

    return true;
  }

  async handleToday(chatId: number, userId: number, forceRefresh: boolean): Promise<void> {
    const location = await this.storage.getUserLocation(userId);
    if (!location || location.lat == null || location.lon == null) {
      await this.userStateRepo.upsertState(userId, 'WAITING_LOCATION');
      await this.telegramApi.sendMessage(chatId, 'Сначала нужна геолокация. Нажми кнопку ниже и отправь location.', {
        replyMarkup: locationKeyboard()
      });
      return;
    }

    const timezoneName = location.timezone || env.defaultTimezone;
    const nowLocal = getNowInTimezone(timezoneName);
    const dateLocal = nowLocal.format('YYYY-MM-DD');

    let panchangJson;
    try {
      panchangJson = await this.panchangService.computePanchang({
        date: nowLocal.toDate(),
        timezone: timezoneName,
        lat: location.lat,
        lon: location.lon
      });
    } catch {
      await this.telegramApi.sendMessage(chatId, 'Не удалось вычислить панчангу. Попробуй снова через /refresh.');
      return;
    }

    const theses = this.thesesService.mergeDefaults({
      tithiName: panchangJson.tithi.name,
      tithiNumber: panchangJson.tithi.number,
      nakshatraName: panchangJson.nakshatra.name,
      vara: panchangJson.vara
    });

    const cacheKey = this.storage.buildCacheKey({
      userId,
      dateLocal,
      lat: location.lat,
      lon: location.lon,
      timezone: timezoneName
    });

    if (!forceRefresh) {
      const cached = await this.storage.getCache(cacheKey);
      if (cached) {
        await this.telegramApi.sendMessage(chatId, cached);
        return;
      }
    }

    try {
      const llmText = await this.llmService.generateVedicDay(panchangJson, theses);
      const output = `${summaryBlock(dateLocal, panchangJson)}\n\n${llmText}`;
      await this.storage.setCache(cacheKey, output, this.storage.getEndOfLocalDayTs(timezoneName));
      await this.telegramApi.sendMessage(chatId, output);
    } catch (error) {
      if (error instanceof OpenRouterRateLimitError) {
        await this.telegramApi.sendMessage(chatId, 'Сейчас лимит LLM, попробуй позже.');
        return;
      }

      logger.error('OpenRouter generation failed', {
        userId,
        timezone: timezoneName,
        dateLocal,
        error: this.errorMessage(error)
      });

      const isDebugUser = env.nodeEnv !== 'production' || env.adminTelegramUserId === String(userId);
      const debugSuffix = isDebugUser ? `\n\nТех.детали: ${this.errorMessage(error)}` : '';
      await this.telegramApi.sendMessage(
        chatId,
        `${summaryBlock(dateLocal, panchangJson)}\n\nИнтерпретация временно недоступна. Попробуй /refresh позже.${debugSuffix}`
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private async detectTimezoneByCoordinates(lat: number, lon: number): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(
        `https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lon}`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { timeZone?: unknown };
      if (typeof payload.timeZone === 'string' && payload.timeZone.trim()) {
        return payload.timeZone.trim();
      }

      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestLocation(chatId: number, userId: number, source: 'start' | 'join_button' | 'setlocation'): Promise<void> {
    await this.userStateRepo.upsertState(userId, 'WAITING_LOCATION', { source });
    const text =
      source === 'setlocation'
        ? 'Отправь геолокацию'
        : 'Привет. Сначала отправь геолокацию, чтобы я определил таймзону и рассчитывал ведический день корректно.';
    await this.telegramApi.sendMessage(chatId, text, { replyMarkup: locationKeyboard() });
  }
}
