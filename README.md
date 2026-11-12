# Hörstatistik – persönliches Spotify-Dashboard

Ein selbst gehostetes Statistik-Dashboard für dein Spotify-Konto. Es speichert jeden Play dauerhaft in Postgres und zeigt dir Auswertungen, die Spotify selbst nicht bietet. Deploybar mit einem Klick auf [Render](https://render.com) per `render.yaml`.

**Features**

- Spotify-Login per **Authorization Code Flow**. Das Refresh-Token liegt in der DB und das Access-Token wird automatisch erneuert, auch wenn Spotify das Refresh-Token rotiert.
- **Cron alle 30 Minuten**: `/me/player/recently-played` abrufen und neue Plays **ohne Duplikate** speichern.
- **Täglicher Snapshot** der Top-Artists und -Tracks (`short_term`, `medium_term`, `long_term`). Daraus entstehen Rangverlauf und „▲/▼ zur Vorwoche“.
- **Import der „Extended Streaming History“** (JSON) per Kommandozeile oder per Drag & Drop im Dashboard.
- **Dashboard**:
  - Hörminuten pro Tag und Woche
  - Top-Künstler und Top-Songs mit Covern
  - Heatmap nach Uhrzeit und Wochentag
  - Genre-Verteilung
  - Entwicklung pro Monat (Minuten, Künstlervielfalt, neue Künstler)
  - Spotify-Ranking mit Verlauf
  - Zuletzt gehört
- Dunkles, mobilfreundliches Design mit flüssigen Animationen (respektiert `prefers-reduced-motion`).
- **Passwortschutz** über ein signiertes Session-Cookie (HttpOnly, SameSite, Secure) und eine Brute-Force-Bremse.
- Alle Secrets kommen **ausschließlich aus Umgebungsvariablen**.

## Architektur

```
┌────────────────────┐     ┌─────────────────────────┐
│  Web Service       │     │  Cron Job (*/30 * * * *) │
│  src/server.js     │     │  scripts/cron.js         │
│  Dashboard + API   │     │  ├ recently-played       │
│  Spotify-OAuth     │     │  ├ Top-Snapshot (1×/Tag) │
│  History-Upload    │     │  └ Cover/Genres nachladen│
└─────────┬──────────┘     └────────────┬─────────────┘
          └──────────────┬──────────────┘
                   ┌─────┴─────┐
                   │  Postgres │  plays · tracks · artists · top_snapshots · spotify_auth
                   └───────────┘
```

| Datei | Zweck |
|---|---|
| `src/server.js` | Express-Server: Login, OAuth, JSON-API, statische Dateien |
| `src/spotify.js` | OAuth, Token-Refresh, API-Client mit Retry (401/429/5xx) |
| `src/sync.js` | Recently Played, Snapshots, Anreicherung, Duplikat-Schutz |
| `src/importer.js` | Parser für `Streaming_History_Audio_*.json` |
| `src/stats.js` | Alle SQL-Auswertungen |
| `src/schema.sql` | Idempotentes Schema (wird bei jedem Start angewendet) |
| `scripts/cron.js` | Einstiegspunkt des Cron-Jobs |
| `scripts/import-history.js` | CLI-Import der Streaming-History |
| `public/` | Frontend (Vanilla JS + Chart.js, ohne Build-Schritt) |

## Setup

### 1. Spotify-App anlegen

1. Öffne das [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) und klicke **Create app**.
2. Wähle bei *Which API/SDKs are you planning to use?* die **Web API**.
3. Trage unter **Redirect URIs** ein:
   - `https://<dein-service>.onrender.com/auth/callback` (die URL bekommst du nach dem ersten Deploy, siehe Schritt 3)
   - für lokale Entwicklung zusätzlich `http://127.0.0.1:3000/auth/callback`. Spotify akzeptiert dafür kein `localhost`, nur die Loopback-IP.
4. Notiere dir **Client ID** und **Client Secret**.

> Seit Februar 2026 gelten für Apps im *Development Mode* strengere Regeln: Der Entwickler-Account braucht Spotify Premium, und es sind nur wenige freigeschaltete Nutzer erlaubt. Für ein persönliches Dashboard reicht das. Falls Spotify deine E-Mail nicht automatisch freischaltet, trage sie unter **User Management** der App ein.

### 2. Auf Render deployen

1. Forke bzw. pushe dieses Repo zu GitHub.
2. Wähle im Render-Dashboard **New → Blueprint** und dann dieses Repository.
3. Render liest `render.yaml` und legt Folgendes an:
   - `spotify-stats` als Web Service
   - `spotify-stats-sync` als Cron Job, alle 30 Minuten
   - `spotify-stats-db` als Postgres-Datenbank
4. Render fragt die geheimen Werte ab:

   | Variable | Service | Wert |
   |---|---|---|
   | `SPOTIFY_CLIENT_ID` | Web und Cron | aus Schritt 1 |
   | `SPOTIFY_CLIENT_SECRET` | Web und Cron | aus Schritt 1 |
   | `APP_PASSWORD` | Web | dein Dashboard-Passwort |

   `SESSION_SECRET` erzeugt Render automatisch, `DATABASE_URL` wird automatisch verknüpft.

### 3. Redirect-URI prüfen

Die Redirect-URI ist automatisch `${RENDER_EXTERNAL_URL}/auth/callback`, also z. B. `https://spotify-stats.onrender.com/auth/callback`. Genau diese URL muss in der Spotify-App eingetragen sein. Nutzt du eine eigene Domain, setze `SPOTIFY_REDIRECT_URI` im Web Service passend.

### 4. Verbinden

Öffne die URL, melde dich mit `APP_PASSWORD` an und klicke **Mit Spotify verbinden**. Danach passiert Folgendes automatisch:

1. Direkt nach dem Verbinden laufen ein erster Sync und ein erster Snapshot.
2. Ab dann übernimmt der Cron-Job alle 30 Minuten, auch wenn der (kostenlose) Web Service schläft.

### 5. Alte Daten importieren (optional, sehr empfehlenswert)

`recently-played` liefert nur die letzten 50 Songs. Deine komplette Historie bekommst du so:

1. Gehe auf spotify.com zu **Konto → Datenschutzeinstellungen** und fordere **„Extended streaming history“** an. Die Daten kommen nach einigen Tagen per Mail.
2. Entpacke das ZIP. Relevant sind die Dateien `Streaming_History_Audio_*.json`.
3. Import auf einem von zwei Wegen:
   - **Im Dashboard**: Klicke **Import** und ziehe die JSON-Dateien hinein.
   - **Per CLI**: Kopiere in Render bei der Datenbank die **External Database URL** und führe lokal aus:
     ```bash
     npm install
     DATABASE_URL="postgres://…render.com/spotify_stats" npm run import -- "./Spotify Extended Streaming History"
     ```
     Akzeptiert werden einzelne Dateien oder ein Ordner. Bei externen Render-URLs wird TLS automatisch aktiviert.

Der Import ist **idempotent**. Doppelte Plays werden übersprungen, auch wenn sie sich mit schon per API gespeicherten Plays überschneiden: Derselbe Track innerhalb von ±90 s gilt als derselbe Play. Podcasts, Hörbücher und Plays unter 30 s (`MIN_PLAY_MS`) werden ignoriert.

Importierte Tracks haben zunächst kein Cover und keine Künstler-ID. Der Cron-Job lädt pro Lauf bis zu `ENRICH_LIMIT` Tracks und Künstler nach, die meistgehörten zuerst. Schneller geht es mit:

```bash
DATABASE_URL=… SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… npm run cron -- --enrich-only
```

## Umgebungsvariablen

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `DATABASE_URL` | ✔ | Postgres-Connection-String |
| `SPOTIFY_CLIENT_ID` | ✔ | Spotify-App |
| `SPOTIFY_CLIENT_SECRET` | ✔ | Spotify-App |
| `APP_PASSWORD` | ✔ (Web) | Passwort fürs Dashboard |
| `SESSION_SECRET` | ✔ (Web) | Zufallswert zum Signieren der Cookies (`openssl rand -hex 32`) |
| `SPOTIFY_REDIRECT_URI` | – | Standard: `${RENDER_EXTERNAL_URL}/auth/callback` bzw. `http://127.0.0.1:$PORT/auth/callback` |
| `TIMEZONE` | – | Zeitzone für Tage, Heatmap und Snapshots (Standard `Europe/Berlin`) |
| `ENRICH_LIMIT` | – | Tracks bzw. Künstler, die pro Cron-Lauf angereichert werden (Standard 150) |
| `MIN_PLAY_MS` | – | Mindestdauer für importierte Plays (Standard 30000) |
| `SESSION_DAYS` | – | Gültigkeit des Logins in Tagen (Standard 30) |
| `PGSSL` | – | `true`/`false` erzwingt TLS für Postgres (sonst automatisch) |
| `PORT` | – | Port des Web Service (Render setzt ihn selbst) |

## Lokale Entwicklung

```bash
cp .env.example .env          # Werte eintragen
npm install
npm run dev                   # http://127.0.0.1:3000
npm run cron                  # einen Sync-Lauf manuell ausführen
npm run snapshot              # Top-Snapshot erzwingen
```

Du brauchst Node ≥ 20 und eine Postgres-Datenbank. Das Schema legt sich beim Start selbst an (`npm run migrate` geht auch einzeln).

## Gut zu wissen

- **Hördauer bei API-Plays**: `recently-played` liefert keine tatsächliche Hördauer. Für diese Plays zählt die volle Track-Länge. Importierte Plays nutzen das exakte `ms_played`.
- **Lücken**: Hörst du mehr als 50 Songs in 30 Minuten, fehlen einzelne Plays. Das ist praktisch ausgeschlossen. Bei längeren Ausfällen des Cron-Jobs schließt der nächste History-Import die Lücke.
- **Genres**: Seit den API-Änderungen vom Februar 2026 gibt es keine Batch-Endpunkte mehr, und Genres fehlen teils in Top-Listen. Das Dashboard lädt Künstler deshalb einzeln über `/artists/{id}` nach und zeigt an, für welchen Anteil der Hörzeit Genres bekannt sind. Liefert Spotify für einen Künstler keine Genres, fehlt er in der Genre-Verteilung.
- **Snapshots** entstehen beim ersten Cron-Lauf eines Tages in `TIMEZONE`. Der Rangverlauf wird also erst nach einigen Tagen interessant.
- **Kosten auf Render**: Der Web Service läuft im Free-Plan. Cron Jobs und dauerhafte Postgres-Instanzen sind kostenpflichtig (aktuelle Preise siehe render.com/pricing). Free-Postgres wird nach 30 Tagen gelöscht und eignet sich daher nicht für eine dauerhafte Historie.
- **Sicherheit**:
  - Alle Seiten und API-Routen außer `/login` und `/healthz` sind passwortgeschützt.
  - Auch die Spotify-Verknüpfung ist nur nach Login möglich.
  - Eine strenge Content-Security-Policy verhindert externe Skripte. Chart.js und die Schrift werden selbst ausgeliefert.
