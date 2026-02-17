import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { env } from '../config/env';
import { DeliveryLogRepo } from '../repos/DeliveryLogRepo';
import { UserRepo } from '../repos/UserRepo';
import { DailyMessageService } from '../services/DailyMessageService';
import { TelegramApi } from '../services/TelegramApi';
import type { DeliveryType, UserRecord } from '../types/domain';
import { logger } from '../utils/logger';
import { isoDateInTimezone } from '../utils/time';

dayjs.extend(utc);
dayjs.extend(timezone);

export class SchedulerService {
  constructor(
    private readonly userRepo: UserRepo,
    private readonly deliveryLogRepo: DeliveryLogRepo,
    private readonly telegramApi: TelegramApi,
    private readonly dailyMessageService: DailyMessageService
  ) {}

  start(): void {
    cron.schedule('* * * * *', () => {
      this.tick().catch((error) => {
        logger.error('Scheduler tick failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });

    logger.info('Scheduler started');
  }

  async tick(): Promise<void> {
    const users = await this.userRepo.getActiveUsers();
    for (const user of users) {
      await this.processUser(user);
    }
  }

  private async processUser(user: UserRecord): Promise<void> {
    const timezoneName = user.timezone || env.defaultTimezone;
    const nowTz = dayjs().tz(timezoneName);
    const hhmm = nowTz.format('HH:mm');

    if (user.morning_time && user.morning_time === hhmm) {
      const targetDate = nowTz.toDate();
      await this.processDelivery(user, 'MORNING', targetDate, 'TODAY');
    }

    if (user.evening_time && user.evening_time === hhmm) {
      const targetDate = nowTz.add(1, 'day').toDate();
      await this.processDelivery(user, 'EVENING', targetDate, 'TOMORROW');
    }
  }

  private async processDelivery(
    user: UserRecord,
    deliveryType: DeliveryType,
    targetDate: Date,
    mode: 'TODAY' | 'TOMORROW'
  ): Promise<void> {
    const timezoneName = user.timezone || env.defaultTimezone;
    const targetDateISO = isoDateInTimezone(targetDate, timezoneName);

    const reserve = await this.deliveryLogRepo.reserveIfNotExists({
      userId: user.id,
      deliveryType,
      targetDateISO,
      scheduledForISO: new Date().toISOString()
    });

    if (!reserve.reserved || !reserve.logId) {
      return;
    }

    try {
      const message = await this.dailyMessageService.buildMessage({
        date: targetDate,
        timezone: timezoneName,
        mode
      });

      await this.telegramApi.sendMessage(user.telegram_chat_id, message);
      await this.deliveryLogRepo.updateStatus(reserve.logId, 'SENT', null);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      await this.deliveryLogRepo.updateStatus(reserve.logId, 'FAILED', errorText);

      logger.error('Delivery failed', {
        userId: user.id,
        deliveryType,
        targetDateISO,
        error: errorText
      });
    }
  }
}
