// Plattensammlung: Musiknoten (Bronze, Silber, Gold, Platin) verdienen, im wöchentlich wechselnden
// Plattenladen Schallplatten der Lieblingskünstler kaufen und im Plattenschrank sammeln.
//
// - Der Laden zeigt jede Woche (ab Montag) eine neue Zufallsauswahl, jedes Album bzw. jeder Song höchstens einmal.
// - Noten-Gutschriften stehen in note_ledger; einmalige Belohnungen haben einen eindeutigen Schlüssel (idempotent).
import crypto from 'node:crypto';
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { milestones, MINUTE_STEPS, STREAK_STEPS, wrappedYears } from './features.js';
import { UserError } from './users.js';
import { bestImage, spotifyGet } from './spotify.js';

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
const CD_STEPS = { 1: R(1), 10: R(2), 25: R(0, 1), 50: R(0, 0, 1), 100: R(0, 0, 0, 1) };
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
  quiz: R(0, 1), // Tagesfrage richtig (falsch: QUIZ_CONSOLATION)
  sotd: R(0, 1), // Song des Tages heute gehört
};
export const WEEK_GOAL = 120;
const QUIZ_CONSOLATION = R(1);
export const DISCOVER_GOAL = 5;
const EXCHANGE_RATE = 4; // 4 × niedrigere Stufe = 1 × nächste Stufe

// Preise je Seltenheit (Noten-Stufe + Spanne)
const PRICE = { common: ['bronze', 2, 4], rare: ['silver', 1, 2], epic: ['gold', 1, 2], legendary: ['platinum', 1, 1] };
// Wie viele Alben es in welcher Seltenheit überhaupt gibt (Prozent)
const PRESENCE = { common: 100, rare: 100, epic: 100, legendary: 100 };
// Wöchentlich neu gewürfelte Seltenheit je Platz (Prozent)
const RARITY_ODDS = { record: { common: 55, rare: 28, epic: 12, legendary: 5 }, cd: { common: 58, rare: 27, epic: 11, legendary: 4 } };
const SHOP_SIZE = 16;
// CD-Singles: günstiger als Schallplatten (legendär kostet Gold statt Platin)
const CD_PRICE = { common: ['bronze', 1, 2], rare: ['silver', 1, 1], epic: ['gold', 1, 1], legendary: ['gold', 3, 3] };
const CD_PRESENCE = { common: 100, rare: 100, epic: 100, legendary: 100 };
const CD_SHOP_SIZE = 30;

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


// ================================================================ Platten-Pool (alle gehörten Alben)
async function albumPool(userId) {
  const { rows } = await query(
    `SELECT lower(t.artist_names[1]) || '|' || lower(t.album_name) AS key,
            min(t.artist_names[1]) AS artist, min(t.album_name) AS album,
            (array_agg(t.album_id) FILTER (WHERE t.album_id IS NOT NULL))[1] AS album_id,
            (array_agg(t.album_image) FILTER (WHERE t.album_image IS NOT NULL))[1] AS image,
            count(*) AS plays
       FROM plays pl JOIN tracks t ON t.id = pl.track_id
      WHERE pl.user_id = $1 AND t.album_name IS NOT NULL AND t.album_name <> '' AND t.artist_names[1] IS NOT NULL
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
        kind: 'record',
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

/** CD-Singles: alle gehörten Songs. */
async function trackPool(userId) {
  const { rows } = await query(
    `SELECT t.id, t.name, t.artist_names[1] AS artist, t.album_image AS image, count(*) AS plays
       FROM plays pl JOIN tracks t ON t.id = pl.track_id
      WHERE pl.user_id = $1 AND t.artist_names[1] IS NOT NULL
      GROUP BY t.id`,
    [userId],
  );
  const items = [];
  for (const tr of rows) {
    for (const rarity of RARITIES) {
      const seed = `cd#${tr.id}#${rarity}`;
      if (hashInt(`${seed}#presence`) % 100 >= CD_PRESENCE[rarity]) continue;
      const [tier, lo, hi] = CD_PRICE[rarity];
      items.push({
        id: `${crypto.createHash('sha1').update(tr.id).digest('hex').slice(0, 12)}-cd-${rarity}`,
        kind: 'cd',
        rarity,
        artist: tr.artist,
        album: tr.name, // Titel der Single
        album_id: tr.id, // Spotify-Track-ID
        image: tr.image,
        week: (hashInt(`${seed}#week`) % 52) + 1,
        hue: hashInt(`${seed}#hue`) % 360,
        price: { tier, amount: lo + (hashInt(`${seed}#price`) % (hi - lo + 1)) },
        tie: hashInt(`${seed}#tie`),
      });
    }
  }
  return items;
}

