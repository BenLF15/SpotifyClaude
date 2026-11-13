// Plattensammlung: Musiknoten (Bronze, Silber, Gold, Platin) verdienen, im wöchentlich wechselnden
// Plattenladen Schallplatten der Lieblingskünstler kaufen und im Plattenschrank sammeln.
//
// - Jede Platte (Album × Seltenheit) hat eine feste Kalenderwoche → sie kehrt jedes Jahr in derselben Woche zurück.
// - Noten-Gutschriften stehen in note_ledger; einmalige Belohnungen haben einen eindeutigen Schlüssel (idempotent).
import crypto from 'node:crypto';
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { milestones, MINUTE_STEPS, STREAK_STEPS, wrappedYears } from './features.js';
import { UserError } from './users.js';

export const TIERS = ['bronze', 'silver', 'gold', 'platinum'];
export const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const R = (bronze = 0, silver = 0, gold = 0, platinum = 0) => ({ bronze, silver, gold, platinum });

// ================================================================ Belohnungen
const MINUTE_REWARDS = {
  500: R(2), 1000: R(3), 2500: R(0, 1), 5000: R(0, 2), 10000: R(0, 0, 1), 25000: R(0, 0, 2),
  50000: R(0, 0, 3), 100000: R(0, 0, 0, 1), 250000: R(0, 0, 0, 2), 500000: R(0, 0, 0, 3), 1000000: R(0, 0, 0, 5),
};
const STREAK_REWARDS = {
  3: R(2), 7: R(0, 1), 14: R(0, 2), 30: R(0, 0, 1), 50: R(0, 0, 2), 100: R(0, 0, 0, 1), 200: R(0, 0, 0, 2), 365: R(0, 0, 0, 3),
};
const ARTIST_STEPS = { 25: R(0, 1), 100: R(0, 0, 1), 250: R(0, 0, 2), 500: R(0, 0, 0, 1) };
const COLLECTION_STEPS = { 1: R(2), 10: R(0, 1), 25: R(0, 0, 1), 50: R(0, 0, 0, 1) };
const ONCE = {
  starter: R(5, 2, 1), // Startguthaben beim ersten Öffnen
  spotify: R(3), // Spotify verbunden
  'birthday-set': R(0, 1), // Geburtstag eingetragen
  import: R(0, 0, 1), // Streaming-History importiert
  'friend-1': R(0, 1),
  'friend-5': R(0, 0, 1),
  'playlist-1': R(0, 1),
  'playlist-5': R(0, 0, 1),
  'legendary-1': R(0, 0, 1), // erste legendäre Platte
};
const RECURRING = {
  visit: R(1), // täglicher Besuch
  week: R(2), // Woche mit mindestens WEEK_GOAL Minuten
  discover: R(0, 1), // Monat mit mindestens DISCOVER_GOAL neuen Künstlern
  bday: R(0, 0, 1), // an deinem Geburtstag
  wrapped: R(0, 1), // Jahresrückblick bis zum Ende angesehen
};
export const WEEK_GOAL = 120;
export const DISCOVER_GOAL = 5;
const EXCHANGE_RATE = 4; // 4 × niedrigere Stufe = 1 × nächste Stufe

// Preise je Seltenheit (Noten-Stufe + Spanne)
const PRICE = { common: ['bronze', 2, 4], rare: ['silver', 1, 2], epic: ['gold', 1, 2], legendary: ['platinum', 1, 1] };
// Wie viele Alben es in welcher Seltenheit überhaupt gibt (Prozent)
const PRESENCE = { common: 100, rare: 60, epic: 30, legendary: 12 };
const SHOP_SIZE = 8;

// ================================================================ Hilfen
const hashInt = (s) => crypto.createHash('sha256').update(s).digest().readUInt32BE(0);

/** Lokales Datum (YYYY-MM-DD) in der konfigurierten Zeitzone. */
function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(d);
}

/** ISO-Kalenderwoche eines Datums 'YYYY-MM-DD' → { year, week }. */
export function isoWeek(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mo = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // Donnerstag derselben Woche
  const year = d.getUTCFullYear();
  const firstThu = new Date(Date.UTC(year, 0, 4));
  firstThu.setUTCDate(4 - ((firstThu.getUTCDay() + 6) % 7) + 3); // Donnerstag der KW 1
  const week = 1 + Math.round((d - firstThu) / (7 * 864e5));
  return { year, week };
}

