-- Idempotentes Schema: wird bei jedem Start von Web-Service und Cron ausgeführt.

CREATE TABLE IF NOT EXISTS spotify_auth (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token    text,
  refresh_token   text NOT NULL,
  expires_at      timestamptz,
  scope           text,
  user_id         text,
  display_name    text,
  avatar_url      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

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
  played_at    timestamptz NOT NULL,
  track_id     text NOT NULL REFERENCES tracks(id),
  ms_played    integer NOT NULL,
  source       text NOT NULL,            -- 'api' | 'import'
  context_uri  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track_id, played_at)
);
CREATE INDEX IF NOT EXISTS plays_played_at_idx ON plays (played_at);

CREATE TABLE IF NOT EXISTS top_snapshots (
  snapshot_date  date NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('artists', 'tracks')),
  time_range     text NOT NULL CHECK (time_range IN ('short_term', 'medium_term', 'long_term')),
  rank           smallint NOT NULL,
  item_id        text NOT NULL,
  name           text NOT NULL,
  subtitle       text,
  image_url      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, kind, time_range, rank)
);
CREATE INDEX IF NOT EXISTS top_snapshots_item_idx ON top_snapshots (kind, time_range, item_id);

CREATE TABLE IF NOT EXISTS sync_log (
  id           bigserial PRIMARY KEY,
  job          text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  ok           boolean,
  message      text
);
