# Namaste Telegram Bot

Production-ready Telegram-бот на Node.js + TypeScript + Express + Supabase.

Бот:
- проводит онбординг (`/start` + кнопка `Присоединиться`),
- сохраняет расписание утро/вечер в Supabase,
- отправляет сообщения 2 раза в день (утро: на сегодня, вечер: на завтра),
- формирует контент детерминированно по JSON-правилам (без LLM),
- использует дедупликацию отправок через `delivery_logs.dedupe_key`.

## Стек

- Node.js 20+
- TypeScript
- Express
- Supabase (Postgres)
- `@supabase/supabase-js`
- `node-cron`
- `@bidyashish/panchang`

## Структура

- `src/server.ts` — HTTP сервер и маршруты
- `src/controllers` — обработка Telegram update
- `src/repos` — доступ к таблицам Supabase
- `src/services` — Moon/Panchang/Composer/Telegram API
- `src/scheduler` — cron раз в минуту
- `src/content/rules` — справочники контента
- `migrations/schema.sql` — SQL для Supabase

## ENV

Скопируй `.env.example` в `.env` и заполни:

- `PORT` — порт приложения (по умолчанию `3000`)
- `TELEGRAM_BOT_TOKEN` — токен бота
- `TELEGRAM_WEBHOOK_SECRET` — секрет в URL webhook
- `TELEGRAM_WEBHOOK_TOKEN` — секретный заголовок от Telegram (опционально)
- `DEFAULT_TIMEZONE` — системная таймзона (по умолчанию `Europe/Amsterdam`)
- `SUPABASE_URL` — URL проекта Supabase
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (только backend)
- `DEFAULT_LAT`, `DEFAULT_LON` — координаты по умолчанию для Panchang

## Запуск локально (Node)

1. Установить зависимости:
```bash
npm install
```

2. Применить SQL из `migrations/schema.sql` в Supabase SQL Editor.

3. Запустить dev:
```bash
npm run dev
```

4. Проверить health:
```bash
curl http://localhost:3000/health
```

## Запуск в Docker

1. Создай `.env`.
2. Собери образ:
```bash
docker compose build
```

3. Запусти:
```bash
docker compose up -d
```

4. Логи:
```bash
docker compose logs -f bot
```

5. Остановить:
```bash
docker compose down
```

## Как подключить Supabase

1. Создай проект в Supabase.
2. Открой `SQL Editor` и выполни SQL из `migrations/schema.sql`.
3. В `Project Settings -> API` скопируй:
- `Project URL` -> `SUPABASE_URL`
- `service_role` key -> `SUPABASE_SERVICE_ROLE_KEY`
4. Заполни эти значения в `.env`.
5. Проверь соединение запуском бота и командой `/start` в Telegram.

Важно:
- Используй только `service_role` ключ на backend.
- Не публикуй `SUPABASE_SERVICE_ROLE_KEY` во фронтенде.

## Как подключить Telegram-бота

1. В `@BotFather` создай бота: `/newbot`.
2. Сохрани токен -> `TELEGRAM_BOT_TOKEN`.
3. Подними приложение на публичном HTTPS-домене.
4. Придумай:
- `TELEGRAM_WEBHOOK_SECRET` (секрет в URL)
- `TELEGRAM_WEBHOOK_TOKEN` (секретный заголовок, опционально, но рекомендуется)
5. Установи webhook:
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>",
    "secret_token": "<TELEGRAM_WEBHOOK_TOKEN>"
  }'
```

6. Проверка webhook:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

В `getWebhookInfo` должно быть:
- `url` с твоим доменом,
- пустой `last_error_message`.

## Упрощенные команды webhook

В проект добавлены npm-скрипты для webhook:

1. Установить webhook:
```bash
npm run webhook:set -- https://your-domain.com
```

2. Проверить статус webhook:
```bash
npm run webhook:info
```

3. Удалить webhook:
```bash
npm run webhook:delete
```

Скрипты читают `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_TOKEN` из `.env`.

## Команды бота

- `/start` — приветствие + кнопка «Присоединиться»
- `/settings` — текущее расписание и кнопки управления
- `/stop` — выключить рассылку
- `/resume` — включить рассылку
- `/today` — ручное сообщение на сегодня
- `/tomorrow` — ручной анонс на завтра

## Деплой (минимально)

1. Деплой сервиса (Render/Railway/Fly.io/VPS) с Docker или Node runtime.
2. Пропиши ENV.
3. Примени `migrations/schema.sql` в Supabase.
4. Поставь webhook на публичный HTTPS URL.
5. Проверь `/health`, потом `/start`, `/today`, `/tomorrow`.

## Примечания

- Тексты сообщений не используют LLM.
- Если Moon API недоступен, сообщение формируется без лунного блока (с явным уведомлением).
- Для Panchang используется пакет `@bidyashish/panchang`; при ошибке вызова применяется детерминированный fallback.
- Дисклеймер в каждом сообщении: `Наблюдай самочувствие; это не медицинская рекомендация.`
