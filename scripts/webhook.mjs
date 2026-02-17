import dotenv from 'dotenv';

dotenv.config();

const action = process.argv[2];
const baseUrlArg = process.argv[3];

const token = process.env.TELEGRAM_BOT_TOKEN;
const pathSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const headerSecret = process.env.TELEGRAM_WEBHOOK_TOKEN;

if (!token) {
  throw new Error('Missing TELEGRAM_BOT_TOKEN in .env');
}

const apiBase = `https://api.telegram.org/bot${token}`;

async function callTelegram(method, body) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(payload)}`);
  }

  console.log(JSON.stringify(payload, null, 2));
}

function buildWebhookUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error('Usage: npm run webhook:set -- https://your-domain.com');
  }

  const trimmed = baseUrl.replace(/\/$/, '');
  const url = pathSecret ? `${trimmed}/telegram/webhook/${pathSecret}` : `${trimmed}/telegram/webhook`;
  return url;
}

async function main() {
  if (action === 'set') {
    const url = buildWebhookUrl(baseUrlArg);
    await callTelegram('setWebhook', {
      url,
      ...(headerSecret ? { secret_token: headerSecret } : {})
    });
    return;
  }

  if (action === 'info') {
    await callTelegram('getWebhookInfo');
    return;
  }

  if (action === 'delete') {
    await callTelegram('deleteWebhook', {
      drop_pending_updates: false
    });
    return;
  }

  throw new Error('Usage: npm run webhook:set -- <base-url> | npm run webhook:info | npm run webhook:delete');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