function nextMonday(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() + (7 - dow));
  return d.toISOString().slice(0, 10);
}


// ================================================================ Platten-Pool (Alben der Lieblingskünstler)
async function albumPool(userId) {
  const { rows } = await query(
    `WITH fav AS (
       SELECT lower(t.artist_names[1]) AS k
         FROM plays pl JOIN tracks t ON t.id = pl.track_id
        WHERE pl.user_id = $1 AND t.artist_names[1] IS NOT NULL
        GROUP BY 1 ORDER BY sum(pl.ms_played) DESC LIMIT 25
     )
     SELECT lower(t.artist_names[1]) || '|' || lower(t.album_name) AS key,
            min(t.artist_names[1]) AS artist, min(t.album_name) AS album,
            (array_agg(t.album_id) FILTER (WHERE t.album_id IS NOT NULL))[1] AS album_id,
            (array_agg(t.album_image) FILTER (WHERE t.album_image IS NOT NULL))[1] AS image,
            count(*) AS plays
       FROM plays pl JOIN tracks t ON t.id = pl.track_id
      WHERE pl.user_id = $1 AND t.album_name IS NOT NULL AND t.album_name <> ''
        AND lower(t.artist_names[1]) IN (SELECT k FROM fav)
      GROUP BY 1`,
    [userId],
  );
  const items = [];
  for (const a of rows) {
    for (const rarity of RARITIES) {
      const seed = `${a.key}#${rarity}`;
      if (hashInt(`${seed}#presence`) % 100 >= PRESENCE[rarity]) continue;
      const [tier, lo, hi] = PRICE[rarity];
      items.push({
        id: `${crypto.createHash('sha1').update(a.key).digest('hex').slice(0, 12)}-${rarity}`,
        rarity,
        artist: a.artist,
        album: a.album,
        album_id: a.album_id,
        image: a.image,
        week: (hashInt(`${seed}#week`) % 52) + 1, // feste Kalenderwoche → kehrt jährlich wieder
        hue: hashInt(`${seed}#hue`) % 360, // Farbe für farbiges Vinyl
        price: { tier, amount: lo + (hashInt(`${seed}#price`) % (hi - lo + 1)) },
        tie: hashInt(`${seed}#tie`),
      });
    }
  }
  return items;
}

/** Angebot der Woche: Platten dieser Kalenderwoche, bei kleiner Sammlung ergänzt aus den nächstgelegenen Wochen. */
function weeklyShop(pool, week) {
  const dist = (w) => Math.min(Math.abs(w - week), 52 - Math.abs(w - week));
  const picked = [...pool].sort((a, b) => dist(a.week) - dist(b.week) || a.tie - b.tie).slice(0, SHOP_SIZE);
  return picked.sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || a.artist.localeCompare(b.artist));
}

// ================================================================ Belohnungen auswerten (idempotent)
async function facts(account) {
  const uid = account.spotify_user_id;
  const [ms, misc, weeks, months, coll] = await Promise.all([
    milestones(uid, []),
    query(
      `SELECT (SELECT count(*) FROM plays WHERE user_id = $1 AND source = 'import') AS imported,
              (SELECT count(DISTINCT lower(t.artist_names[1])) FROM plays pl JOIN tracks t ON t.id = pl.track_id WHERE pl.user_id = $1) AS artists,
              (SELECT count(*) FROM friendships WHERE status = 'accepted' AND (requester_id = $2 OR addressee_id = $2)) AS friends,
              (SELECT count(*) FROM created_playlists WHERE account_id = $2) AS playlists,
              (SELECT notes_started_at FROM accounts WHERE id = $2) AS started`,
      [uid, account.id],
    ),
    // Minuten je ISO-Woche seit Start des Notensystems
    query(
      `SELECT to_char(date_trunc('week', pl.played_at AT TIME ZONE $1), 'IYYY-"W"IW') AS w,
              round(sum(pl.ms_played) / 60000.0)::int AS minutes
         FROM plays pl
        WHERE pl.user_id = $2
          AND pl.played_at >= date_trunc('week', COALESCE((SELECT notes_started_at FROM accounts WHERE id = $3), now()) AT TIME ZONE $1) AT TIME ZONE $1
        GROUP BY 1`,
      [config.timezone, uid, account.id],
    ),
    // Neue Künstler je Monat seit Start des Notensystems
    query(
      `WITH firsts AS (
         SELECT lower(t.artist_names[1]) AS k, min(pl.played_at) AS first
           FROM plays pl JOIN tracks t ON t.id = pl.track_id WHERE pl.user_id = $2 GROUP BY 1
       )
       SELECT to_char(first AT TIME ZONE $1, 'YYYY-MM') AS m, count(*) AS n FROM firsts
        WHERE first >= date_trunc('month', COALESCE((SELECT notes_started_at FROM accounts WHERE id = $3), now()) AT TIME ZONE $1) AT TIME ZONE $1
        GROUP BY 1`,
      [config.timezone, uid, account.id],
    ),
    query(`SELECT count(*) AS n, count(*) FILTER (WHERE rarity = 'legendary') AS legendary FROM record_collection WHERE account_id = $1`, [account.id]),
  ]);
  return { ms, ...misc.rows[0], weeks: weeks.rows, months: months.rows, collection: coll.rows[0] };
}

