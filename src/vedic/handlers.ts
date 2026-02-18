import { env } from '../config/env';
import { UserStateRepo } from '../repos/UserStateRepo';
import { TelegramApi } from '../services/TelegramApi';
import type { TelegramMessage } from '../types/telegram';
import { getNowInTimezone } from '../utils/time';
import { LlmService, OpenRouterRateLimitError } from './llmService';
import { VedicPanchangService } from './panchangService';
import { VedicStorage } from './storage';
import { VedicThesesService } from './vedicTheses';

const CANCEL_TEXT = 'Отмена';

function removeKeyboard() {
  return { remove_keyboard: true } as const;
}

function locationKeyboard() {
  return {
    keyboard: [[{ text: 'Send location', request_location: true }], [{ text: CANCEL_TEXT }]],
    resize_keyboard: true,
    one_time_keyboard: true
  } as const;
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

    if (text === '/setlocation') {
      await this.userStateRepo.upsertState(userId, 'WAITING_LOCATION');
      await this.telegramApi.sendMessage(chatId, 'Отправь геолокацию', {
        replyMarkup: locationKeyboard()
      });
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

  async handleLocationMessage(message: TelegramMessage): Promise<boolean> {
    const userId = message.from?.id;
    const location = message.location;
    if (!userId || !location) {
      return false;
    }

    const chatId = message.chat.id;
    const existing = await this.storage.getUserLocation(userId);
    const timezoneName = existing?.timezone || env.defaultTimezone;

    await this.storage.saveLocation({
      userId,
      chatId,
      lat: location.latitude,
      lon: location.longitude,
      timezone: timezoneName
    });

    await this.userStateRepo.clearState(userId);
    const tzHelp =
      timezoneName === env.defaultTimezone
        ? `\nТаймзона пока установлена как ${timezoneName}. Если она другая, задай: /settimezone Europe/Moscow`
        : '';

    await this.telegramApi.sendMessage(
      chatId,
      `Локация сохранена: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}.\nТаймзона: ${timezoneName}.${tzHelp}`,
      { replyMarkup: removeKeyboard() }
    );

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

      await this.telegramApi.sendMessage(
        chatId,
        `${summaryBlock(dateLocal, panchangJson)}\n\nИнтерпретация временно недоступна. Попробуй /refresh позже.`
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