/** Angebot der Woche: Platten dieser Kalenderwoche, bei kleiner Sammlung ergänzt aus den nächstgelegenen Wochen. */
function weeklyShop(pool, seed, size = SHOP_SIZE) {
  // Für jeden Nutzer jede Woche komplett zufällig (fest innerhalb der Woche): zufällige Alben/Songs,
  // Seltenheit je Platz neu gewürfelt; jedes Album/jeder Song höchstens einmal.
  const byBase = new Map();
  for (const it of pool) {
    const base = it.id.replace(/-(cd-)?(common|rare|epic|legendary)$/, '');
    if (!byBase.has(base)) byBase.set(base, {});
    byBase.get(base)[it.rarity] = it;
  }
  const bases = [...byBase.keys()].sort((a, b) => hashInt(`${seed}#${a}`) - hashInt(`${seed}#${b}`)).slice(0, size);
  const picked = bases.map((base) => {
    const variants = byBase.get(base);
    const kind = Object.values(variants)[0].kind === 'cd' ? 'cd' : 'record';
    let roll = hashInt(`${seed}#${base}#rarity`) % 100;
    let rarity = 'common';
    for (const r of RARITIES) { if (roll < RARITY_ODDS[kind][r]) { rarity = r; break; } roll -= RARITY_ODDS[kind][r]; }
    return variants[rarity] || variants.common || Object.values(variants)[0];
  });
  return picked.sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || a.artist.localeCompare(b.artist));
}
const shopSeed = (account, year, week) => `${account.id}#${year}-W${week}`;

// ================================================================ Belohnungen auswerten (idempotent)
async function facts(account) {
  const uid = account.spotify_user_id;
  const [ms, misc, weeks, months, coll, sotd] = await Promise.all([
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
    query(`SELECT count(*) FILTER (WHERE kind = 'record') AS n, count(*) FILTER (WHERE kind = 'cd') AS cds, count(*) FILTER (WHERE rarity = 'legendary') AS legendary FROM record_collection WHERE account_id = $1`, [account.id]),
    songOfTheDay(account),
  ]);
  return { ms, ...misc.rows[0], weeks: weeks.rows, months: months.rows, collection: coll.rows[0], sotd };
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
  for (const [n, r] of Object.entries(CD_STEPS)) if (f.collection.cds >= Number(n)) add(`cd-${n}`, r);
  add(`visit:${today}`, RECURRING.visit);
  if (f.sotd?.done) add(`sotd:${today}`, RECURRING.sotd);
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
    ...Object.entries(CD_STEPS).map(([n, r]) => ({
      key: `cd-${n}`, group: 'collector', reward: r, done: has.has(`cd-${n}`), at: has.get(`cd-${n}`) || null, cur: Math.min(f.collection.cds, Number(n)), goal: Number(n),
    })),
    once('legendary-1', 'collector', Math.min(f.collection.legendary, 1), 1),
    { key: 'visit', group: 'recurring', reward: RECURRING.visit, done: has.has(`visit:${today}`), at: has.get(`visit:${today}`) || null },
    { key: 'week', group: 'recurring', reward: RECURRING.week, done: has.has(`week:${thisWeek}`), at: has.get(`week:${thisWeek}`) || null,
      cur: Math.min(f.weeks.find((w) => w.w === thisWeek)?.minutes || 0, WEEK_GOAL), goal: WEEK_GOAL },
    { key: 'discover', group: 'recurring', reward: RECURRING.discover, done: has.has(`discover:${thisMonth}`), at: has.get(`discover:${thisMonth}`) || null,
      cur: Math.min(f.months.find((m) => m.m === thisMonth)?.n || 0, DISCOVER_GOAL), goal: DISCOVER_GOAL },
    { key: 'bday', group: 'recurring', reward: RECURRING.bday, done: has.has(`bday:${today.slice(0, 4)}`), at: has.get(`bday:${today.slice(0, 4)}`) || null, birthday: account.birthday || null },
    { key: 'wrapped', group: 'recurring', reward: RECURRING.wrapped, done: earned.some((r) => r.key.startsWith('wrapped:')), at: null },
    { key: 'quiz', group: 'recurring', reward: RECURRING.quiz, done: has.has(`quiz:${today}`), at: has.get(`quiz:${today}`) || null },
    { key: 'sotd', group: 'recurring', reward: RECURRING.sotd, done: has.has(`sotd:${today}`), at: has.get(`sotd:${today}`) || null },
  ];
  return list;
}

