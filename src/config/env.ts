import dotenv from 'dotenv';

dotenv.config();

const required = ['TELEGRAM_BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN as string,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  telegramWebhookToken: process.env.TELEGRAM_WEBHOOK_TOKEN,
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Amsterdam',
  supabaseUrl: process.env.SUPABASE_URL as string,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  defaultLat: Number(process.env.DEFAULT_LAT ?? 52.3676),
  defaultLon: Number(process.env.DEFAULT_LON ?? 4.9041)
};
