# Spotlfy – persönliches Spotify-Dashboard

Ein selbst gehostetes Statistik-Dashboard für dein Spotify-Konto. Es speichert jeden Play dauerhaft in Postgres und zeigt dir Auswertungen, die Spotify selbst nicht bietet. Auf [Render](https://render.com) läuft alles in **einem einzigen Node-Web-Service** (Build `npm install`, Start `npm start`) mit einer Postgres-Datenbank.

**Features**

- Spotify-Login per **Authorization Code Flow**. Das Refresh-Token liegt in der DB und das Access-Token wird automatisch erneuert.
- **Alle 30 Minuten**: `/me/player/recently-played` abrufen und neue Plays **ohne Duplikate** speichern. Das macht ein Zeitplan in der App selbst, ein separater Cron Job ist nicht nötig.
- **Täglicher Snapshot** der Top-Artists und -Tracks (`short_term`, `medium_term`, `long_term`). Daraus entstehen Rangverlauf und „▲/▼ zur Vorwoche“.
- **Import der „Extended Streaming History“** (JSON) per Drag & Drop im Dashboard oder per Kommandozeile.
- **Dashboard**:
  - Hörminuten pro Tag und Woche
  - Top-Künstler und Top-Songs mit Covern
  - Heatmap nach Uhrzeit und Wochentag
  - Genre-Verteilung (eigene Einordnung in Hauptgenres, unabhängig von Spotify)
  - Entwicklung pro Monat
  - Spotify-Ranking mit Verlauf
  - Verlauf nach Tagen (je 5 Songs, aufklappbar, mit Hör-Aktivität pro Stunde)
- Dunkles, mobilfreundliches Design mit flüssigen Animationen.
- **Darstellung**: Hell, Dunkel, System oder **Jahreszeit** (Farbwelt wechselt exakt zu Frühlings-, Sommer-, Herbst- und Winteranfang). Wird am Konto gespeichert.
- **Festliche Effekte** (im Profil ein-/ausschaltbar): Zu Fasching (Weiberfastnacht bis Faschingsdienstag und am 11.11.), Ostern (Karfreitag bis Ostermontag), Midsommar, Weihnachten (24.–26.12.), Neujahr (31.12.–1.1.) und zum **eigenen Geburtstag** (im Profil eintragbar) erscheinen kleine Animationen: ein Gruß-Banner, Deko an Logo, Überschriften, Podium, Genre-Diagramm, Heatmap und Profil sowie ein kurzer Partikel-Effekt beim ersten Öffnen jedes Tabs. Admins können jedes Event über ein Test-Datum ausprobieren. Beim Einschalten (und einmalig beim ersten Besuch) erklärt ein kurzer Walkthrough Schritt für Schritt alle Events – durchklicken oder direkt mit ✕ schließen.
- **Sprachen**: Deutsch, Englisch, Französisch, Spanisch, Italienisch, Schwedisch und Dänisch – die gesamte Oberfläche inkl. Datums- und Zahlenformaten. Wählbar im Profil und auf der Login-Seite.
- Als App installierbar (PWA), ohne Browserleiste und ohne Zoomen.
- **Ladezustände**: Platzhalter („Skeletons“) beim ersten Laden, beim Zeitraumwechsel bleibt der alte Stand ausgegraut sichtbar.
- **Jahresrückblick** (Tab „Rückblick“): Jahresübersicht mit Top-Künstlern und -Songs, Monaten, Genre-Mix, Rekorden und ersten Song des Jahres – plus eine Vollbild-Story zum Durchtippen (teilbar). Im Dezember und Januar weist die Übersicht darauf hin.
- **Freunde vergleichen** (Tab „Freunde“): Anfrage per Benutzername, nach Bestätigung Match-Wert in %, gemeinsame Künstler und Songs, Kennzahlen im direkten Vergleich, **Top 5 nebeneinander** (Künstler, Songs, Alben, Genres, Hörzeiten; Gemeinsames hervorgehoben) und die **Sammlung des Freundes** (Plattenschrank und CD-Regal, nur ansehen). Freunde sehen nie den Verlauf.
- **Suche im Verlauf**: Songs, Künstler und Alben suchen. Ein Klick auf einen Song oder Künstler (überall in der App) öffnet die Detailansicht: erste und letzte Wiedergabe, Plays, Minuten, Rang, Lieblingszeit und Verlauf pro Monat.
- **Meilensteine** (Profil): Hörminuten (500 bis 1 Mio.) und Tagesserien (3 bis 365 Tage) mit Fortschritt und einer kleinen Feier, wenn ein neuer erreicht wird.
- **Als Playlist speichern** (Top-Listen): Die meistgehörten 10–100 Songs eines Zeitraums als private Playlist direkt in Spotify.
- **Aktuell läuft**: Der gerade gespielte Song mit Fortschritt und wie oft du ihn schon gehört hast.
- **Plattensammlung** (Übersicht): Ein Plattenschrank, der anfangs leer ist. Mit verdienten **Musiknoten** (Bronze, Silber, Gold, Platin) kaufst du im **Plattenladen** Schallplatten deiner Lieblingskünstler. Details siehe unten.
- **Datenschutz** (`/datenschutz`): Zustimmung bei der Registrierung, Hinweis für bestehende Konten, Datenexport als JSON im Profil.
- **Backup** (Admin): Komplette Datenbank als `.json.gz` herunterladen und wiederherstellen (ergänzt nur fehlende Daten, überschreibt nichts).
- **Eigene Konten**: Jeder registriert sich mit Benutzername und Passwort, verbindet danach sein Spotify-Konto und sieht nur die eigenen Werte.
- **Admin-Tab „Admin“**: Wer Admin ist, sieht oben „Meine Statistik | Admin“. Dort gibt es:

- **Kennzahlen**: registrierte Nutzer, Aktive der letzten 7 Tage, Logins, Plays.
- **Kontenliste** mit Suche: Benutzername, Spotify-Name, E-Mail, Spotify-ID, Land, Abo, Registrierung, letzter Login und Sync, Plays. Pro Konto kannst du:
  - **Jetzt synchronisieren**
  - **Passwort zurücksetzen** (zeigt einmalig ein neues Zufallspasswort)
  - **Zum Admin machen** bzw. **Admin entziehen** (der letzte Admin bleibt geschützt)
  - **Löschen** (samt aller Hördaten)
- **CSV-Export** aller Nutzer (öffnet sich direkt in Excel).
- **Letzte Logins**: die 50 neuesten Anmeldungen mit Browser und Gerät.
- **System**: Datenbankgröße, Katalog (Songs und Künstler, fehlende Cover und Genres), Sync-Läufe und Fehler der letzten 24 h, Zeitplan, Zeitzone.
- **Sync-Fehler**: die letzten fehlgeschlagenen Läufe mit Fehlermeldung.

**Wer ist Admin?** Der erste Nutzer, der sich registriert, wird automatisch Admin mit allen Funktionen. Weitere Admins ernennst du im Admin-Tab. Der letzte Admin kann weder entfernt noch gelöscht werden.

---

## Einrichtung auf Render (Schritt für Schritt)

### 1. Postgres-Datenbank anlegen

1. Wähle im Render-Dashboard **New → Postgres**.
2. Gib einen beliebigen Namen ein, z. B. `spotify-db`. Wähle als **Region** dieselbe, die du gleich für den Web Service nimmst (z. B. Frankfurt).
3. Wähle den Plan und klicke **Create Database**.
   > Die kostenlose Render-Datenbank wird nach 30 Tagen gelöscht. Für eine dauerhafte Hörhistorie brauchst du einen bezahlten Plan (z. B. *Basic 256 MB*).
4. Kopiere danach auf der Seite der Datenbank die **Internal Database URL**.

#### Alternative: kostenlose Datenbank bei Neon (ohne Ablaufdatum)

Statt Render-Postgres geht jeder Postgres-Anbieter, z. B. **[Neon](https://neon.tech)** (Free-Plan, 0,5 GB, ohne Ablaufdatum):

1. Registriere dich auf neon.tech und lege ein **Project** an. Wähle als Region z. B. *AWS Europe Central (Frankfurt)*.
2. Klicke im Projekt auf **Connect** und kopiere den **Connection string**. Er beginnt mit `postgresql://` und endet z. B. mit `?sslmode=require`.
3. Trage diesen String in Render als `DATABASE_URL` ein. Die verschlüsselte Verbindung (TLS) schaltet die App automatisch ein.

Ohne irgendeine Datenbank geht es nicht: Der kostenlose Render-Web-Service hat keine dauerhafte Festplatte. Lokale Dateien wären nach jedem Deploy weg.

### 2. Spotify-App anlegen

1. Öffne <https://developer.spotify.com/dashboard> und klicke **Create app**.
2. Name und Beschreibung sind beliebig. Wähle bei den APIs **Web API**.
3. Trage als **Redirect URI** vorerst `https://example.com/callback` ein. Die richtige URL ergänzt du in Schritt 4.
4. Notiere dir unter **Settings** die **Client ID** und das **Client Secret** („View client secret“).

> Seit Februar 2026 braucht der Entwickler-Account für Apps im *Development Mode* Spotify Premium. Falls der Login später mit „user not registered“ scheitert, trage deine Spotify-E-Mail unter **User Management** der App ein.

### 3. Web Service anlegen

1. Wähle **New → Web Service** und verbinde dieses GitHub-Repository.
2. Fülle die Felder so aus:

   | Feld | Wert |
   |---|---|
   | **Language** | **Node** (nicht Docker!) |
   | **Branch** | der Branch mit diesem Code (z. B. `main`) |
   | **Region** | dieselbe wie die Datenbank |
   | **Root Directory** | *leer lassen* |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | Free reicht |

3. Lege unter **Environment Variables** diese Werte an:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | die *Internal Database URL* aus Schritt 1 |
   | `SPOTIFY_CLIENT_ID` | aus Schritt 2 |
   | `SPOTIFY_CLIENT_SECRET` | aus Schritt 2 |
   | `TIMEZONE` | `Europe/Berlin` *(optional, ist Standard)* |

4. Klicke **Deploy Web Service**.

Unter **Settings** bleiben *Pre-Deploy Command* und *Docker Command* leer.

### 4. Redirect URI bei Spotify eintragen

Nach dem Deploy hat dein Service eine URL wie `https://spotify-xyz.onrender.com`. Trage in der Spotify-App unter **Settings → Redirect URIs** genau diese Adresse ein und speichere:

```
https://spotify-xyz.onrender.com/auth/callback
```

Den Platzhalter `https://example.com/callback` kannst du entfernen.

### 5. Loslegen

1. Öffne deine Render-URL, klicke **Registrieren** und lege dein Konto an. Als erster Nutzer wirst du automatisch Admin.
2. Klicke **Mit Spotify verbinden** und bestätige bei Spotify.
3. Danach läuft sofort ein erster Sync inklusive Top-Snapshot. Ab dann synchronisiert die App alle 30 Minuten von selbst.
4. Andere registrieren sich auf der Login-Seite unter **Registrieren** mit eigenem Benutzernamen und Passwort und verbinden danach ihr Spotify.

Siehst du statt des Logins eine Seite **„Einrichtung unvollständig“**, steht dort, welche Variable fehlt oder warum die Datenbank nicht erreichbar ist.

### Alternativ: Blueprint

Statt Schritt 1 und 3 kannst du auch **New → Blueprint** wählen und dieses Repo verbinden. `render.yaml` legt dann Datenbank und Web Service automatisch an. Render fragt nur noch nach Client ID und Client Secret.

---

## Andere Nutzer einladen

Jeder kann sich mit dem eigenen Spotify-Konto anmelden und sieht nur die eigenen Statistiken. Spotify erlaubt im **Development Mode** allerdings nur Konten, die du freigeschaltet hast:

1. Öffne <https://developer.spotify.com/dashboard> → deine App → **User Management**.
2. Trage Name und **Spotify-E-Mail-Adresse** der Person ein und speichere.
3. Danach kann sich die Person unter deiner Render-URL anmelden.

Ohne Freischaltung zeigt die Login-Seite „Dein Spotify-Konto ist für diese App noch nicht freigeschaltet“. Im Development Mode ist die Zahl der Nutzer stark begrenzt (aktuell 5). Für mehr Nutzer bräuchte die App eine „Extended Quota“, die Spotify nur Unternehmen gewährt.

Ablauf für neue Nutzer: Login-Seite → **Registrieren** (Benutzername 3–24 Zeichen, Passwort mind. 8 Zeichen) → **Mit Spotify verbinden**. Ein Spotify-Konto kann nur mit einem Spotlfy-Konto verbunden sein. Wer sein Passwort vergisst, bekommt im Admin-Tab über **Passwort zurücksetzen** ein neues. Mit `ALLOW_REGISTRATION=false` schließt du die Registrierung.

## Damit der Free-Service nicht einschläft

Render legt kostenlose Web Services nach ca. 15 Minuten ohne Aufrufe schlafen, und dann läuft auch der Sync nicht. Die App sorgt auf zwei Wegen dafür, dass trotzdem nichts verloren geht:

- **Keep-Alive**: Die App ruft alle 10 Minuten ihre eigene öffentliche URL auf (`/healthz`). Auf Render ist das automatisch aktiv, abschaltbar mit `KEEP_ALIVE=false`. Ein einzelner Service bleibt damit innerhalb der 750 freien Stunden pro Monat.
- **Nachholen**: Wann zuletzt synchronisiert wurde, steht in der Datenbank. Wacht der Service auf (oder startet neu), holt er den Sync sofort nach. Spotify liefert die letzten 50 Songs, kurze Pausen sind also kein Problem.

Zusätzlich kannst du einen **externen Pinger** nutzen, z. B. cron-job.org oder UptimeRobot:

1. Setze `CRON_SECRET` auf einen langen Zufallswert.
2. Lass den Pinger alle 30 Minuten `https://<deine-url>/cron/run?key=<CRON_SECRET>` aufrufen.

---

## Alte Daten importieren (empfohlen)

`recently-played` liefert nur die letzten 50 Songs. Deine komplette Historie bekommst du so:

1. Gehe auf spotify.com zu **Konto → Datenschutzeinstellungen** und fordere **„Extended streaming history“** an. Die Daten kommen nach einigen Tagen per Mail.
2. Entpacke das ZIP und öffne das Dashboard.
3. Klicke **Import** und ziehe alle `Streaming_History_Audio_*.json` hinein.

Alternativ per Kommandozeile mit der **External Database URL**:

```bash
npm install
DATABASE_URL="postgres://…render.com/…" npm run import -- "./Spotify Extended Streaming History"
```

Der Import ist **idempotent**. Doppelte Plays werden übersprungen, auch wenn sie sich mit schon per API gespeicherten Plays überschneiden: Derselbe Track innerhalb von ±90 s gilt als derselbe Play. Podcasts und Plays unter 30 s werden ignoriert.

Cover und Genres der importierten Songs lädt die App bei jedem Sync schrittweise nach (`ENRICH_LIMIT` pro Lauf), die meistgehörten zuerst.

---

## Umgebungsvariablen

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `DATABASE_URL` | ✔ | Postgres-Connection-String |
| `SPOTIFY_CLIENT_ID` | ✔ | Spotify-App |
| `SPOTIFY_CLIENT_SECRET` | ✔ | Spotify-App |
| `ALLOW_REGISTRATION` | – | Neue Registrierungen erlauben (Standard `true`) |
| `SPOTIFY_REDIRECT_URI` | – | Standard: `${RENDER_EXTERNAL_URL}/auth/callback`; bei eigener Domain setzen |
| `TIMEZONE` | – | Zeitzone für Tage, Heatmap und Snapshots (Standard `Europe/Berlin`) |
| `SESSION_SECRET` | – | Cookie-Schlüssel; Standard: abgeleitet aus dem Client-Secret |
| `SESSION_DAYS` | – | Gültigkeit des Logins in Tagen (Standard 30) |
| `INTERNAL_SCHEDULER` | – | Interner Zeitplan an/aus (Standard `true`) |
| `SYNC_INTERVAL_MINUTES` | – | Sync-Intervall (Standard 30) |
| `KEEP_ALIVE` | – | Selbst-Ping gegen Einschlafen (Standard: an auf Render) |
| `CRON_SECRET` | – | Aktiviert `/cron/run?key=…` für externe Trigger |
| `ENRICH_LIMIT` | – | Tracks bzw. Künstler, die pro Lauf angereichert werden (Standard 150) |
| `MIN_PLAY_MS` | – | Mindestdauer für importierte Plays (Standard 30000) |
| `OPERATOR_NAME` | für öffentliche Nutzung | Name des Verantwortlichen (Datenschutzerklärung) |
| `OPERATOR_ADDRESS` | für öffentliche Nutzung | Ladungsfähige Anschrift, Zeilen mit `|` trennen, z. B. `Musterstraße 1 \| 12345 Musterstadt` |
| `OPERATOR_EMAIL` | für öffentliche Nutzung | Kontakt-E-Mail |
| `OPERATOR_PHONE` | – | Telefon (optional) |
| `HOSTING_PROVIDER` / `DATABASE_PROVIDER` | – | Angaben in der Datenschutzerklärung überschreiben (Standard: Render bzw. automatisch aus `DATABASE_URL`) |
| `PGSSL` | – | `true`/`false` erzwingt TLS für Postgres (sonst automatisch: an für externe Hosts wie Neon/Supabase) |

## Nach dem Update: einmal Spotify neu verbinden

„Aktuell läuft“ und „Als Playlist speichern“ brauchen zwei zusätzliche Spotify-Berechtigungen (`user-read-currently-playing`, `playlist-modify-private`). Bestehende Nutzer sehen dafür einen Hinweis und verbinden Spotify einmal neu. Die Hördaten bleiben dabei erhalten. Im Development Mode muss der Besitzer der Spotify-App Premium haben, damit Playlists angelegt werden können.

## Plattensammlung & Musiknoten

**Plattenschrank**: In der Übersicht steht dein Plattenschrank, anfangs leer. Ein Klick auf eine Platte zeigt Hülle und drehende Schallplatte.

**Plattenladen**: Für jeden Nutzer jeden Montag komplett zufällig: 16 Schallplatten aus allen Alben deines Hörverlaufs (jedes Album höchstens einmal pro Woche). Die Seltenheit wird pro Platz neu gewürfelt (Platten: 55 % gewöhnlich, 28 % selten, 12 % episch, 5 % legendär; CDs: 58 / 27 / 11 / 4 %). Seltenheiten:

| Seltenheit | Ausführung | Preis |
|---|---|---|
| Gewöhnlich | Schwarzes Vinyl | 2–4 Bronze |
| Selten | Farbiges Vinyl | 1–2 Silber |
| Episch | Limitierte Picture Disc | 1–2 Gold |
| Legendär | Signierte Erstpressung | 1 Platin |

**Autogramme**: Legendäre Platten und CDs tragen ein Autogramm des Künstlers. Echte Unterschriften werden bewusst nicht nachgebildet; jeder Künstler bekommt stattdessen eine eigene, immer gleiche Handschrift (Schrift, Stiftfarbe, Neigung, Schnörkel, ggf. Stern oder Herz), abgeleitet aus seinem Namen. Die Handschrift-Schriften (Permanent Marker, Rock Salt, Mrs Saint Delafield, Homemade Apple, Caveat; SIL OFL / Apache 2.0) werden lokal über `/vendor/sign/` ausgeliefert.

Nicht jedes Album gibt es in jeder Seltenheit. 4 Noten einer Stufe lassen sich gegen 1 Note der nächsten Stufe tauschen.

**CD-Singles**: Auf der zweiten Seite des Ladens gibt es jede Woche 30 einzelne Songs deiner Lieblingskünstler als CD-Single, günstiger als Schallplatten. Sie kommen in ein eigenes **CD-Regal** (Metall, Glasböden, LED-Leiste).

| Seltenheit | Ausführung | Preis |
|---|---|---|
| Gewöhnlich | Jewel Case | 1–2 Bronze |
| Selten | Farbige Edition | 1 Silber |
| Episch | Holografische CD | 1 Gold |
| Legendär | Signierte Single | 3 Gold |

Für CD-Singles gibt es eigene Sammler-Belohnungen (1 / 10 / 25 / 50 / 100 CDs).

**Höranstoß im Laden**: Ein Teil des Angebots sind Stücke deiner Lieblingskünstler, die du **noch nie gehört** hast (4 von 16 Platten, 8 von 30 CDs), markiert mit „✨ Noch nie gehört“ und einem „▶ Reinhören“-Link. Spotlfy sucht sie einmal pro Woche über die Spotify-Suche (6 Anfragen pro Nutzer, gecacht in `discover_cache`); klappt das nicht, nimmt es ungehörte Songs und Alben dieser Künstler aus dem eigenen Katalog (z. B. von Freunden).

**Versteckte Überraschungen**: Jede Woche sind 1–2 kleine 🎁 an zufälligen Stellen in der App versteckt (z. B. Heatmap, Podium, Plattenschrank, CD-Regal, Laden, Profil, Rückblick, Freunde). Ein Klick öffnet ein Geschenk: meist Noten (3 Bronze, 2 Silber, 1 Gold, selten 1 Platin), manchmal eine Gratis-CD-Single oder Schallplatte für die Sammlung. Es gibt bewusst keinen Hinweis darauf – man muss sie selbst entdecken.

**Admin – Plattenladen kostenlos**: Im Admin-Tab schaltet ein Schalter alle Platten und CD-Singles für das eigene Admin-Konto kostenlos (zum Testen). Andere Nutzer sind nicht betroffen. Der reguläre Preis bleibt trotzdem sichtbar (im Laden durchgestrichen, in der Detailansicht mit dem Vermerk „gratis erhalten“ bzw. bei Überraschungen „geschenkt bekommen“); auch in der Sammlung eines Freundes steht der Preis.

**Musiknoten verdienen**:

| Kategorie | Belohnung |
|---|---|
| Startguthaben (erstes Öffnen) | 5 Bronze, 2 Silber, 1 Gold |
| Spotify verbunden / Geburtstag eingetragen / History importiert | 3 Bronze / 1 Silber / 1 Gold |
| Hörminuten 500 … 1 Mio. | 2 Bronze … 5 Platin |
| Tagesserie 3 … 365 Tage | 2 Bronze … 3 Platin |
| Vielfalt: 25 / 100 / 250 / 500 Künstler | 1 Silber / 1 Gold / 2 Gold / 1 Platin |
| Freunde: erster / 5 | 1 Silber / 1 Gold |
| Playlists: erste / 5 | 1 Silber / 1 Gold |
| Sammler: 1 / 10 / 25 / 50 Platten, erste legendäre | 2 Bronze / 1 Silber / 1 Gold / 1 Platin, 1 Gold |
| Täglicher Besuch | 1 Bronze pro Tag |
| Wochenhörer (120 Min. in einer Kalenderwoche) | 2 Bronze pro Woche |
| Entdecker des Monats (5 neue Künstler) | 1 Silber pro Monat |
| Geburtstagsgeschenk | 1 Gold pro Jahr |
| Jahresrückblick bis zum Ende angesehen | 1 Silber pro Jahr |
| 🎯 Tagesfrage zu deinen eigenen Hördaten (z. B. „Wer war gestern dein meistgehörter Künstler?“) | richtig 1 Silber, falsch 1 Bronze, einmal pro Tag |
| 🎵 Song des Tages: ein alter Favorit (≥ 3 Plays, seit 30 Tagen nicht gehört) heute erneut hören | 1 Silber pro Tag (wird beim Sync erkannt) |

Bereits erreichte Meilensteine werden beim ersten Öffnen nachträglich gutgeschrieben; wöchentliche und monatliche Belohnungen zählen ab dann.

## Datenschutz

Die Seite `/datenschutz` ist ohne Login erreichbar und auf der Login-Seite und in der App-Fußzeile verlinkt. Trage in Render `OPERATOR_NAME`, `OPERATOR_ADDRESS` und `OPERATOR_EMAIL` ein (Abschnitt „Verantwortlicher“), sonst zeigt die Seite einen Warnhinweis. Der Text ist eine sorgfältige Vorlage für ein privates, nicht-kommerzielles Projekt, aber **keine Rechtsberatung**.

## Backups

Im Admin-Tab unter **Backup**:

- **Backup herunterladen** erzeugt eine `spotlfy-backup-JJJJ-MM-TT.json.gz` mit allen Tabellen. Die Datei enthält Passwort-Hashes und Spotify-Tokens, bewahre sie also privat auf. Der Tab zeigt, wann zuletzt gesichert wurde, und erinnert nach 7 Tagen.
- **Backup wiederherstellen** spielt eine solche Datei ein. Es werden nur fehlende Zeilen ergänzt, vorhandene bleiben unverändert. So lässt sich nach einem Datenbank-Verlust (z. B. abgelaufene Free-Postgres auf Render) eine neue, leere Datenbank vollständig wiederherstellen: neue `DATABASE_URL` setzen, deployen, als erster Nutzer registrieren (wird Admin), Backup einspielen.
- Zusätzlich bietet Neon eine Wiederherstellung auf einen früheren Zeitpunkt (Point-in-time Restore) in der Neon-Konsole.

## Lokale Entwicklung

```bash
cp .env.example .env    # Werte eintragen
npm install
npm run dev             # http://127.0.0.1:3000
npm run cron            # einen Sync-Lauf manuell ausführen
npm run snapshot        # Top-Snapshot erzwingen
```

Du brauchst Node ≥ 20 und Postgres. Das Schema legt sich beim Start selbst an. Lokal muss in der Spotify-App die Redirect URI `http://127.0.0.1:3000/auth/callback` eingetragen sein; Spotify akzeptiert dafür kein `localhost`.

## Aufbau

| Datei | Zweck |
|---|---|
| `src/server.js` | Einstieg: prüft die Konfiguration, zeigt sonst die Setup-Seite |
| `src/app.js` | Express: Login, OAuth, JSON-API, statische Dateien |
| `src/scheduler.js` | Interner Zeitplan, Keep-Alive |
| `src/spotify.js` | OAuth, Token-Refresh, API-Client mit Retry (401/429/5xx) |
| `src/sync.js` | Recently Played, Snapshots, Anreicherung, Duplikat-Schutz |
| `src/importer.js` | Parser für `Streaming_History_Audio_*.json` |
| `src/stats.js` | SQL-Auswertungen |
| `src/features.js` | Rückblick, Suche & Details, Meilensteine, Freunde, Playlist, Aktuell läuft, Datenexport |
| `src/records.js` | Plattensammlung & CD-Singles: Musiknoten, Belohnungen, tägliche Aufgaben, wöchentlicher Laden, Kauf & Tausch |
| `src/backup.js` | Backup (gestreamt, gzip) und Wiederherstellung |
| `src/schema.sql` | Idempotentes Schema |
| `public/` | Frontend (Vanilla JS + Chart.js, ohne Build-Schritt) |

## Gut zu wissen

- **Hördauer**: Für per API erfasste Plays liefert Spotify keine echte Hördauer, daher zählt die volle Track-Länge. Importierte Plays nutzen das exakte `ms_played`.
- **Genres (eigene Einordnung)**: Spotlfy übernimmt keine Genres von Spotify. Für jeden Künstler holt die App im Hintergrund die offenen Genre-Tags von [MusicBrainz](https://musicbrainz.org) (ohne API-Key, max. 1 Anfrage/s, ca. 20 Künstler pro Minute) und ordnet sie selbst einer festen Liste von Hauptgenres zu: Pop, Hip-Hop & Rap, Rock, Electronic & Dance, R&B & Soul, Indie & Alternative, Jazz, Klassik, Country & Folk, Metal, Latin, Reggae & Dancehall, Blues, Schlager & Volksmusik, Soundtrack. Jeder Song zählt für das Hauptgenre seines Hauptkünstlers. Die Regeln stehen in `src/genres.js`.
- **Snapshots** entstehen beim ersten Sync eines Tages in `TIMEZONE`. Der Rangverlauf wird also nach einigen Tagen interessant.
- **Sicherheit**:
  - Alles außer `/login`, `/datenschutz`, `/healthz` und dem optionalen `/cron/run` erfordert eine Anmeldung. Jeder Nutzer sieht nur die eigenen Daten (Freunde nur zusammengefasste Werte nach gegenseitiger Bestätigung), `/api/admin/*` nur Admins.
  - Eine strenge Content-Security-Policy verhindert externe Skripte.