export async function overviewFor(account) {
  const { fresh, facts: f } = await evaluate(account);
  const today = localDate();
  const { year, week } = isoWeek(today);
  const [balance, ledger, collection, pool, tpool, freeRow] = await Promise.all([
    balanceOf(account.id),
    query(
      `SELECT key, bronze, silver, gold, platinum, created_at FROM note_ledger WHERE account_id = $1 ORDER BY created_at DESC, id DESC`,
      [account.id],
    ),
    query(
      `SELECT record_id AS id, kind, rarity, artist, album, album_id, image, hue, week, price, acquired_at
         FROM record_collection WHERE account_id = $1 ORDER BY acquired_at DESC`,
      [account.id],
    ),
    albumPool(account.spotify_user_id),
    trackPool(account.spotify_user_id),
    query('SELECT free_shop FROM accounts WHERE id = $1', [account.id]),
  ]);
  const free = Boolean(freeRow.rows[0]?.free_shop);
  const owned = new Set(collection.rows.map((r) => r.id));
  const { shopList, singleList } = await composeShop(account, year, week, pool, tpool);
  const shop = shopList.map(({ tie, ...it }) => ({ ...it, owned: owned.has(it.id) }));
  const singles = singleList.map(({ tie, ...it }) => ({ ...it, owned: owned.has(it.id) }));
  return {
    balance,
    fresh,
    week: { year, week, resetsOn: nextMonday(today) },
    shop,
    singles,
    free,
    poolSize: pool.length,
    collection: collection.rows,
    sources: sources(account, f, ledger.rows.filter((r) => r.key && !r.key.startsWith('buy:'))),
    exchangeRate: EXCHANGE_RATE,
    eggs: weeklyEggs(account, year, week).map((e) => ({ id: e.id, spot: e.spot, found: ledger.rows.some((r) => r.key === `egg:${e.id}`) })),
    daily: {
      quiz: await quizState(account, ledger.rows),
      sotd: f.sotd ? { ...f.sotd, rewarded: ledger.rows.some((r) => r.key === `sotd:${today}`) } : null,
    },
  };
}

