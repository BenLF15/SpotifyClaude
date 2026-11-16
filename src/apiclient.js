// Gemeinsamer JSON-Abruf für externe Musikdienste (Deezer, iTunes, Wikidata, Last.fm).
// Deezer erlaubt nur ~50 Anfragen pro 5 Sekunden und IP. Cover-Nachladen, Bekanntheits-Messung und Hörproben
// teilen sich deshalb EINE Warteschlange: höchstens ~8 Deezer-Anfragen pro Sekunde, und was ein Nutzer gerade
// anklickt (Hörprobe), wird vor Hintergrundarbeit vorgezogen. Deezers Fehlerantwort „Quota“ (HTTP 200 mit
// { error: { code: 4 } }) gilt als Rate-Limit, damit sie nicht als „nicht gefunden“ missverstanden wird.

const DEEZER_GAP_MS = 125; // 8 pro Sekunde → 40 in 5 s, mit Luft unter Deezers Grenze
const queue = { high: [], low: [] };
let busy = false;
let last = 0;
let pausedUntil = 0;

function pump() {
  if (busy) return;
  const next = queue.high.shift() || queue.low.shift();
  if (!next) return;
  busy = true;
  const wait = Math.max(0, last + DEEZER_GAP_MS - Date.now(), pausedUntil - Date.now());
  setTimeout(() => {
    last = Date.now();
    busy = false;
    next();
    pump();
  }, wait);
}

function deezerSlot(priority) {
  return new Promise((resolve) => { (priority === 'high' ? queue.high : queue.low).push(resolve); pump(); });
}

/**
 * JSON von einem externen Dienst holen.
 * @param {string} url
 * @param {{ headers?: object, timeout?: number, priority?: 'high'|'low' }} opts
 */
export async function getJSON(url, { headers = {}, timeout = 10_000, priority = 'low' } = {}) {
  const isDeezer = /^https:\/\/api\.deezer\.com\//.test(url);
  for (let attempt = 0; ; attempt++) {
    if (isDeezer) await deezerSlot(priority);
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json', ...headers } });
    let quota = res.status === 429;
    let data = null;
    if (!quota) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      quota = isDeezer && data?.error?.code === 4;
    }
    if (!quota) {
      if (isDeezer && data?.error) throw new Error(`Deezer: ${data.error.message || data.error.type || 'Fehler'}`);
      return data;
    }
    // Rate-Limit: alle Deezer-Anfragen kurz pausieren; Hörproben (high) einmal erneut versuchen
    if (isDeezer) pausedUntil = Date.now() + 5500;
    if (priority === 'high' && attempt < 1) continue;
    const e = new Error('Rate-Limit');
    e.status = 429;
    throw e;
  }
}
