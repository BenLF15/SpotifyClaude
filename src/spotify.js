// Spotify Web API: OAuth (Authorization Code Flow), Token-Refresh, API-Aufrufe mit Retry.
import { config, requireEnv } from './config.js';
import { query } from './db.js';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export class SpotifyNotConnectedError extends Error {
  constructor() {
    super('Spotify ist noch nicht verbunden. Bitte im Dashboard „Mit Spotify verbinden“ klicken.');
    this.code = 'NOT_CONNECTED';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function basicAuth() {
  requireEnv('SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET');
  return 'Basic ' + Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64');
}

export function authorizeUrl(state) {
  requireEnv('SPOTIFY_CLIENT_ID');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.spotify.clientId,
    scope: config.spotify.scopes.join(' '),
    redirect_uri: config.spotify.redirectUri,
    state,
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Token-Anfrage fehlgeschlagen (${res.status}): ${data.error_description || data.error || 'unbekannt'}`);
    err.status = res.status;
    err.spotifyError = data.error;
    throw err;
  }
  return data;
}

/** Tauscht den OAuth-Code gegen Tokens und speichert sie inkl. Profil. */
export async function exchangeCode(code) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.spotify.redirectUri });
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
  const meRes = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  const me = meRes.ok ? await meRes.json() : {};
  await query(
    `INSERT INTO spotify_auth (id, access_token, refresh_token, expires_at, scope, user_id, display_name, avatar_url, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at, scope = EXCLUDED.scope, user_id = EXCLUDED.user_id,
       display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url, updated_at = now()`,
    [t.access_token, t.refresh_token, expiresAt, t.scope, me.id || null, me.display_name || me.id || null, me.images?.[0]?.url || null],
  );
  return me;
}

export async function getAuthRow() {
  const { rows } = await query('SELECT * FROM spotify_auth WHERE id = 1');
  return rows[0] || null;
}

let refreshing = null;

/** Liefert ein gültiges Access-Token; erneuert es automatisch über das gespeicherte Refresh-Token. */
export async function getAccessToken({ force = false } = {}) {
  const row = await getAuthRow();
  if (!row) throw new SpotifyNotConnectedError();
  if (!force && row.access_token && row.expires_at && new Date(row.expires_at) > new Date()) {
    return row.access_token;
  }
  if (!refreshing) {
    refreshing = (async () => {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
      const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
      // Spotify liefert manchmal ein neues Refresh-Token (Rotation) – dann ersetzen.
      await query(
        `UPDATE spotify_auth SET access_token = $1, refresh_token = COALESCE($2, refresh_token),
           expires_at = $3, scope = COALESCE($4, scope), updated_at = now() WHERE id = 1`,
        [t.access_token, t.refresh_token || null, expiresAt, t.scope || null],
      );
      return t.access_token;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** GET gegen die Web API – mit Token-Refresh bei 401 und Backoff bei 429/5xx. */
export async function spotifyGet(pathOrUrl, { retries = 4 } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  let token = await getAccessToken();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return res.status === 204 ? null : res.json();

    if (attempt >= retries) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Spotify ${res.status} für ${url}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 401) {
      token = await getAccessToken({ force: true });
    } else if (res.status === 429) {
      const wait = Math.min(Number.parseInt(res.headers.get('retry-after') || '5', 10), 120);
      console.warn(`[spotify] Rate-Limit – warte ${wait}s`);
      await sleep(wait * 1000 + 250);
    } else if (res.status >= 500) {
      await sleep(1000 * 2 ** attempt);
    } else {
      const text = await res.text().catch(() => '');
      const err = new Error(`Spotify ${res.status} für ${url}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
  }
}

export const bestImage = (images) => {
  if (!Array.isArray(images) || !images.length) return null;
  // ~300px-Variante bevorzugen (gut für Karten, nicht zu groß)
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  return (sorted.find((i) => (i.width || 0) <= 320) || sorted[sorted.length - 1] || sorted[0]).url;
};