// ================================================================ Kaufen & Tauschen
export async function buy(account, recordId) {
  const today = localDate();
  const { year, week } = isoWeek(today);
  const [pool, tpool, freeRow] = await Promise.all([
    albumPool(account.spotify_user_id),
    trackPool(account.spotify_user_id),
    query('SELECT free_shop FROM accounts WHERE id = $1', [account.id]),
  ]);
  const free = Boolean(freeRow.rows[0]?.free_shop);
  const { shopList, singleList } = await composeShop(account, year, week, pool, tpool);
  const item = [...shopList, ...singleList].find((it) => it.id === String(recordId));
  if (!item) throw new UserError('Diese Platte gibt es diese Woche nicht.', 404, 'recordNotInShop');
  const result = await withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [900000 + Number(account.id)]);
    const { rows: own } = await db.query('SELECT 1 FROM record_collection WHERE account_id = $1 AND record_id = $2', [account.id, item.id]);
    if (own.length) throw new UserError('Diese Platte hast du schon.', 409, 'recordOwned');
    const bal = await balanceOf(account.id, db);
    if (!free && bal[item.price.tier] < item.price.amount) throw new UserError('Nicht genug Noten.', 400, 'notEnoughNotes');
    const cost = R();
    if (!free) cost[item.price.tier] = -item.price.amount;
    await db.query(
      'INSERT INTO note_ledger (account_id, key, bronze, silver, gold, platinum) VALUES ($1, $2, $3, $4, $5, $6)',
      [account.id, `buy:${item.id}#${Date.now()}`, cost.bronze, cost.silver, cost.gold, cost.platinum],
    );
    await db.query(
      `INSERT INTO record_collection (account_id, record_id, kind, rarity, artist, album, album_id, image, hue, week, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [account.id, item.id, item.kind, item.rarity, item.artist, item.album, item.album_id, item.image, item.hue, item.week,
        JSON.stringify({ ...item.price, ...(free ? { free: true } : {}), ...(item.discover ? { discover: true } : {}) })],
    );
    return item;
  });
  // Sammler-Belohnungen sofort prüfen
  const { fresh } = await evaluate(account);
  const { tie, ...record } = result;
  return { record, fresh, balance: await balanceOf(account.id) };
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


// ================================================================ Tägliche Aufgaben: Tagesfrage & Song des Tages
const dayShift = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Song des Tages: ein früher oft gehörter Song (≥ 3 Plays), seit mindestens 30 Tagen nicht mehr gehört. */
async function songOfTheDay(account) {
  const uid = account.spotify_user_id;
  const today = localDate();
  const pick = async (minPlays, minDays) => {
    const { rows } = await query(
      `SELECT t.id, t.name, array_to_string(t.artist_names, ', ') AS artists, t.album_image AS image,
              count(*) FILTER (WHERE (pl.played_at AT TIME ZONE $2)::date < $3::date) AS plays,
              max(pl.played_at) FILTER (WHERE (pl.played_at AT TIME ZONE $2)::date < $3::date) AS last,
              bool_or((pl.played_at AT TIME ZONE $2)::date = $3::date) AS today
         FROM plays pl JOIN tracks t ON t.id = pl.track_id
        WHERE pl.user_id = $1
        GROUP BY t.id
       HAVING count(*) FILTER (WHERE (pl.played_at AT TIME ZONE $2)::date < $3::date) >= $4
          AND max(pl.played_at) FILTER (WHERE (pl.played_at AT TIME ZONE $2)::date < $3::date) < ($3::date - $5::int)::timestamp AT TIME ZONE $2
        ORDER BY t.id`,
      [uid, config.timezone, today, minPlays, minDays],
    );
    return rows;
  };
  let rows = await pick(3, 30);
  if (!rows.length) rows = await pick(2, 7); // Fallback für kurze Hörverläufe
  if (!rows.length) return null;
  const t = rows[hashInt(`${account.id}#${today}#sotd`) % rows.length];
  return {
    id: t.id, name: t.name, artists: t.artists, image: t.image, plays: t.plays, last: t.last, done: t.today,
    url: /^[0-9A-Za-z]{22}$/.test(t.id) ? `https://open.spotify.com/track/${t.id}` : null,
  };
}

