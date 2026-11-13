// Spotify Web API: OAuth (Authorization Code Flow), Token-Refresh pro Nutzer, API-Aufrufe mit Retry.
import { config, requireEnv } from './config.js';
import { query } from './db.js';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export class SpotifyAuthError extends Error {
  constructor(message) {
    super(message || 'Die Spotify-Verbindung ist abgelaufen. Bitte melde dich neu an.');
    this.code = 'AUTH_EXPIRED';
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

/**
 * Tauscht den OAuth-Code gegen Tokens und lädt das Profil (/me).
 * Gibt { tokens, profile } zurück – das Speichern übernimmt users.js.
 */
export async function exchangeCode(code) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.spotify.redirectUri });
  const meRes = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  if (!meRes.ok) {
    const err = new Error(`Spotify-Profil konnte nicht geladen werden (${meRes.status})`);
    err.status = meRes.status;
    // 403 im Development Mode: Nutzer ist nicht im "User Management" der Spotify-App eingetragen.
    err.spotifyError = meRes.status === 403 ? 'user_not_registered' : 'profile_failed';
    throw err;
  }
  const profile = await meRes.json();
  return {
    tokens: {
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000),
      scope: t.scope,
    },
    profile,
  };
}

const refreshing = new Map();

/** Liefert ein gültiges Access-Token des Nutzers; erneuert es automatisch über das Refresh-Token. */
export async function getAccessToken(userId, { force = false } = {}) {
  const { rows } = await query('SELECT access_token, refresh_token, expires_at, auth_error FROM users WHERE id = $1', [userId]);
  const row = rows[0];
  if (!row) throw new SpotifyAuthError('Unbekannter Nutzer.');
  if (row.auth_error) throw new SpotifyAuthError();
  if (!force && row.access_token && row.expires_at && new Date(row.expires_at) > new Date()) {
    return row.access_token;
  }
  if (!refreshing.has(userId)) {
    const p = (async () => {
      try {
        const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
        const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
        // Spotify rotiert Refresh-Tokens gelegentlich – dann ersetzen.
        await query(
          `UPDATE users SET access_token = $2, refresh_token = COALESCE($3, refresh_token),
             expires_at = $4, scope = COALESCE($5, scope), updated_at = now() WHERE id = $1`,
          [userId, t.access_token, t.refresh_token || null, expiresAt, t.scope || null],
        );
        return t.access_token;
      } catch (err) {
        if (err.spotifyError === 'invalid_grant') {
          // Zugriff widerrufen oder Token abgelaufen → bis zum nächsten Login nicht mehr versuchen.
          await query('UPDATE users SET auth_error = $2, updated_at = now() WHERE id = $1', [userId, err.message]);
          throw new SpotifyAuthError();
        }
        throw err;
      }
    })().finally(() => refreshing.delete(userId));
    refreshing.set(userId, p);
  }
  return refreshing.get(userId);
}

/** GET gegen die Web API im Namen eines Nutzers – mit Token-Refresh bei 401 und Backoff bei 429/5xx. */
export function spotifyGet(userId, pathOrUrl, opts = {}) {
  return spotifyRequest(userId, 'GET', pathOrUrl, undefined, opts);
}

/** POST (JSON) gegen die Web API, z. B. Playlist anlegen. */
export function spotifyPost(userId, pathOrUrl, body, opts = {}) {
  return spotifyRequest(userId, 'POST', pathOrUrl, body, { retries: 2, ...opts });
}

async function spotifyRequest(userId, method, pathOrUrl, body, { retries = 4 } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  let token = await getAccessToken(userId);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.ok) {
      if (res.status === 204) return null;
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }

    if (attempt >= retries) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Spotify ${res.status} für ${url}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 401) {
      token = await getAccessToken(userId, { force: true });
    } else if (res.status === 429 && method !== 'GET' && attempt >= 1) {
      const err = new Error('Spotify-Rate-Limit');
      err.status = 429;
      throw err;
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

/** Fehlende Berechtigungen (Scopes) eines Nutzers – z. B. nach neuen Funktionen. */
export function missingScopes(scopeString, needed) {
  const have = new Set(String(scopeString || '').split(/\s+/).filter(Boolean));
  return needed.filter((sc) => !have.has(sc));
}