function eligibleAwards(account, f) {
  const out = [];
  const add = (key, reward) => out.push({ key, ...reward });
  const today = localDate();
  add('starter', ONCE.starter);
  add('spotify', ONCE.spotify);
  if (account.birthday) add('birthday-set', ONCE['birthday-set']);
  if (f.imported > 0) add('import', ONCE.import);
  if (f.friends >= 1) add('friend-1', ONCE['friend-1']);
  if (f.friends >= 5) add('friend-5', ONCE['friend-5']);
  if (f.playlists >= 1) add('playlist-1', ONCE['playlist-1']);
  if (f.playlists >= 5) add('playlist-5', ONCE['playlist-5']);
  if (f.collection.legendary >= 1) add('legendary-1', ONCE['legendary-1']);
  for (const m of f.ms.items) {
    if (!m.achieved) continue;
    if (m.kind === 'minutes' && MINUTE_REWARDS[m.value]) add(`min-${m.value}`, MINUTE_REWARDS[m.value]);
    if (m.kind === 'streak' && STREAK_REWARDS[m.value]) add(`streak-${m.value}`, STREAK_REWARDS[m.value]);
  }
  for (const [n, r] of Object.entries(ARTIST_STEPS)) if (f.artists >= Number(n)) add(`artists-${n}`, r);
  for (const [n, r] of Object.entries(COLLECTION_STEPS)) if (f.collection.n >= Number(n)) add(`coll-${n}`, r);
  add(`visit:${today}`, RECURRING.visit);
  for (const w of f.weeks) if (w.minutes >= WEEK_GOAL) add(`week:${w.w}`, RECURRING.week);
  for (const m of f.months) if (m.n >= DISCOVER_GOAL) add(`discover:${m.m}`, RECURRING.discover);
  if (account.birthday && account.birthday.slice(5) === today.slice(5)) add(`bday:${today.slice(0, 4)}`, RECURRING.bday);
  return out;
}

async function grant(accountId, awards) {
  if (!awards.length) return [];
  const { rows } = await query(
    `INSERT INTO note_ledger (account_id, key, bronze, silver, gold, platinum)
     SELECT $1, a.key, a.bronze, a.silver, a.gold, a.platinum
       FROM jsonb_to_recordset($2::jsonb) AS a(key text, bronze int, silver int, gold int, platinum int)
     ON CONFLICT (account_id, key) WHERE key IS NOT NULL DO NOTHING
     RETURNING key, bronze, silver, gold, platinum, created_at`,
    [accountId, JSON.stringify(awards)],
  );
  return rows;
}

/** Prüft alle Belohnungen und schreibt neue gut. Gibt die neu erhaltenen zurück. */
export async function evaluate(account) {
  await query('UPDATE accounts SET notes_started_at = now() WHERE id = $1 AND notes_started_at IS NULL', [account.id]);
  const f = await facts(account);
  const fresh = await grant(account.id, eligibleAwards(account, f));
  return { fresh, facts: f };
}

