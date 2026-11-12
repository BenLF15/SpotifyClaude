// Zentrale Konfiguration – alle Secrets kommen ausschließlich aus Umgebungsvariablen.

function env(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name, fallback) {
  const n = Number.parseInt(env(name, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

const externalUrl = env('RENDER_EXTERNAL_URL', '').replace(/\/$/, '');

export const config = {
  port: int('PORT', 3000),
  databaseUrl: env('DATABASE_URL'),
  spotify: {
    clientId: env('SPOTIFY_CLIENT_ID'),
    clientSecret: env('SPOTIFY_CLIENT_SECRET'),
    redirectUri: env(
      'SPOTIFY_REDIRECT_URI',
      externalUrl ? `${externalUrl}/auth/callback` : `http://127.0.0.1:${int('PORT', 3000)}/auth/callback`,
    ),
    scopes: ['user-read-recently-played', 'user-top-read', 'user-read-private'],
  },
  appPassword: env('APP_PASSWORD'),
  sessionSecret: env('SESSION_SECRET'),
  sessionDays: int('SESSION_DAYS', 30),
  timezone: env('TIMEZONE', 'Europe/Berlin'),
  enrichLimit: int('ENRICH_LIMIT', 150),
  minPlayMs: int('MIN_PLAY_MS', 30000),
  isProduction: env('NODE_ENV') === 'production' || Boolean(externalUrl),
};

export function requireEnv(...names) {
  const missing = names.filter((n) => !env(n));
  if (missing.length) {
    throw new Error(`Fehlende Umgebungsvariable(n): ${missing.join(', ')}`);
  }
}
