/* Spotlfy – Datenschutzerklärung & Impressum (Deutsch maßgeblich, Englisch als Übersetzung) */
(() => {
  const I = window.SpotlfyI18n;
  const de = I.lang === 'de';
  const page = location.pathname.startsWith('/impressum') ? 'imprint' : 'privacy';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const el = document.getElementById('legal');
  document.querySelectorAll('.legal-nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `/${page === 'imprint' ? 'impressum' : 'datenschutz'}`));

  const L = (deText, enText) => (de ? deText : enText);

  function operator(c) {
    if (!c.configured) {
      return `<div class="legal-warn">${L(
        '⚠️ Die Betreiberangaben sind noch nicht eingerichtet. Der Betreiber muss in Render die Umgebungsvariablen <code>OPERATOR_NAME</code>, <code>OPERATOR_ADDRESS</code> und <code>OPERATOR_EMAIL</code> setzen.',
        '⚠️ The operator details have not been set up yet. The operator has to set the environment variables <code>OPERATOR_NAME</code>, <code>OPERATOR_ADDRESS</code> and <code>OPERATOR_EMAIL</code> on Render.',
      )}</div>`;
    }
    return `<address>${esc(c.name)}<br>${c.address.map(esc).join('<br>')}<br>
      ${L('E-Mail', 'Email')}: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.phone ? `<br>${L('Telefon', 'Phone')}: ${esc(c.phone)}` : ''}</address>`;
  }

  function imprint(c) {
    return `
      <h1>${L('Impressum', 'Legal notice')}</h1>
      <h2>${L('Angaben gemäß § 5 DDG', 'Information pursuant to § 5 DDG (German Digital Services Act)')}</h2>
      ${operator(c)}
      <h2>${L('Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV', 'Responsible for content pursuant to § 18 (2) MStV')}</h2>
      <p>${c.configured ? esc(c.name) : '–'}</p>
      <h2>${L('Hinweis', 'Note')}</h2>
      <p>${L(
        'Spotlfy ist ein privates, nicht-kommerzielles Projekt und steht in keiner Verbindung zu Spotify AB. Spotify ist eine Marke der Spotify AB. Die Musikdaten stammen über die offizielle Spotify Web API aus deinem eigenen Spotify-Konto.',
        'Spotlfy is a private, non-commercial project and is not affiliated with Spotify AB. Spotify is a trademark of Spotify AB. Music data comes from your own Spotify account via the official Spotify Web API.',
      )}</p>
      <h2>${L('Haftung für Links', 'Liability for links')}</h2>
      <p>${L(
        'Für Inhalte externer Seiten, auf die verlinkt wird (z. B. Spotify), sind ausschließlich deren Betreiber verantwortlich.',
        'The operators of linked external pages (e.g. Spotify) are solely responsible for their content.',
      )}</p>`;
  }

  function privacy(c) {
    const dbLine = c.database ? esc(c.database) : L('den vom Betreiber gewählten Postgres-Anbieter', 'the Postgres provider chosen by the operator');
    return `
      <h1>${L('Datenschutzerklärung', 'Privacy policy')}</h1>
      <p class="muted">${L('Stand: November 2026', 'Last updated: November 2026')}</p>

      <h2>1. ${L('Verantwortlicher', 'Controller')}</h2>
      ${operator(c)}

      <h2>2. ${L('Kurz zusammengefasst', 'In short')}</h2>
      <ul>
        <li>${L('Spotlfy ist ein privates Statistik-Dashboard für dein eigenes Spotify-Konto.', 'Spotlfy is a private statistics dashboard for your own Spotify account.')}</li>
        <li>${L('Keine Werbung, kein Tracking, keine Analyse-Tools, kein Verkauf von Daten.', 'No ads, no tracking, no analytics tools, no selling of data.')}</li>
        <li>${L('Schriftarten und Skripte liegen auf unserem Server – es werden keine fremden CDNs geladen.', 'Fonts and scripts are served from our own server – no third-party CDNs are loaded.')}</li>
        <li>${L('Du kannst deine Daten jederzeit exportieren und dein Konto samt aller Daten löschen (Profil).', 'You can export your data at any time and delete your account including all data (profile).')}</li>
      </ul>

      <h2>3. ${L('Welche Daten wir verarbeiten', 'What data we process')}</h2>
      <h3>${L('Spotlfy-Konto', 'Spotlfy account')}</h3>
      <p>${L(
        'Benutzername, Passwort (nur als scrypt-Hash, nie im Klartext), Einstellungen (Sprache, Darstellung, festliche Effekte), freiwillig dein Geburtstag, Zeitpunkt der Registrierung und der Logins sowie die Browser-Kennung (User-Agent) bei Logins, gesehene Meilensteine.',
        'Username, password (only as a scrypt hash, never in plain text), settings (language, appearance, festive effects), optionally your birthday, time of registration and logins, the browser identifier (user agent) of logins, and milestones you have seen.',
      )}</p>
      <h3>${L('Spotify (erst nachdem du dein Konto verbindest)', 'Spotify (only after you connect your account)')}</h3>
      <p>${L(
        'Spotify-ID, Anzeigename, E-Mail-Adresse, Profilbild, Land und Abo-Art; Zugriffs- und Aktualisierungs-Token; dein Hörverlauf (Song, Zeitpunkt, Hördauer), tägliche Schnappschüsse deiner Top-Künstler und Top-Songs, von dir hochgeladene „Extended Streaming History“, aus der Statistik erstellte Playlists (Name, Link). Der gerade laufende Song wird nur angezeigt und nicht gespeichert.',
        'Spotify ID, display name, email address, profile picture, country and plan; access and refresh tokens; your listening history (song, time, duration), daily snapshots of your top artists and songs, any “Extended Streaming History” you upload, playlists created from your statistics (name, link). The song currently playing is only displayed, not stored.',
      )}</p>
      <p>${L('Angefragte Spotify-Berechtigungen:', 'Requested Spotify permissions:')} <code>user-read-recently-played</code>, <code>user-top-read</code>, <code>user-read-private</code>, <code>user-read-email</code>, <code>user-read-currently-playing</code>, <code>playlist-modify-private</code>.
      ${L('Den Zugriff kannst du jederzeit unter', 'You can revoke access at any time at')} <a href="https://www.spotify.com/account/apps/" target="_blank" rel="noopener">spotify.com/account/apps</a>${L(' widerrufen.', '.')}</p>
      <h3>${L('Freunde', 'Friends')}</h3>
      <p>${L(
        'Wen du als Freund hinzufügst oder wer dich anfragt. Bestätigte Freunde sehen im Vergleich nur zusammengefasste Werte: Hörminuten, Plays, Anzahl Künstler und Songs, Top-Künstler, Top-Songs und Genre-Anteile – keinen Verlauf, keine Zeitpunkte und keine E-Mail-Adresse. Eine Freundschaft kannst du jederzeit beenden.',
        'Who you add as a friend or who sends you a request. Confirmed friends only see aggregated values in the comparison: listening minutes, plays, number of artists and songs, top artists, top songs and genre shares – no history, no timestamps and no email address. You can end a friendship at any time.',
      )}</p>

      <h2>4. ${L('Zwecke und Rechtsgrundlagen', 'Purposes and legal bases')}</h2>
      <ul>
        <li>${L('Bereitstellung des Dienstes und deiner Statistiken (Art. 6 Abs. 1 lit. b DSGVO).', 'Providing the service and your statistics (Art. 6(1)(b) GDPR).')}</li>
        <li>${L('Verbindung mit Spotify, Freunde-Vergleich und Geburtstag: deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), jederzeit widerrufbar.', 'Spotify connection, friend comparison and birthday: your consent (Art. 6(1)(a) GDPR), revocable at any time.')}</li>
        <li>${L('Sicherheit und Missbrauchsschutz (Login-Protokoll, Sperre nach Fehlversuchen), Backups: berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO).', 'Security and abuse prevention (login log, lockout after failed attempts), backups: legitimate interest (Art. 6(1)(f) GDPR).')}</li>
      </ul>

      <h2>5. ${L('Empfänger und Dienstleister', 'Recipients and service providers')}</h2>
      <ul>
        <li><b>Spotify</b> (Spotify AB, Regeringsgatan 19, 111 53 ${L('Stockholm, Schweden', 'Stockholm, Sweden')}): ${L('Abruf deiner Daten über die offizielle Web API. Cover und Profilbilder werden direkt von Spotify-Servern (scdn.co) geladen; dabei erhält Spotify deine IP-Adresse.', 'your data is retrieved via the official Web API. Covers and profile pictures are loaded directly from Spotify servers (scdn.co), which receive your IP address.')}</li>
        <li><b>Hosting</b>: ${esc(c.hosting)}.</li>
        <li><b>${L('Datenbank', 'Database')}</b>: ${dbLine}.</li>
        <li><b>MusicBrainz</b> (MetaBrainz Foundation, USA): ${L('zur Genre-Einordnung werden ausschließlich Künstlernamen ohne Bezug zu deiner Person abgefragt.', 'for genre classification, only artist names are queried, without any reference to you.')}</li>
      </ul>
      <p>${L(
        'Soweit Anbieter Daten in den USA verarbeiten, erfolgt die Übermittlung auf Grundlage des EU-US Data Privacy Framework (sofern der Anbieter zertifiziert ist) oder der EU-Standardvertragsklauseln (Art. 46 DSGVO).',
        'Where providers process data in the USA, transfers are based on the EU-US Data Privacy Framework (if the provider is certified) or the EU Standard Contractual Clauses (Art. 46 GDPR).',
      )}</p>
      <p>${L(
        'Administratoren dieser Installation sehen zum Betrieb: Benutzername, Spotify-Name, E-Mail, Spotify-ID, Land, Abo-Art, Login-Zeiten mit Browser und die Anzahl deiner Plays und Hörminuten.',
        'Administrators of this installation see, for operating the service: username, Spotify name, email, Spotify ID, country, plan, login times with browser, and your number of plays and listening minutes.',
      )}</p>

      <h2>6. ${L('Cookies und lokaler Speicher', 'Cookies and local storage')}</h2>
      <p>${L(
        'Wir verwenden nur technisch notwendige Cookies (§ 25 Abs. 2 TDDDG): <code>sd_session</code> hält dich angemeldet (signiert, max. 30 Tage) und <code>sd_oauth_state</code> schützt die Spotify-Anmeldung (10 Minuten). Im lokalen Speicher deines Browsers liegen nur Einstellungen wie Sprache, Darstellung und zuletzt geöffneter Tab. Es gibt keine Tracking- oder Werbe-Cookies.',
        'We only use technically necessary cookies (§ 25(2) TDDDG): <code>sd_session</code> keeps you signed in (signed, max. 30 days) and <code>sd_oauth_state</code> protects the Spotify sign-in (10 minutes). Your browser’s local storage only holds settings such as language, appearance and the last opened tab. There are no tracking or advertising cookies.',
      )}</p>

      <h2>7. ${L('Speicherdauer', 'Retention')}</h2>
      <p>${L(
        'Deine Daten bleiben gespeichert, solange dein Konto besteht. Löschst du dein Konto, werden Konto, Hörverlauf, Snapshots, Logins, Freundschaften und Playlists-Einträge sofort gelöscht. Trennst du nur Spotify, bleiben die Hördaten erhalten und kehren beim erneuten Verbinden zurück. Vom Administrator heruntergeladene Backups können Daten enthalten, bis sie gelöscht werden.',
        'Your data is kept as long as your account exists. If you delete your account, the account, listening history, snapshots, logins, friendships and playlist entries are deleted immediately. If you only disconnect Spotify, your listening data is kept and comes back when you reconnect. Backups downloaded by the administrator may contain data until they are deleted.',
      )}</p>

      <h2>8. ${L('Deine Rechte', 'Your rights')}</h2>
      <p>${L(
        'Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21 DSGVO) sowie auf Widerruf erteilter Einwilligungen (Art. 7 Abs. 3). Den Export (JSON) und die Kontolöschung findest du direkt im Profil. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO).',
        'You have the right of access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), data portability (Art. 20) and objection (Art. 21 GDPR), and to withdraw consent (Art. 7(3)). Data export (JSON) and account deletion are available directly in your profile. You may also lodge a complaint with a data protection supervisory authority (Art. 77 GDPR).',
      )}</p>

      <h2>9. ${L('Sicherheit', 'Security')}</h2>
      <p>${L(
        'Verbindungen sind per HTTPS verschlüsselt, Passwörter werden mit scrypt gehasht, Sitzungen sind signiert und Anmeldeversuche werden begrenzt.',
        'Connections are encrypted via HTTPS, passwords are hashed with scrypt, sessions are signed and sign-in attempts are rate-limited.',
      )}</p>`;
  }

  fetch('/api/legal')
    .then((r) => r.json())
    .then((c) => {
      const note = !de ? `<p class="legal-note">${esc(I.t('legal.enNote'))}</p>` : '';
      el.innerHTML = note + (page === 'imprint' ? imprint(c) : privacy(c));
      document.title = `${page === 'imprint' ? L('Impressum', 'Legal notice') : L('Datenschutz', 'Privacy')} · Spotlfy`;
    })
    .catch(() => { el.textContent = 'Error'; });
})();