/** Tagesfrage aus den eigenen Daten (nur Daten bis gestern → stabil über den Tag). */
export async function buildQuiz(account) {
  const uid = account.spotify_user_id;
  const tz = config.timezone;
  const today = localDate();
  const yesterday = dayShift(today, -1);
  const weekStart = dayShift(today, -7);
  const seed = (x) => hashInt(`${account.id}#${today}#${x}`);
  const window = `(pl.played_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date`;
  const shuffle = (opts) => opts
    .map((o) => ({ ...o, k: seed(o.label) }))
    .sort((a, b) => a.k - b.k)
    .map(({ k, ...o }, i) => ({ ...o, id: 'abc'[i] }));

  const topArtists = async (from, to, limit) => (await query(
    `SELECT min(t.artist_names[1]) AS name, sum(pl.ms_played) AS ms
       FROM plays pl JOIN tracks t ON t.id = pl.track_id
      WHERE pl.user_id = $1 AND ${window} AND t.artist_names[1] IS NOT NULL
      GROUP BY lower(t.artist_names[1]) ORDER BY ms DESC LIMIT $5`,
    [uid, tz, from, to, limit],
  )).rows;
  const artistQuestion = async (type, from) => {
    const top = await topArtists(from, yesterday, 1);
    if (!top.length) return null;
    const pool = (await topArtists(dayShift(today, -365), yesterday, 15)).filter((a) => a.name.toLowerCase() !== top[0].name.toLowerCase());
    if (pool.length < 2) return null;
    const others = pool.sort((a, b) => seed(a.name) - seed(b.name)).slice(0, 2);
    return { type, options: shuffle([{ label: top[0].name, correct: true }, ...others.map((a) => ({ label: a.name, correct: false }))]) };
  };
  const songQuestion = async () => {
    const q = (from, limit) => query(
      `SELECT t.id, t.name, t.artist_names[1] AS artist, t.album_image AS image, count(*) AS n
         FROM plays pl JOIN tracks t ON t.id = pl.track_id
        WHERE pl.user_id = $1 AND ${window}
        GROUP BY t.id ORDER BY n DESC, t.id LIMIT $5`,
      [uid, tz, from, yesterday, limit],
    );
    const top = (await q(weekStart, 1)).rows;
    if (!top.length) return null;
    const pool = (await q(dayShift(today, -90), 20)).rows.filter((x) => x.id !== top[0].id);
    if (pool.length < 2) return null;
    const others = pool.sort((a, b) => seed(a.id) - seed(b.id)).slice(0, 2);
    const opt = (x, correct) => ({ label: x.name, sub: x.artist, image: x.image, correct });
    return { type: 'songWeek', options: shuffle([opt(top[0], true), ...others.map((x) => opt(x, false))]) };
  };
  const minutesQuestion = async () => {
    const { rows } = await query(
      `SELECT round(COALESCE(sum(ms_played), 0) / 60000.0)::int AS m FROM plays pl WHERE pl.user_id = $1 AND ${window}`,
      [uid, tz, yesterday, yesterday],
    );
    const m = rows[0].m;
    if (m < 10) return null;
    const vals = [m, Math.max(1, Math.round(m * 0.55)), Math.round(m * 1.6)];
    if (new Set(vals).size < 3) return null;
    return { type: 'minutesYesterday', options: shuffle(vals.map((v, i) => ({ label: String(v), unit: 'min', correct: i === 0 }))) };
  };
  const hourQuestion = async () => {
    const { rows } = await query(
      `SELECT extract(hour FROM pl.played_at AT TIME ZONE $2)::int AS h, sum(ms_played) AS ms
         FROM plays pl WHERE pl.user_id = $1 AND ${window} GROUP BY 1 ORDER BY ms DESC LIMIT 1`,
      [uid, tz, dayShift(today, -30), yesterday],
    );
    if (!rows.length) return null;
    const h = rows[0].h;
    return { type: 'hourMonth', options: shuffle([h, (h + 7) % 24, (h + 15) % 24].map((x, i) => ({ label: String(x), unit: 'hour', correct: i === 0 }))) };
  };

  const makers = [
    () => artistQuestion('artistYesterday', yesterday),
    songQuestion,
    minutesQuestion,
    () => artistQuestion('artistWeek', weekStart),
    hourQuestion,
  ];
  const start = seed('type') % makers.length;
  for (let i = 0; i < makers.length; i++) {
    const q = await makers[(start + i) % makers.length]();
    if (q) return q;
  }
  return null;
}

async function quizState(account, ledgerRows) {
  const today = localDate();
  const q = await buildQuiz(account);
  if (!q) return null;
  const row = ledgerRows.find((r) => r.key === `quiz:${today}`);
  const options = q.options.map(({ correct, ...o }) => o); // Lösung erst nach dem Antworten
  if (!row) return { type: q.type, options, answered: false };
  return { type: q.type, options, answered: true, correct: row.silver > 0, answer: q.options.find((o) => o.correct).id };
}

export async function answerQuiz(account, answer) {
  const today = localDate();
  const q = await buildQuiz(account);
  if (!q) throw new UserError('Heute gibt es keine Tagesfrage.', 404, 'notFound');
  const choice = q.options.find((o) => o.id === String(answer));
  if (!choice) throw new UserError('Ungültige Antwort.', 400, 'invalidSetting');
  const reward = choice.correct ? RECURRING.quiz : QUIZ_CONSOLATION;
  const fresh = await grant(account.id, [{ key: `quiz:${today}`, ...reward }]);
  if (!fresh.length) throw new UserError('Die Tagesfrage hast du heute schon beantwortet.', 409, 'quizDone');
  return { correct: choice.correct, answer: q.options.find((o) => o.correct).id, fresh, balance: await balanceOf(account.id) };
}