// ================================================================ Übersicht (Kontostand, Laden, Sammlung, Quellen)
async function balanceOf(accountId, db = { query }) {
  const { rows } = await db.query(
    `SELECT COALESCE(sum(bronze), 0)::int AS bronze, COALESCE(sum(silver), 0)::int AS silver,
            COALESCE(sum(gold), 0)::int AS gold, COALESCE(sum(platinum), 0)::int AS platinum
       FROM note_ledger WHERE account_id = $1`,
    [accountId],
  );
  return rows[0];
}

function sources(account, f, earned) {
  const has = new Map(earned.map((r) => [r.key, r.created_at]));
  const today = localDate();
  const { year, week } = isoWeek(today);
  const thisWeek = `${year}-W${String(week).padStart(2, '0')}`;
  const thisMonth = today.slice(0, 7);
  const once = (key, group, cur = null, goal = null) => ({ key, group, reward: ONCE[key], done: has.has(key), at: has.get(key) || null, cur, goal });
  const list = [
    once('starter', 'start'),
    once('spotify', 'start'),
    once('birthday-set', 'start'),
    once('import', 'start'),
    once('friend-1', 'social', Math.min(f.friends, 1), 1),
    once('friend-5', 'social', Math.min(f.friends, 5), 5),
    once('playlist-1', 'social', Math.min(f.playlists, 1), 1),
    once('playlist-5', 'social', Math.min(f.playlists, 5), 5),
    ...MINUTE_STEPS.filter((n) => MINUTE_REWARDS[n]).map((n) => ({
      key: `min-${n}`, group: 'minutes', reward: MINUTE_REWARDS[n], done: has.has(`min-${n}`), at: has.get(`min-${n}`) || null,
      cur: Math.min(f.ms.totalMinutes, n), goal: n,
    })),
    ...STREAK_STEPS.filter((n) => STREAK_REWARDS[n]).map((n) => ({
      key: `streak-${n}`, group: 'streak', reward: STREAK_REWARDS[n], done: has.has(`streak-${n}`), at: has.get(`streak-${n}`) || null,
      cur: Math.min(f.ms.bestStreak, n), goal: n,
    })),
    ...Object.entries(ARTIST_STEPS).map(([n, r]) => ({
      key: `artists-${n}`, group: 'variety', reward: r, done: has.has(`artists-${n}`), at: has.get(`artists-${n}`) || null, cur: Math.min(f.artists, Number(n)), goal: Number(n),
    })),
    ...Object.entries(COLLECTION_STEPS).map(([n, r]) => ({
      key: `coll-${n}`, group: 'collector', reward: r, done: has.has(`coll-${n}`), at: has.get(`coll-${n}`) || null, cur: Math.min(f.collection.n, Number(n)), goal: Number(n),
    })),
    once('legendary-1', 'collector', Math.min(f.collection.legendary, 1), 1),
    { key: 'visit', group: 'recurring', reward: RECURRING.visit, done: has.has(`visit:${today}`), at: has.get(`visit:${today}`) || null },
    { key: 'week', group: 'recurring', reward: RECURRING.week, done: has.has(`week:${thisWeek}`), at: has.get(`week:${thisWeek}`) || null,
      cur: Math.min(f.weeks.find((w) => w.w === thisWeek)?.minutes || 0, WEEK_GOAL), goal: WEEK_GOAL },
    { key: 'discover', group: 'recurring', reward: RECURRING.discover, done: has.has(`discover:${thisMonth}`), at: has.get(`discover:${thisMonth}`) || null,
      cur: Math.min(f.months.find((m) => m.m === thisMonth)?.n || 0, DISCOVER_GOAL), goal: DISCOVER_GOAL },
    { key: 'bday', group: 'recurring', reward: RECURRING.bday, done: has.has(`bday:${today.slice(0, 4)}`), at: has.get(`bday:${today.slice(0, 4)}`) || null, birthday: account.birthday || null },
    { key: 'wrapped', group: 'recurring', reward: RECURRING.wrapped, done: earned.some((r) => r.key.startsWith('wrapped:')), at: null },
  ];
  return list;
}

