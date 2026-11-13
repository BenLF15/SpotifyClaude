import crypto from 'node:crypto';

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
const bool = (name, fallback) => {
  const v = env(name);
  return v === undefined ? fallback : !['false', '0', 'no', 'off'].includes(v.toLowerCase());
};

// Ohne SESSION_SECRET wird ein stabiler Schlüssel aus dem Client-Secret abgeleitet.
const derivedSecret = () =>
  crypto
    .createHash('sha256')
    .update(`session:${env('SPOTIFY_CLIENT_SECRET', '')}`)
    .digest('hex');

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
    scopes: [
      'user-read-recently-played', 'user-top-read', 'user-read-private', 'user-read-email',
      'user-read-currently-playing', 'playlist-modify-private',
    ],
  },
  // Neue Registrierungen erlauben (true/false)
  allowRegistration: bool('ALLOW_REGISTRATION', true),
  sessionSecret: env('SESSION_SECRET') || derivedSecret(),
  sessionDays: int('SESSION_DAYS', 30),
  timezone: env('TIMEZONE', 'Europe/Berlin'),
  enrichLimit: int('ENRICH_LIMIT', 150),
  minPlayMs: int('MIN_PLAY_MS', 30000),
  internalScheduler: bool('INTERNAL_SCHEDULER', true),
  syncIntervalMinutes: Math.max(5, int('SYNC_INTERVAL_MINUTES', 30)),
  keepAliveUrl: bool('KEEP_ALIVE', Boolean(externalUrl)) && externalUrl ? `${externalUrl}/healthz` : null,
  cronSecret: env('CRON_SECRET'),
  // Datenschutz: Angaben des Verantwortlichen (nur über Umgebungsvariablen, nie im Code)
  legal: {
    name: env('OPERATOR_NAME'),
    address: env('OPERATOR_ADDRESS'), // Zeilen mit „|“ oder „\n“ trennen
    email: env('OPERATOR_EMAIL'),
    phone: env('OPERATOR_PHONE'),
    hosting: env('HOSTING_PROVIDER', 'Render Services, Inc., 525 Brannan Street, San Francisco, CA 94107, USA'),
    database: env('DATABASE_PROVIDER'),
  },
  isProduction: env('NODE_ENV') === 'production' || Boolean(externalUrl),
};

export const REQUIRED_ENV = ['DATABASE_URL', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'];
export const missingEnv = () => REQUIRED_ENV.filter((n) => !env(n));

export function requireEnv(...names) {
  const missing = names.filter((n) => !env(n));
  if (missing.length) {
    throw new Error(`Fehlende Umgebungsvariable(n): ${missing.join(', ')}`);
  }
}