/** Admin: alle Platten und CD-Singles für das eigene Konto kostenlos (zum Testen). */
export async function setFreeShop(accountId, on) {
  await query('UPDATE accounts SET free_shop = $2 WHERE id = $1', [accountId, Boolean(on)]);
}


// ================================================================ Versteckte Überraschungen (1–2 pro Woche)
// Orte in der App, an denen ein kleines Geschenk versteckt sein kann (Platzierung macht das Frontend).
export const EGG_SPOTS = ['topbar', 'kpi', 'heatmap', 'genres', 'trends', 'history', 'podium', 'cabinet', 'shop', 'profile', 'wrapped', 'friends', 'cdrack', 'earn'];

function weeklyEggs(account, year, week) {
  const base = `${account.id}#${year}-W${week}#egg`;
  const count = 1 + (hashInt(`${base}#count`) % 2);
  const spots = [...EGG_SPOTS].sort((a, b) => hashInt(`${base}#${a}`) - hashInt(`${base}#${b}`));
  return Array.from({ length: count }, (_, i) => ({ id: `${year}-W${String(week).padStart(2, '0')}#${i + 1}`, spot: spots[i] }));
}

/** Überraschung öffnen: Noten oder ein Gratis-Stück für die Sammlung (fest je Überraschung). */
export async function openEgg(account, eggId) {
  const today = localDate();
  const { year, week } = isoWeek(today);
  const egg = weeklyEggs(account, year, week).find((e) => e.id === String(eggId));
  if (!egg) throw new UserError('Diese Überraschung gibt es nicht (mehr).', 404, 'eggNotFound');
  const key = `egg:${egg.id}`;
  const roll = hashInt(`${account.id}#${key}#roll`) % 100;
  let gift = null;
  let reward = R();
  if (roll < 35) reward = R(3);
  else if (roll < 60) reward = R(0, 2);
  else if (roll < 78) reward = R(0, 0, 1);
  else if (roll < 95) {
    // Gratis-Stück: CD-Single (häufiger) oder Schallplatte, das man noch nicht hat
    const wantRecord = roll >= 89;
    const [pool, own] = await Promise.all([
      wantRecord ? albumPool(account.spotify_user_id) : trackPool(account.spotify_user_id),
      query('SELECT record_id FROM record_collection WHERE account_id = $1', [account.id]),
    ]);
    const owned = new Set(own.rows.map((r) => r.record_id));
    const cands = pool.filter((it) => !owned.has(it.id) && it.rarity !== 'legendary')
      .sort((a, b) => hashInt(`${key}#${a.id}`) - hashInt(`${key}#${b.id}`));
    if (cands.length) gift = cands[0];
    else reward = R(0, 0, 1);
  } else reward = R(0, 0, 0, 1);

  const result = await withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [900000 + Number(account.id)]);
    const ins = await db.query(
      `INSERT INTO note_ledger (account_id, key, bronze, silver, gold, platinum) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, key) WHERE key IS NOT NULL DO NOTHING RETURNING id`,
      [account.id, key, reward.bronze, reward.silver, reward.gold, reward.platinum],
    );
    if (!ins.rowCount) throw new UserError('Diese Überraschung hast du schon gefunden.', 409, 'eggFound');
    if (gift) {
      await db.query(
        `INSERT INTO record_collection (account_id, record_id, kind, rarity, artist, album, album_id, image, hue, week, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
        [account.id, gift.id, gift.kind, gift.rarity, gift.artist, gift.album, gift.album_id, gift.image, gift.hue, gift.week,
          JSON.stringify({ ...gift.price, free: true, gift: true })],
      );
    }
    return true;
  });
  const { fresh } = await evaluate(account);
  const eggs = weeklyEggs(account, year, week);
  const { rows } = await query('SELECT key FROM note_ledger WHERE account_id = $1 AND key = ANY($2)', [account.id, eggs.map((e) => `egg:${e.id}`)]);
  const giftOut = gift ? (({ tie, ...g }) => ({ ...g, acquired_at: new Date().toISOString(), price: { ...g.price, free: true, gift: true } }))(gift) : null;
  return { ok: result, reward, gift: giftOut, left: eggs.length - rows.length, fresh, balance: await balanceOf(account.id) };
}


// ================================================================ Höranstoß: Songs & Alben, die man noch nie gehört hat
const DISCOVER_RECORDS = 4; // von SHOP_SIZE
const DISCOVER_CDS = 8; // von CD_SHOP_SIZE

async function favouriteArtists(userId, limit) {
  const { rows } = await query(
    `SELECT min(t.artist_names[1]) AS name, (array_agg(t.artist_ids[1]) FILTER (WHERE t.artist_ids[1] IS NOT NULL))[1] AS id
       FROM plays pl JOIN tracks t ON t.id = pl.track_id
      WHERE pl.user_id = $1 AND t.artist_names[1] IS NOT NULL
      GROUP BY lower(t.artist_names[1]) ORDER BY sum(pl.ms_played) DESC LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/** Spotify-Suche nach Songs und Alben der Lieblingskünstler (einmal pro Woche, gecacht). */
async function fetchDiscover(userId) {
  const artists = await favouriteArtists(userId, 6);
  const tracks = [];
  const albums = [];
  for (const a of artists) {
    const params = new URLSearchParams({ q: `artist:"${a.name}"`, type: 'track,album', limit: '10', market: 'from_token' });
    const r = await spotifyGet(userId, `/search?${params}`, { retries: 1 });
    const same = (x) => (x?.artists?.[0]?.name || '').toLowerCase() === a.name.toLowerCase();
    for (const tr of r?.tracks?.items || []) {
      if (!same(tr) || !tr.id) continue;
      tracks.push({ id: tr.id, name: tr.name, artist: a.name, image: bestImage(tr.album?.images), album: tr.album?.name || null });
    }
    for (const al of r?.albums?.items || []) {
      if (!same(al) || !al.id || al.album_type === 'compilation') continue;
      albums.push({ id: al.id, name: al.name, artist: a.name, image: bestImage(al.images) });
    }
  }
  return { tracks, albums };
}

/** Kandidaten aus dem eigenen Katalog (z. B. von Freunden gehört), falls die Suche nicht klappt. */
async function catalogDiscover(userId) {
  const fav = (await favouriteArtists(userId, 25)).map((a) => a.name.toLowerCase());
  const { rows: tracks } = await query(
    `SELECT t.id, t.name, t.artist_names[1] AS artist, t.album_image AS image, t.album_name AS album, t.album_id
       FROM tracks t
      WHERE lower(t.artist_names[1]) = ANY($2)
        AND NOT EXISTS (SELECT 1 FROM plays pl WHERE pl.user_id = $1 AND pl.track_id = t.id)
      ORDER BY t.id LIMIT 80`,
    [userId, fav],
  );
  const { rows: albums } = await query(
    `SELECT min(t.album_id) AS id, min(t.album_name) AS name, min(t.artist_names[1]) AS artist,
            (array_agg(t.album_image) FILTER (WHERE t.album_image IS NOT NULL))[1] AS image
       FROM tracks t
      WHERE lower(t.artist_names[1]) = ANY($2) AND t.album_name IS NOT NULL
      GROUP BY lower(t.artist_names[1]), lower(t.album_name)
     HAVING NOT EXISTS (
       SELECT 1 FROM plays pl JOIN tracks t2 ON t2.id = pl.track_id
        WHERE pl.user_id = $1 AND lower(t2.artist_names[1]) = lower(min(t.artist_names[1])) AND lower(t2.album_name) = lower(min(t.album_name)))
      LIMIT 40`,
    [userId, fav],
  );
  return { tracks, albums };
}

/** Wöchentlicher Höranstoß-Pool: aus dem Cache, sonst neu (Suche, ersatzweise eigener Katalog). */
async function discoverPool(userId, year, week) {
  const wk = `${year}-W${String(week).padStart(2, '0')}`;
  const { rows } = await query('SELECT items, ok, fetched_at FROM discover_cache WHERE user_id = $1 AND week = $2', [userId, wk]);
  let data = rows[0]?.items;
  const stale = rows[0] && !rows[0].ok && Date.now() - new Date(rows[0].fetched_at) > 6 * 36e5;
  if (!rows[0] || stale) {
    let ok = true;
    let found = { tracks: [], albums: [] };
    try {
      found = await fetchDiscover(userId);
    } catch (err) {
      ok = false;
      console.warn('[discover]', userId, err.message);
    }
    // Nur wirklich Ungehörtes behalten (Stand beim Erstellen des Angebots → stabil über die Woche)
    const heard = await query(
      `SELECT array_agg(DISTINCT pl.track_id) AS ids,
              array_agg(DISTINCT lower(t.artist_names[1]) || '|' || lower(t.album_name)) AS albums
         FROM plays pl JOIN tracks t ON t.id = pl.track_id WHERE pl.user_id = $1`,
      [userId],
    );
    const heardIds = new Set(heard.rows[0].ids || []);
    const heardAlbums = new Set(heard.rows[0].albums || []);
    const fallback = found.tracks.length + found.albums.length < 6 ? await catalogDiscover(userId) : { tracks: [], albums: [] };
    const uniq = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];
    data = {
      tracks: uniq([...found.tracks, ...fallback.tracks], (x) => x.id).filter((x) => !heardIds.has(x.id)),
      albums: uniq([...found.albums, ...fallback.albums], (x) => `${x.artist}|${x.name}`.toLowerCase())
        .filter((x) => !heardAlbums.has(`${x.artist}|${x.name}`.toLowerCase())),
    };
    await query(
      `INSERT INTO discover_cache (user_id, week, items, ok, fetched_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, week) DO UPDATE SET items = EXCLUDED.items, ok = EXCLUDED.ok, fetched_at = now()`,
      [userId, wk, JSON.stringify(data), ok],
    );
  }
  const items = [];
  const variant = (seed, kind, base, rarityPrices, presence) => {
    for (const rarity of RARITIES) {
      if (hashInt(`${seed}#${rarity}#presence`) % 100 >= presence[rarity]) continue;
      const [tier, lo, hi] = rarityPrices[rarity];
      items.push({
        ...base,
        id: `${crypto.createHash('sha1').update(base.key).digest('hex').slice(0, 12)}-${kind === 'cd' ? 'cd-' : ''}${rarity}`,
        kind, rarity, discover: true,
        week: (hashInt(`${seed}#${rarity}#week`) % 52) + 1,
        hue: hashInt(`${seed}#${rarity}#hue`) % 360,
        price: { tier, amount: lo + (hashInt(`${seed}#${rarity}#price`) % (hi - lo + 1)) },
        tie: hashInt(`${seed}#${rarity}#tie`),
      });
      delete items[items.length - 1].key;
    }
  };
  for (const a of data.albums || []) {
    // gleiche ID-Logik wie bei gehörten Alben (Künstler|Album)
    variant(`disc#${a.artist}|${a.name}`, 'record', { key: `${a.artist.toLowerCase()}|${a.name.toLowerCase()}`, artist: a.artist, album: a.name, album_id: a.id || null, image: a.image || null }, PRICE, PRESENCE);
  }
  for (const tr of data.tracks || []) {
    variant(`disc#${tr.id}`, 'cd', { key: tr.id, artist: tr.artist, album: tr.name, album_id: tr.id, image: tr.image || null }, CD_PRICE, CD_PRESENCE);
  }
  return {
    records: items.filter((x) => x.kind === 'record'),
    cds: items.filter((x) => x.kind === 'cd'),
  };
}

/** Wochenangebot: gehörte Lieblinge plus ein paar ungehörte Höranstöße (je Album/Song höchstens einmal). */
async function composeShop(account, year, week, pool, tpool) {
  const seed = shopSeed(account, year, week);
  const disc = await discoverPool(account.spotify_user_id, year, week);
  const dRec = weeklyShop(disc.records, `${seed}#disc`, DISCOVER_RECORDS);
  const dCd = weeklyShop(disc.cds, `${seed}#disc-cd`, DISCOVER_CDS);
  const merge = (base, extra, size) => {
    const ids = new Set(extra.map((x) => x.id.replace(/-(cd-)?(common|rare|epic|legendary)$/, '')));
    const rest = weeklyShop(base.filter((x) => !ids.has(x.id.replace(/-(cd-)?(common|rare|epic|legendary)$/, ''))), seed + (size === CD_SHOP_SIZE ? '#cd' : ''), size - extra.length);
    return [...extra, ...rest].sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity) || Number(Boolean(b.discover)) - Number(Boolean(a.discover)) || a.artist.localeCompare(b.artist));
  };
  return { shopList: merge(pool, dRec, SHOP_SIZE), singleList: merge(tpool, dCd, CD_SHOP_SIZE) };
}