export async function overviewFor(account) {
  const { fresh, facts: f } = await evaluate(account);
  const today = localDate();
  const { year, week } = isoWeek(today);
  const [balance, ledger, collection, pool] = await Promise.all([
    balanceOf(account.id),
    query(
      `SELECT key, bronze, silver, gold, platinum, created_at FROM note_ledger WHERE account_id = $1 ORDER BY created_at DESC, id DESC`,
      [account.id],
    ),
    query(
      `SELECT record_id AS id, rarity, artist, album, album_id, image, hue, week, price, acquired_at
         FROM record_collection WHERE account_id = $1 ORDER BY acquired_at DESC`,
      [account.id],
    ),
    albumPool(account.spotify_user_id),
  ]);
  const owned = new Set(collection.rows.map((r) => r.id));
  const shop = weeklyShop(pool, week).map(({ tie, ...it }) => ({ ...it, owned: owned.has(it.id) }));
  return {
    balance,
    fresh,
    week: { year, week, resetsOn: nextMonday(today) },
    shop,
    poolSize: pool.length,
    collection: collection.rows,
    sources: sources(account, f, ledger.rows.filter((r) => r.key && !r.key.startsWith('buy:'))),
    ledger: ledger.rows.slice(0, 25),
    exchangeRate: EXCHANGE_RATE,
  };
}

// ================================================================ Kaufen & Tauschen
export async function buy(account, recordId) {
  const today = localDate();
  const { week } = isoWeek(today);
  const pool = await albumPool(account.spotify_user_id);
  const item = weeklyShop(pool, week).find((it) => it.id === String(recordId));
  if (!item) throw new UserError('Diese Platte gibt es diese Woche nicht.', 404, 'recordNotInShop');
  const result = await withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [900000 + Number(account.id)]);
    const { rows: own } = await db.query('SELECT 1 FROM record_collection WHERE account_id = $1 AND record_id = $2', [account.id, item.id]);
    if (own.length) throw new UserError('Diese Platte hast du schon.', 409, 'recordOwned');
    const bal = await balanceOf(account.id, db);
    if (bal[item.price.tier] < item.price.amount) throw new UserError('Nicht genug Noten.', 400, 'notEnoughNotes');
    const cost = R();
    cost[item.price.tier] = -item.price.amount;
    await db.query(
      'INSERT INTO note_ledger (account_id, key, bronze, silver, gold, platinum) VALUES ($1, $2, $3, $4, $5, $6)',
      [account.id, `buy:${item.id}`, cost.bronze, cost.silver, cost.gold, cost.platinum],
    );
    await db.query(
      `INSERT INTO record_collection (account_id, record_id, rarity, artist, album, album_id, image, hue, week, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [account.id, item.id, item.rarity, item.artist, item.album, item.album_id, item.image, item.hue, item.week, JSON.stringify(item.price)],
    );
    return item;
  });
  // Sammler-Belohnungen sofort prüfen
  const { fresh } = await evaluate(account);
  return { record: result, fresh, balance: await balanceOf(account.id) };
}

export async function exchange(account, from) {
  const i = TIERS.indexOf(from);
  if (i < 0 || i >= TIERS.length - 1) throw new UserError('Ungültiger Tausch.', 400, 'invalidSetting');
  const to = TIERS[i + 1];
  await withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [900000 + Number(account.id)]);
    const bal = await balanceOf(account.id, db);
    if (bal[from] < EXCHANGE_RATE) throw new UserError('Nicht genug Noten.', 400, 'notEnoughNotes');
    const d = R();
    d[from] = -EXCHANGE_RATE;
    d[to] = 1;
    await db.query(
      'INSERT INTO note_ledger (account_id, key, bronze, silver, gold, platinum) VALUES ($1, NULL, $2, $3, $4, $5)',
      [account.id, d.bronze, d.silver, d.gold, d.platinum],
    );
  });
  return { balance: await balanceOf(account.id) };
}

/** Ereignisse aus dem Frontend, z. B. Jahresrückblick bis zum Ende angesehen. */
export async function event(account, { type, year }) {
  if (type === 'wrapped') {
    const y = Number(year);
    const years = await wrappedYears(account.spotify_user_id);
    if (!years.includes(y)) throw new UserError('Ungültig.', 400, 'invalidSetting');
    return { fresh: await grant(account.id, [{ key: `wrapped:${y}`, ...RECURRING.wrapped }]), balance: await balanceOf(account.id) };
  }
  throw new UserError('Ungültig.', 400, 'invalidSetting');
}
