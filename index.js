// Oude manier (NIET MEER GEBRUIKEN):
// const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Nieuwe manier:
const PROXY_URL = 'https://twemcwgovtyzyhkfpvds.supabase.co/functions/v1/bot-runner-proxy';
const BOT_RUNNER_API_KEY = process.env.BOT_RUNNER_API_KEY;

// Alle bots ophalen
const response = await fetch(`${PROXY_URL}/bots`, {
  headers: { 'x-bot-runner-key': BOT_RUNNER_API_KEY }
});
const bots = await response.json();

// Bot status updaten
await fetch(`${PROXY_URL}/bots/${botId}`, {
  method: 'PATCH',
  headers: {
    'x-bot-runner-key': BOT_RUNNER_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ status: 'online', servers: 5 })
});

// Token ophalen voor bot login
const tokenRes = await fetch(`${PROXY_URL}/decrypt-token`, {
  method: 'POST',
  headers: {
    'x-bot-runner-key': BOT_RUNNER_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ bot_id: botId })
});
const { token } = await tokenRes.json();
