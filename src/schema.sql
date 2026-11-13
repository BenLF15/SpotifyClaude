-- Idempotentes Schema (Mehrbenutzer). Wird bei jedem Start ausgeführt und migriert
-- auch Datenbanken aus der Einzelnutzer-Version (Tabelle spotify_auth).

CREATE TABLE IF NOT EXISTS users (
  id             text PRIMARY KEY,            -- Spotify-User-ID
  display_name   text,
  email          text,
  avatar_url     text,
  country        text,
  product        text,                        -- premium | free | …
  access_token   text,
  refresh_token  text NOT NULL,
  expires_at     timestamptz,
  scope          text,
  auth_error     text,                        -- gesetzt, wenn das Refresh-Token ungültig wurde
  is_admin       boolean NOT NULL DEFAULT false,
  login_count    integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  last_seen_at   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_events (
  id          bigserial PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  user_agent  text
);
CREATE INDEX IF NOT EXISTS login_events_at_idx ON login_events (at DESC);

CREATE TABLE IF NOT EXISTS artists (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  image_url    text,
  genres       text[] NOT NULL DEFAULT '{}',
  enriched_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artists_name_idx ON artists (lower(name));

CREATE TABLE IF NOT EXISTS tracks (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  artist_ids    text[] NOT NULL DEFAULT '{}',
  artist_names  text[] NOT NULL DEFAULT '{}',
  album_id      text,
  album_name    text,
  album_image   text,
  duration_ms   integer,
  enriched_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plays (
  id           bigserial PRIMARY KEY,
  user_id      text,
  played_at    timestamptz NOT NULL,
  track_id     text NOT NULL REFERENCES tracks(id),
  ms_played    integer NOT NULL,
  source       text NOT NULL,            -- 'api' | 'import'
  context_uri  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS top_snapshots (
  user_id        text,
  snapshot_date  date NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('artists', 'tracks')),
  time_range     text NOT NULL CHECK (time_range IN ('short_term', 'medium_term', 'long_term')),
  rank           smallint NOT NULL,
  item_id        text NOT NULL,
  name           text NOT NULL,
  subtitle       text,
  image_url      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_log (
  id           bigserial PRIMARY KEY,
  user_id      text,
  job          text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean,
  message      text
);

-- ---------------------------------------------------------------- Migration Einzel- → Mehrbenutzer
ALTER TABLE plays         ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE top_snapshots ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE sync_log      ADD COLUMN IF NOT EXISTS user_id text;

DO $$
BEGIN
  -- Alten Spotify-Login als ersten Nutzer (Admin) übernehmen.
  IF to_regclass('public.spotify_auth') IS NOT NULL THEN
    INSERT INTO users (id, display_name, avatar_url, access_token, refresh_token, expires_at, scope, is_admin, last_login_at)
    SELECT COALESCE(user_id, 'owner'), display_name, avatar_url, access_token, refresh_token, expires_at, scope, true, updated_at
      FROM spotify_auth WHERE id = 1
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE spotify_auth;
  END IF;

  -- Alte Eindeutigkeits-Regeln ohne user_id entfernen.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plays_track_id_played_at_key') THEN
    ALTER TABLE plays DROP CONSTRAINT plays_track_id_played_at_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'top_snapshots_pkey') THEN
    ALTER TABLE top_snapshots DROP CONSTRAINT top_snapshots_pkey;
  END IF;
END $$;

-- Daten ohne Besitzer gehören dem ersten Nutzer (bei frischer DB: noch niemand → bleibt NULL,
-- wird beim ersten Login übernommen, siehe users.js).
UPDATE plays         SET user_id = (SELECT id FROM users ORDER BY created_at LIMIT 1) WHERE user_id IS NULL;
UPDATE top_snapshots SET user_id = (SELECT id FROM users ORDER BY created_at LIMIT 1) WHERE user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS plays_user_track_time_uq ON plays (user_id, track_id, played_at);
CREATE INDEX IF NOT EXISTS plays_user_played_at_idx ON plays (user_id, played_at);
DROP INDEX IF EXISTS plays_played_at_idx;
CREATE UNIQUE INDEX IF NOT EXISTS top_snapshots_uq ON top_snapshots (user_id, snapshot_date, kind, time_range, rank);
DROP INDEX IF EXISTS top_snapshots_item_idx;
CREATE INDEX IF NOT EXISTS top_snapshots_item_idx ON top_snapshots (user_id, kind, time_range, item_id);
CREATE INDEX IF NOT EXISTS sync_log_user_job_idx ON sync_log (user_id, job, id DESC);

-- ---------------------------------------------------------------- Spotlfy-Konten (Benutzername + Passwort)
-- Ein Konto meldet sich mit Benutzername/Passwort an und verbindet danach (optional) ein Spotify-Konto.
-- Die Hördaten hängen weiterhin an der Spotify-User-ID (users.id).
CREATE TABLE IF NOT EXISTS accounts (
  id               bigserial PRIMARY KEY,
  username         text NOT NULL,
  password_hash    text NOT NULL,
  is_admin         boolean NOT NULL DEFAULT false,
  spotify_user_id  text UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  login_count      integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz,
  last_seen_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_uq ON accounts (lower(username));

ALTER TABLE login_events ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE login_events ALTER COLUMN user_id DROP NOT NULL;

-- ---------------------------------------------------------------- Einmaliger Admin-Reset (Nov. 2026)
-- Entfernt das früher automatisch angelegte Konto „Nebs“ und alle Admin-Rechte. Danach wird der
-- erste Nutzer, der sich registriert, automatisch Admin (siehe users.registerAccount).
-- Hördaten bleiben erhalten (sie hängen am Spotify-Konto und kommen beim Verbinden zurück).
CREATE TABLE IF NOT EXISTS app_meta (
  key         text PRIMARY KEY,
  value       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'admin_reset_2026_11') THEN
    DELETE FROM accounts WHERE lower(username) = 'nebs';
    UPDATE accounts SET is_admin = false WHERE is_admin;
    INSERT INTO app_meta (key, value) VALUES ('admin_reset_2026_11', now()::text);
  END IF;
END $$;

-- ---------------------------------------------------------------- Eigene Genre-Einordnung
-- Pro Künstlername (kleingeschrieben): eigenes Hauptgenre + Stil-Tags, ermittelt aus MusicBrainz.
CREATE TABLE IF NOT EXISTS artist_genres (
  name_key     text PRIMARY KEY,
  artist_name  text NOT NULL,
  main_genre   text,
  styles       text[] NOT NULL DEFAULT '{}',
  mbid         text,
  tags         jsonb,
  checked_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artist_genres_main_idx ON artist_genres (main_genre);

-- ---------------------------------------------------------------- Darstellung pro Konto
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'dark';

-- ---------------------------------------------------------------- Sprache, festliche Effekte, Geburtstag
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lang text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS festive boolean NOT NULL DEFAULT true;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS birthday date;

-- ---------------------------------------------------------------- Datenschutz, Meilensteine
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS milestones_seen text[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------- Freunde (gegenseitig bestätigt)
CREATE TABLE IF NOT EXISTS friendships (
  requester_id  bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  addressee_id  bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id);

-- ---------------------------------------------------------------- Aus der Statistik erstellte Playlists
CREATE TABLE IF NOT EXISTS created_playlists (
  id                   bigserial PRIMARY KEY,
  account_id           bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  spotify_playlist_id  text NOT NULL,
  name                 text NOT NULL,
  url                  text,
  track_count          integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS created_playlists_account_idx ON created_playlists (account_id, created_at DESC);

-- Suche im Verlauf (Künstler-/Songnamen)
CREATE INDEX IF NOT EXISTS tracks_name_lower_idx ON tracks (lower(name));

-- ---------------------------------------------------------------- Plattensammlung & Musiknoten
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes_started_at timestamptz;
-- Noten-Konto: positive Zeilen = verdient, negative = ausgegeben/getauscht.
-- Einmalige Belohnungen haben einen eindeutigen Schlüssel (z. B. 'starter', 'streak-7', 'week:2026-W46').
CREATE TABLE IF NOT EXISTS note_ledger (
  id          bigserial PRIMARY KEY,
  account_id  bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key         text,
  bronze      integer NOT NULL DEFAULT 0,
  silver      integer NOT NULL DEFAULT 0,
  gold        integer NOT NULL DEFAULT 0,
  platinum    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS note_ledger_key_uq ON note_ledger (account_id, key) WHERE key IS NOT NULL;
CREATE INDEX IF NOT EXISTS note_ledger_account_idx ON note_ledger (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS record_collection (
  account_id   bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  record_id    text NOT NULL,
  rarity       text NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  artist       text NOT NULL,
  album        text NOT NULL,
  album_id     text,
  image        text,
  hue          integer,
  week         integer,
  price        jsonb,
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, record_id)
);

-- ---------------------------------------------------------------- CD-Singles & Gratis-Laden (Admin)
ALTER TABLE record_collection ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'record';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS free_shop boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- Höranstoß im Laden (wöchentlicher Cache der Spotify-Suche)
CREATE TABLE IF NOT EXISTS discover_cache (
  user_id     text NOT NULL,
  week        text NOT NULL,
  items       jsonb NOT NULL DEFAULT '{}',
  ok          boolean NOT NULL DEFAULT true,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week)
);
