import express, { Request, Response } from 'express';
import { env } from './config/env';
import { TelegramWebhookController } from './controllers/TelegramWebhookController';
import { DeliveryLogRepo } from './repos/DeliveryLogRepo';
import { UserRepo } from './repos/UserRepo';
import { UserStateRepo } from './repos/UserStateRepo';
import { SchedulerService } from './scheduler/SchedulerService';
import { TelegramApi } from './services/TelegramApi';
import type { TelegramUpdate } from './types/telegram';
import { logger } from './utils/logger';
import { LlmService } from './vedic/llmService';
import { VedicHandlers } from './vedic/handlers';
import { VedicPanchangService } from './vedic/panchangService';
import { VedicStorage } from './vedic/storage';
import { VedicThesesService } from './vedic/vedicTheses';

const app = express();
app.use(express.json({ limit: '1mb' }));

const userRepo = new UserRepo();
const userStateRepo = new UserStateRepo();
const deliveryLogRepo = new DeliveryLogRepo();
const telegramApi = new TelegramApi(env.telegramBotToken);
const vedicStorage = new VedicStorage(userRepo);
const vedicPanchangService = new VedicPanchangService();
const vedicThesesService = new VedicThesesService();
const llmService = new LlmService();
const vedicHandlers = new VedicHandlers(
  telegramApi,
  userStateRepo,
  vedicStorage,
  vedicPanchangService,
  vedicThesesService,
  llmService
);

const telegramController = new TelegramWebhookController(
  telegramApi,
  userRepo,
  userStateRepo,
  vedicHandlers
);

const scheduler = new SchedulerService(userRepo, deliveryLogRepo, vedicHandlers);

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

app.post(['/telegram/webhook', '/telegram/webhook/:secret'], async (req: Request, res: Response) => {
  const secretFromPath = req.params.secret;
  const secretFromHeader = req.header('x-telegram-bot-api-secret-token');

  if (env.telegramWebhookSecret && secretFromPath !== env.telegramWebhookSecret) {
    res.status(403).json({ ok: false, error: 'Invalid webhook path secret' });
    return;
  }

  if (env.telegramWebhookToken && secretFromHeader !== env.telegramWebhookToken) {
    res.status(403).json({ ok: false, error: 'Invalid webhook token' });
    return;
  }

  const update = req.body as TelegramUpdate;
  res.status(200).json({ ok: true });

  void telegramController.handle(update).catch((error: unknown) => {
    logger.error('Async webhook processing failed', {
      error: error instanceof Error ? error.message : String(error),
      updateId: update.update_id
    });
  });
});

app.listen(env.port, () => {
  scheduler.start();
  logger.info('Server started', {
    port: env.port,
    mode: env.nodeEnv,
    defaultTimezone: env.defaultTimezone
  });
});
