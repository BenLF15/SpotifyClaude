/* Spotlfy – Dashboard-Frontend (Vanilla JS + Chart.js) */
(() => {
  'use strict';

  // Als App installierbar machen (Android/Chrome: Vollbild ohne Browserleiste)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  // ================================================================ Helpers & Sprache
  const I = window.SpotlfyI18n;
  const t = I.t;
  const tn = I.tn;
  const LOCALE = I.locale;
  const T = window.SpotlfyTheme;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const nf = new Intl.NumberFormat(LOCALE);
  const fmt = (n) => nf.format(Math.round(n || 0));
  const decSep = nf.format(1.5).replace(/\d/g, '') || ',';
  const pctFmt = (x) => `${x < 0.1 && x > 0 ? (x * 100).toFixed(1).replace('.', decSep) : Math.round(x * 100)} %`;
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
  };

  const PANELS = ['overview', 'top', 'times', 'genres', 'trends', 'history', 'wrapped', 'friends', 'records', 'admin', 'profile'];
  const RANGE_PANELS = new Set(['overview', 'top', 'times', 'genres']);

  const state = {
    range: store.get('range', '30d'),
    timelineMode: store.get('timelineMode', 'daily'),
    trendMode: 'minutes',
    rankKind: store.get('rankKind', 'artists'),
    rankRange: store.get('rankRange', 'short_term'),
    panel: PANELS.includes(store.get('panel')) ? store.get('panel') : 'overview',
    dashboard: null,
    trends: null,
    ranking: null,
    account: null,
    spotify: null,
    status: null,
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...opts });
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code, key: data.key });
    return data;
  }
  // Fehlermeldung in der gewählten Sprache (Server liefert einen Schlüssel)
  const errMsg = (err) => (err?.key && I.D[`err.${err.key}`] ? t(`err.${err.key}`) : err?.message || String(err));
  const postJSON = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  let toastTimer;
  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  function relTime(date) {
    if (!date) return '';
    const diff = (Date.now() - new Date(date)) / 1000;
    if (diff < 60) return t('rel.now');
    if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
    if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
    return rtf.format(-Math.floor(diff / 86400), 'day');
  }

  const dateFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
  const dateFmtYear = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
  const dayMonthFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
  const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' });
  const monthFmtLong = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
  const longDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
  const longDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
  const shortDate = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parseDay = (s) => new Date(`${s}T12:00:00`);
  // Wochentage ab Montag in der gewählten Sprache (1.1.2024 war ein Montag)
  const DAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }).format(new Date(2024, 0, 1 + i)));
  const DAYS_LONG = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }).format(new Date(2024, 0, 1 + i)));
  const hh = (h) => String(h).padStart(2, '0');
  const hourRange = (h) => t('time.range', { a: hh(h), b: hh((h + 1) % 24) });
  const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function initials(name) {
    return esc((name || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '♪');
  }
  function imgOrPlaceholder(src, name) {
    return src
      ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
      : `<div class="placeholder" aria-hidden="true">${initials(name)}</div>`;
  }

  function countUp(el, to) {
    if (!el) return;
    const from = Number(el.dataset.value || 0);
    el.dataset.value = to;
    if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
    const start = performance.now();
    const dur = 900;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Balken nach dem Einfügen weich auf ihre Breite animieren
  function growBars(root, sel) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$(sel, root).forEach((b, i) => {
        b.style.transitionDelay = `${Math.min(i, 12) * 40}ms`;
        b.style.width = `${b.dataset.w}%`;
      });
    }));
  }

  // Segment-Controls mit gleitender Markierung
  function segmented(root, attr, current, onChange) {
    const buttons = $$('button', root);
    let pill = $('.seg-pill', root);
    if (!pill) { pill = document.createElement('span'); pill.className = 'seg-pill'; root.prepend(pill); }
    const select = (btn, animate = true) => {
      buttons.forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      pill.style.transition = animate ? '' : 'none';
      pill.style.width = `${btn.offsetWidth}px`;
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    };
    const initial = buttons.find((b) => b.dataset[attr] === current) || buttons[0];
    requestAnimationFrame(() => select(initial, false));
    buttons.forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-selected') === 'true') return;
      select(b);
      onChange(b.dataset[attr]);
    }));
    const realign = () => {
      const sel = buttons.find((b) => b.getAttribute('aria-selected') === 'true');
      if (sel) select(sel, false);
    };
    window.addEventListener('resize', realign);
    root.realign = realign;
  }

  // ================================================================ Chart.js
  // Diagrammfarben folgen der aktiven Farbwelt (CSS-Variablen aus styles.css)
  const COLORS = {
    // Kategoriale Reihenfolge (validiert): Blau, Orange, Aqua, Gelb, Magenta, Grün, Violett, Rot
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    other: '#4a524c',
  };
  function readThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const ink = v('--ink-rgb') || '255, 255, 255';
    Object.assign(COLORS, {
      accent: v('--accent') || '#1ed760',
      accentRgb: (v('--accent-rgb') || '30, 215, 96').replace(/\s+/g, ''),
      accentHover: v('--accent-hover') || '#3be477',
      grid: `rgba(${ink}, 0.08)`,
      tick: v('--text-3'),
      text: v('--text'),
      text2: v('--text-2'),
      surface: v('--surface'),
      tooltipBg: v('--tooltip-bg'),
      border: `rgba(${ink}, 0.16)`,
    });
  }
  readThemeColors();
  const accentA = (a) => `rgba(${COLORS.accentRgb},${a})`;
  const charts = {};

  // Gestrichelte Durchschnittslinie mit Beschriftung
  const avgLinePlugin = {
    id: 'avgLine',
    afterDatasetsDraw(chart, _args, opts) {
      if (opts?.value == null || !Number.isFinite(opts.value) || opts.value <= 0) return;
      const { ctx, chartArea: { left, right }, scales: { y } } = chart;
      const yy = y.getPixelForValue(opts.value);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = COLORS.text2;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      const text = opts.label;
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = COLORS.surface;
      ctx.fillRect(left, yy - 8, w, 16);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, left + 5, yy);
      ctx.restore();
    },
  };

  function setupChartDefaults() {
    const C = window.Chart;
    C.defaults.font.family = "'Inter', system-ui, sans-serif";
    C.defaults.font.size = 11;
    C.defaults.locale = LOCALE;
    C.defaults.color = COLORS.tick;
    C.defaults.animation.duration = reduceMotion ? 0 : 800;
    C.defaults.animation.easing = 'easeOutQuart';
    C.defaults.maintainAspectRatio = false;
    C.defaults.plugins.legend.display = false;
    Object.assign(C.defaults.plugins.tooltip, {
      backgroundColor: COLORS.tooltipBg, borderColor: COLORS.border, borderWidth: 1,
      titleColor: COLORS.text, bodyColor: COLORS.text2, padding: 10, cornerRadius: 10,
      displayColors: false, titleFont: { weight: '650' }, caretSize: 0,
    });
  }

  // Farbwelt gewechselt (oder Test-Datum geändert) → Farben neu lesen, Diagramme frisch zeichnen, Events prüfen
  window.addEventListener('spotlfy:theme', () => {
    if (!window.Chart) return;
    readThemeColors();
    setupChartDefaults();
    Object.keys(charts).forEach((k) => { charts[k].destroy(); delete charts[k]; });
    if (state.panel) renderPanel(state.panel);
    renderThemeSettings();
    updateFestive();
    if (rec.data) renderRecordsCard(); // Staub hängt vom (Test-)Datum ab
  });

  const baseScales = (extra = {}) => ({
    x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
    y: { grid: { color: COLORS.grid }, border: { display: false }, beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 5, padding: 8 } },
    ...extra,
  });

  function verticalGradient(ctx, area, rgb, top = 0.35) {
    const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, `rgba(${rgb},${top})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    return g;
  }

  function upsertChart(key, canvas, config) {
    if (charts[key] && charts[key].canvas === canvas) {
      charts[key].data = config.data;
      charts[key].options = config.options;
      charts[key].update();
    } else {
      charts[key]?.destroy();
      charts[key] = new window.Chart(canvas, config);
    }
  }

  // ================================================================ Status
  async function loadStatus() {
    const s = await api('/api/status');
    state.account = s.account;
    state.spotify = s.spotify;
    state.status = s;
    // Einstellungen des Kontos gelten auf allen Geräten
    if (T && s.account.theme && s.account.theme !== T.mode()) T.setMode(s.account.theme);
    if (s.account.lang && s.account.lang !== I.lang) {
      I.setLang(s.account.lang);
      location.reload();
      return s;
    }
    if (!s.account.lang) postJSON('/api/me/settings', { lang: I.lang }).catch(() => {});
    const sp = s.spotify;
    $('#auth-banner').hidden = !sp?.auth_expired;
    $('#user-line').textContent = sp?.display_name && sp.display_name !== s.account.username
      ? `${s.account.username} · ${sp.display_name}` : s.account.username;
    // Profil-Button oben rechts: Spotify-Bild oder Initiale
    const avatar = $('#avatar');
    const initialsEl = $('#avatar-initials');
    if (sp?.avatar_url) {
      avatar.src = sp.avatar_url;
      avatar.hidden = false;
      initialsEl.textContent = '';
    } else {
      avatar.hidden = true;
      initialsEl.textContent = (s.account.username[0] || '?').toUpperCase();
    }
    $('#admin-tab').hidden = !s.account.is_admin;
    renderProfile(s);
    updateFestive();
    maybeShowTour();
    renderNotices();
    renderWrappedPromo();
    startNowPlaying();
    return s;
  }

  // ================================================================ Darstellung (Hell/Dunkel/System/Jahreszeit)
  function seasonText() {
    const date = T.effectiveDate();
    const key = T.seasonOf(date);
    const info = T.SEASONS[key];
    const next = T.SEASONS[info.next];
    const end = T.seasonEnd(key, date);
    end.setDate(end.getDate() + 1);
    return t('season.text', {
      name: t(`season.${key}`), icon: info.icon, next: t(`season.${info.next}`), nicon: next.icon, date: longDate.format(end),
    });
  }

  function renderThemeSettings() {
    if (!T) return;
    const mode = T.mode();
    $$('#theme-picker [data-theme-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeMode === mode)));
    const override = T.seasonDate();
    const testNote = override ? ` · <span class="tag tag-warn">${esc(t('season.testDate', { d: shortDate.format(parseDay(override)) }))}</span>` : '';
    const hints = {
      system: esc(t('theme.hint.system', { x: t(T.resolve('system') === 'light' ? 'theme.word.light' : 'theme.word.dark') })),
      light: esc(t('theme.hint.light')),
      dark: esc(t('theme.hint.dark')),
      season: t('theme.hint.season', { s: seasonText() }) + testNote,
    };
    $('#theme-hint').innerHTML = hints[mode] || '';
    // Admin-Tester
    const input = $('#season-date');
    if (input) {
      if (document.activeElement !== input) input.value = override || '';
      const ev = activeEvent(T.effectiveDate());
      $('#season-status').innerHTML = [
        esc(t(override ? 'admin.testActive' : 'admin.todayApplies')),
        t('admin.seasonShows', { s: seasonText() }),
        esc(t('admin.festiveShows', { e: ev ? `${FEST[ev].deco} ${t(`fest.${ev}`)}` : t('admin.noEvent') })),
        mode !== 'season' ? `<b>${esc(t('admin.modeNote'))}</b>` : '',
        state.account && state.account.festive === false ? `<b>${esc(t('admin.festiveOffNote'))}</b>` : '',
      ].filter(Boolean).join(' · ');
    }
  }

  async function saveSettings(body) {
    try {
      await postJSON('/api/me/settings', body);
      return true;
    } catch (err) {
      toast(t('toast.settingsFailed', { e: errMsg(err) }), true);
      return false;
    }
  }

  async function chooseTheme(mode) {
    T.setMode(mode);
    await saveSettings({ theme: mode });
  }

  async function previewDate(iso, { forceSeason = false } = {}) {
    T.setSeasonDate(iso);
    if (forceSeason && T.mode() !== 'season') await chooseTheme('season');
    renderThemeSettings();
    updateFestive({ burst: true });
  }

  function renderLangPicker() {
    $('#lang-picker').innerHTML = I.LANGS.map((l) =>
      `<button type="button" role="radio" aria-checked="${l === I.lang}" data-lang="${l}"><b>${l.toUpperCase()}</b> ${esc(I.NAMES[l])}</button>`).join('');
  }

  async function chooseLang(l) {
    if (l === I.lang) return;
    I.setLang(l);
    await saveSettings({ lang: l });
    location.reload(); // Formate (Datum, Zahlen) und alle Texte neu aufbauen
  }

  // ================================================================ Profil
  function renderProfile(s) {
    renderThemeSettings();
    renderLangPicker();
    const sp = s.spotify;
    const acc = s.account;
    const av = $('#profile-avatar');
    av.innerHTML = sp?.avatar_url
      ? `<img src="${esc(sp.avatar_url)}" alt="" referrerpolicy="no-referrer" />`
      : esc((acc.username[0] || '?').toUpperCase());
    $('#profile-name').innerHTML = `${esc(acc.username)}${acc.is_admin ? ` <span class="tag tag-admin">${esc(t('role.admin'))}</span>` : ''}`;
    $('#profile-sub').textContent = [sp?.display_name, sp?.email].filter(Boolean).join(' · ') || t('profile.notConnectedSub');

    const row = (k, v) => `<dt>${esc(t(k))}</dt><dd>${v}</dd>`;
    const spRows = sp
      ? [
          row('status.label', sp.auth_expired
            ? `<span class="status-dot bad"></span>${esc(t('status.expired'))}`
            : `<span class="status-dot ok"></span>${esc(t('status.connected'))}`),
          row('profile.spotifyName', esc(sp.display_name || '–')),
          row('profile.email', esc(sp.email || '–')),
          row('profile.spotifyId', `<code>${esc(sp.id)}</code>`),
          sp.product ? row('profile.plan', esc(sp.product)) : '',
          sp.country ? row('profile.country', esc(sp.country)) : '',
        ]
      : [row('status.label', `<span class="status-dot bad"></span>${esc(t('status.notConnected'))}`)];
    $('#profile-spotify').innerHTML = spRows.join('');
    $('#profile-spotify-actions').innerHTML = sp
      ? `${sp.auth_expired ? `<a class="btn btn-primary" href="/auth/login">${esc(t('btn.reconnect'))}</a>` : ''}
         <button class="btn btn-ghost" data-action="disconnect" type="button">${esc(t('btn.disconnect'))}</button>`
      : `<a class="btn btn-primary" href="/auth/login">${esc(t('btn.connectSpotify'))}</a>`;

    if (sp && s.counts) {
      const job = s.jobs?.recently_played;
      const pending = s.counts.tracks_pending || 0;
      $('#profile-data').innerHTML = [
        row('profile.savedPlays', fmt(s.counts.plays)),
        row('profile.imported', fmt(s.counts.imported)),
        row('profile.snapshots', fmt(s.snapshots?.days)),
        row('profile.lastSync', job
          ? `<span class="status-dot ${job.ok ? 'ok' : 'bad'}"></span>${job.ok ? '' : `${esc(t('profile.failed'))} · `}${esc(relTime(job.finished_at))}`
          : '–'),
        row('profile.autoSync', esc(t('profile.every30'))),
        pending ? row('profile.waitingCovers', esc(tn('day.songs', pending, { n: fmt(pending) }))) : '',
      ].join('');
    } else {
      $('#profile-data').innerHTML = row('profile.dataLabel', esc(t('profile.noData')));
    }
    $('#profile-data-actions').hidden = !sp;

    $('#profile-account').innerHTML = [
      row('account.username', esc(acc.username)),
      row('account.role', esc(t(acc.is_admin ? 'role.admin' : 'role.user'))),
      acc.created_at ? row('account.since', esc(dateFmtYear.format(new Date(acc.created_at)))) : '',
    ].join('');
    const bInput = $('#birthday-input');
    if (document.activeElement !== bInput) bInput.value = acc.birthday || '';
    bInput.max = isoDay(new Date());
    $('#birthday-clear').hidden = !acc.birthday;

    $('#festive-switch').setAttribute('aria-checked', String(acc.festive !== false));
    renderFestiveHint();
  }

  // ================================================================ Daten laden
  let dashSeq = 0;
  async function loadDashboard() {
    const view = $('#view-stats');
    if (!state.dashboard) showDashboardSkeleton(); else view.classList.add('is-refreshing');
    const seq = ++dashSeq;
    try {
      const d = await api(`/api/dashboard?range=${state.range}`);
      if (seq !== dashSeq) return; // schneller Zeitraumwechsel: nur die letzte Antwort zählt
      state.dashboard = d;
      view.classList.remove('is-loading', 'is-refreshing');
      renderPanel(state.panel);
      renderRibbon();
    } catch (err) {
      view.classList.remove('is-loading', 'is-refreshing');
      if (err.message !== 'unauthorized' && err.code !== 'NOT_CONNECTED') toast(t('toast.loadFailed', { e: errMsg(err) }), true);
    }
  }
  async function loadTrends() {
    $('#trend-chart').parentElement.classList.add('loading');
    try {
      state.trends = await api('/api/trends');
      if (state.panel === 'trends') renderTrends();
    } catch (err) {
      if (err.message !== 'unauthorized' && err.code !== 'NOT_CONNECTED') toast(t('toast.loadFailed', { e: errMsg(err) }), true);
    }
  }
  async function loadRanking() {
    if (!state.ranking) $('#rank-list').innerHTML = skRows(6);
    $('#rank-chart').parentElement.classList.add('loading');
    try {
      state.ranking = await api(`/api/spotify-top?kind=${state.rankKind}&range=${state.rankRange}`);
      if (state.panel === 'trends') renderRanking();
    } catch (err) {
      if (err.message !== 'unauthorized' && err.code !== 'NOT_CONNECTED') toast(t('toast.loadFailed', { e: errMsg(err) }), true);
    }
  }

  function renderPanel(panel) {
    const d = state.dashboard;
    if (panel === 'trends') {
      if (state.trends) renderTrends(); else loadTrends();
      if (state.ranking) renderRanking(); else loadRanking();
      decoratePanel(panel);
      return;
    }
    if (panel === 'admin') { renderThemeSettings(); renderEventButtons(); return loadAdmin(); }
    if (panel === 'profile') { if (state.status) renderProfile(state.status); decoratePanel(panel); return; }
    if (panel === 'history') { if (history.days.length) renderHistory(); else loadHistory(true); return; }
    if (panel === 'wrapped') { if (wr.data) renderWrapped(); else loadWrapped(); return; }
    if (panel === 'friends') { if (fr.data) renderFriends(); loadFriends(); return; }
    if (panel === 'records') { renderRecords(); return; }
    if (!d) return;
    if (panel === 'overview') {
      if (rec.data) renderRecordsCard();
      renderKpis(d.overview, d.timeline.daily);
      renderInsights(d);
      renderTimeline();
      renderRankBars($('#overview-artists'), d.topArtists.slice(0, 5), 'artist');
      renderRankBars($('#overview-tracks'), d.topTracks.slice(0, 5), 'track');
    } else if (panel === 'top') {
      renderPodium(d.topArtists.slice(0, 3));
      renderRankBars($('#top-artists'), d.topArtists.slice(3, 20), 'artist', 3, d.topArtists[0]?.minutes);
      renderRankBars($('#top-tracks'), d.topTracks.slice(0, 20), 'track');
    } else if (panel === 'times') {
      renderTimeInsights(d.heatmap);
      renderHeatmap(d.heatmap);
      renderHourCharts(d.heatmap);
    } else if (panel === 'genres') {
      renderGenres(d.genres);
    }
    decoratePanel(panel);
  }

  // ================================================================ Übersicht
  function renderKpis(o, daily) {
    for (const key of ['minutes', 'avgMinutesPerDay', 'plays', 'artists', 'tracks']) {
      countUp($(`[data-kpi="${key}"]`), o[key]);
    }
    const sub = $('[data-kpi-sub="minutes"]');
    if (o.previousMinutes) {
      const pct = ((o.minutes - o.previousMinutes) / o.previousMinutes) * 100;
      const cls = pct >= 0 ? 'up' : 'down';
      sub.innerHTML = `<span class="delta ${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)} %</span> ${esc(t('kpi.vsPrev'))}`;
    } else {
      sub.textContent = t('kpi.hours', { n: fmt(o.minutes / 60) });
    }
    $('[data-kpi-sub="activeDays"]').textContent = t('kpi.onDays', { n: fmt(o.activeDays) });
    $('[data-kpi-sub="newArtists"]').textContent = o.newArtists != null ? t('kpi.newOf', { n: fmt(o.newArtists) }) : t('kpi.different');
    renderSparkline(daily);
  }

  function renderSparkline(daily) {
    const svg = $('#sparkline');
    const days = RANGE_DAYS[state.range] || 365;
    let vals = daily.slice(-days).map((r) => r.minutes);
    if (vals.length > 60) { // auf Wochen verdichten, damit die Linie ruhig bleibt
      const w = [];
      for (let i = 0; i < vals.length; i += 7) w.push(vals.slice(i, i + 7).reduce((a, b) => a + b, 0));
      vals = w;
    }
    if (vals.length < 2) { svg.innerHTML = ''; return; }
    const max = Math.max(1, ...vals);
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 120, 30 - (v / max) * 26]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    svg.innerHTML = `<defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${COLORS.accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${COLORS.accent}" stop-opacity="0"/></linearGradient></defs>
      <path class="area" d="${line}L120,32L0,32Z"/><path class="line" d="${line}"/>`;
  }

  const ICONS = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.5 3 2.5 3-1-3 0-6 0-8z"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>',
  };
  const insight = (icon, labelKey, value, sub = '') =>
    `<div class="insight"><div class="insight-icon">${ICONS[icon]}</div>
      <div class="insight-label">${esc(t(labelKey))}</div>
      <div class="insight-value" title="${esc(value)}">${esc(value)}${sub ? ` <small>${esc(sub)}</small>` : ''}</div></div>`;

  function peakOf(grid) {
    let best = { d: 0, h: 0, v: -1 };
    grid.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
    return best;
  }

  function longestStreak(daily) {
    let best = 0;
    let cur = 0;
    for (const r of daily) { cur = r.minutes > 0 ? cur + 1 : 0; best = Math.max(best, cur); }
    return best;
  }

  const genreName = (g) => (I.D[`genre.${g}`] ? t(`genre.${g}`) : g);

  function renderInsights(d) {
    const days = RANGE_DAYS[state.range] || 365;
    const daily = d.timeline.daily.slice(-days);
    const peak = peakOf(d.heatmap);
    const bestDay = daily.reduce((a, r) => (r.minutes > (a?.minutes ?? -1) ? r : a), null);
    const streak = longestStreak(daily);
    const topGenre = d.genres.items[0];
    $('#insights').innerHTML = [
      peak.v > 0 ? insight('clock', 'insight.favTime', `${DAYS[peak.d]} · ${hourRange(peak.h)}`) : insight('clock', 'insight.favTime', '–'),
      bestDay?.minutes
        ? insight('star', 'insight.bestDay', dateFmt.format(parseDay(bestDay.day)), `${fmt(bestDay.minutes)} ${t('unit.min')}`)
        : insight('star', 'insight.bestDay', '–'),
      insight('flame', 'insight.streak', tn('unit.day', streak, { n: fmt(streak) }), t('insight.inARow')),
      d.overview.newArtists != null
        ? insight('spark', 'insight.discovered', t('unit.artists', { n: fmt(d.overview.newArtists) }))
        : insight('tag', 'insight.topGenre', topGenre ? genreName(topGenre.genre) : '–', topGenre ? `${Math.round(topGenre.share * 100)} %` : ''),
    ].join('');
  }

  function renderTimeline() {
    const d = state.dashboard;
    if (!d) return;
    const weekly = state.timelineMode === 'weekly';
    const days = RANGE_DAYS[state.range] || 365;
    const rows = weekly ? d.timeline.weekly : d.timeline.daily.slice(-days);
    const labels = rows.map((r) => (weekly ? r.week : r.day));
    const values = rows.map((r) => r.minutes);
    const total = values.reduce((a, b) => a + b, 0);
    const avg = rows.length ? total / rows.length : 0;
    const max = Math.max(0, ...values);
    $('#timeline-caption').textContent = rows.length
      ? t(weekly ? 'timeline.capWeek' : 'timeline.capDay', { avg: fmt(avg), max: fmt(max) })
        + (!weekly && state.range === 'all' ? ` · ${t('timeline.last365')}` : '')
      : '';
    upsertChart('timeline', $('#timeline-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: (ctx) => (ctx.raw === max && max > 0 ? COLORS.accent : ctx.raw >= avg ? accentA(0.7) : accentA(0.38)),
          hoverBackgroundColor: COLORS.accentHover,
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom',
          barPercentage: 0.86,
          categoryPercentage: rows.length > 120 ? 1 : 0.9,
          maxBarThickness: 26,
        }],
      },
      plugins: [avgLinePlugin],
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: baseScales({
          x: {
            grid: { display: false }, border: { display: false },
            ticks: {
              maxRotation: 0, autoSkip: true, autoSkipPadding: 18,
              callback(v) {
                const day = parseDay(this.getLabelForValue(v));
                return rows.length > 60 ? monthFmt.format(day) : dayMonthFmt.format(day);
              },
            },
          },
        }),
        plugins: {
          avgLine: { value: avg, label: t('avg.label', { n: fmt(avg) }) },
          tooltip: {
            callbacks: {
              title: (items) => {
                const l = items[0].label;
                return weekly ? t('timeline.weekOf', { d: dateFmtYear.format(parseDay(l)) }) : dateFmt.format(parseDay(l));
              },
              label: (item) => {
                const diff = avg ? Math.round(((item.raw - avg) / avg) * 100) : 0;
                return t('timeline.tooltip', { n: fmt(item.raw), diff: `${diff >= 0 ? '+' : ''}${diff}` });
              },
            },
          },
        },
      },
    });
  }

  // Ranglisten mit Balken (Künstler: Minuten, Songs: Plays)
  function renderRankBars(el, list, kind, offset = 0, maxOverride) {
    if (!list.length) { el.innerHTML = offset ? '' : `<li class="empty">${esc(t('empty.range'))}</li>`; return; }
    const val = (x) => (kind === 'artist' ? x.minutes : x.plays);
    const max = maxOverride || val(list[0]) || 1;
    el.innerHTML = list.map((x, i) => `
      <li class="rb" ${kind === 'artist' ? `data-detail-artist="${esc(x.name)}"` : `data-detail-track="${esc(x.id)}"`}>
        <span class="num">${offset + i + 1}</span>
        <div class="cover${kind === 'artist' ? ' round' : ''}">${imgOrPlaceholder(x.image, x.name)}</div>
        <div class="rb-main">
          <div class="rb-title">${esc(x.name)}</div>
          <div class="rb-sub">${kind === 'artist' ? esc(t('rb.artistSub', { plays: fmt(x.plays), tracks: fmt(x.tracks) })) : esc(x.artists)}</div>
          <div class="rb-bar"><span data-w="${Math.max(2, (val(x) / max) * 100)}"></span></div>
        </div>
        <div class="rb-val">${kind === 'artist' ? `${fmt(x.minutes)}<small>${esc(t('unit.min'))}</small>` : `${fmt(x.plays)}×<small>${fmt(x.minutes)} ${esc(t('unit.min'))}</small>`}</div>
      </li>`).join('');
    growBars(el, '.rb-bar span');
  }

  function renderPodium(top3) {
    const el = $('#podium');
    if (!top3.length) { el.innerHTML = `<p class="empty">${esc(t('empty.range'))}</p>`; return; }
    const order = [top3[1], top3[0], top3[2]].map((a, i) => (a ? { a, place: [2, 1, 3][i] } : null)).filter(Boolean);
    el.innerHTML = order.map(({ a, place }) => `
      <div class="podium-item p${place}" data-detail-artist="${esc(a.name)}">
        <div class="pimg-wrap"><div class="pimg">${imgOrPlaceholder(a.image, a.name)}</div></div>
        <div class="podium-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="podium-meta">${esc(t('podium.meta', { min: fmt(a.minutes), plays: fmt(a.plays) }))}</div>
        <div class="podium-step">${place}</div>
      </div>`).join('');
  }

  // ================================================================ Hörzeiten
  function sumsOf(grid) {
    const hours = Array(24).fill(0);
    const days = Array(7).fill(0);
    grid.forEach((row, d) => row.forEach((v, h) => { hours[h] += v; days[d] += v; }));
    return { hours, days };
  }

  function renderTimeInsights(grid) {
    const { hours, days } = sumsOf(grid);
    const total = hours.reduce((a, b) => a + b, 0) || 1;
    const peakH = hours.indexOf(Math.max(...hours));
    const peakD = days.indexOf(Math.max(...days));
    const night = [22, 23, 0, 1, 2, 3, 4].reduce((a, h) => a + hours[h], 0) / total;
    const morning = [5, 6, 7, 8, 9, 10].reduce((a, h) => a + hours[h], 0) / total;
    const weekend = (days[5] + days[6]) / total;
    $('#time-insights').innerHTML = [
      insight('clock', 'insight.peakTime', hourRange(peakH)),
      insight('calendar', 'insight.favDay', DAYS_LONG[peakD]),
      night >= morning
        ? insight('moon', 'insight.nightOwl', `${Math.round(night * 100)} %`, t('time.range', { a: '22', b: '5' }))
        : insight('sun', 'insight.earlyBird', `${Math.round(morning * 100)} %`, t('time.range', { a: '5', b: '11' })),
      insight('star', 'insight.weekend', `${Math.round(weekend * 100)} %`, t('insight.ofTime')),
    ].join('');
  }

  function renderHeatmap(grid) {
    const el = $('#heatmap');
    el.classList.remove('is-ready');
    const max = Math.max(1, ...grid.flat());
    const peak = peakOf(grid);
    const wide = window.innerWidth >= 700;
    let html = '<span></span>';
    for (let h = 0; h < 24; h++) html += `<span class="heat-col-label">${h % (wide ? 3 : 6) === 0 ? h : ''}</span>`;
    grid.forEach((row, d) => {
      html += `<span class="heat-row-label">${esc(DAYS[d])}</span>`;
      row.forEach((v, h) => {
        const alpha = v === 0 ? 0.04 : 0.1 + 0.9 * Math.pow(v / max, 0.75);
        const isPeak = d === peak.d && h === peak.h && v > 0;
        html += `<span class="heat-cell${isPeak ? ' peak' : ''}" role="gridcell" data-d="${d}" data-h="${h}" data-v="${v}" data-a="${alpha.toFixed(3)}" aria-label="${esc(`${DAYS_LONG[d]} ${t('time.hour', { h })}: ${t('n.minutes', { n: v })}`)}"></span>`;
      });
    });
    el.innerHTML = html;
    $$('.heat-cell', el).forEach((c) => {
      c.style.background = accentA(c.dataset.a);
      c.style.transitionDelay = reduceMotion ? '0ms' : `${(Number(c.dataset.h) + Number(c.dataset.d) * 2) * 10}ms`;
    });
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-ready')));
  }

  function bindHeatTooltip() {
    const el = $('#heatmap');
    const tip = $('#heat-tip');
    const show = (cell) => {
      const d = Number(cell.dataset.d);
      const h = Number(cell.dataset.h);
      tip.innerHTML = `${esc(DAYS_LONG[d])}, ${esc(hourRange(h))}<br><strong>${esc(t('n.minutes', { n: fmt(cell.dataset.v) }))}</strong>`;
      const r = cell.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(r.left + r.width / 2, 90), window.innerWidth - 90)}px`;
      tip.style.top = `${r.top}px`;
      tip.hidden = false;
    };
    el.addEventListener('pointerover', (e) => { const c = e.target.closest('.heat-cell'); if (c) show(c); });
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
    el.addEventListener('click', (e) => { const c = e.target.closest('.heat-cell'); if (c) show(c); });
    window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  }

  // Balken in Akzentfarbe, Deckkraft nach Wert (eine Farbe: hell = viel)
  function intensityBars(key, canvas, labels, values, tooltipTitle) {
    const max = Math.max(1, ...values);
    upsertChart(key, canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: values.map((v) => (v === max ? COLORS.accent : accentA(0.2 + 0.6 * (v / max)))),
          hoverBackgroundColor: COLORS.accentHover,
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom',
          barPercentage: 0.82,
          categoryPercentage: 0.92,
        }],
      },
      options: {
        scales: baseScales({ y: { display: false, beginAtZero: true } }),
        plugins: {
          tooltip: { callbacks: { title: (items) => tooltipTitle(items[0].dataIndex), label: (item) => t('n.minutes', { n: fmt(item.raw) }) } },
        },
      },
    });
  }

  function renderHourCharts(grid) {
    const { hours, days } = sumsOf(grid);
    intensityBars('hours', $('#hours-chart'), hours.map((_, h) => (h % 3 === 0 ? `${h}` : '')), hours, (i) => hourRange(i));
    intensityBars('weekdays', $('#weekday-chart'), DAYS, days, (i) => DAYS_LONG[i]);
  }

  // ================================================================ Genres (eigene Einordnung)
  // Feste Farbe je Hauptgenre – die Farbe folgt dem Genre, nicht seinem Rang.
  const GENRE_COLORS = {
    Pop: '#d55181',
    'Hip-Hop & Rap': '#c98500',
    Rock: '#e66767',
    'Electronic & Dance': '#3987e5',
    'R&B & Soul': '#9085e9',
    'Indie & Alternative': '#199e70',
    Jazz: '#d95926',
    Klassik: '#c9b27c',
    'Country & Folk': '#a0703f',
    Metal: '#8a8f98',
    Latin: '#2bb3c0',
    'Reggae & Dancehall': '#3a9a3a',
    Blues: '#5b7fd1',
    'Schlager & Volksmusik': '#e8a3c0',
    Soundtrack: '#b4bcb6',
  };
  const genreColor = (g) => GENRE_COLORS[g] || COLORS.other;

  function renderGenres(g) {
    const list = $('#genres');
    const note = $('#genre-note');
    $('#genre-caption').textContent = g.items.length
      ? `${t('genres.by')} · ${t('genres.coverage', { p: `${Math.round(g.coverage * 100)} %` })}`
      : t('genres.by');
    note.textContent = [
      g.pending > 0.01 ? t('genres.pending', { p: `${Math.round(g.pending * 100)} %` }) : '',
      g.unclassifiedArtists ? t('genres.unclassified', { n: fmt(g.unclassifiedArtists) }) : '',
    ].filter(Boolean).join(' ');
    if (!g.items.length) {
      list.innerHTML = `<li class="empty">${esc(t(g.pending > 0 ? 'genres.emptyPending' : 'genres.empty'))}</li>`;
      $('#donut-center').innerHTML = '';
      charts.donut?.destroy();
      delete charts.donut;
      return;
    }
    const shown = g.items.slice(0, 8);
    const rest = g.items.slice(8);
    const restShare = rest.reduce((a, i) => a + i.share, 0);
    const labels = [...shown.map((i) => genreName(i.genre)), ...(restShare > 0.002 ? [t('genres.other')] : [])];
    const data = [...shown.map((i) => i.share), ...(restShare > 0.002 ? [restShare] : [])];
    const colors = [...shown.map((i) => genreColor(i.genre)), COLORS.other];
    upsertChart('donut', $('#genre-donut'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: COLORS.surface, borderWidth: 2, hoverOffset: 6 }] },
      options: {
        cutout: '70%',
        layout: { padding: 6 },
        animation: { animateRotate: !reduceMotion, duration: reduceMotion ? 0 : 900 },
        plugins: {
          tooltip: { displayColors: true, callbacks: { label: (item) => ` ${item.label}: ${(item.raw * 100).toFixed(1)} %` } },
        },
      },
    });
    const top = g.items[0];
    $('#donut-center').innerHTML = `<span>${esc(t('genres.no1'))}</span><b>${Math.round(top.share * 100)} %</b><strong>${esc(genreName(top.genre))}</strong>
      <small>${esc(tn('genres.count', g.items.length, { n: fmt(g.items.length) }))}</small>`;
    const max = top.share || 1;
    list.innerHTML = g.items.slice(0, 10).map((x) => {
      const color = genreColor(x.genre);
      const avatars = x.artists.slice(0, 4).map((a) => `<span title="${esc(a.name)}">${imgOrPlaceholder(a.image, a.name)}</span>`).join('');
      const chips = x.styles.slice(0, 3).map((st) => `<span class="chip">${esc(st)}</span>`).join('');
      return `<li class="gcard">
        <span class="gcard-stripe" style="background:${color}"></span>
        <span class="gcard-name">${esc(genreName(x.genre))}</span>
        <span class="gcard-pct">${pctFmt(x.share)}</span>
        <span class="gcard-bar"><span data-w="${(x.share / max) * 100}" style="background:${color}"></span></span>
        <span class="gcard-meta">
          <span class="gcard-avatars">${avatars}</span>
          <span class="gcard-sub" title="${esc(x.artists.map((a) => a.name).join(', '))}">${esc(t('gcard.sub', { min: fmt(x.minutes), n: fmt(x.artistCount) }))} ${chips}</span>
        </span>
      </li>`;
    }).join('');
    growBars(list, '.gcard-bar span');
  }

  // ================================================================ Verlauf (nach Tagen, aufklappbar)
  const DAY_PREVIEW = 5;
  const history = { days: [], hasMore: false, loading: false, open: new Set() };

  async function loadHistory(reset = false) {
    if (history.loading) return;
    history.loading = true;
    if (reset && !history.days.length) $('#history').innerHTML = skCard(`<ul class="day-list">${skRows(5)}</ul>`).repeat(2);
    try {
      const before = !reset && history.days.length ? history.days.at(-1).day : '';
      const r = await api(`/api/history${before ? `?before=${before}` : ''}`);
      history.days = reset ? r.days : [...history.days, ...r.days];
      history.hasMore = r.hasMore;
      if (state.panel === 'history') renderHistory();
    } catch (err) {
      if (err.message !== 'unauthorized' && err.code !== 'NOT_CONNECTED') toast(t('toast.loadFailed', { e: errMsg(err) }), true);
    } finally {
      history.loading = false;
    }
  }

  function dayTitle(dayStr) {
    const today = new Date();
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    if (dayStr === isoDay(today)) return t('history.today');
    if (dayStr === isoDay(yest)) return t('history.yesterday');
    return longDayFmt.format(parseDay(dayStr));
  }

  // Direkt hintereinander gehörte gleiche Songs zu einem Eintrag „×n“ zusammenfassen
  function mergeRepeats(items) {
    const out = [];
    for (const it of items) {
      const last = out.at(-1);
      if (last && last.id === it.id) last.count++;
      else out.push({ ...it, count: 1 });
    }
    return out;
  }

  const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>';

  function renderDayList(items, expanded) {
    let html = '';
    let lastHour = null;
    for (const it of items) {
      const d = new Date(it.played_at);
      if (expanded && d.getHours() !== lastHour) {
        lastHour = d.getHours();
        html += `<li class="hour-sep">${esc(t('time.hour', { h: hh(lastHour) }))}</li>`;
      }
      html += `<li class="track" data-detail-track="${esc(it.id)}">
        <div class="cover">${imgOrPlaceholder(it.image, it.name)}</div>
        <div class="t-main"><div class="t-title">${esc(it.name)}${it.count > 1 ? `<span class="repeat">${it.count}×</span>` : ''}</div><div class="t-sub">${esc(it.artists)}</div></div>
        <div class="t-stat">${timeFmt.format(d)}</div>
      </li>`;
    }
    return html;
  }

  function renderHistory() {
    const el = $('#history');
    if (!history.days.length) {
      el.innerHTML = history.loading ? '' : `<section class="card"><p class="empty">${esc(t('history.empty'))}</p></section>`;
      $('#history-more').hidden = true;
      return;
    }
    el.innerHTML = history.days.map((d) => {
      const merged = mergeRepeats(d.items);
      const open = history.open.has(d.day);
      const items = open ? merged : merged.slice(0, DAY_PREVIEW);
      const maxH = Math.max(1, ...d.hours);
      const strip = d.hours.map((m, h) => `<span class="${m ? 'on' : ''}" style="height:${m ? Math.max(18, (m / maxH) * 100) : 12}%;opacity:${m ? 0.35 + 0.65 * (m / maxH) : 1}" title="${esc(`${t('time.hour', { h: hh(h) })}: ${t('n.minutes', { n: m })}`)}"></span>`).join('');
      return `<section class="card day-card${open ? ' open' : ''}" data-day="${d.day}">
        <div class="day-head">
          <div>
            <div class="day-title">${esc(dayTitle(d.day))}</div>
            <div class="day-stats"><b>${esc(tn('day.songs', d.plays, { n: fmt(d.plays) }))}</b> · <b>${fmt(d.minutes)}</b> ${esc(t('unit.min'))}${d.topArtist ? ` · ${esc(t('history.topArtist'))}: <b>${esc(d.topArtist)}</b>` : ''}</div>
          </div>
          <div aria-label="${esc(t('history.activity'))}">
            <div class="day-strip">${strip}</div>
            <div class="day-strip-labels"><span>0</span><span>12</span><span>24</span></div>
          </div>
        </div>
        <ul class="day-list">${renderDayList(items, open)}</ul>
        ${merged.length > DAY_PREVIEW ? `<button class="day-more" type="button" data-toggle-day="${d.day}">${esc(open ? t('history.showLess') : t('history.showAll', { n: fmt(d.plays) }))} ${CHEVRON}</button>` : ''}
      </section>`;
    }).join('');
    $('#history-more').hidden = !history.hasMore || !$('#search-results').hidden;
    decoratePanel('history');
  }

  // ================================================================ Entwicklung
  function isCurrentMonth(m) {
    const now = new Date();
    return m === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function renderTrends() {
    $('#trend-chart').parentElement.classList.remove('loading');
    const rows = state.trends?.monthly || [];
    const key = state.trendMode;
    const label = t(`trends.label.${key}`);
    const values = rows.map((r) => r[key]);
    const complete = rows.filter((r) => !isCurrentMonth(r.month));
    const avg = complete.length ? complete.reduce((a, r) => a + r[key], 0) / complete.length : 0;
    const best = rows.reduce((a, r) => (r[key] > (a?.[key] ?? -1) ? r : a), null);
    $('#trend-caption').textContent = best
      ? t('trends.caption', { n: fmt(rows.length), m: monthFmtLong.format(new Date(`${best.month}-15`)), v: fmt(best[key]), label })
      : t('trends.sub');
    upsertChart('trend', $('#trend-chart'), {
      type: 'line',
      data: {
        labels: rows.map((r) => r.month),
        datasets: [{
          data: values,
          borderColor: COLORS.accent,
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          backgroundColor: (ctx) => (ctx.chart.chartArea ? verticalGradient(ctx.chart.ctx, ctx.chart.chartArea, COLORS.accentRgb) : 'transparent'),
          segment: { borderDash: (ctx) => (ctx.p1DataIndex === rows.length - 1 && isCurrentMonth(rows.at(-1)?.month) ? [5, 5] : undefined) },
          pointRadius: (ctx) => (rows[ctx.dataIndex] === best ? 5 : rows.length > 36 ? 0 : 3),
          pointHoverRadius: 6,
          pointBackgroundColor: (ctx) => (rows[ctx.dataIndex] === best ? COLORS.text : COLORS.accent),
          pointBorderColor: COLORS.surface,
          pointBorderWidth: 2,
        }],
      },
      plugins: [avgLinePlugin],
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: baseScales({
          x: {
            grid: { display: false }, border: { display: false },
            ticks: { maxRotation: 0, autoSkipPadding: 20, callback(v) { return monthFmt.format(new Date(`${this.getLabelForValue(v)}-15`)); } },
          },
        }),
        plugins: {
          avgLine: { value: avg, label: t('avg.label', { n: fmt(avg) }) },
          tooltip: {
            callbacks: {
              title: (items) => monthFmtLong.format(new Date(`${items[0].label}-15`)),
              label: (item) => `${fmt(item.raw)} ${label}${item.dataIndex === rows.length - 1 && isCurrentMonth(item.label) ? ` ${t('trends.soFar')}` : ''}`,
            },
          },
        },
      },
    });
  }

  function renderRanking() {
    const r = state.ranking;
    if (!r) return;
    $('#rank-chart').parentElement.classList.remove('loading');
    const list = $('#rank-list');
    $('#ranking-caption').textContent = r.date ? t('rank.stand', { d: dateFmtYear.format(parseDay(r.date)) }) : t('rank.sub');
    if (!r.items.length) {
      list.innerHTML = `<li class="empty">${esc(t('rank.empty'))}</li>`;
    } else {
      const round = state.rankKind === 'artists' ? ' round' : '';
      list.innerHTML = r.items.slice(0, 10).map((it) => {
        let ch = `<span class="rank-change new">${esc(t('rank.new'))}</span>`;
        if (it.prev_rank != null) {
          const diff = it.prev_rank - it.rank;
          ch = diff > 0 ? `<span class="rank-change up">▲ ${diff}</span>`
            : diff < 0 ? `<span class="rank-change down">▼ ${-diff}</span>`
            : '<span class="rank-change same">–</span>';
        }
        return `<li class="track" ${state.rankKind === 'artists' ? `data-detail-artist="${esc(it.name)}"` : `data-detail-track="${esc(it.id)}"`}>
          <span class="num">${it.rank}</span>
          <div class="cover${round}">${imgOrPlaceholder(it.image, it.name)}</div>
          <div class="t-main"><div class="t-title">${esc(it.name)}</div><div class="t-sub">${esc(it.subtitle || '')}</div></div>
          ${ch}
        </li>`;
      }).join('');
    }
    const { dates, series } = r.history;
    upsertChart('rank', $('#rank-chart'), {
      type: 'line',
      data: {
        labels: dates,
        datasets: series.map((s, i) => ({
          label: s.name,
          data: s.ranks,
          borderColor: COLORS.series[i],
          backgroundColor: COLORS.series[i],
          borderWidth: 2,
          tension: 0.3,
          spanGaps: true,
          pointRadius: dates.length > 30 ? 0 : 4,
          pointHoverRadius: 6,
          pointBorderColor: COLORS.surface,
          pointBorderWidth: 2,
        })),
      },
      options: {
        interaction: { mode: 'nearest', intersect: false },
        scales: baseScales({
          x: {
            grid: { display: false }, border: { display: false },
            ticks: { maxRotation: 0, autoSkipPadding: 20, callback(v) { return dayMonthFmt.format(parseDay(this.getLabelForValue(v))); } },
          },
          y: {
            reverse: true, min: 1, suggestedMax: 10,
            grid: { color: COLORS.grid }, border: { display: false },
            ticks: { precision: 0, maxTicksLimit: 6, padding: 8, callback: (v) => `#${v}` },
          },
        }),
        plugins: {
          legend: {
            display: series.length > 1,
            position: 'bottom',
            labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, color: COLORS.text2 },
          },
          tooltip: {
            displayColors: true,
            usePointStyle: true,
            callbacks: {
              title: (items) => dateFmtYear.format(parseDay(items[0].label)),
              label: (item) => ` ${t('rank.place', { name: item.dataset.label, n: item.raw })}`,
            },
          },
        },
      },
    });
  }

  // ================================================================ Festliche Effekte
  // Fasching, Ostern, Midsommar, Weihnachten, Neujahr und Geburtstag – mit kleinen Animationen je Tab.
  const FEST = {
    carnival: { deco: '🎭', hat: '🎭', emojis: ['🎭', '🎉', '🎊', '🥳', '🎈'], motion: 'burst', confetti: true },
    easter: { deco: '🐣', hat: '🐰', emojis: ['🥚', '🐣', '🐰', '🌷', '🥚'], motion: 'fall' },
    midsummer: { deco: '🌼', hat: '🌸', emojis: ['🌼', '🌸', '🍓', '🌿', '🌼'], motion: 'sway' },
    christmas: { deco: '🎄', hat: '⭐', emojis: ['❄️', '🎄', '⭐', '🎁', '❄️'], motion: 'snow' },
    newyear: { deco: '🎆', hat: '🎩', emojis: ['🎆', '✨', '🥂', '🎇', '✨'], motion: 'burst', confetti: true },
    birthday: { deco: '🎂', hat: '🥳', emojis: ['🎈', '🎂', '🎉', '🎁', '🎈'], motion: 'rise', confetti: true },
  };

  // Ostersonntag (gregorianisch, anonymer Algorithmus)
  function easterSunday(y) {
    const a = y % 19; const b = Math.floor(y / 100); const c = y % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dayNum = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);

  function eventsForYear(y) {
    const E = easterSunday(y);
    let fri = new Date(y, 5, 19);
    while (fri.getDay() !== 5) fri = addDays(fri, 1); // Midsommarafton: Freitag zwischen 19. und 25. Juni
    const list = [
      { key: 'carnival', start: addDays(E, -52), end: addDays(E, -47) }, // Weiberfastnacht bis Faschingsdienstag
      { key: 'carnival', start: new Date(y, 10, 11), end: new Date(y, 10, 11) }, // 11.11. Sessionsbeginn
      { key: 'easter', start: addDays(E, -2), end: addDays(E, 1) }, // Karfreitag bis Ostermontag
      { key: 'midsummer', start: fri, end: addDays(fri, 2) },
      { key: 'christmas', start: new Date(y, 11, 24), end: new Date(y, 11, 26) },
      { key: 'newyear', start: new Date(y, 11, 31), end: new Date(y + 1, 0, 1) },
    ];
    const b = state.account?.birthday;
    if (b) {
      const [, mm, dd] = b.split('-').map(Number);
      let day = dd;
      if (mm === 2 && dd === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) day = 28;
      const bd = new Date(y, mm - 1, day);
      list.unshift({ key: 'birthday', start: bd, end: bd });
    }
    return list;
  }

  function activeEvent(date) {
    const n = dayNum(date);
    const all = [...eventsForYear(date.getFullYear() - 1), ...eventsForYear(date.getFullYear())];
    const hits = all.filter((e) => n >= dayNum(e.start) && n <= dayNum(e.end));
    return (hits.find((e) => e.key === 'birthday') || hits[0])?.key || null;
  }

  function nextEvent(date) {
    const n = dayNum(date);
    return [...eventsForYear(date.getFullYear()), ...eventsForYear(date.getFullYear() + 1)]
      .filter((e) => dayNum(e.start) > n)
      .sort((a, b) => a.start - b.start)[0] || null;
  }

  const festive = { key: null };
  const festOn = () => Boolean(state.account) && state.account.festive !== false;

  function renderFestiveHint() {
    const el = $('#festive-hint');
    if (!el) return;
    if (!festOn()) { el.textContent = ''; return; }
    const date = T.effectiveDate();
    const ev = activeEvent(date);
    const nx = nextEvent(date);
    el.textContent = ev
      ? t('settings.festiveActive', { e: `${FEST[ev].deco} ${t(`fest.${ev}`)}` })
      : nx ? t('settings.festiveNext', { e: `${FEST[nx.key].deco} ${t(`fest.${nx.key}`)}`, d: longDate.format(nx.start) }) : '';
  }

  function clearFestive() {
    $$('.fest-deco').forEach((n) => n.remove());
    $('#fest-ribbon').hidden = true;
    document.documentElement.dataset.fest = '';
  }

  // Dauerhafte, kleine Deko (bleibt stehen): Logo, Überschriften, Profil
  function decorateStatic() {
    const ev = festive.key;
    if (!ev) return;
    const f = FEST[ev];
    const wrap = $('.brand-logo-wrap');
    if (wrap && !$('.fest-deco', wrap)) wrap.insertAdjacentHTML('beforeend', `<span class="fest-deco fest-badge" aria-hidden="true">${f.deco}</span>`);
    $$('[data-fest-title]').forEach((h, i) => {
      if (!$('.fest-deco', h)) h.insertAdjacentHTML('beforeend', ` <span class="fest-deco fest-title" aria-hidden="true">${f.emojis[(i + 1) % f.emojis.length]}</span>`);
    });
    const av = $('#profile-avatar');
    if (av && !$('.fest-deco', av.parentElement)) av.insertAdjacentHTML('afterend', `<span class="fest-deco fest-hat" aria-hidden="true">${f.hat}</span>`);
    renderRibbon();
  }

  function renderRibbon() {
    const el = $('#fest-ribbon');
    const ev = festive.key;
    if (!el) return;
    const dismissKey = `fest-dismiss-${ev}-${T.effectiveDate().getFullYear()}`;
    if (!ev || store.get(dismissKey)) { el.hidden = true; return; }
    const today = state.dashboard?.timeline?.daily?.at(-1)?.minutes || 0;
    el.className = `fest-ribbon fest-${ev}`;
    el.innerHTML = `<span class="fest-ribbon-icon" aria-hidden="true">${FEST[ev].deco}</span>
      <div><strong>${esc(t(`greet.${ev}`, { name: state.account?.username || '' }))}</strong>
      ${today ? `<span>${esc(t('greet.sub', { n: t('n.minutes', { n: fmt(today) }) }))}</span>` : ''}</div>
      <button type="button" class="fest-close" data-fest-dismiss="${dismissKey}" aria-label="${esc(t('fest.dismiss'))}">✕</button>`;
    el.hidden = false;
  }

  // Deko je Tab, die nach dem Rendern ergänzt wird (bleibt stehen)
  function decoratePanel(panel) {
    const ev = festive.key;
    if (!ev) return;
    const f = FEST[ev];
    if (panel === 'top') {
      const p1 = $('#podium .p1 .pimg-wrap');
      if (p1 && !$('.fest-deco', p1)) p1.insertAdjacentHTML('beforeend', `<span class="fest-deco fest-crown" aria-hidden="true">${f.hat}</span>`);
    } else if (panel === 'genres') {
      const c = $('#donut-center');
      if (c && c.innerHTML && !$('.fest-deco', c)) c.insertAdjacentHTML('afterbegin', `<span class="fest-deco fest-center" aria-hidden="true">${f.deco}</span>`);
    } else if (panel === 'times') {
      const cell = $('#heatmap .heat-cell.peak');
      if (cell && !$('.fest-deco', cell)) cell.insertAdjacentHTML('beforeend', `<span class="fest-deco fest-cell" aria-hidden="true">${f.emojis[1]}</span>`);
    } else if (panel === 'history') {
      $$('.day-card').forEach((card) => {
        const evDay = activeEvent(parseDay(card.dataset.day));
        const title = $('.day-title', card);
        if (evDay && title && !$('.fest-deco', title)) title.insertAdjacentHTML('beforeend', ` <span class="fest-deco fest-title" aria-hidden="true">${FEST[evDay].deco}</span>`);
      });
    }
  }

  let lastBurst = 0;
  // Kurze Partikel-Animation beim ersten Besuch eines Tabs (verschwindet wieder)
  function burst(panel, force = false) {
    const ev = festive.key;
    if (!ev || reduceMotion) return;
    if (Date.now() - lastBurst < 1200) return; // nicht doppelt auslösen
    const key = `fest-burst-${ev}-${panel}`;
    try { if (!force && sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* egal */ }
    lastBurst = Date.now();
    const f = FEST[ev];
    const layer = $('#fx-layer');
    const count = window.innerWidth < 600 ? 14 : 22;
    const confettiColors = ['#ff5d8f', '#ffd23f', '#3ec5ff', '#7ae582', '#b892ff', '#ff8c42'];
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      const isConf = f.confetti && i % 3 === 0;
      p.className = `fx-p fx-${f.motion}${isConf ? ' fx-conf' : ''}`;
      if (isConf) p.style.background = confettiColors[i % confettiColors.length];
      else p.textContent = f.emojis[i % f.emojis.length];
      p.style.setProperty('--x', `${rnd(4, 96)}vw`);
      p.style.setProperty('--dx', `${rnd(-18, 18)}vw`);
      p.style.setProperty('--dy', `${rnd(-45, -15)}vh`);
      p.style.setProperty('--rot', `${rnd(-260, 260)}deg`);
      p.style.setProperty('--dur', `${rnd(2.2, 3.6)}s`);
      p.style.setProperty('--delay', `${rnd(0, 0.7)}s`);
      p.style.setProperty('--size', `${rnd(18, 32)}px`);
      p.addEventListener('animationend', () => p.remove());
      setTimeout(() => p.remove(), 5500); // Sicherheitsnetz
      layer.appendChild(p);
    }
  }

  function updateFestive({ burst: doBurst = false } = {}) {
    const ev = festOn() ? activeEvent(T.effectiveDate()) : null;
    if (ev !== festive.key) {
      clearFestive();
      festive.key = ev;
      document.documentElement.dataset.fest = ev || '';
      if (ev) {
        decorateStatic();
        decoratePanel(state.panel);
        burst(state.panel, doBurst);
      }
    } else if (ev) {
      decorateStatic();
      if (doBurst) burst(state.panel, true);
    }
    renderFestiveHint();
  }

  function renderEventButtons() {
    const el = $('#event-quick');
    if (!el) return;
    el.innerHTML = Object.entries(FEST).map(([key, f]) =>
      `<button type="button" class="btn btn-ghost btn-xs" data-event-test="${key}">${f.deco} ${esc(t(`fest.${key}`))}</button>`).join('');
  }

  function testEvent(key) {
    const y = new Date().getFullYear();
    if (key === 'birthday' && !state.account?.birthday) { toast(t('admin.noBirthday'), true); return; }
    const ev = eventsForYear(y).find((e) => e.key === key && !(key === 'carnival' && e.start.getMonth() === 10));
    if (ev) previewDate(isoDay(ev.start));
  }

  // ================================================================ Walkthrough der festlichen Effekte
  const TOUR_KEYS = ['carnival', 'easter', 'midsummer', 'christmas', 'newyear', 'birthday'];
  const tour = { step: 0 };
  const tourSeenKey = () => `fest-tour-seen-${state.account?.id}`;

  function nextDateOf(key) {
    const now = T.effectiveDate();
    const n = dayNum(now);
    const hit = [...eventsForYear(now.getFullYear() - 1), ...eventsForYear(now.getFullYear()), ...eventsForYear(now.getFullYear() + 1)]
      .filter((e) => e.key === key && dayNum(e.end) >= n)
      .sort((a, b) => a.start - b.start)[0];
    return hit ? (dayNum(hit.start) <= n ? t('history.today') : longDate.format(hit.start)) : null;
  }

  function renderTour() {
    const total = TOUR_KEYS.length + 2;
    const i = tour.step;
    const ev = i >= 1 && i <= TOUR_KEYS.length ? TOUR_KEYS[i - 1] : null;
    const last = i === total - 1;
    let hero; let title; let body;
    if (i === 0) {
      hero = ['🎉', '🎄', '🐣', '🎂'];
      title = t('tour.introTitle');
      body = `<p>${esc(t('tour.introText'))}</p>`;
    } else if (ev) {
      const f = FEST[ev];
      hero = f.emojis;
      title = `${f.deco} ${t(`fest.${ev}`)}`;
      const nd = nextDateOf(ev);
      const noBd = ev === 'birthday' && !state.account?.birthday;
      body = `<p class="tour-when">${esc(t(`tour.when.${ev}`))}</p>
        <p>${esc(t(`tour.desc.${ev}`))}</p>
        ${nd && !noBd ? `<p class="tour-date">📅 ${esc(t('tour.nextDate', { d: nd }))}</p>` : ''}
        ${noBd ? `<p class="tour-date">${esc(t('tour.noBirthday'))}</p>
          <button type="button" class="btn btn-ghost btn-xs" data-tour="birthday">🎂 ${esc(t('tour.addBirthday'))}</button>` : ''}`;
    } else {
      hero = ['✨', '🎶', '✨'];
      title = t('tour.outroTitle');
      body = `<p>${esc(t('tour.outroText'))}</p>`;
    }
    const dots = Array.from({ length: total }, (_, k) =>
      `<button type="button" class="tour-dot${k === i ? ' on' : ''}" data-tour-go="${k}" aria-label="${esc(t('tour.step', { i: k + 1, n: total }))}"></button>`).join('');
    $('#tour-body').innerHTML = `
      <button type="button" class="tour-close" data-tour="close" aria-label="${esc(t('tour.close'))}">✕</button>
      <div class="tour-hero fest-${ev || 'intro'}" aria-hidden="true">
        ${hero.map((e, k) => `<span style="--k:${k}">${e}</span>`).join('')}
      </div>
      <div class="tour-content" key="${i}">
        <p class="tour-step">${esc(t('tour.step', { i: i + 1, n: total }))}</p>
        <h2 id="tour-title">${esc(title)}</h2>
        ${body}
      </div>
      <div class="tour-foot">
        <div class="tour-dots">${dots}</div>
        <div class="tour-btns">
          ${i > 0 ? `<button type="button" class="btn btn-ghost" data-tour="back">${esc(t('tour.back'))}</button>` : ''}
          <button type="button" class="btn btn-primary" data-tour="next">${esc(t(i === 0 ? 'tour.start' : last ? 'tour.done' : 'tour.next'))}</button>
        </div>
      </div>`;
  }

  function openTour() {
    const dlg = $('#fest-tour');
    if (dlg.open) return;
    tour.step = 0;
    renderTour();
    dlg.showModal();
    $('[data-tour="next"]', dlg)?.focus();
  }

  function closeTour() {
    store.set(tourSeenKey(), '1');
    const dlg = $('#fest-tour');
    if (dlg.open) dlg.close();
  }

  function bindTour() {
    const dlg = $('#fest-tour');
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { closeTour(); return; } // Klick auf den Hintergrund
      const go = e.target.closest('[data-tour-go]');
      if (go) { tour.step = Number(go.dataset.tourGo); renderTour(); return; }
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      const act = b.dataset.tour;
      if (act === 'close') closeTour();
      else if (act === 'back') { tour.step = Math.max(0, tour.step - 1); renderTour(); }
      else if (act === 'next') {
        if (tour.step >= TOUR_KEYS.length + 1) closeTour();
        else { tour.step++; renderTour(); }
      } else if (act === 'birthday') {
        closeTour();
        showPanel('profile');
        requestAnimationFrame(() => { const inp = $('#birthday-input'); inp.scrollIntoView({ block: 'center' }); inp.focus(); });
      }
    });
    dlg.addEventListener('cancel', () => store.set(tourSeenKey(), '1')); // Esc
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') $('[data-tour="next"]', dlg)?.click();
      if (e.key === 'ArrowLeft') $('[data-tour="back"]', dlg)?.click();
    });
  }

  // Beim ersten Mal mit aktiven Effekten einmalig zeigen (Standard ist „an“)
  function maybeShowTour() {
    if (festOn() && !store.get(tourSeenKey()) && !$('#import-dialog').open) setTimeout(openTour, 900);
  }

  // ================================================================ Sync & Import
  async function runSync() {
    const btn = $('#sync-btn');
    if (btn.classList.contains('is-busy')) return;
    btn.classList.add('is-busy');
    try {
      const r = await api('/api/sync', { method: 'POST' });
      const n = r.recent?.inserted ?? 0;
      toast(n ? t('toast.newPlays', { n: fmt(n) }) : t('toast.upToDate'));
      wr.data = null;
      await refreshAll();
    } catch (err) {
      toast(err.status === 409 ? t('toast.expired') : t('toast.syncFailed', { e: errMsg(err) }), true);
    } finally {
      btn.classList.remove('is-busy');
    }
  }

  function bindImport() {
    const dialog = $('#import-dialog');
    const input = $('#import-files');
    const zone = $('#dropzone');
    const log = $('#import-log');
    $('#import-btn').addEventListener('click', () => dialog.showModal());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

    async function handle(files) {
      const list = [...files].filter((f) => f.name.toLowerCase().endsWith('.json'));
      if (!list.length) return;
      let any = false;
      for (const file of list) {
        const li = document.createElement('li');
        li.innerHTML = `<span>${esc(file.name)}</span><span class="muted">${esc(t('import.running'))}</span>`;
        log.append(li);
        try {
          const text = await file.text();
          JSON.parse(text); // früh validieren
          const r = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
          li.lastElementChild.className = 'ok';
          li.lastElementChild.textContent = r.unsupported && !r.candidates
            ? t('import.short')
            : t('import.result', { n: fmt(r.inserted), d: fmt(r.duplicates) });
          any = any || r.inserted > 0;
        } catch (err) {
          li.lastElementChild.className = 'err';
          li.lastElementChild.textContent = err instanceof SyntaxError ? t('import.invalid') : errMsg(err);
        }
      }
      if (any) { toast(t('import.done')); state.trends = null; wr.data = null; refreshAll(); }
    }
    input.addEventListener('change', () => { handle(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ty) => zone.addEventListener(ty, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ty) => zone.addEventListener(ty, (e) => { e.preventDefault(); zone.classList.remove('is-over'); }));
    zone.addEventListener('drop', (e) => handle(e.dataTransfer.files));
  }

  // ================================================================ Bereiche (Ebene 1) & Ansicht
  function setupTabs() {
    const tabs = $('#panel-tabs');
    const ink = document.createElement('span');
    ink.className = 'tab-ink';
    tabs.prepend(ink);
    const place = (animate) => {
      const btn = $(`button[data-panel="${state.panel}"]`, tabs);
      $$('button', tabs).forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      if (!btn || btn.hidden) { ink.style.width = '0'; return; }
      ink.style.transition = animate ? '' : 'none';
      ink.style.width = `${btn.offsetWidth - 16}px`;
      ink.style.transform = `translateX(${btn.offsetLeft + 8}px)`;
      const left = btn.offsetLeft - tabs.clientWidth / 2 + btn.offsetWidth / 2;
      tabs.scrollTo({ left, behavior: animate && !reduceMotion ? 'smooth' : 'auto' });
    };
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-panel]');
      if (b) showPanel(b.dataset.panel);
    });
    window.addEventListener('resize', () => place(false));
    tabs.place = place;
  }

  function applyView() {
    const connected = Boolean(state.spotify);
    if (state.panel === 'admin' && state.account && !state.account.is_admin) state.panel = 'overview';
    const isAdmin = state.panel === 'admin' && Boolean(state.account?.is_admin);
    const isProfile = state.panel === 'profile';
    const special = isAdmin || isProfile;
    $('#view-admin').hidden = !isAdmin;
    $('#view-profile').hidden = !isProfile;
    $('#profile-btn').classList.toggle('is-active', isProfile);
    $('#view-connect').hidden = special || connected;
    $('#view-stats').hidden = special || !connected;
    $$('#view-stats .panel').forEach((p) => { p.hidden = p.dataset.panel !== state.panel; });
    $('#range-bar').hidden = !RANGE_PANELS.has(state.panel);
    $('#panel-tabs').place?.(true);
    // Segment-Pills in gerade sichtbar gewordenen Bereichen ausrichten
    requestAnimationFrame(() => $$('.segmented').forEach((s) => s.realign?.()));
  }

  function showPanel(panel) {
    if (!PANELS.includes(panel)) return;
    const changed = panel !== state.panel;
    state.panel = panel;
    store.set('panel', panel);
    applyView();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    if (changed) window.scrollTo({ top: 0, behavior: 'auto' });
    if (state.spotify || panel === 'admin' || panel === 'profile') renderPanel(state.panel);
    burst(panel);
  }

  async function refreshAll() {
    await loadStatus().catch((err) => {
      if (err.message !== 'unauthorized') toast(t('toast.loadFailed', { e: errMsg(err) }), true);
    });
    applyView();
    if (state.panel === 'admin') { renderEventButtons(); loadAdmin(); }
    if (!state.spotify) return;
    state.trends = null;
    state.ranking = null;
    history.days = [];
    const jobs = [loadDashboard(), loadFriends(), loadRecords()];
    if (state.panel === 'history') jobs.push(loadHistory(true));
    if (state.panel === 'trends') jobs.push(loadTrends(), loadRanking());
    await Promise.all(jobs);
    loadMilestones({ celebrate: true });
  }

  function handleQueryFlags() {
    const q = new URLSearchParams(location.search);
    if (q.has('welcome')) toast(t(q.has('admin') ? 'welcome.admin' : 'welcome.user'));
    if (q.has('connected')) toast(t('toast.connected'));
    if (q.has('spotify_error')) {
      const e = q.get('spotify_error');
      toast(I.D[`sperr.${e}`] ? t(`sperr.${e}`) : t('sperr.generic', { e }), true);
    }
    // window.history ausdrücklich, weil „history“ hier der Verlaufs-Zustand ist
    if ([...q.keys()].length) window.history.replaceState(null, '', '/');
    return q.has('connected');
  }

  // ================================================================ Konto
  async function changePassword() {
    const current = prompt(t('pw.current'));
    if (current === null) return;
    const next = prompt(t('pw.new'));
    if (next === null) return;
    if (next.length < 8) return toast(t('err.passwordShort'), true);
    if (prompt(t('pw.repeat')) !== next) return toast(t('pw.mismatch'), true);
    try {
      await postJSON('/api/me/password', { current, next });
      toast(t('pw.changed'));
    } catch (err) {
      toast(errMsg(err), true);
    }
  }

  async function disconnectSpotify() {
    if (!confirm(t('confirm.disconnect'))) return;
    try {
      await api('/api/me/disconnect', { method: 'POST' });
      location.reload();
    } catch (err) {
      toast(errMsg(err), true);
    }
  }

  async function deleteAccount() {
    if (!confirm(t('confirm.delete'))) return;
    try {
      await api('/api/me', { method: 'DELETE' });
      location.href = '/login';
    } catch (err) {
      toast(t('toast.deleteFailed', { e: errMsg(err) }), true);
    }
  }

  async function saveBirthday(value) {
    if (await saveSettings({ birthday: value || null })) {
      state.account.birthday = value || null;
      toast(t('toast.saved'));
      renderProfile(state.status);
      festive.key = undefined; // neu bewerten
      updateFestive({ burst: true });
    }
  }

  async function toggleFestive() {
    const on = !festOn();
    if (await saveSettings({ festive: on })) {
      state.account.festive = on;
      $('#festive-switch').setAttribute('aria-checked', String(on));
      if (on) openTour();
      updateFestive({ burst: on });
      renderThemeSettings();
    }
  }

  // ================================================================ Admin
  function shortAgent(ua) {
    if (!ua) return '';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return [br, os].filter(Boolean).join(' · ');
  }
  const fmtDT = (d) => (d ? dateTimeFmt.format(new Date(d)) : '–');

  function userAvatar(u) {
    return u.avatar_url
      ? `<img class="avatar-sm" src="${esc(u.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="placeholder" aria-hidden="true">${initials(u.display_name || u.id)}</div>`;
  }

  let adminAccounts = [];

  function renderAdminUsers() {
    const q = ($('#admin-search').value || '').trim().toLowerCase();
    const me = state.account?.id;
    const list = q
      ? adminAccounts.filter((u) => [u.username, u.display_name, u.email, u.spotify_user_id].some((v) => String(v || '').toLowerCase().includes(q)))
      : adminAccounts;
    $('#admin-users').innerHTML = list.length
      ? list.map((u) => `
        <li class="user-row" data-id="${u.id}">
          ${userAvatar({ ...u, display_name: u.display_name || u.username })}
          <div class="t-main">
            <div class="user-name">${esc(u.username)}
              ${u.id === me ? `<span class="tag tag-muted">${esc(t('admin.you'))}</span>` : ''}
              ${u.is_admin ? `<span class="tag tag-admin">${esc(t('role.admin'))}</span>` : ''}
              ${!u.spotify_user_id ? `<span class="tag tag-muted">${esc(t('admin.notConnected'))}</span>` : ''}
              ${u.auth_expired ? `<span class="tag tag-warn">${esc(t('status.expired'))}</span>` : ''}
              ${u.product ? `<span class="tag tag-muted">${esc(u.product)}</span>` : ''}
            </div>
            ${u.spotify_user_id ? `
              <div class="user-mail">${esc(u.display_name || '')}${u.display_name ? ' · ' : ''}${u.email ? `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : `<span class="muted">${esc(t('admin.noEmail'))}</span>`}</div>
              <div class="user-meta">${esc(t('profile.spotifyId'))} ${esc(u.spotify_user_id)}${u.country ? ` · ${esc(u.country)}` : ''} · ${esc(t('admin.lastSync'))} ${u.last_sync ? `${esc(relTime(u.last_sync))}${u.last_sync_ok === false ? ` (${esc(t('admin.error'))})` : ''}` : '–'}</div>`
              : ''}
            <div class="user-meta">${esc(t('admin.registeredAt'))} ${fmtDT(u.created_at)}</div>
            <div class="user-actions">
              ${u.spotify_user_id ? `<button class="btn btn-ghost btn-xs" data-act="sync" ${u.auth_expired ? `disabled title="${esc(t('status.expired'))}"` : ''}>${esc(t('btn.syncNow'))}</button>` : ''}
              ${u.id === me ? '' : `<button class="btn btn-ghost btn-xs" data-act="reset">${esc(t('admin.resetPw'))}</button>`}
              ${u.id === me ? '' : `<button class="btn btn-ghost btn-xs" data-act="${u.is_admin ? 'unadmin' : 'admin'}">${esc(t(u.is_admin ? 'admin.revokeAdmin' : 'admin.makeAdmin'))}</button>`}
              ${u.id === me ? '' : `<button class="btn btn-ghost btn-xs btn-danger" data-act="delete">${esc(t('admin.delete'))}</button>`}
            </div>
          </div>
          <div class="user-side">
            ${fmt(u.plays)} ${esc(t('kpi.plays'))}<small>${fmt(u.minutes)} ${esc(t('unit.min'))}</small>
            <small>Login ${esc(relTime(u.last_login_at) || '–')} · ${fmt(u.login_count)}×</small>
          </div>
        </li>`).join('')
      : `<li class="empty">${esc(t(q ? 'admin.noHits' : 'admin.noAccounts'))}</li>`;
  }

  async function adminAction(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.closest('.user-row').dataset.id);
    const u = adminAccounts.find((x) => x.id === id);
    const name = u?.username || String(id);
    const act = btn.dataset.act;
    const base = `/api/admin/accounts/${id}`;
    try {
      if (act === 'delete') {
        if (!confirm(t('admin.confirmDelete', { n: name }))) return;
        btn.disabled = true;
        await api(base, { method: 'DELETE' });
        toast(t('admin.deleted', { n: name }));
      } else if (act === 'admin' || act === 'unadmin') {
        if (act === 'admin' && !confirm(t('admin.confirmAdmin', { n: name }))) return;
        btn.disabled = true;
        await postJSON(`${base}/admin`, { admin: act === 'admin' });
        toast(t(act === 'admin' ? 'admin.nowAdmin' : 'admin.noLongerAdmin', { n: name }));
      } else if (act === 'reset') {
        if (!confirm(t('admin.confirmReset', { n: name }))) return;
        btn.disabled = true;
        const r = await api(`${base}/reset-password`, { method: 'POST' });
        prompt(t('admin.newPw', { n: r.username }), r.password);
      } else if (act === 'sync') {
        btn.disabled = true;
        btn.textContent = t('admin.syncing');
        const r = await api(`${base}/sync`, { method: 'POST' });
        toast(`${name}: ${t('toast.newPlays', { n: fmt(r.recent?.inserted ?? 0) })}`);
      }
      await loadAdmin();
    } catch (err) {
      toast(t('admin.actionFailed', { e: errMsg(err) }), true);
      btn.disabled = false;
    }
  }

  function renderSystem(sys) {
    const c = sys.catalog;
    const rows = [
      ['sys.db', `${sys.database.size} · ${sys.database.version}`],
      ['sys.plays', fmt(c.plays)],
      ['sys.songs', `${fmt(c.tracks)}${c.tracks_pending ? ` (${t('sys.noCover', { n: fmt(c.tracks_pending) })})` : ''}`],
      ['sys.artists', `${fmt(c.artists)}${c.artists_pending ? ` (${t('sys.noGenres', { n: fmt(c.artists_pending) })})` : ''}`],
      ['profile.snapshots', fmt(c.snapshots)],
      ['sys.runs', `${fmt(sys.jobs.runs_24h)} · ${sys.jobs.errors_24h ? t('sys.errors', { n: fmt(sys.jobs.errors_24h) }) : t('sys.noErrors')}`],
      ['profile.lastSync', sys.jobs.last_run ? relTime(sys.jobs.last_run) : '–'],
      ['sys.schedule', sys.config.internalScheduler ? t('sys.every', { n: sys.config.syncIntervalMinutes }) : t('switch.off')],
      ['Keep-Alive', t(sys.config.keepAlive ? 'switch.on' : 'switch.off')],
      ['sys.tz', sys.config.timezone],
      ['sys.reg', t(sys.config.allowRegistration ? 'sys.open' : 'sys.closed')],
    ];
    $('#admin-system').innerHTML = rows.map(([k, v]) => `<dt>${esc(I.D[k] ? t(k) : k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('#admin-errors').innerHTML = sys.errors.length
      ? sys.errors.map((e) => `
        <li>
          ${userAvatar({ display_name: e.username || e.display_name, id: e.user_id || '?' })}
          <div class="who">${esc(e.username || e.display_name || e.user_id || 'System')} <span>· ${esc(e.job)}</span>
            <span class="err-msg" title="${esc(e.message)}">${esc(e.message)}</span></div>
          <time datetime="${esc(e.started_at)}">${fmtDT(e.started_at)}</time>
        </li>`).join('')
      : `<li class="empty">${esc(t('admin.noErrors'))}</li>`;
  }

  async function loadAdmin() {
    if (!adminAccounts.length) $('#admin-users').innerHTML = skRows(4);
    try {
      const [d, sys] = await Promise.all([api('/api/admin/accounts'), api('/api/admin/system')]);
      const weekAgo = Date.now() - 7 * 864e5;
      countUp($('[data-admin="users"]'), d.accounts.length);
      $('[data-admin-sub="connected"]').textContent = t('admin.withSpotify', { n: fmt(d.accounts.filter((u) => u.spotify_user_id).length) });
      countUp($('[data-admin="active"]'), d.accounts.filter((u) => u.last_seen_at && new Date(u.last_seen_at) > weekAgo).length);
      countUp($('[data-admin="logins"]'), d.accounts.reduce((a, u) => a + (u.login_count || 0), 0));
      countUp($('[data-admin="plays"]'), d.accounts.reduce((a, u) => a + (u.plays || 0), 0));
      adminAccounts = d.accounts;
      renderAdminUsers();
      renderSystem(sys);
      loadBackupInfo();
      $('#admin-logins').innerHTML = d.logins.length
        ? d.logins.map((l) => `
          <li>
            ${userAvatar({ ...l, display_name: l.username, id: String(l.account_id) })}
            <div class="who">${esc(l.username)} <span>${esc([l.display_name, l.email, shortAgent(l.user_agent)].filter(Boolean).join(' · '))}</span></div>
            <time datetime="${esc(l.at)}">${fmtDT(l.at)}</time>
          </li>`).join('')
        : `<li class="empty">${esc(t('admin.noLogins'))}</li>`;
    } catch (err) {
      if (err.message !== 'unauthorized') toast(t('admin.actionFailed', { e: errMsg(err) }), true);
    }
  }

  // ================================================================ Ladezustände (Skeletons)
  const SK_ROW = '<li class="sk-row" aria-hidden="true"><span class="sk sk-cover"></span><span class="sk-lines"><span class="sk sk-line"></span><span class="sk sk-line short"></span></span></li>';
  const skRows = (n) => SK_ROW.repeat(n);
  const skInsights = (n) => '<div class="insight sk-card" aria-hidden="true"><span class="sk sk-icon"></span><span class="sk sk-line short"></span><span class="sk sk-line"></span></div>'.repeat(n);
  const skBlock = (h, cls = '') => `<div class="sk sk-block ${cls}" style="height:${h}px" aria-hidden="true"></div>`;
  const skCard = (inner) => `<section class="card sk-wrap" aria-busy="true">${inner}</section>`;

  function showDashboardSkeleton() {
    $('#view-stats').classList.add('is-loading');
    $$('[data-kpi]').forEach((el) => { el.innerHTML = '<span class="sk sk-num"></span>'; el.dataset.value = 0; });
    $$('[data-kpi-sub]').forEach((el) => { el.innerHTML = '<span class="sk sk-line short"></span>'; });
    $('#insights').innerHTML = skInsights(4);
    $('#time-insights').innerHTML = skInsights(4);
    ['#overview-artists', '#overview-tracks', '#genres'].forEach((s) => { $(s).innerHTML = skRows(5); });
    $('#top-artists').innerHTML = skRows(6);
    $('#top-tracks').innerHTML = skRows(8);
    $('#podium').innerHTML = [2, 1, 3].map((p) => `<div class="podium-item p${p}"><div class="pimg-wrap"><div class="pimg sk"></div></div><span class="sk sk-line short"></span></div>`).join('');
    $('#heatmap').innerHTML = skBlock(190, 'sk-span');
    $('#donut-center').innerHTML = '';
  }

  // ================================================================ Allgemeines: Dialoge & Konfetti
  const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>';
  const CLOSE_BTN = (extra = '') => `<button type="button" class="tour-close ${extra}" data-close-dialog aria-label="${esc(t('tour.close'))}">✕</button>`;

  function confetti(container = $('#fx-layer'), n = 36) {
    if (reduceMotion || !container) return;
    const colors = ['#ff5d8f', '#ffd23f', '#3ec5ff', '#7ae582', '#b892ff', '#ff8c42'];
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      p.className = 'fx-p fx-burst fx-conf';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--x', `${rnd(4, 96)}%`);
      p.style.setProperty('--dx', `${rnd(-15, 15)}vw`);
      p.style.setProperty('--dy', `${rnd(-50, -20)}vh`);
      p.style.setProperty('--rot', `${rnd(-300, 300)}deg`);
      p.style.setProperty('--dur', `${rnd(1.8, 3)}s`);
      p.style.setProperty('--delay', `${rnd(0, 0.4)}s`);
      p.addEventListener('animationend', () => p.remove());
      setTimeout(() => p.remove(), 4500);
      container.appendChild(p);
    }
  }

  // Erst zeigen, wenn kein anderer Dialog offen ist (z. B. Walkthrough)
  function whenNoDialog(fn) {
    if (!document.querySelector('dialog[open]')) { fn(); return; }
    const iv = setInterval(() => { if (!document.querySelector('dialog[open]')) { clearInterval(iv); setTimeout(fn, 400); } }, 800);
  }

  const PERIODS = ['7d', '30d', '90d', '365d', 'all'];
  const periodName = (r) => t(`period.${r}`);
  const compactFmt = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });

  // Lückenlose Monatsreihe (YYYY-MM) zwischen erstem und letztem Monat
  function fillMonths(rows, key) {
    if (!rows.length) return { labels: [], values: [] };
    const map = new Map(rows.map((r) => [r.month, r[key]]));
    const [y0, m0] = rows[0].month.split('-').map(Number);
    const [y1, m1] = rows.at(-1).month.split('-').map(Number);
    const labels = [];
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, m = 1) : m++) labels.push(`${y}-${String(m).padStart(2, '0')}`);
    return { labels, values: labels.map((l) => map.get(l) || 0) };
  }

  // ================================================================ Aktuell läuft
  const np = { data: null, fetchedAt: 0, lastPoll: 0, timer: null, tick: null };

  async function pollNowPlaying() {
    if (!state.spotify || state.spotify.auth_expired || document.visibilityState !== 'visible') return;
    np.lastPoll = Date.now();
    try {
      np.data = await api('/api/now-playing');
      np.fetchedAt = Date.now();
    } catch {
      np.data = null;
    }
    renderNowPlaying();
  }

  function renderNowPlaying() {
    const el = $('#now-playing');
    const d = np.data;
    if (!d?.playing) { el.hidden = true; el.innerHTML = ''; delete el.dataset.track; return; }
    const tr = d.track;
    if (el.dataset.track !== tr.id) {
      el.dataset.track = tr.id;
      el.innerHTML = `
        <button type="button" class="np-main"${d.timesPlayed ? ` data-detail-track="${esc(tr.id)}"` : ''}>
          <span class="np-cover">${imgOrPlaceholder(tr.image, tr.name)}</span>
          <span class="np-text">
            <span class="np-label"><span class="np-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="np-state"></span></span>
            <span class="np-title">${esc(tr.name)}</span>
            <span class="np-sub">${esc(tr.artists)}<span class="np-count"></span></span>
          </span>
        </button>
        <a class="np-open" href="${esc(tr.url)}" target="_blank" rel="noopener" title="${esc(t('np.open'))}" aria-label="${esc(t('np.open'))}">${LINK_ICON}</a>
        <span class="np-progress" aria-hidden="true"><span></span></span>`;
      el.classList.remove('np-in');
      void el.offsetWidth;
      el.classList.add('np-in');
    }
    el.classList.toggle('paused', !d.is_playing);
    $('.np-state', el).textContent = t(d.is_playing ? 'np.playing' : 'np.paused');
    $('.np-count', el).textContent = ` · ${d.timesPlayed ? t('np.times', { n: fmt(d.timesPlayed) }) : t('np.first')}`;
    el.hidden = false;
    updateNpProgress();
  }

  function updateNpProgress() {
    const d = np.data;
    if (!d?.playing) return;
    const pos = Math.min(d.duration_ms, d.progress_ms + (d.is_playing ? Date.now() - np.fetchedAt : 0));
    const bar = $('#now-playing .np-progress span');
    if (bar) bar.style.width = `${d.duration_ms ? (pos / d.duration_ms) * 100 : 0}%`;
    // Song zu Ende → gleich nachsehen, was als Nächstes läuft
    if (d.is_playing && pos >= d.duration_ms && Date.now() - np.lastPoll > 4000) pollNowPlaying();
  }

  function startNowPlaying() {
    if (np.timer || !state.spotify || state.spotify.missing_scopes?.includes('user-read-currently-playing')) return;
    pollNowPlaying();
    np.timer = setInterval(pollNowPlaying, 20_000);
    np.tick = setInterval(updateNpProgress, 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollNowPlaying(); });
  }

  // ================================================================ Hinweise: Datenschutz & neue Berechtigungen
  function renderNotices() {
    const acc = state.account;
    const sp = state.spotify;
    $('#privacy-banner').hidden = !acc || acc.privacy_accepted;
    const scopeKey = 'scope-dismiss';
    const dismissed = Number(store.get(scopeKey, 0)) > Date.now();
    $('#scope-banner').hidden = !sp || sp.auth_expired || !sp.missing_scopes?.length || dismissed;
  }

  async function acceptPrivacy() {
    try {
      await api('/api/me/privacy', { method: 'POST' });
      state.account.privacy_accepted = true;
      renderNotices();
      toast(t('toast.saved'));
    } catch (err) {
      toast(errMsg(err), true);
    }
  }

  // ================================================================ Details zu Song / Künstler
  async function openDetail(kind, key) {
    const dlg = $('#detail-dialog');
    const body = $('#detail-body');
    body.innerHTML = `${CLOSE_BTN('detail-close')}
      <div class="detail-head"><span class="sk sk-cover-lg"></span><span class="sk-lines"><span class="sk sk-line short"></span><span class="sk sk-line"></span></span></div>
      ${skBlock(70)}${skBlock(150)}`;
    if (!dlg.open) dlg.showModal();
    try {
      const d = await api(kind === 'track' ? `/api/track/${encodeURIComponent(key)}` : `/api/artist?name=${encodeURIComponent(key)}`);
      renderDetail(d);
    } catch (err) {
      body.innerHTML = `${CLOSE_BTN('detail-close')}<p class="empty detail-empty">${esc(err.key === 'notFound' ? t('detail.notFound') : errMsg(err))}</p>`;
    }
  }

  function renderDetail(d) {
    const isArtist = d.type === 'artist';
    const fav = d.favourite || {};
    const stat = (label, val) => `<div class="dstat"><span>${esc(label)}</span><b>${val}</b></div>`;
    const genreLine = isArtist && d.main_genre
      ? `<p class="muted small">${esc(genreName(d.main_genre))}${d.styles?.length ? ` · ${d.styles.slice(0, 3).map(esc).join(', ')}` : ''}</p>` : '';
    const sub = isArtist
      ? genreLine
      : `<p class="muted small"><button type="button" class="link-btn inline" data-detail-artist="${esc(d.artist)}">${esc(d.artists)}</button>${d.album ? ` · ${esc(d.album)}` : ''}</p>`;
    const maxPlays = Math.max(1, ...(d.topTracks || []).map((x) => x.plays));
    $('#detail-body').innerHTML = `${CLOSE_BTN('detail-close')}
      <div class="detail-head">
        <div class="detail-cover${isArtist ? ' round' : ''}">${imgOrPlaceholder(d.image, d.name)}</div>
        <div class="detail-who">
          <span class="detail-kind">${esc(t(isArtist ? 'detail.artist' : 'detail.track'))} · ${esc(t('detail.rank', { n: fmt(d.rank) }))}</span>
          <h2 id="detail-title">${esc(d.name)}</h2>
          ${sub}
        </div>
      </div>
      <div class="detail-stats">
        ${stat(t('kpi.plays'), fmt(d.plays))}
        ${stat(t('detail.minutes'), fmt(d.minutes))}
        ${isArtist ? stat(t('kpi.songs'), fmt(d.tracks)) : ''}
        ${stat(t('detail.first'), esc(dateFmtYear.format(new Date(d.first))))}
        ${stat(t('detail.last'), esc(relTime(d.last)))}
        ${stat(t('insight.favTime'), fav.hour != null ? esc(`${DAYS[fav.weekday]} · ${hourRange(fav.hour)}`) : '–')}
      </div>
      <h3 class="detail-h">${esc(t(isArtist ? 'detail.minutesPerMonth' : 'detail.playsPerMonth'))}</h3>
      <div class="chart-wrap short"><canvas id="detail-chart" role="img" aria-label="${esc(t('detail.perMonth'))}"></canvas></div>
      ${isArtist
        ? `<h3 class="detail-h">${esc(t('detail.topSongs'))}</h3>
           <ol class="rank-bars">${d.topTracks.map((x, i) => `
             <li class="rb" data-detail-track="${esc(x.id)}">
               <span class="num">${i + 1}</span>
               <div class="cover">${imgOrPlaceholder(x.image, x.name)}</div>
               <div class="rb-main"><div class="rb-title">${esc(x.name)}</div><div class="rb-bar"><span data-w="${Math.max(3, (x.plays / maxPlays) * 100)}"></span></div></div>
               <div class="rb-val">${fmt(x.plays)}×<small>${fmt(x.minutes)} ${esc(t('unit.min'))}</small></div>
             </li>`).join('')}</ol>`
        : `<h3 class="detail-h">${esc(t('detail.recent'))}</h3>
           <ul class="detail-recent">${(d.recent || []).map((r) => `<li>${esc(dateTimeFmt.format(new Date(r)))}</li>`).join('')}</ul>`}
      ${d.url ? `<a class="btn btn-primary detail-open" href="${esc(d.url)}" target="_blank" rel="noopener">${LINK_ICON}<span>${esc(t('np.open'))}</span></a>` : ''}`;
    growBars($('#detail-body'), '.rb-bar span');
    const { labels, values } = fillMonths(d.monthly || [], isArtist ? 'minutes' : 'plays');
    intensityBars('detail', $('#detail-chart'), labels.map((l) => monthFmt.format(new Date(`${l}-15`))), values,
      (i) => monthFmtLong.format(new Date(`${labels[i]}-15`)));
    if (isArtist) charts.detail.options.plugins.tooltip.callbacks.label = (item) => t('n.minutes', { n: fmt(item.raw) });
    else charts.detail.options.plugins.tooltip.callbacks.label = (item) => `${fmt(item.raw)}×`;
  }

  // ================================================================ Suche im Verlauf
  let searchTimer;
  let searchSeq = 0;
  const hl = (text, q) => {
    const s = String(text || '');
    const i = s.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`;
  };

  async function runSearch() {
    const q = $('#search-input').value.trim();
    const box = $('#search-results');
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; $('#history').hidden = false; return; }
    const seq = ++searchSeq;
    box.hidden = false;
    $('#history').hidden = true;
    $('#history-more').hidden = true;
    box.innerHTML = `<ul class="search-tracks">${skRows(4)}</ul>`;
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return;
      if (!r.tracks.length && !r.artists.length) { box.innerHTML = `<p class="empty">${esc(t('search.none', { q }))}</p>`; return; }
      box.innerHTML = `
        ${r.artists.length ? `<h3 class="search-h">${esc(t('kpi.artists'))}</h3>
          <div class="search-artists">${r.artists.map((a) => `
            <button type="button" class="artist-chip" data-detail-artist="${esc(a.name)}">
              <span class="cover round">${imgOrPlaceholder(a.image, a.name)}</span>
              <span class="ac-text"><b>${hl(a.name, q)}</b><small>${esc(t('search.artistSub', { plays: fmt(a.plays), min: fmt(a.minutes) }))}</small></span>
            </button>`).join('')}</div>` : ''}
        ${r.tracks.length ? `<h3 class="search-h">${esc(t('kpi.songs'))}</h3>
          <ul class="search-tracks">${r.tracks.map((x) => `
            <li class="track" data-detail-track="${esc(x.id)}">
              <div class="cover">${imgOrPlaceholder(x.image, x.name)}</div>
              <div class="t-main"><div class="t-title">${hl(x.name, q)}</div><div class="t-sub">${hl(x.artists, q)}</div></div>
              <div class="t-stat"><b>${fmt(x.plays)}×</b><small>${esc(t('search.since', { d: dateFmtYear.format(new Date(x.first)) }))}</small></div>
            </li>`).join('')}</ul>` : ''}`;
    } catch (err) {
      if (seq === searchSeq) box.innerHTML = `<p class="empty">${esc(errMsg(err))}</p>`;
    }
  }

  function bindSearch() {
    const input = $('#search-input');
    input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 280); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); input.blur(); } });
  }

  // ================================================================ Meilensteine (Hörminuten & Tagesserie)
  const ms = { data: null };
  const MS_ICON = { minutes: '🎧', streak: '🔥' };
  const msName = (m) => (m.kind === 'minutes' ? t('ms.minutesName', { n: fmt(m.value) }) : t('ms.streakName', { n: fmt(m.value) }));
  const msShort = (m) => (m.value >= 1e6 ? compactFmt.format(m.value) : fmt(m.value));

  async function loadMilestones({ celebrate = false } = {}) {
    if (!state.spotify) return;
    try {
      ms.data = await api('/api/milestones');
    } catch {
      return;
    }
    renderMilestones();
    if (celebrate) whenNoDialog(celebrateMilestones);
  }

  function renderMilestones() {
    const d = ms.data;
    const card = $('#milestones-card');
    if (!d) { card.hidden = true; return; }
    card.hidden = false;
    const nm = d.next.minutes;
    const ns = d.next.streak;
    const hint = d.activeToday ? t('ms.todayDone') : d.currentStreak ? t('ms.keepAlive') : t('ms.startStreak');
    const badge = (m) => `
      <li class="ms-badge ms-${m.kind}${m.achieved ? ' on' : ''}" title="${esc(msName(m))}${m.at ? ` · ${esc(dateFmtYear.format(parseDay(m.at)))}` : ''}">
        <span class="ms-badge-ico" aria-hidden="true">${m.achieved ? MS_ICON[m.kind] : '🔒'}</span>
        <b>${esc(msShort(m))}</b>
        <small>${esc(m.kind === 'minutes' ? t('unit.min') : tn('unit.dayWord', m.value))}</small>
      </li>`;
    $('#milestones').innerHTML = `
      <div class="ms-progress">
        <div class="ms-prog">
          <span class="ms-ico" aria-hidden="true">🎧</span>
          <div class="ms-prog-main">
            <div class="ms-prog-top"><b>${fmt(d.totalMinutes)}</b> <span>${esc(t('ms.totalMinutes'))}</span></div>
            <div class="ms-bar"><span data-w="${nm ? Math.round(nm.progress * 100) : 100}"></span></div>
            <small class="muted">${esc(nm ? t('ms.toNext', { n: fmt(nm.value - d.totalMinutes), goal: fmt(nm.value) }) : t('ms.allDone'))}</small>
          </div>
        </div>
        <div class="ms-prog">
          <span class="ms-ico${d.currentStreak ? ' burning' : ''}" aria-hidden="true">🔥</span>
          <div class="ms-prog-main">
            <div class="ms-prog-top"><b>${esc(tn('unit.day', d.currentStreak, { n: fmt(d.currentStreak) }))}</b> <span>${esc(t('ms.currentStreak'))}</span></div>
            <div class="ms-bar streak"><span data-w="${ns ? Math.round(ns.progress * 100) : 100}"></span></div>
            <small class="muted">${esc(hint)} · ${esc(t('ms.best', { n: fmt(d.bestStreak) }))}</small>
          </div>
        </div>
      </div>
      <h3 class="ms-h">${esc(t('ms.minutesTitle'))}</h3>
      <ul class="ms-badges">${d.items.filter((m) => m.kind === 'minutes').map(badge).join('')}</ul>
      <h3 class="ms-h">${esc(t('ms.streakTitle'))}</h3>
      <ul class="ms-badges">${d.items.filter((m) => m.kind === 'streak').map(badge).join('')}</ul>`;
    growBars($('#milestones'), '.ms-bar span');
  }

  async function celebrateMilestones() {
    const d = ms.data;
    if (!d) return;
    const unseen = d.items.filter((m) => m.achieved && !d.seen.includes(m.id));
    if (!unseen.length) return;
    const top = [...unseen].sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.value - a.value);
    const main = top[0];
    const dlg = $('#milestone-dialog');
    $('#ms-dlg-body').innerHTML = `${CLOSE_BTN()}
      <div class="ms-dlg-hero"><div class="ms-dlg-fx"></div><span class="ms-dlg-ico">${MS_ICON[main.kind]}</span></div>
      <div class="ms-dlg-text">
        <p class="tour-step">${esc(t('ms.reached'))}</p>
        <h2 id="ms-dlg-title">${esc(unseen.length === 1 ? msName(main) : t('ms.reachedMany', { n: unseen.length }))}</h2>
        ${unseen.length === 1
          ? `<p class="muted">${esc(main.at ? t('ms.reachedOn', { d: dateFmtYear.format(parseDay(main.at)) }) : '')}</p>`
          : `<ul class="ms-dlg-list">${top.slice(0, 6).map((m) => `<li><span>${MS_ICON[m.kind]}</span>${esc(msName(m))}<small>${m.at ? esc(dateFmtYear.format(parseDay(m.at))) : ''}</small></li>`).join('')}</ul>`}
        <button type="button" class="btn btn-primary" data-close-dialog>${esc(t('ms.great'))}</button>
      </div>`;
    dlg.showModal();
    setTimeout(() => confetti($('.ms-dlg-fx', dlg), 40), 150);
    d.seen = [...d.seen, ...unseen.map((m) => m.id)];
    postJSON('/api/milestones/seen', { ids: unseen.map((m) => m.id) }).catch(() => {});
  }

  // ================================================================ Playlist aus der Statistik
  const pl = { range: '30d', size: 25, name: '', nameEdited: false, busy: false, result: null };
  const plDefaultName = () => t('pl.defaultName', { n: pl.size, p: periodName(pl.range) });

  function renderPlaylistDialog(recent = null) {
    const needsReauth = state.spotify?.missing_scopes?.includes('playlist-modify-private');
    const body = $('#pl-body');
    if (pl.result) {
      const r = pl.result;
      body.innerHTML = `${CLOSE_BTN()}
        <div class="pl-done"><div class="pl-fx"></div>
          <div class="pl-done-cover">${imgOrPlaceholder(r.image, r.name)}</div>
          <h2 id="pl-title">${esc(t('pl.done'))}</h2>
          <p class="muted">${esc(t('pl.doneText', { name: r.name, n: r.count }))}</p>
          <a class="btn btn-primary" href="${esc(r.url)}" target="_blank" rel="noopener">${LINK_ICON}<span>${esc(t('np.open'))}</span></a>
          <button type="button" class="btn btn-ghost" data-pl="again">${esc(t('pl.again'))}</button>
        </div>`;
      return;
    }
    if (!pl.nameEdited) pl.name = plDefaultName();
    const chip = (attr, val, label, cur) => `<button type="button" class="chip-btn" data-${attr}="${val}" aria-pressed="${String(val) === String(cur)}">${esc(label)}</button>`;
    body.innerHTML = `${CLOSE_BTN()}
      <header class="pl-head"><span class="pl-ico" aria-hidden="true">🎶</span><div><h2 id="pl-title">${esc(t('pl.title'))}</h2><p class="muted small">${esc(t('pl.sub'))}</p></div></header>
      ${needsReauth ? `<div class="notice inline"><span class="notice-icon">✨</span><div class="notice-text"><p class="small">${esc(t('pl.reauth'))}</p></div><a class="btn btn-primary btn-xs" href="/auth/login">${esc(t('btn.reconnect'))}</a></div>` : ''}
      <h3 class="pl-label">${esc(t('pl.period'))}</h3>
      <div class="chips">${PERIODS.map((r) => chip('pl-range', r, periodName(r), pl.range)).join('')}</div>
      <h3 class="pl-label">${esc(t('pl.size'))}</h3>
      <div class="chips">${[10, 25, 50, 100].map((n) => chip('pl-size', n, t('pl.songs', { n }), pl.size)).join('')}</div>
      <h3 class="pl-label">${esc(t('pl.name'))}</h3>
      <input class="pl-name" id="pl-name" type="text" maxlength="100" value="${esc(pl.name)}" />
      <p class="muted small">${esc(t('pl.privateNote'))}</p>
      <button type="button" class="btn btn-primary pl-create" data-pl="create" ${needsReauth || pl.busy ? 'disabled' : ''}>${esc(t(pl.busy ? 'pl.creating' : 'pl.create'))}</button>
      <div class="pl-recent" id="pl-recent">${recent ? renderRecentPlaylists(recent) : ''}</div>`;
    $('#pl-name').addEventListener('input', (e) => { pl.name = e.target.value; pl.nameEdited = true; });
  }

  const renderRecentPlaylists = (items) => (items.length
    ? `<h3 class="pl-label">${esc(t('pl.recent'))}</h3><ul class="pl-list">${items.map((p) => `
        <li><a href="${esc(p.url)}" target="_blank" rel="noopener"><b>${esc(p.name)}</b><small>${esc(t('pl.songs', { n: p.track_count }))} · ${esc(relTime(p.created_at))}</small></a></li>`).join('')}</ul>`
    : '');

  async function openPlaylistDialog() {
    Object.assign(pl, { range: state.range, size: 25, nameEdited: false, busy: false, result: null });
    renderPlaylistDialog();
    $('#playlist-dialog').showModal();
    try {
      const r = await api('/api/playlists');
      pl.recent = r.items;
      const box = $('#pl-recent');
      if (box) box.innerHTML = renderRecentPlaylists(r.items);
    } catch { /* egal */ }
  }

  async function createPlaylist() {
    if (pl.busy) return;
    pl.busy = true;
    pl.name = $('#pl-name')?.value || pl.name;
    renderPlaylistDialog(pl.recent);
    try {
      pl.result = await postJSON('/api/playlists', {
        range: pl.range,
        size: pl.size,
        name: pl.name.trim() || plDefaultName(),
        description: t('pl.description', { p: periodName(pl.range), d: dateFmtYear.format(new Date()) }),
      });
      pl.busy = false;
      renderPlaylistDialog();
      setTimeout(() => confetti($('#pl-body .pl-fx'), 30), 100);
    } catch (err) {
      pl.busy = false;
      if (err.key === 'needsReauth' && state.spotify) {
        state.spotify.missing_scopes = [...new Set([...(state.spotify.missing_scopes || []), 'playlist-modify-private'])];
      }
      renderPlaylistDialog(pl.recent);
      toast(errMsg(err), true);
    }
  }

  // ================================================================ Jahresrückblick
  const wr = { data: null, loading: false };

  function defaultWrappedYear() {
    const d = new Date();
    return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); // im Januar: das abgelaufene Jahr
  }

  async function loadWrapped(year = wr.data?.year || defaultWrappedYear()) {
    if (wr.loading) return;
    wr.loading = true;
    if (!wr.data || wr.data.year !== year) {
      $('#wrapped').innerHTML = skCard(`${skBlock(26, 'w40')}${skBlock(16, 'w60')}${skBlock(48, 'w30')}`)
        + `<div class="kpis">${'<article class="card kpi"><span class="sk sk-line short"></span><span class="sk sk-num"></span></article>'.repeat(5)}</div>`
        + skCard(`<ul class="rank-bars">${skRows(5)}</ul>`);
    }
    try {
      let d = await api(`/api/wrapped?year=${year}`);
      if (d.empty && d.years.length && !d.years.includes(year)) d = await api(`/api/wrapped?year=${d.years[0]}`);
      wr.data = d;
      if (state.panel === 'wrapped') renderWrapped();
    } catch (err) {
      $('#wrapped').innerHTML = `<section class="card"><p class="empty">${esc(errMsg(err))}</p></section>`;
    } finally {
      wr.loading = false;
    }
  }

  const wrList = (items, kind) => {
    const val = (x) => (kind === 'artist' ? x.minutes : x.plays);
    const max = Math.max(1, ...items.map(val));
    return `<ol class="rank-bars">${items.map((x, i) => `
      <li class="rb" ${kind === 'artist' ? `data-detail-artist="${esc(x.name)}"` : `data-detail-track="${esc(x.id)}"`}>
        <span class="num">${i + 1}</span>
        <div class="cover${kind === 'artist' ? ' round' : ''}">${imgOrPlaceholder(x.image, x.name)}</div>
        <div class="rb-main"><div class="rb-title">${esc(x.name)}</div>
          ${kind === 'track' ? `<div class="rb-sub">${esc(x.artists)}</div>` : ''}
          <div class="rb-bar"><span data-w="${Math.max(3, (val(x) / max) * 100)}"></span></div></div>
        <div class="rb-val">${kind === 'artist' ? `${fmt(x.minutes)}<small>${esc(t('unit.min'))}</small>` : `${fmt(x.plays)}×<small>${fmt(x.minutes)} ${esc(t('unit.min'))}</small>`}</div>
      </li>`).join('')}</ol>`;
  };

  function renderWrapped() {
    const d = wr.data;
    const el = $('#wrapped');
    if (!d) return;
    const chips = d.years.length > 1
      ? `<div class="chips year-chips">${d.years.map((y) => `<button type="button" class="chip-btn" data-wrapped-year="${y}" aria-pressed="${y === d.year}">${y}</button>`).join('')}</div>` : '';
    if (d.empty) {
      el.innerHTML = `<section class="card wrapped-hero"><div class="wh-content"><span class="wh-kicker">Spotlfy · ${d.year}</span>
        <h2>${esc(t('wrapped.title', { year: d.year }))}</h2><p>${esc(t('wrapped.empty'))}</p></div>${chips}</section>`;
      return;
    }
    const monthName = (m) => new Intl.DateTimeFormat(LOCALE, { month: 'long' }).format(new Date(2024, m - 1, 15));
    const delta = d.previousYearMinutes ? Math.round(((d.minutes - d.previousYearMinutes) / d.previousYearMinutes) * 100) : null;
    el.innerHTML = `
      <section class="card wrapped-hero">
        <div class="wh-art" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="wh-content">
          <span class="wh-kicker">Spotlfy · ${d.year}</span>
          <h2>${esc(t('wrapped.title', { year: d.year }))}</h2>
          <p>${esc(t('wrapped.lead', { min: fmt(d.minutes), artists: fmt(d.artists) }))}</p>
          <button type="button" class="btn btn-primary btn-lg" data-story-start>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg><span>${esc(t('wrapped.start'))}</span>
          </button>
        </div>
        ${chips}
      </section>
      <div class="kpis wrapped-kpis">
        <article class="card kpi kpi-hero"><span class="kpi-label">${esc(t('kpi.minutes'))}</span><strong class="kpi-value" data-wk="minutes">0</strong>
          <span class="kpi-sub">${delta != null ? `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} %</span> ${esc(t('wrapped.vsYear', { y: d.year - 1 }))}` : esc(t('kpi.hours', { n: fmt(d.minutes / 60) }))}</span></article>
        <article class="card kpi"><span class="kpi-label">${esc(t('kpi.plays'))}</span><strong class="kpi-value" data-wk="plays">0</strong><span class="kpi-sub">${esc(t('kpi.onDays', { n: fmt(d.activeDays) }))}</span></article>
        <article class="card kpi"><span class="kpi-label">${esc(t('kpi.artists'))}</span><strong class="kpi-value" data-wk="artists">0</strong><span class="kpi-sub">${esc(t('kpi.newOf', { n: fmt(d.newArtists) }))}</span></article>
        <article class="card kpi"><span class="kpi-label">${esc(t('kpi.songs'))}</span><strong class="kpi-value" data-wk="tracks">0</strong><span class="kpi-sub">${esc(t('kpi.different'))}</span></article>
        <article class="card kpi"><span class="kpi-label">${esc(t('wrapped.streak'))}</span><strong class="kpi-value" data-wk="streak">0</strong><span class="kpi-sub">${esc(tn('unit.dayWord', d.streak.len))} ${esc(t('insight.inARow'))}</span></article>
      </div>
      <div class="grid-2">
        <section class="card"><header class="card-head"><h2>${esc(t('overview.topArtists'))}</h2></header>${wrList(d.topArtists, 'artist')}</section>
        <section class="card"><header class="card-head"><h2>${esc(t('overview.topSongs'))}</h2></header>${wrList(d.topTracks, 'track')}</section>
      </div>
      <section class="card">
        <header class="card-head"><div><h2>${esc(t('wrapped.months'))}</h2><p class="muted small">${esc(t('wrapped.topMonth', { m: monthName(d.topMonth) }))}</p></div></header>
        <div class="chart-wrap short"><canvas id="wrapped-chart" role="img" aria-label="${esc(t('wrapped.months'))}"></canvas></div>
      </section>
      <div class="insights">
        ${insight('clock', 'insight.peakTime', hourRange(d.peakHour))}
        ${insight('calendar', 'insight.favDay', DAYS_LONG[d.peakWeekday])}
        ${d.bestDay ? insight('star', 'insight.bestDay', dateFmt.format(parseDay(d.bestDay.day)), `${fmt(d.bestDay.minutes)} ${t('unit.min')}`) : ''}
        ${d.topDiscovery ? insight('spark', 'wrapped.discovery', d.topDiscovery.name, `${fmt(d.topDiscovery.minutes)} ${t('unit.min')}`) : insight('spark', 'insight.discovered', fmt(d.newArtists))}
      </div>
      ${d.genres.length ? `<section class="card"><header class="card-head"><h2>${esc(t('wrapped.genreMix'))}</h2></header>
        <ul class="wr-genres">${d.genres.map((g) => `<li><span class="wr-g-name">${esc(genreName(g.genre))}</span>
          <span class="wr-g-bar"><span data-w="${Math.max(2, g.share * 100)}" style="background:${genreColor(g.genre)}"></span></span><b>${Math.round(g.share * 100)} %</b></li>`).join('')}</ul></section>` : ''}
      ${d.firstSong ? `<section class="card wr-first" data-detail-track="${esc(d.firstSong.id)}">
        <div class="cover">${imgOrPlaceholder(d.firstSong.image, d.firstSong.name)}</div>
        <div><span class="muted small">${esc(t('wrapped.firstSong', { year: d.year }))} · ${esc(dateFmt.format(new Date(d.firstSong.local_time)))}</span>
        <strong>${esc(d.firstSong.name)}</strong><span class="muted small">${esc(d.firstSong.artists)}</span></div></section>` : ''}`;
    for (const [k, v] of Object.entries({ minutes: d.minutes, plays: d.plays, artists: d.artists, tracks: d.tracks, streak: d.streak.len })) countUp($(`[data-wk="${k}"]`, el), v);
    growBars(el, '.rb-bar span, .wr-g-bar span');
    const labels = d.monthly.map((_, i) => new Intl.DateTimeFormat(LOCALE, { month: 'short' }).format(new Date(2024, i, 15)));
    intensityBars('wrapped', $('#wrapped-chart'), labels, d.monthly, (i) => `${monthName(i + 1)} ${d.year}`);
    decoratePanel('wrapped');
  }

  // ---------------------------------------------------------------- Story (Vollbild, Slides)
  const story = { i: 0, slides: [], raf: 0, start: 0, elapsed: 0, paused: false };
  const STORY_MS = 6500;

  function buildSlides(d) {
    const monthName = (m) => new Intl.DateTimeFormat(LOCALE, { month: 'long' }).format(new Date(2024, m - 1, 15));
    const a1 = d.topArtists[0];
    const s1 = d.topTracks[0];
    const delta = d.previousYearMinutes ? Math.round(((d.minutes - d.previousYearMinutes) / d.previousYearMinutes) * 100) : null;
    const mini = (list, kind) => `<ol class="st-mini">${list.slice(1, 5).map((x, i) => `<li><span>${i + 2}</span>${imgOrPlaceholder(x.image, x.name)}<b>${esc(x.name)}</b><small>${kind === 'artist' ? `${fmt(x.minutes)} ${esc(t('unit.min'))}` : `${fmt(x.plays)}×`}</small></li>`).join('')}</ol>`;
    const slides = [
      { cls: 'st-intro', html: `<div class="st-logo"><img src="/assets/logo-animated.svg" alt="" width="96" height="96"></div>
          <p class="st-kicker">Spotlfy · ${d.year}</p><h2 id="story-title">${esc(t('story.introTitle', { year: d.year }))}</h2><p class="st-text">${esc(t('story.introText'))}</p>` },
      { cls: 'st-minutes', html: `<p class="st-kicker">${esc(t('story.minutesKicker'))}</p>
          <div class="st-num" data-count="${d.minutes}">0</div><p class="st-unit">${esc(t('story.minutesUnit'))}</p>
          <p class="st-text">${esc(t('story.minutesDays', { n: (d.minutes / 1440).toFixed(1).replace('.', decSep) }))}</p>
          ${delta != null ? `<p class="st-pill">${delta >= 0 ? '▲' : '▼'} ${esc(t('story.vsYear', { p: `${Math.abs(delta)} %`, y: d.year - 1 }))}</p>` : ''}` },
    ];
    if (a1) slides.push({ cls: 'st-artist', html: `<p class="st-kicker">${esc(t('story.artistKicker'))}</p>
          <div class="st-photo round">${imgOrPlaceholder(a1.image, a1.name)}</div><h2>${esc(a1.name)}</h2>
          <p class="st-text">${esc(t('story.artistText', { n: fmt(a1.minutes) }))}</p>${mini(d.topArtists, 'artist')}` });
    if (s1) slides.push({ cls: 'st-song', html: `<p class="st-kicker">${esc(t('story.songKicker'))}</p>
          <div class="st-photo">${imgOrPlaceholder(s1.image, s1.name)}</div><h2>${esc(s1.name)}</h2>
          <p class="st-text">${esc(s1.artists)} · ${esc(t('story.songText', { n: fmt(s1.plays) }))}</p>${mini(d.topTracks, 'track')}` });
    if (d.genres.length) slides.push({ cls: 'st-genres', html: `<p class="st-kicker">${esc(t('story.genreKicker'))}</p>
          <h2>${esc(genreName(d.genres[0].genre))}</h2>
          <ul class="st-bars">${d.genres.map((g, i) => `<li style="--i:${i}"><span>${esc(genreName(g.genre))}</span><i><b style="width:${Math.max(3, g.share * 100)}%;background:${genreColor(g.genre)}"></b></i><em>${Math.round(g.share * 100)} %</em></li>`).join('')}</ul>` });
    slides.push({ cls: 'st-rhythm', html: `<p class="st-kicker">${esc(t('story.rhythmKicker'))}</p><h2>${esc(t('story.rhythmTitle'))}</h2>
          <div class="st-tiles">
            <div style="--i:0"><span>${esc(t('story.topMonth'))}</span><b>${esc(monthName(d.topMonth))}</b></div>
            <div style="--i:1"><span>${esc(t('insight.peakTime'))}</span><b>${esc(hourRange(d.peakHour))}</b></div>
            <div style="--i:2"><span>${esc(t('insight.favDay'))}</span><b>${esc(DAYS_LONG[d.peakWeekday])}</b></div>
            ${d.bestDay ? `<div style="--i:3"><span>${esc(t('insight.bestDay'))}</span><b>${esc(dateFmt.format(parseDay(d.bestDay.day)))}</b><small>${fmt(d.bestDay.minutes)} ${esc(t('unit.min'))}</small></div>` : ''}
          </div>` });
    slides.push({ cls: 'st-streak', html: `<p class="st-kicker">${esc(t('story.streakKicker'))}</p>
          <div class="st-num" data-count="${d.streak.len}">0</div><p class="st-unit">${esc(tn('unit.dayWord', d.streak.len))} ${esc(t('insight.inARow'))}</p>
          ${d.streak.from ? `<p class="st-text">${esc(dateFmt.format(parseDay(d.streak.from)))} – ${esc(dateFmt.format(parseDay(d.streak.to)))}</p>` : ''}
          <div class="st-split"><div><b>${fmt(d.newArtists)}</b><span>${esc(t('story.newArtists'))}</span></div>
          ${d.topDiscovery ? `<div class="st-disc">${imgOrPlaceholder(d.topDiscovery.image, d.topDiscovery.name)}<span>${esc(t('wrapped.discovery'))}</span><b>${esc(d.topDiscovery.name)}</b></div>` : ''}</div>` });
    if (d.firstSong) slides.push({ cls: 'st-first', html: `<p class="st-kicker">${esc(t('wrapped.firstSong', { year: d.year }))}</p>
          <div class="st-photo spin">${imgOrPlaceholder(d.firstSong.image, d.firstSong.name)}</div><h2>${esc(d.firstSong.name)}</h2>
          <p class="st-text">${esc(d.firstSong.artists)} · ${esc(dateFmt.format(new Date(d.firstSong.local_time)))}, ${esc(timeFmt.format(new Date(d.firstSong.local_time)))}</p>` });
    slides.push({ cls: 'st-outro', outro: true, html: `<div class="st-fx"></div><p class="st-kicker">Spotlfy · ${d.year}</p><h2>${esc(t('story.outroTitle'))}</h2>
          <div class="st-summary">
            <div><span>${esc(t('kpi.minutes'))}</span><b>${fmt(d.minutes)}</b></div>
            <div><span>${esc(t('kpi.artists'))}</span><b>${fmt(d.artists)}</b></div>
            ${a1 ? `<div class="wide"><span>${esc(t('story.artistKicker'))}</span><b>${esc(a1.name)}</b></div>` : ''}
            ${s1 ? `<div class="wide"><span>${esc(t('story.songKicker'))}</span><b>${esc(s1.name)}</b></div>` : ''}
            ${d.genres[0] ? `<div class="wide"><span>${esc(t('insight.topGenre'))}</span><b>${esc(genreName(d.genres[0].genre))}</b></div>` : ''}
          </div>
          <div class="st-actions"><button type="button" class="btn btn-primary" data-story="share">${esc(t('story.share'))}</button>
          <button type="button" class="btn btn-ghost st-ghost" data-story="restart">${esc(t('story.restart'))}</button></div>` });
    return slides;
  }

  function openStory() {
    const d = wr.data;
    if (!d || d.empty) return;
    story.slides = buildSlides(d);
    $('#story-body').innerHTML = `
      <div class="st-bars-top">${story.slides.map(() => '<span><i></i></span>').join('')}</div>
      <button type="button" class="st-close" data-close-dialog aria-label="${esc(t('tour.close'))}">✕</button>
      <div class="st-stage">${story.slides.map((s, i) => `<section class="st-slide ${s.cls}" data-i="${i}" aria-hidden="true"><div class="st-content">${s.html}</div></section>`).join('')}</div>
      <button type="button" class="st-nav prev" data-story="prev" aria-label="${esc(t('tour.back'))}"></button>
      <button type="button" class="st-nav next" data-story="next" aria-label="${esc(t('tour.next'))}"></button>`;
    const dlg = $('#story');
    dlg.showModal();
    storyGo(0);
  }

  function storyGo(i) {
    const n = story.slides.length;
    if (i >= n) { closeStory(); return; }
    story.i = Math.max(0, i);
    story.elapsed = 0;
    story.start = performance.now();
    $$('#story .st-slide').forEach((s, k) => {
      const on = k === story.i;
      s.classList.toggle('active', on);
      s.setAttribute('aria-hidden', String(!on));
    });
    $$('#story .st-bars-top i').forEach((b, k) => { b.style.width = k < story.i ? '100%' : '0%'; });
    const slide = $(`#story .st-slide[data-i="${story.i}"]`);
    $$('.st-num', slide).forEach((el) => { el.dataset.value = 0; countUp(el, Number(el.dataset.count)); });
    if (story.slides[story.i].outro) {
      setTimeout(() => confetti($('.st-fx', slide), 50), 300);
      // Rückblick bis zum Ende angesehen → Musiknoten (einmal pro Jahr)
      postJSON('/api/records/event', { type: 'wrapped', year: wr.data.year })
        .then((r) => { if (r.fresh?.length) { rec.data && (rec.data.balance = r.balance); setTimeout(() => showNoteToast(r.fresh), 1500); } })
        .catch(() => {});
    }
    cancelAnimationFrame(story.raf);
    story.raf = requestAnimationFrame(storyTick);
  }

  function storyTick(now) {
    const dlg = $('#story');
    if (!dlg.open) return;
    const outro = story.slides[story.i]?.outro;
    if (!story.paused && !outro) story.elapsed += now - story.start;
    story.start = now;
    const bar = $$('#story .st-bars-top i')[story.i];
    if (bar) bar.style.width = `${outro ? 100 : Math.min(100, (story.elapsed / STORY_MS) * 100)}%`;
    if (!outro && story.elapsed >= STORY_MS) { storyGo(story.i + 1); return; }
    story.raf = requestAnimationFrame(storyTick);
  }

  function closeStory() {
    cancelAnimationFrame(story.raf);
    const dlg = $('#story');
    if (dlg.open) dlg.close();
  }

  async function shareWrapped() {
    const d = wr.data;
    const text = t('story.shareText', { year: d.year, min: fmt(d.minutes), a: d.topArtists[0]?.name || '–', s: d.topTracks[0]?.name || '–' });
    try {
      if (navigator.share) await navigator.share({ title: `Spotlfy ${d.year}`, text });
      else { await navigator.clipboard.writeText(text); toast(t('story.copied')); }
    } catch { /* abgebrochen */ }
  }

  function bindStory() {
    const dlg = $('#story');
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-story]');
      if (!b) return;
      const act = b.dataset.story;
      if (act === 'next') storyGo(story.i + 1);
      else if (act === 'prev') storyGo(story.i - 1);
      else if (act === 'share') shareWrapped();
      else if (act === 'restart') storyGo(0);
    });
    // Gedrückt halten = pausieren
    dlg.addEventListener('pointerdown', (e) => { if (e.target.closest('.st-nav')) story.paused = true; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => dlg.addEventListener(ev, () => { story.paused = false; }));
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); storyGo(story.i + 1); }
      if (e.key === 'ArrowLeft') storyGo(story.i - 1);
    });
    dlg.addEventListener('close', () => cancelAnimationFrame(story.raf));
  }

  // Hinweis im Dezember/Januar: „Dein Rückblick ist da“
  function renderWrappedPromo() {
    const el = $('#wrapped-promo');
    const now = T.effectiveDate();
    const m = now.getMonth();
    const year = m === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const key = `wrapped-promo-${year}`;
    if (!(m === 11 || m === 0) || !state.spotify || store.get(key)) { el.hidden = true; return; }
    el.innerHTML = `<span class="wp-ico" aria-hidden="true">🎁</span>
      <div><strong>${esc(t('wrapped.promoTitle', { year }))}</strong><span>${esc(t('wrapped.promoText'))}</span></div>
      <button type="button" class="btn btn-primary btn-xs" data-goto="wrapped">${esc(t('wrapped.open'))}</button>
      <button type="button" class="fest-close" data-promo-dismiss="${key}" aria-label="${esc(t('fest.dismiss'))}">✕</button>`;
    el.hidden = false;
  }

  // ================================================================ Freunde & Vergleich
  const fr = { data: null, compareId: null, compareRange: '90d', compare: null };
  const avatarOf = (url, name) => (url
    ? `<img class="avatar-sm" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<div class="placeholder avatar-ph" aria-hidden="true">${initials(name)}</div>`);

  async function loadFriends() {
    if (!fr.data) $('#friend-list').innerHTML = skRows(3);
    try {
      fr.data = await api('/api/friends');
      renderFriends();
      if (fr.compareId && fr.data.friends.some((f) => f.id === fr.compareId)) { if (!fr.compare) loadCompare(fr.compareId); }
      else { fr.compareId = null; fr.compare = null; $('#compare').innerHTML = ''; }
    } catch (err) {
      $('#friend-list').innerHTML = `<li class="empty">${esc(errMsg(err))}</li>`;
    }
  }

  function renderFriends() {
    const d = fr.data;
    const req = (f, incoming) => `
      <li class="friend-row pending">
        ${avatarOf(f.avatar_url, f.username)}
        <div class="t-main"><div class="t-title">${esc(f.username)}</div><div class="t-sub">${esc(t(incoming ? 'friends.wantsToBe' : 'friends.waiting'))}</div></div>
        <div class="friend-actions">
          ${incoming ? `<button type="button" class="btn btn-primary btn-xs" data-friend-act="accept" data-id="${f.id}">${esc(t('friends.accept'))}</button>` : ''}
          <button type="button" class="btn btn-ghost btn-xs" data-friend-act="${incoming ? 'decline' : 'cancel'}" data-id="${f.id}">${esc(t(incoming ? 'friends.decline' : 'friends.cancel'))}</button>
        </div>
      </li>`;
    $('#friend-requests').innerHTML = d.incoming.length || d.outgoing.length
      ? `<h3 class="ms-h">${esc(t('friends.requests'))}</h3><ul class="friend-list">${d.incoming.map((f) => req(f, true)).join('')}${d.outgoing.map((f) => req(f, false)).join('')}</ul>`
      : '';
    $('#friend-list').innerHTML = d.friends.length
      ? `${d.friends.map((f) => `
        <li class="friend-row${fr.compareId === f.id ? ' active' : ''}">
          ${avatarOf(f.avatar_url, f.username)}
          <div class="t-main"><div class="t-title">${esc(f.username)}</div>
            <div class="t-sub">${f.connected ? esc(t('friends.since', { d: dateFmtYear.format(new Date(f.accepted_at || f.created_at)) })) : esc(t('friends.noSpotify'))}</div></div>
          <div class="friend-actions">
            <button type="button" class="btn btn-primary btn-xs" data-compare="${f.id}" ${f.connected ? '' : 'disabled'}>${esc(t('friends.compare'))}</button>
            <button type="button" class="btn btn-ghost btn-xs icon" data-friend-act="remove" data-id="${f.id}" aria-label="${esc(t('friends.remove'))}" title="${esc(t('friends.remove'))}">✕</button>
          </div>
        </li>`).join('')}`
      : `<li class="empty">${esc(t('friends.empty'))}</li>`;
    $('#panel-tabs [data-panel="friends"]').dataset.badge = d.incoming.length || '';
  }

  async function addFriend(e) {
    e.preventDefault();
    const input = $('#friend-input');
    const username = input.value.trim();
    if (!username) return;
    try {
      const r = await postJSON('/api/friends', { username });
      toast(t(r.status === 'accepted' ? 'friends.nowFriends' : 'friends.sent', { n: r.username }));
      input.value = '';
      await loadFriends();
    } catch (err) {
      toast(errMsg(err), true);
    }
  }

  async function friendAction(act, id) {
    const f = [...(fr.data?.friends || []), ...(fr.data?.incoming || []), ...(fr.data?.outgoing || [])].find((x) => x.id === id);
    try {
      if (act === 'accept') {
        await api(`/api/friends/${id}/accept`, { method: 'POST' });
        toast(t('friends.nowFriends', { n: f?.username || '' }));
      } else {
        if (act === 'remove' && !confirm(t('friends.confirmRemove', { n: f?.username || '' }))) return;
        await api(`/api/friends/${id}`, { method: 'DELETE' });
        if (fr.compareId === id) { fr.compareId = null; fr.compare = null; }
      }
      await loadFriends();
    } catch (err) {
      toast(errMsg(err), true);
    }
  }

  async function loadCompare(id) {
    fr.compareId = id;
    const box = $('#compare');
    box.innerHTML = skCard(`<div class="cmp-people">${skBlock(64, 'sk-circle-64')}${skBlock(120, 'sk-circle-120')}${skBlock(64, 'sk-circle-64')}</div>`)
      + skCard(`<ul class="rank-bars">${skRows(4)}</ul>`);
    $$('#friend-list .friend-row').forEach((r) => r.classList.toggle('active', Boolean($(`[data-compare="${id}"]`, r))));
    try {
      fr.compare = await api(`/api/friends/${id}/compare?range=${fr.compareRange}`);
      renderCompare();
    } catch (err) {
      fr.compare = null;
      box.innerHTML = `<section class="card"><p class="empty">${esc(errMsg(err))}</p></section>`;
    }
  }

  function matchLabel(p) {
    return t(p >= 80 ? 'cmp.l80' : p >= 60 ? 'cmp.l60' : p >= 40 ? 'cmp.l40' : p >= 20 ? 'cmp.l20' : 'cmp.l0');
  }

  function renderCompare() {
    const c = fr.compare;
    const box = $('#compare');
    const meName = state.account.username;
    const meAv = state.spotify?.avatar_url;
    const duel = (label, a, b) => {
      const max = Math.max(1, a, b);
      return `<li class="duel"><span class="duel-v me">${fmt(a)}</span>
        <span class="duel-bar me"><span data-w="${(a / max) * 100}"></span></span>
        <span class="duel-label">${esc(label)}</span>
        <span class="duel-bar them"><span data-w="${(b / max) * 100}"></span></span>
        <span class="duel-v them">${fmt(b)}</span></li>`;
    };
    const shared = c.sharedArtists.length
      ? `<ul class="shared-list">${c.sharedArtists.map((a) => {
          const tot = a.me.minutes + a.friend.minutes || 1;
          return `<li data-detail-artist="${esc(a.name)}"><div class="cover round">${imgOrPlaceholder(a.image, a.name)}</div>
            <div class="t-main"><div class="t-title">${esc(a.name)}</div>
              <div class="split-bar"><span class="me" style="width:${(a.me.minutes / tot) * 100}%"></span><span class="them"></span></div>
              <div class="t-sub">${esc(t('cmp.youMin', { n: fmt(a.me.minutes) }))} · ${esc(t('cmp.themMin', { name: c.friend.username, n: fmt(a.friend.minutes) }))}</div></div></li>`;
        }).join('')}</ul>`
      : `<p class="empty">${esc(t('cmp.noShared'))}</p>`;
    const sharedTracks = c.sharedTracks.length
      ? `<ul class="shared-list">${c.sharedTracks.map((x) => `<li data-detail-track="${esc(x.id)}"><div class="cover">${imgOrPlaceholder(x.image, x.name)}</div>
          <div class="t-main"><div class="t-title">${esc(x.name)}</div><div class="t-sub">${esc(x.artists)}</div>
          <div class="t-sub">${esc(t('cmp.youPlays', { n: fmt(x.me.plays) }))} · ${esc(t('cmp.themPlays', { name: c.friend.username, n: fmt(x.friend.plays) }))}</div></div></li>`).join('')}</ul>`
      : `<p class="empty">${esc(t('cmp.noSharedSongs'))}</p>`;
    const gmax = Math.max(0.01, ...c.genres.flatMap((g) => [g.me, g.them]));
    box.innerHTML = `
      <section class="card compare-head">
        <div class="cmp-people">
          <div class="cmp-person">${avatarOf(meAv, meName)}<b>${esc(t('cmp.you'))}</b></div>
          <div class="match-ring" style="--p:${c.match}">
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="mr-bg" cx="60" cy="60" r="52" /><circle class="mr-fg" cx="60" cy="60" r="52" pathLength="100" /></svg>
            <div class="mr-text"><b data-match="${c.match}">0</b><span>${esc(t('cmp.match'))}</span></div>
          </div>
          <div class="cmp-person">${avatarOf(c.friend.avatar_url, c.friend.username)}<b>${esc(c.friend.username)}</b></div>
        </div>
        <p class="cmp-label">${esc(matchLabel(c.match))}</p>
        <p class="muted small cmp-shared-count">${esc(t('cmp.sharedCount', { n: c.sharedArtistCount }))}</p>
        <div class="chips">${PERIODS.map((r) => `<button type="button" class="chip-btn" data-cmp-range="${r}" aria-pressed="${r === fr.compareRange}">${esc(periodName(r))}</button>`).join('')}</div>
      </section>
      <section class="card">
        <header class="card-head"><h2>${esc(t('cmp.duel'))}</h2><div class="duel-legend"><span class="me">${esc(t('cmp.you'))}</span><span class="them">${esc(c.friend.username)}</span></div></header>
        <ul class="duel-list">
          ${duel(t('kpi.minutes'), c.me.minutes, c.them.minutes)}
          ${duel(t('kpi.plays'), c.me.plays, c.them.plays)}
          ${duel(t('kpi.artists'), c.me.artists, c.them.artists)}
          ${duel(t('kpi.songs'), c.me.tracks, c.them.tracks)}
        </ul>
      </section>
      <div class="grid-2">
        <section class="card"><header class="card-head"><div><h2>${esc(t('cmp.sharedArtists'))}</h2><p class="muted small">${esc(t('cmp.sharedSub'))}</p></div></header>${shared}</section>
        <section class="card"><header class="card-head"><div><h2>${esc(t('cmp.sharedSongs'))}</h2><p class="muted small">${esc(t('cmp.sharedSub'))}</p></div></header>${sharedTracks}</section>
      </div>
      ${c.genres.length ? `<section class="card"><header class="card-head"><h2>${esc(t('cmp.genres'))}</h2><div class="duel-legend"><span class="me">${esc(t('cmp.you'))}</span><span class="them">${esc(c.friend.username)}</span></div></header>
        <ul class="duel-list genres">${c.genres.map((g) => `<li class="duel"><span class="duel-v me">${Math.round(g.me * 100)} %</span>
          <span class="duel-bar me"><span data-w="${(g.me / gmax) * 100}"></span></span><span class="duel-label">${esc(genreName(g.genre))}</span>
          <span class="duel-bar them"><span data-w="${(g.them / gmax) * 100}"></span></span><span class="duel-v them">${Math.round(g.them * 100)} %</span></li>`).join('')}</ul></section>` : ''}
      ${top5Section(c)}
      <section class="card friend-coll" id="friend-coll">
        <header class="card-head"><div><h2>💿 ${esc(t('cmp.collTitle', { name: c.friend.username }))}</h2><p class="muted small">${esc(t('cmp.collSub'))}</p></div>
          <button type="button" class="btn btn-ghost btn-xs" data-friend-coll="${c.friend.id}">${esc(t('cmp.collShow'))}</button></header>
        <div id="friend-coll-body"></div>
      </section>`;
    growBars(box, '.duel-bar span');
    countUp($('[data-match]', box), c.match);
  }

  // Top 5 je Kategorie nebeneinander: Du | Freund, Gemeinsames hervorgehoben
  const TOP5_CATS = [
    { key: 'topArtists', title: 'cmp.t.artists', id: (x) => x.name.toLowerCase(), label: (x) => x.name, sub: (x) => `${fmt(x.minutes)} ${t('unit.min')}`, img: (x) => x.image, round: true, detail: (x) => `data-detail-artist="${esc(x.name)}"` },
    { key: 'topTracks', title: 'cmp.t.songs', id: (x) => x.id, label: (x) => x.name, sub: (x) => x.artists, img: (x) => x.image, detail: (x) => `data-detail-track="${esc(x.id)}"` },
    { key: 'topAlbums', title: 'cmp.t.albums', id: (x) => `${x.artist}|${x.name}`.toLowerCase(), label: (x) => x.name, sub: (x) => x.artist, img: (x) => x.image },
    { key: 'topGenres', title: 'cmp.t.genres', id: (x) => x.genre, label: (x) => genreName(x.genre), sub: (x) => `${Math.round(x.share * 100)} %`, dot: (x) => genreColor(x.genre) },
    { key: 'topHours', title: 'cmp.t.hours', id: (x) => String(x.hour), label: (x) => hourRange(x.hour), sub: (x) => `${fmt(x.minutes)} ${t('unit.min')}`, icon: '🕐' },
  ];

  function top5Section(c) {
    const col = (cat, list, other) => {
      const shared = new Set((other || []).map(cat.id));
      return `<ol class="t5-list">${(list || []).map((x, i) => `
        <li class="t5-row${shared.has(cat.id(x)) ? ' shared' : ''}" ${cat.detail ? cat.detail(x) : ''}>
          <span class="t5-num">${i + 1}</span>
          ${cat.img ? `<span class="cover${cat.round ? ' round' : ''}">${imgOrPlaceholder(cat.img(x), cat.label(x))}</span>`
            : cat.dot ? `<span class="t5-dot" style="background:${cat.dot(x)}"></span>` : `<span class="t5-ico">${cat.icon}</span>`}
          <span class="t5-text"><b>${esc(cat.label(x))}</b><small>${esc(cat.sub(x) || '')}</small></span>
          ${shared.has(cat.id(x)) ? '<span class="t5-shared" title="' + esc(t('cmp.both')) + '">🔗</span>' : ''}
        </li>`).join('') || '<li class="empty">–</li>'}</ol>`;
    };
    const tabs = TOP5_CATS.map((cat, i) => `<button type="button" class="chip-btn" data-t5="${i}" aria-pressed="${(fr.t5 || 0) === i}">${esc(t(cat.title))}</button>`).join('');
    const cat = TOP5_CATS[fr.t5 || 0];
    const both = (c.me[cat.key] || []).filter((x) => new Set((c.them[cat.key] || []).map(cat.id)).has(cat.id(x))).length;
    return `<section class="card top5-card" id="top5-card">
      <header class="card-head"><div><h2>${esc(t('cmp.top5'))}</h2><p class="muted small">${esc(t('cmp.top5Sub', { n: both }))}</p></div>
        <div class="chips">${tabs}</div></header>
      <div class="t5-grid">
        <div><h3 class="t5-h"><span class="dot-me"></span>${esc(t('cmp.you'))}</h3>${col(cat, c.me[cat.key], c.them[cat.key])}</div>
        <div><h3 class="t5-h"><span class="dot-them"></span>${esc(c.friend.username)}</h3>${col(cat, c.them[cat.key], c.me[cat.key])}</div>
      </div>
    </section>`;
  }

  // Sammlung eines Freundes (nur ansehen)
  async function showFriendCollection(id) {
    const body = $('#friend-coll-body');
    if (!body) return;
    body.innerHTML = skBlock(160);
    try {
      const r = await api(`/api/friends/${id}/collection`);
      fr.collection = r;
      const recs = r.collection.filter((x) => x.kind !== 'cd');
      const cdl = r.collection.filter((x) => x.kind === 'cd');
      body.innerHTML = `
        <p class="muted small rec-stats">${esc(t('rec.countBoth', { n: fmt(recs.length), m: fmt(cdl.length) }))}${recs.length ? ` · ${collectionStats(r.collection)}` : ''}</p>
        ${cabinetHTML(recs, { rows: Math.max(2, Math.ceil(recs.length / 6)), readonly: true })}
        <p class="rack-label">💿 ${esc(t('cmp.cdRackOf', { name: r.friend.username }))}</p>
        ${cdRackHTML(cdl, { rows: Math.max(1, Math.ceil(cdl.length / 10)), readonly: true })}`;
      const btn = $(`[data-friend-coll="${id}"]`);
      if (btn) btn.hidden = true;
    } catch (err) {
      body.innerHTML = `<p class="empty">${esc(errMsg(err))}</p>`;
    }
  }

  function bindFriends() {
    document.addEventListener('click', (e) => {
      const fc = e.target.closest('[data-friend-coll]');
      if (fc) { showFriendCollection(Number(fc.dataset.friendColl)); return; }
      const t5 = e.target.closest('[data-t5]');
      if (t5 && fr.compare) {
        fr.t5 = Number(t5.dataset.t5);
        const card = $('#top5-card');
        if (card) card.outerHTML = top5Section(fr.compare);
        return;
      }
      const fi = e.target.closest('[data-friend-record]');
      if (fi) {
        const it = fr.collection?.collection.find((x) => x.id === fi.dataset.friendRecord);
        if (it) openRecord(it, { owned: true, friendName: fr.collection.friend.username });
      }
    });
    $('#friend-form').addEventListener('submit', addFriend);
  }

  // ================================================================ Admin: Backup & Rechtliches
  function renderFreeShop() {
    const sw = $('#free-shop-switch');
    if (sw) sw.setAttribute('aria-checked', String(Boolean(rec.data?.free)));
  }

  async function toggleFreeShop() {
    const on = !rec.data?.free;
    try {
      await postJSON('/api/admin/free-shop', { on });
      if (rec.data) rec.data.free = on;
      renderFreeShop();
      toast(t(on ? 'rec.freeOn' : 'rec.freeOff'));
      loadRecords();
    } catch (err) {
      toast(errMsg(err), true);
    }
  }

  async function loadBackupInfo() {
    renderFreeShop();
    try {
      const [b, legal] = await Promise.all([api('/api/admin/backup/info'), fetch('/api/legal').then((r) => r.json())]);
      const el = $('#backup-status');
      const old = !b.last || Date.now() - new Date(b.last) > 7 * 864e5;
      el.className = `backup-status${old ? ' warn' : ' ok'}`;
      el.innerHTML = `<span class="status-dot ${old ? 'bad' : 'ok'}"></span>${esc(b.last ? t('backup.last', { d: dateTimeFmt.format(new Date(b.last)), r: relTime(b.last) }) : t('backup.never'))}${old ? ` · ${esc(t('backup.recommend'))}` : ''}`;
      const sys = $('#admin-system');
      if (sys && !$('[data-legal-row]', sys)) {
        sys.insertAdjacentHTML('beforeend', `<dt data-legal-row>${esc(t('legal.operator'))}</dt><dd>${legal.configured
          ? `<span class="status-dot ok"></span>${esc(t('legal.ok'))}` : `<span class="status-dot bad"></span>${esc(t('legal.missing'))}`}</dd>`);
      }
    } catch { /* egal */ }
  }

  async function restoreFromFile(file) {
    if (!file) return;
    if (!confirm(t('backup.confirm', { f: file.name }))) return;
    const log = $('#restore-log');
    log.innerHTML = `<li><span>${esc(file.name)}</span><span class="muted">${esc(t('import.running'))}</span></li>`;
    try {
      const r = await api('/api/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const rows = Object.entries(r.tables);
      const added = rows.reduce((a, [, v]) => a + v.inserted, 0);
      log.innerHTML = `<li><span>${esc(file.name)}${r.created_at ? ` · ${esc(dateTimeFmt.format(new Date(r.created_at)))}` : ''}</span><span class="ok">${esc(t('backup.restored', { n: fmt(added) }))}</span></li>`
        + rows.map(([k, v]) => `<li><span class="muted">${esc(k)}</span><span>${esc(t('backup.tableRow', { n: fmt(v.inserted), m: fmt(v.rows) }))}</span></li>`).join('');
      toast(t('backup.restored', { n: fmt(added) }));
      loadAdmin();
    } catch (err) {
      log.innerHTML = `<li><span>${esc(file.name)}</span><span class="err">${esc(errMsg(err))}</span></li>`;
    }
  }

  function bindBackup() {
    $('#restore-file').addEventListener('change', (e) => { restoreFromFile(e.target.files[0]); e.target.value = ''; });
    $('#backup-download').addEventListener('click', () => setTimeout(loadBackupInfo, 4000));
  }

  // ================================================================ Plattensammlung & Musiknoten
  const TIERS = ['bronze', 'silver', 'gold', 'platinum'];
  const RARITIES = ['common', 'rare', 'epic', 'legendary'];
  const rec = { data: null, tab: 'collection', filter: 'all', busy: false, dropped: new Set() };
  const noteIcon = (tier, cls = '') => `<span class="note n-${tier} ${cls}" aria-hidden="true">♪</span>`;
  const rewardChips = (r) => TIERS.filter((tr) => r[tr]).map((tr) =>
    `<span class="note-chip" title="${esc(t(`note.${tr}`))}">${noteIcon(tr)}<b>${r[tr] > 0 ? '+' : ''}${fmt(r[tr])}</b></span>`).join('');
  const balanceHTML = (b, big = false) => `<div class="note-balance${big ? ' big' : ''}">${TIERS.map((tr) =>
    `<span class="nb" title="${esc(t(`note.${tr}`))}">${noteIcon(tr)}<b data-note="${tr}">${fmt(b[tr])}</b>${big ? `<small>${esc(t(`note.${tr}`))}</small>` : ''}</span>`).join('')}</div>`;
  const rarityBadge = (r) => `<span class="rarity-badge r-${r}">${esc(t(`rec.r.${r}`))}</span>`;
  const realAlbum = (id) => /^[0-9A-Za-z]{22}$/.test(id || '');

  async function loadRecords({ silent = true } = {}) {
    if (!state.spotify) return;
    try {
      rec.data = await api('/api/records');
      recSeen(); // „gesehen“-Liste anlegen, bevor neue Platten dazukommen
      // Läuft gerade eine Fall-Animation, erst danach neu zeichnen
      const wait = Math.max(0, (rec.animUntil || 0) - Date.now());
      setTimeout(() => {
        renderRecordsCard();
        if (state.panel === 'records') renderRecords();
        placeEggs();
      }, wait);
      if (rec.data.fresh?.length) showNoteToast(rec.data.fresh);
    } catch (err) {
      if (!silent) toast(errMsg(err), true);
    }
  }

  // Schallplatte: Hülle mit herausschauender Platte (Farbe je Seltenheit), besondere Platten schimmern
  function recordArt(r, { size = '' } = {}) {
    const special = r.rarity !== 'common';
    return `<span class="rec ${size} r-${r.rarity}" style="--hue:${r.hue ?? 0}">
      <span class="rec-disc">${r.rarity === 'epic' && r.image ? `<img class="rec-pic" src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}<span class="rec-sheen"></span>
        <span class="rec-label">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}</span></span>
      <span class="rec-sleeve">${imgOrPlaceholder(r.image, r.album)}<span class="rec-wear"></span>${special ? '<span class="rec-shimmer"></span>' : ''}${r.rarity === 'legendary' ? '<span class="rec-sign" aria-hidden="true"></span>' : ''}</span>
    </span>`;
  }

  // CD-Single: Jewel Case mit herausschauender CD
  function cdArt(r, { size = '' } = {}) {
    const special = r.rarity !== 'common';
    return `<span class="cd ${size} r-${r.rarity}" style="--hue:${r.hue ?? 0}">
      <span class="cd-disc"><span class="cd-ring"></span></span>
      <span class="cd-case">${imgOrPlaceholder(r.image, r.album)}<span class="cd-hinge"></span><span class="cd-gloss"></span>${special ? '<span class="rec-shimmer"></span>' : ''}${r.rarity === 'legendary' ? '<span class="rec-sign" aria-hidden="true"></span>' : ''}</span>
    </span>`;
  }
  const itemArt = (r, opts) => (r.kind === 'cd' ? cdArt(r, opts) : recordArt(r, opts));
  const variantName = (r) => t(r.kind === 'cd' ? `rec.cv.${r.rarity}` : `rec.v.${r.rarity}`);
  const records = (d) => (d?.collection || []).filter((r) => r.kind !== 'cd');
  const cds = (d) => (d?.collection || []).filter((r) => r.kind === 'cd');

  function newItemHTML(r, i, art, readonly = false) {
    const isNew = !readonly && !recSeen().has(r.id);
    const drop = isNew && !rec.dropped.has(r.id);
    return `<button type="button" class="cab-item${r.kind === 'cd' ? ' cd-item' : ''}${isNew ? ' is-new' : ''}${drop ? ' drop' : ''}" ${readonly ? 'data-friend-record' : 'data-record'}="${esc(r.id)}" style="--i:${i}" title="${esc(`${r.album} · ${r.artist}`)}">
      ${art}${isNew ? `<span class="new-tag">${esc(t('rec.newTag'))}</span>` : ''}
      ${drop ? '<span class="sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}</button>`;
  }

  // CD-Regal: dunkles Metall, Glasböden, LED-Leiste
  function cdRackHTML(list, { rows = 2, mini = false, readonly = false } = {}) {
    return `<div class="cdrack${mini ? ' mini' : ''}${list.length ? '' : ' empty'}" style="--rows:${rows}">
      <div class="cdrack-top" aria-hidden="true"><span class="cdrack-led"></span></div>
      <div class="cdrack-body"><div class="cdrack-inner">${list.map((r, i) => newItemHTML(r, i, cdArt(r), readonly)).join('')}</div></div>
      <div class="cdrack-base" aria-hidden="true"></div>
    </div>`;
  }

  // Staub: leerer Schrank oder seit DUST_DAYS Tagen keine neue Platte
  const DUST_DAYS = 15;
  function dustState(all = records(rec.data)) {
    const list = all;
    if (!list.length) return { dusty: true, days: null };
    const last = Math.max(...list.map((r) => new Date(r.acquired_at).getTime()));
    const days = Math.floor((T.effectiveDate().getTime() - last) / 864e5);
    return { dusty: days >= DUST_DAYS, days };
  }

  const COBWEB = `<svg viewBox="0 0 120 120" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round">
    <path stroke-width="1.1" d="M0 0 L120 64 M0 0 L96 96 M0 0 L64 120 M0 0 L118 26 M0 0 L26 118"/>
    <path stroke-width="0.8" d="M22 12 Q19 19 12 22 Q17 26 16 32 Q24 28 30 31 Q28 22 33 18 Q26 17 22 12Z"/>
    <path stroke-width="0.8" d="M44 23 Q37 36 23 44 Q30 52 29 63 Q44 55 57 60 Q53 45 62 35 Q50 33 44 23Z"/>
    <path stroke-width="0.7" d="M70 37 Q57 57 37 70 Q46 82 45 96 Q66 83 85 91 Q79 70 93 55 Q76 52 70 37Z"/>
    <path stroke-width="0.6" d="M96 51 Q78 79 51 96 Q62 110 61 120 M96 51 Q105 72 118 73"/></g></svg>`;

  function dustLayer({ empty, leaving = false }) {
    const motes = Array.from({ length: empty ? 16 : 22 }, (_, k) =>
      `<i style="--x:${(k * 37) % 100}%;--y:${(k * 53) % 90}%;--d:${(k % 7) * 0.9}s;--t:${7 + (k % 5) * 2}s;--s:${1.5 + (k % 3)}px"></i>`).join('');
    return `<div class="cab-dust${empty ? ' is-empty' : ''}${leaving ? ' leaving' : ''}" aria-hidden="true">
      <span class="web web-l">${COBWEB}</span><span class="web web-r">${COBWEB}</span>
      ${empty ? '<span class="spider"><span class="thread"></span><span class="spider-body"></span></span>' : ''}
      <span class="dust-film"></span><span class="motes">${motes}</span>
    </div>`;
  }

  // Neue Platten: „NEU“, bis sie einmal geöffnet wurden; Fall-Animation einmal je Sitzung
  const recSeenKey = () => `rec-seen-${state.account?.id}`;
  let recSeenCache = null;
  function saveRecSeen() { store.set(recSeenKey(), JSON.stringify([...recSeenCache])); }
  function recSeen() {
    if (!recSeenCache) {
      const raw = store.get(recSeenKey(), null);
      try { recSeenCache = new Set(JSON.parse(raw || '[]')); } catch { recSeenCache = new Set(); }
      // Beim allerersten Mal gelten alle bisherigen Platten als gesehen
      if (raw === null && rec.data) { rec.data.collection.forEach((r) => recSeenCache.add(r.id)); saveRecSeen(); }
    }
    return recSeenCache;
  }
  function markRecSeen(id) { recSeen().add(id); saveRecSeen(); }
  // Sichtbar abgespielte Fall-Animationen merken, damit sie nicht bei jedem Neuzeichnen wiederkommen
  function afterCabinetRender(root) {
    $$('.cab-item.drop', root).forEach((el, i) => {
      if (!el.offsetParent) return;
      const id = el.dataset.record;
      const dur = 2200 + Math.min(i, 8) * 180;
      rec.animUntil = Math.max(rec.animUntil || 0, Date.now() + dur);
      setTimeout(() => rec.dropped.add(id), dur);
    });
  }

  function cabinetHTML(list, { rows = 3, mini = false, readonly = false } = {}) {
    const all = readonly ? list : records(rec.data);
    const { dusty, days } = dustState(all);
    const none = !list.length;
    const reallyEmpty = !all.length;
    const clearing = !readonly && rec.dustClearing && !dusty;
    return `<div class="cabinet${mini ? ' mini' : ''}${none ? ' empty' : ''}${dusty ? ' dusty' : ''}" style="--rows:${rows}">
      <div class="cab-crown" aria-hidden="true"></div>
      <div class="cab-body">
        <div class="cabinet-inner">
          ${list.map((r, i) => newItemHTML(r, i, recordArt(r), readonly)).join('')}
        </div>
        ${dusty || clearing ? dustLayer({ empty: reallyEmpty, leaving: clearing }) : ''}
        ${none && !reallyEmpty ? `<div class="cabinet-empty"><b>${esc(t('rec.noneOfRarity'))}</b></div>` : ''}
        ${dusty && !reallyEmpty && !mini && !readonly ? `<span class="dust-note">🕸️ ${esc(t('rec.dusty', { n: days }))}</span>` : ''}
      </div>
      <div class="cab-plinth" aria-hidden="true"><span></span><span></span></div>
    </div>`;
  }

  // ---------------------------------------------------------------- Tägliche Aufgaben (Tagesfrage & Song des Tages)
  function quizOptLabel(o) {
    if (o.unit === 'min') return `${fmt(Number(o.label))} ${t('unit.min')}`;
    if (o.unit === 'hour') return hourRange(Number(o.label));
    return o.label;
  }

  function dailyHTML(d) {
    const q = d.daily?.quiz;
    const so = d.daily?.sotd;
    const quiz = q
      ? `<div class="daily-box quiz-box${q.answered ? (q.correct ? ' right' : ' wrong') : ''}">
          <div class="daily-head"><span class="daily-ico" aria-hidden="true">🎯</span><div><b>${esc(t('quiz.title'))}</b>
            <small>${esc(t('src.quiz.d'))}</small></div></div>
          <p class="quiz-q">${esc(t(`quiz.q.${q.type}`))}</p>
          <div class="quiz-opts">${q.options.map((o) => {
            const state = q.answered ? (o.id === q.answer ? ' is-right' : o.id === q.picked ? ' is-wrong' : ' is-off') : '';
            return `<button type="button" class="quiz-opt${state}" data-quiz="${o.id}" ${q.answered ? 'disabled' : ''}>
              ${o.image !== undefined ? `<span class="cover">${imgOrPlaceholder(o.image, o.label)}</span>` : ''}
              <span class="qo-text"><b>${esc(quizOptLabel(o))}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span></button>`;
          }).join('')}</div>
          ${q.answered ? `<p class="quiz-result">${q.correct ? `🎉 ${esc(t('quiz.right'))}` : `🙈 ${esc(t('quiz.wrong'))}`} · ${esc(t('quiz.tomorrow'))}</p>` : ''}
        </div>`
      : `<div class="daily-box"><div class="daily-head"><span class="daily-ico" aria-hidden="true">🎯</span><div><b>${esc(t('quiz.title'))}</b></div></div><p class="muted small">${esc(t('quiz.none'))}</p></div>`;
    const sotd = so
      ? `<div class="daily-box sotd-box${so.done ? ' right' : ''}">
          <div class="daily-head"><span class="daily-ico" aria-hidden="true">🎵</span><div><b>${esc(t('sotd.title'))}</b><small>${esc(t('sotd.text'))}</small></div></div>
          <div class="sotd-track" data-detail-track="${esc(so.id)}">
            <span class="sotd-cover">${imgOrPlaceholder(so.image, so.name)}<span class="sotd-disc"></span></span>
            <span class="qo-text"><b>${esc(so.name)}</b><small>${esc(so.artists)}</small>
              <small>${esc(t('sotd.last', { r: relTime(so.last), n: fmt(so.plays) }))}</small></span>
          </div>
          <div class="sotd-actions">
            ${so.url ? `<a class="btn btn-primary btn-xs" href="${esc(so.url)}" target="_blank" rel="noopener">▶ ${esc(t('sotd.listen'))}</a>` : ''}
            <span class="sotd-status">${so.rewarded ? `✓ ${esc(t('sotd.done'))}` : so.done ? esc(t('sotd.done')) : esc(t('sotd.pending'))}</span>
          </div>
        </div>`
      : `<div class="daily-box"><div class="daily-head"><span class="daily-ico" aria-hidden="true">🎵</span><div><b>${esc(t('sotd.title'))}</b></div></div><p class="muted small">${esc(t('sotd.none'))}</p></div>`;
    return `<section class="card daily-card"><header class="card-head"><div><h2>${esc(t('daily.title'))}</h2><p class="muted small">${esc(t('daily.sub'))}</p></div></header>
      <div class="daily-grid">${quiz}${sotd}</div></section>`;
  }

  // ---------------------------------------------------------------- Versteckte Überraschungen
  const EGG_SPOTS = {
    topbar: () => $('.topbar'),
    kpi: () => $('[data-kpi="tracks"]')?.closest('.card'),
    heatmap: () => $('#heatmap')?.closest('.card'),
    genres: () => $('#genre-donut')?.closest('.card'),
    trends: () => $('#trend-chart')?.closest('.card'),
    history: () => $('.search-card'),
    podium: () => $('#podium')?.closest('.card'),
    cabinet: () => $('#records-card .cab-body'),
    cdrack: () => $('#records-card .cdrack-body'),
    shop: () => $('#records .shop-card'),
    earn: () => $('#records .daily-card'),
    profile: () => $('.profile-head'),
    wrapped: () => $('.wrapped-hero'),
    friends: () => $('#friend-form')?.closest('.card'),
  };
  const eggHash = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const openEggs = () => (rec.data?.eggs || []).filter((e) => !e.found);

  function placeEggs() {
    for (const egg of openEggs()) {
      const host = EGG_SPOTS[egg.spot]?.();
      if (!host || host.querySelector(`[data-egg="${CSS.escape(egg.id)}"]`)) continue;
      const h = eggHash(egg.id + egg.spot);
      const corners = [{ right: 10, bottom: 8 }, { left: 10, bottom: 8 }, { right: 12, top: 10 }, { right: 46, bottom: 10 }];
      const pos = corners[h % corners.length];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'egg';
      btn.dataset.egg = egg.id;
      btn.setAttribute('aria-label', t('egg.aria'));
      btn.title = t('egg.aria');
      btn.innerHTML = '<span class="gift-mini" aria-hidden="true"><span class="gm-box"></span><span class="gm-lid"></span><span class="gm-shine"></span></span><span class="egg-glint"></span><span class="egg-glint g2"></span>';
      Object.entries(pos).forEach(([k, v]) => { btn.style[k] = `${v + (h % 7)}px`; });
      btn.style.setProperty('--d', `${(h % 9) * 0.7}s`);
      host.appendChild(btn);
    }
  }

  let eggTimer;
  function watchEggs() {
    const obs = new MutationObserver(() => { clearTimeout(eggTimer); eggTimer = setTimeout(placeEggs, 350); });
    ['#view-stats', '#view-profile', '.topbar'].forEach((sel) => { const el = $(sel); if (el) obs.observe(el, { childList: true, subtree: true }); });
  }

  async function openEgg(btn) {
    const id = btn.dataset.egg;
    if (btn.classList.contains('opening')) return;
    btn.classList.add('opening');
    try {
      const r = await postJSON('/api/records/egg', { id });
      const egg = rec.data.eggs.find((e) => e.id === id);
      if (egg) egg.found = true;
      rec.data.balance = r.balance;
      if (r.gift) rec.data.collection.unshift(r.gift);
      setTimeout(() => btn.remove(), 400);
      showGift(r);
      renderRecordsCard();
      if (state.panel === 'records') renderRecords();
      if (r.fresh?.length) setTimeout(() => showNoteToast(r.fresh), 3500);
    } catch (err) {
      btn.classList.remove('opening');
      if (err.key === 'eggFound') btn.remove();
      toast(errMsg(err), true);
    }
  }

  function showGift(r) {
    const dlg = $('#gift-dialog');
    const notes = TIERS.filter((tr) => r.reward[tr]);
    const content = r.gift
      ? `<div class="gift-item">${itemArt(r.gift, { size: 'lg' })}</div>`
      : `<div class="gift-coins">${notes.map((tr) => `<span class="gift-coin">${noteIcon(tr)}<b>+${r.reward[tr]}</b></span>`).join('')}</div>`;
    const desc = r.gift
      ? t(r.gift.kind === 'cd' ? 'egg.cd' : 'egg.record', { a: `${r.gift.album} · ${r.gift.artist}` })
      : t('egg.notes', { r: notes.map((tr) => `${r.reward[tr]} ${t(`note.${tr}`)}`).join(', ') });
    $('#gift-body').innerHTML = `${CLOSE_BTN()}
      <div class="gift-stage">
        <div class="gift-rays" aria-hidden="true"></div>
        <div class="gift-fx"></div>
        <div class="gift-box" aria-hidden="true"><span class="gift-lid"><i></i></span><span class="gift-base"><i></i></span></div>
        <div class="gift-reveal">${content}</div>
      </div>
      <div class="gift-text">
        <p class="tour-step">${esc(t('egg.found'))}</p>
        <h2 id="gift-title">${esc(t('egg.title'))}</h2>
        <p>${esc(desc)}</p>
        <p class="muted small">${esc(r.left ? tn('egg.left', r.left, { n: r.left }) : t('egg.allFound'))}</p>
        <button type="button" class="btn btn-primary" data-close-dialog>${esc(t('egg.great'))}</button>
      </div>`;
    dlg.showModal();
    setTimeout(() => confetti($('.gift-fx', dlg), r.gift || r.reward.platinum ? 60 : 36), 1050);
  }

  async function answerQuiz(id) {
    const q = rec.data?.daily?.quiz;
    if (!q || q.answered || rec.quizBusy) return;
    rec.quizBusy = true;
    try {
      const r = await postJSON('/api/records/quiz', { answer: id });
      Object.assign(q, { answered: true, correct: r.correct, answer: r.answer, picked: id });
      rec.data.balance = r.balance;
      renderRecords();
      renderRecordsCard();
      if (r.correct) confetti($('#fx-layer'), 30);
      if (r.fresh?.length) setTimeout(() => showNoteToast(r.fresh), 600);
    } catch (err) {
      toast(errMsg(err), true);
    } finally {
      rec.quizBusy = false;
    }
  }

  function renderRecordsCard() {
    const d = rec.data;
    const card = $('#records-card');
    if (!d) { card.hidden = true; return; }
    card.hidden = false;
    const n = records(d).length;
    const m = cds(d).length;
    $('#records-sub').textContent = n || m ? t('rec.countBoth', { n: fmt(n), m: fmt(m) }) : t('rec.subEmpty');
    $('#note-balance-mini').innerHTML = balanceHTML(d.balance);
    $('#cabinet-mini').innerHTML = cabinetHTML(records(d).slice(0, 16), { rows: 2, mini: true })
      + `<p class="rack-label">💿 ${esc(t('rec.cdRack'))}</p>${cdRackHTML(cds(d).slice(0, 24), { rows: 1, mini: true })}`;
    const q = d.daily?.quiz;
    const so = d.daily?.sotd;
    $('#daily-chips').innerHTML = [
      q ? `<button type="button" class="daily-chip${q.answered ? ' done' : ' open'}" data-records-tab="earn">🎯 ${esc(t('quiz.title'))}${q.answered ? ' ✓' : ''}</button>` : '',
      so ? `<button type="button" class="daily-chip${so.rewarded ? ' done' : ' open'}" data-records-tab="earn">🎵 ${esc(t('sotd.title'))}${so.rewarded ? ' ✓' : ''}</button>` : '',
    ].join('');
    setTimeout(placeEggs, 50);
    afterCabinetRender($('#cabinet-mini'));
  }

  function collectionStats(list) {
    const by = Object.fromEntries(RARITIES.map((r) => [r, list.filter((x) => x.rarity === r).length]));
    return RARITIES.filter((r) => by[r]).map((r) => `${rarityBadge(r)} <b>${fmt(by[r])}</b>`).join(' ');
  }

  function countdown(day) {
    const ms = new Date(`${day}T00:00:00`) - Date.now();
    const d = Math.max(0, Math.floor(ms / 864e5));
    const h = Math.max(0, Math.floor((ms % 864e5) / 36e5));
    return t('rec.resetIn', { d, h });
  }

  function renderRecords() {
    const d = rec.data;
    const el = $('#records');
    if (!d) {
      el.innerHTML = skCard(`${skBlock(30, 'w40')}${skBlock(40, 'w60')}`) + skCard(skBlock(300));
      loadRecords({ silent: false });
      return;
    }
    const tabs = ['collection', 'shop', 'earn'].map((k) =>
      `<button type="button" class="chip-btn" data-rec-tab="${k}" aria-pressed="${rec.tab === k}">${esc(t(`rec.tab.${k}`))}</button>`).join('');
    let body = '';
    if (rec.tab === 'collection') {
      const byRarity = (l) => (rec.filter === 'all' ? l : l.filter((r) => r.rarity === rec.filter));
      const list = byRarity(records(d));
      const cdList = byRarity(cds(d));
      body = `<section class="card">
        <header class="card-head"><div><h2>${esc(t('rec.cabinet'))}</h2><p class="muted small rec-stats">${records(d).length ? collectionStats(records(d)) : esc(t('rec.subEmpty'))}</p></div>
          <div class="chips">${['all', ...RARITIES].map((r) => `<button type="button" class="chip-btn" data-rec-filter="${r}" aria-pressed="${rec.filter === r}">${esc(r === 'all' ? t('rec.all') : t(`rec.r.${r}`))}</button>`).join('')}</div></header>
        ${cabinetHTML(list, { rows: Math.max(3, Math.ceil(list.length / 6)) })}
        ${d.collection.length ? '' : `<div class="rec-cta"><button type="button" class="btn btn-primary" data-rec-tab="shop">🛍️ ${esc(t('rec.toShop'))}</button></div>`}
      </section>
      <section class="card">
        <header class="card-head"><div><h2>💿 ${esc(t('rec.cdRack'))}</h2><p class="muted small rec-stats">${cds(d).length ? collectionStats(cds(d)) : esc(t('rec.cdEmpty'))}</p></div></header>
        ${cdRackHTML(cdList, { rows: Math.max(2, Math.ceil(cdList.length / 10)) })}
        ${cds(d).length ? '' : `<div class="rec-cta"><button type="button" class="btn btn-ghost" data-shop-page="cd">💿 ${esc(t('rec.toCdShop'))}</button></div>`}
      </section>`;
    } else if (rec.tab === 'shop') {
      const b = d.balance;
      const cdPage = rec.shopPage === 'cd';
      const list = cdPage ? d.singles : d.shop;
      const items = list.map((it) => {
        const lack = d.free ? 0 : Math.max(0, it.price.amount - b[it.price.tier]);
        const btn = it.owned
          ? `<span class="si-owned">✓ ${esc(t('rec.owned'))}</span>`
          : `<button type="button" class="btn ${lack ? 'btn-ghost' : 'btn-primary'} btn-xs si-buy" data-buy="${esc(it.id)}" ${lack || rec.busy ? 'disabled' : ''}>
              ${d.free ? `🎁 ${esc(t('rec.free'))}` : `${noteIcon(it.price.tier)} ${fmt(it.price.amount)}`} · ${esc(lack ? t('rec.missing', { n: fmt(lack), tier: t(`note.${it.price.tier}`) }) : t('rec.buy'))}</button>`;
        const listen = it.discover && realAlbum(it.album_id)
          ? `<a class="si-listen" href="https://open.spotify.com/${it.kind === 'cd' ? 'track' : 'album'}/${esc(it.album_id)}" target="_blank" rel="noopener">▶ ${esc(t('rec.preview'))}</a>` : '';
        return `<article class="shop-item r-${it.rarity}${it.owned ? ' owned' : ''}${it.kind === 'cd' ? ' is-cd' : ''}${it.discover ? ' discover' : ''}">
          ${it.discover ? `<span class="disc-badge" title="${esc(t('rec.discoverHint'))}">✨ ${esc(t('rec.discover'))}</span>` : ''}
          <button type="button" class="si-art" data-preview="${esc(it.id)}" aria-label="${esc(it.album)}">${itemArt(it, { size: 'lg' })}</button>
          ${rarityBadge(it.rarity)}
          <div class="si-text"><b title="${esc(it.album)}">${esc(it.album)}</b><small>${esc(it.artist)}</small><small class="si-variant">${esc(variantName(it))}</small></div>
          ${listen}${btn}
        </article>`;
      }).join('');
      const ex = TIERS.slice(0, 3).map((tr, i) => {
        const to = TIERS[i + 1];
        return `<button type="button" class="ex-btn" data-exchange="${tr}" ${b[tr] < d.exchangeRate ? 'disabled' : ''}>
          ${noteIcon(tr)}<b>${d.exchangeRate}</b> → ${noteIcon(to)}<b>1</b></button>`;
      }).join('');
      const pages = ['record', 'cd'].map((k) => `<button type="button" class="chip-btn" data-shop-page="${k}" aria-pressed="${(rec.shopPage || 'record') === k}">${k === 'cd' ? '💿' : '🎵'} ${esc(t(k === 'cd' ? 'rec.shopCds' : 'rec.shopRecords'))}</button>`).join('');
      body = `<section class="card shop-card">
          <header class="card-head"><div><h2>🛍️ ${esc(t(cdPage ? 'rec.cdShopTitle' : 'rec.shopTitle', { w: d.week.week }))}</h2>
            <p class="muted small">${esc(countdown(d.week.resetsOn))}</p></div>
            <div class="chips shop-pages">${pages}</div></header>
          ${d.free ? `<p class="free-banner">🎁 ${esc(t('rec.freeOn'))}</p>` : ''}
          ${list.length ? `<div class="shop-grid${cdPage ? ' cd-grid' : ''}">${items}</div>` : `<p class="empty">${esc(t('rec.shopEmpty'))}</p>`}
        </section>
        <section class="card"><header class="card-head"><div><h2>${esc(t('rec.exchangeTitle'))}</h2><p class="muted small">${esc(t('rec.exchangeSub', { n: d.exchangeRate }))}</p></div></header>
          <div class="ex-row">${ex}</div></section>
        <section class="card"><header class="card-head"><h2>${esc(t('rec.rarityTitle'))}</h2></header>
          <ul class="rarity-legend">${RARITIES.map((r) => `<li>${rarityBadge(r)}<span>${esc(t(cdPage ? `rec.cv.${r}` : `rec.v.${r}`))}</span><small>${esc(t(cdPage ? `rec.cdPrice.${r}` : `rec.price.${r}`))}</small></li>`).join('')}</ul></section>`;
    } else {
      const groups = ['start', 'social', 'minutes', 'streak', 'variety', 'collector', 'recurring'];
      const srcTitle = (s) => {
        const n = s.key.split('-')[1];
        if (s.key.startsWith('min-')) return t('ms.minutesName', { n: fmt(Number(n)) });
        if (s.key.startsWith('streak-')) return t('ms.streakName', { n: fmt(Number(n)) });
        if (s.key.startsWith('artists-')) return t('src.artists', { n: fmt(Number(n)) });
        if (s.key.startsWith('coll-')) return Number(n) === 1 ? t('src.coll1') : t('src.coll', { n: fmt(Number(n)) });
        if (s.key.startsWith('cd-')) return Number(n) === 1 ? t('src.cd1') : t('src.cd', { n: fmt(Number(n)) });
        return t(`src.${s.key}`);
      };
      const srcDesc = (s) => {
        if (s.key === 'week') return t('src.week.d', { n: s.goal });
        if (s.key === 'discover') return t('src.discover.d', { n: s.goal });
        if (s.key === 'bday') return s.birthday ? t('src.bday.d') : t('src.bday.none');
        return I.D[`src.${s.key}.d`] ? t(`src.${s.key}.d`) : '';
      };
      const row = (s) => {
        const prog = s.goal && !s.done ? `<span class="src-bar"><span style="width:${Math.round((s.cur / s.goal) * 100)}%"></span></span><small class="src-prog">${fmt(s.cur)} / ${fmt(s.goal)}</small>` : '';
        const status = s.done
          ? `<span class="src-done" title="${s.at ? esc(dateFmtYear.format(new Date(s.at))) : ''}">✓</span>`
          : '<span class="src-open" aria-hidden="true">○</span>';
        return `<li class="src-row${s.done ? ' done' : ''}">${status}
          <div class="src-main"><b>${esc(srcTitle(s))}</b>${srcDesc(s) ? `<small>${esc(srcDesc(s))}</small>` : ''}${prog}</div>
          <span class="src-reward">${rewardChips(s.reward)}</span></li>`;
      };
      body = `${dailyHTML(d)}<div class="earn-grid">${groups.map((g) => {
          const list = d.sources.filter((s) => s.group === g);
          const done = list.filter((s) => s.done).length;
          return `<section class="card"><header class="card-head"><div><h2>${esc(t(`rec.group.${g}`))}</h2>
            <p class="muted small">${g === 'recurring' ? esc(t('rec.recurringSub')) : esc(t('rec.doneOf', { n: done, m: list.length }))}</p></div></header>
            <ul class="src-list">${list.map(row).join('')}</ul></section>`;
        }).join('')}</div>`;
    }
    el.innerHTML = `
      <section class="card rec-head">
        <button type="button" class="link-btn rec-back" data-goto="overview">← ${esc(t('nav.overview'))}</button>
        <div class="rec-head-main">
          <div><h2>💿 ${esc(t('rec.title'))}</h2><p class="muted small">${esc(d.collection.length ? t('rec.countBoth', { n: fmt(records(d).length), m: fmt(cds(d).length) }) : t('rec.subEmpty'))}</p></div>
          ${balanceHTML(d.balance, true)}
        </div>
        <div class="chips rec-tabs">${tabs}</div>
      </section>
      ${body}`;
    afterCabinetRender(el);
    const fresh = d.collection.filter((r) => !recSeen().has(r.id)).length;
    const ct = $('[data-rec-tab="collection"]', el);
    if (ct && fresh && rec.tab !== 'collection') ct.insertAdjacentHTML('beforeend', ` <span class="tab-dot">${fresh}</span>`);
    decoratePanel('records');
  }

  function openRecordsTab(tab) {
    rec.tab = tab;
    if (state.panel !== 'records') showPanel('records');
    else renderRecords();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // Detail einer Platte: rotierende Schallplatte neben der Hülle
  function openRecord(r, { owned = true, isNew = false, friendName = null } = {}) {
    const dlg = $('#record-dialog');
    const variant = variantName(r);
    const isCd = r.kind === 'cd';
    const lack = !owned && rec.data && !rec.data.free ? Math.max(0, r.price.amount - rec.data.balance[r.price.tier]) : 0;
    $('#record-body').innerHTML = `${CLOSE_BTN()}
      <div class="rd-stage r-${r.rarity}${isNew ? ' is-new' : ''}${isCd ? ' is-cd' : ''}">
        <div class="rd-fx"></div>
        ${isNew ? `<p class="rd-new">✨ ${esc(t('rec.newIn'))}</p>` : ''}
        <div class="rd-player">
          <div class="rd-sleeve">${imgOrPlaceholder(r.image, r.album)}${r.rarity === 'legendary' ? '<span class="rec-sign" aria-hidden="true"></span>' : ''}</div>
          <div class="rd-vinyl r-${r.rarity}" style="--hue:${r.hue ?? 0}">
            ${r.rarity === 'epic' && r.image ? `<img class="rd-picture" src="${esc(r.image)}" alt="" referrerpolicy="no-referrer" />` : ''}
            <span class="rd-label">${r.image ? `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer" />` : ''}</span>
          </div>
        </div>
      </div>
      <div class="rd-info">
        ${rarityBadge(r.rarity)} <span class="muted small">${esc(variant)}</span>
        <h2 id="record-title">${esc(r.album)}</h2>
        <p class="rd-artist"><button type="button" class="link-btn inline" data-detail-artist="${esc(r.artist)}">${esc(r.artist)}</button></p>
        ${r.discover || r.price?.discover ? `<p class="rd-discover">✨ ${esc(t('rec.discoverHint'))}</p>` : ''}
        <dl class="sys-list">
          ${friendName ? `<dt>${esc(t('cmp.owner'))}</dt><dd>${esc(friendName)}</dd>` : ''}
          ${owned && r.acquired_at ? `<dt>${esc(t('rec.acquired'))}</dt><dd>${esc(dateFmtYear.format(new Date(r.acquired_at)))}</dd>` : ''}
          ${friendName || !r.price ? '' : `<dt>${esc(t('rec.price'))}</dt><dd>${r.price.free ? `🎁 ${esc(t('rec.free'))}` : `${noteIcon(r.price.tier)} ${fmt(r.price.amount)} ${esc(t(`note.${r.price.tier}`))}`}</dd>`}
        </dl>
        <div class="profile-actions">
          ${!owned ? `<button type="button" class="btn btn-primary" data-buy="${esc(r.id)}" ${lack ? 'disabled' : ''}>${rec.data?.free ? `🎁 ${esc(t('rec.free'))}` : `${noteIcon(r.price.tier)} ${fmt(r.price.amount)}`} · ${esc(lack ? t('rec.missing', { n: fmt(lack), tier: t(`note.${r.price.tier}`) }) : t('rec.buy'))}</button>` : ''}
          ${realAlbum(r.album_id) ? `<a class="btn btn-ghost" href="https://open.spotify.com/${isCd ? 'track' : 'album'}/${esc(r.album_id)}" target="_blank" rel="noopener">${LINK_ICON}<span>${esc(t(isCd ? 'rec.listenTrack' : 'rec.listen'))}</span></a>` : ''}
        </div>
      </div>`;
    if (!dlg.open) dlg.showModal();
    if (isNew) setTimeout(() => confetti($('.rd-fx', dlg), r.rarity === 'legendary' ? 70 : 40), 250);
  }

  async function buyRecord(id) {
    const d = rec.data;
    const it = [...(d?.shop || []), ...(d?.singles || [])].find((x) => x.id === id);
    if (!it || rec.busy) return;
    if (!d.free && ['epic', 'legendary'].includes(it.rarity) && !confirm(t('rec.confirmBuy', { a: it.album, n: it.price.amount, tier: t(`note.${it.price.tier}`) }))) return;
    rec.busy = true;
    try {
      const r = await postJSON('/api/records/buy', { id });
      await purchaseAnimation(it);
      d.balance = r.balance;
      it.owned = true;
      const owned = { ...r.record, acquired_at: new Date().toISOString() };
      const wasDusty = dustState().dusty;
      d.collection.unshift(owned);
      rec.busy = false;
      if (wasDusty) { rec.dustClearing = true; setTimeout(() => { rec.dustClearing = false; renderRecordsCard(); if (state.panel === 'records') renderRecords(); }, 1600); }
      renderRecordsCard();
      if (state.panel === 'records') renderRecords();
      openRecord(owned, { isNew: true });
      if (r.fresh?.length) setTimeout(() => showNoteToast(r.fresh), 1200);
      setTimeout(loadRecords, 2500); // Quellen & Verlauf aktualisieren (nach den Animationen)
    } catch (err) {
      rec.busy = false;
      toast(errMsg(err), true);
      loadRecords();
    }
  }

  // Kauf: Noten fliegen aus dem Kontostand, „Gekauft“-Stempel, Platte fliegt in die Sammlung
  function flyEl(html, from, to, { dur = 800, cls = '', rot = 0, scaleTo = 0.4, delay = 0 } = {}) {
    if (!from || !to) return Promise.resolve();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = `fly ${cls}`;
    el.innerHTML = html;
    Object.assign(el.style, { left: `${a.left + a.width / 2}px`, top: `${a.top + a.height / 2}px` });
    document.body.appendChild(el);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const lift = Math.min(-60, dy / 2 - 80);
    const anim = el.animate([
      { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${lift}px)) scale(1.1) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scaleTo}) rotate(${rot}deg)`, opacity: 0.2 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
    const done = () => el.parentNode && el.parentNode.removeChild(el);
    return anim.finished.then(done, done);
  }

  async function purchaseAnimation(it) {
    if (reduceMotion) return;
    const card = $(`.shop-item [data-preview="${CSS.escape(it.id)}"]`)?.closest('.shop-item');
    const btn = card ? $('.si-buy', card) : null;
    const chip = $(`.rec-head [data-note="${it.price.tier}"]`)?.closest('.nb');
    const jobs = [];
    // Noten wandern vom Kontostand zur Platte
    for (let i = 0; i < (rec.data?.free ? 0 : Math.min(it.price.amount, 6)); i++) {
      jobs.push(flyEl(noteIcon(it.price.tier), chip, btn || card, { dur: 650, delay: i * 110, cls: 'fly-note', scaleTo: 0.7 }));
    }
    if (chip) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
    await Promise.all(jobs);
    if (card) {
      card.classList.add('just-bought');
      card.insertAdjacentHTML('beforeend', `<span class="sold-stamp">✓ ${esc(t('rec.bought'))}</span>`);
      confetti($('#fx-layer'), it.rarity === 'legendary' ? 60 : it.rarity === 'common' ? 18 : 34);
      await new Promise((r) => setTimeout(r, 450));
      // Platte fliegt zum Reiter „Sammlung“
      const target = $('[data-rec-tab="collection"]') || $('.rec-head');
      await flyEl(itemArt(it, { size: 'lg' }), $('.si-art', card), target, { dur: 850, rot: -25, scaleTo: 0.25, cls: 'fly-rec' });
    }
  }

  async function exchangeNotes(from) {
    try {
      const r = await postJSON('/api/records/exchange', { from });
      rec.data.balance = r.balance;
      renderRecords();
      renderRecordsCard();
      const i = TIERS.indexOf(from);
      toast(t('rec.exchanged', { a: rec.data.exchangeRate, from: t(`note.${from}`), to: t(`note.${TIERS[i + 1]}`) }));
      loadRecords();
    } catch (err) {
      toast(errMsg(err), true);
    }
  }

  // Kleine Einblendung für neu verdiente Noten (nicht blockierend)
  let noteToastTimer;
  function showNoteToast(fresh) {
    const sum = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
    for (const f of fresh) for (const tr of TIERS) sum[tr] += f[tr];
    if (!TIERS.some((tr) => sum[tr] > 0)) return;
    const el = $('#note-toast');
    const label = (k) => {
      const base = k.split(':')[0];
      const n = k.split('-')[1];
      if (k.startsWith('min-')) return t('ms.minutesName', { n: fmt(Number(n)) });
      if (k.startsWith('streak-')) return t('ms.streakName', { n: fmt(Number(n)) });
      if (k.startsWith('artists-')) return t('src.artists', { n: fmt(Number(n)) });
      if (k.startsWith('coll-')) return Number(n) === 1 ? t('src.coll1') : t('src.coll', { n: fmt(Number(n)) });
      if (k.startsWith('cd-')) return Number(n) === 1 ? t('src.cd1') : t('src.cd', { n: fmt(Number(n)) });
      return t(`src.${base}`);
    };
    el.innerHTML = `<div class="nt-coins" aria-hidden="true">${TIERS.filter((tr) => sum[tr]).map((tr, i) => noteIcon(tr, 'fly').replace('class="note', `style="--i:${i}" class="note`)).join('')}</div>
      <div class="nt-text"><b>${esc(t('rec.earned'))}</b><span>${esc(fresh.length === 1 ? label(fresh[0].key) : t('rec.earnedMany', { n: fresh.length }))}</span>
      <span class="src-reward">${rewardChips(sum)}</span></div>
      <button type="button" class="btn btn-ghost btn-xs" data-records-tab="earn">${esc(t('rec.view'))}</button>
      <button type="button" class="fest-close" data-note-toast-close aria-label="${esc(t('tour.close'))}">✕</button>`;
    el.hidden = false;
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
    clearTimeout(noteToastTimer);
    noteToastTimer = setTimeout(() => { el.hidden = true; }, 9000);
  }

  function bindRecords() {
    document.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-records-tab]');
      if (tb) { $('#note-toast').hidden = true; openRecordsTab(tb.dataset.recordsTab); return; }
      const sp = e.target.closest('[data-shop-page]');
      if (sp) { rec.shopPage = sp.dataset.shopPage; rec.tab = 'shop'; if (state.panel !== 'records') showPanel('records'); else renderRecords(); return; }
      const fs = e.target.closest('#free-shop-switch');
      if (fs) { toggleFreeShop(); return; }
      const rt = e.target.closest('[data-rec-tab]');
      if (rt) { rec.tab = rt.dataset.recTab; renderRecords(); return; }
      const rf = e.target.closest('[data-rec-filter]');
      if (rf) { rec.filter = rf.dataset.recFilter; renderRecords(); return; }
      const rb = e.target.closest('[data-record]');
      if (rb) {
        const r = rec.data?.collection.find((x) => x.id === rb.dataset.record);
        if (r) { markRecSeen(r.id); rb.classList.remove('is-new'); $('.new-tag', rb)?.remove(); openRecord(r); }
        return;
      }
      const pv = e.target.closest('[data-preview]');
      if (pv) {
        const it = [...(rec.data?.shop || []), ...(rec.data?.singles || [])].find((x) => x.id === pv.dataset.preview);
        if (it) openRecord(rec.data.collection.find((x) => x.id === it.id) || it, { owned: it.owned });
        return;
      }
      const by = e.target.closest('[data-buy]');
      if (by) { $('#record-dialog').close(); buyRecord(by.dataset.buy); return; }
      const qz = e.target.closest('[data-quiz]');
      if (qz) { answerQuiz(qz.dataset.quiz); return; }
      const ex = e.target.closest('[data-exchange]');
      if (ex) { exchangeNotes(ex.dataset.exchange); return; }
      if (e.target.closest('[data-note-toast-close]')) { $('#note-toast').hidden = true; }
    });
    const dlg = $('#record-dialog');
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    watchEggs();
    document.addEventListener('click', (e) => {
      const eg = e.target.closest('[data-egg]');
      if (eg) { e.stopPropagation(); e.preventDefault(); openEgg(eg); }
    }, true);
  }

  // ================================================================ Start
  document.addEventListener('DOMContentLoaded', () => {
    I.apply();
    setupChartDefaults();
    setupTabs();
    segmented($('#range-control'), 'range', state.range, (v) => { state.range = v; store.set('range', v); loadDashboard(); });
    segmented($('#timeline-mode'), 'mode', state.timelineMode, (v) => { state.timelineMode = v; store.set('timelineMode', v); renderTimeline(); });
    segmented($('#trend-mode'), 'mode', state.trendMode, (v) => { state.trendMode = v; renderTrends(); });
    segmented($('#rank-kind'), 'kind', state.rankKind, (v) => { state.rankKind = v; store.set('rankKind', v); loadRanking(); });
    segmented($('#rank-range'), 'range', state.rankRange, (v) => { state.rankRange = v; store.set('rankRange', v); loadRanking(); });
    $('#sync-btn').addEventListener('click', runSync);
    $('#profile-btn').addEventListener('click', () => showPanel(state.panel === 'profile' ? 'overview' : 'profile'));
    bindHeatTooltip();
    bindImport();
    bindTour();
    document.addEventListener('click', (e) => {
      const cd = e.target.closest('[data-close-dialog]');
      if (cd) { cd.closest('dialog')?.close(); return; }
      const dtr = e.target.closest('[data-detail-track]');
      if (dtr) { openDetail('track', dtr.dataset.detailTrack); return; }
      const dar = e.target.closest('[data-detail-artist]');
      if (dar) { openDetail('artist', dar.dataset.detailArtist); return; }
      if (e.target.closest('[data-story-start]')) { openStory(); return; }
      const wy = e.target.closest('[data-wrapped-year]');
      if (wy) { loadWrapped(Number(wy.dataset.wrappedYear)); return; }
      const pd = e.target.closest('[data-promo-dismiss]');
      if (pd) { store.set(pd.dataset.promoDismiss, '1'); $('#wrapped-promo').hidden = true; return; }
      const cmp = e.target.closest('[data-compare]');
      if (cmp) {
        fr.compare = null;
        loadCompare(Number(cmp.dataset.compare));
        setTimeout(() => $('#compare').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }), 60);
        return;
      }
      const cr = e.target.closest('[data-cmp-range]');
      if (cr) { fr.compareRange = cr.dataset.cmpRange; loadCompare(fr.compareId); return; }
      const fa = e.target.closest('[data-friend-act]');
      if (fa) { friendAction(fa.dataset.friendAct, Number(fa.dataset.id)); return; }
      const plr = e.target.closest('[data-pl-range]');
      if (plr) { pl.name = $('#pl-name')?.value ?? pl.name; pl.range = plr.dataset.plRange; renderPlaylistDialog(pl.recent); return; }
      const pls = e.target.closest('[data-pl-size]');
      if (pls) { pl.name = $('#pl-name')?.value ?? pl.name; pl.size = Number(pls.dataset.plSize); renderPlaylistDialog(pl.recent); return; }
      const pla = e.target.closest('[data-pl]');
      if (pla) {
        if (pla.dataset.pl === 'create') createPlaylist();
        else { pl.result = null; pl.nameEdited = false; renderPlaylistDialog(pl.recent); }
        return;
      }
      const tog = e.target.closest('[data-toggle-day]');
      if (tog) {
        const day = tog.dataset.toggleDay;
        if (history.open.has(day)) history.open.delete(day); else history.open.add(day);
        renderHistory();
        if (!history.open.has(day)) document.querySelector(`[data-day="${day}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      const go = e.target.closest('[data-goto]');
      if (go) {
        e.preventDefault();
        showPanel(go.dataset.goto);
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
        return;
      }
      const th = e.target.closest('[data-theme-mode]');
      if (th) { chooseTheme(th.dataset.themeMode); return; }
      const lb = e.target.closest('[data-lang]');
      if (lb) { chooseLang(lb.dataset.lang); return; }
      const sq = e.target.closest('[data-season-date]');
      if (sq) { previewDate(`${new Date().getFullYear()}-${sq.dataset.seasonDate}`, { forceSeason: true }); return; }
      const et = e.target.closest('[data-event-test]');
      if (et) { testEvent(et.dataset.eventTest); return; }
      const fd = e.target.closest('[data-fest-dismiss]');
      if (fd) { store.set(fd.dataset.festDismiss, '1'); $('#fest-ribbon').hidden = true; return; }
      const b = e.target.closest('[data-action]');
      if (b) ({ password: changePassword, disconnect: disconnectSpotify, delete: deleteAccount })[b.dataset.action]?.();
    });
    $('#festive-switch').addEventListener('click', toggleFestive);
    bindSearch();
    bindStory();
    bindFriends();
    bindBackup();
    bindRecords();
    $('#playlist-btn').addEventListener('click', openPlaylistDialog);
    $('#privacy-accept').addEventListener('click', acceptPrivacy);
    $('#scope-dismiss').addEventListener('click', () => { store.set('scope-dismiss', String(Date.now() + 7 * 864e5)); renderNotices(); });
    ['#detail-dialog', '#playlist-dialog', '#milestone-dialog'].forEach((sel) => {
      const dlg = $(sel);
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    });
    $('#birthday-save').addEventListener('click', () => saveBirthday($('#birthday-input').value));
    $('#birthday-clear').addEventListener('click', () => saveBirthday(''));
    $('#admin-refresh').addEventListener('click', loadAdmin);
    $('#admin-users').addEventListener('click', adminAction);
    $('#admin-search').addEventListener('input', renderAdminUsers);
    $('#history-more').addEventListener('click', () => loadHistory(false));
    $('#season-date').addEventListener('change', (e) => { if (e.target.value) previewDate(e.target.value); });
    $('#season-reset').addEventListener('click', () => { T.setSeasonDate(null); renderThemeSettings(); updateFestive(); });
    renderThemeSettings();
    renderLangPicker();
    const justConnected = handleQueryFlags();
    refreshAll();
    // Nach dem Verbinden läuft der erste Sync im Hintergrund – kurz danach neu laden.
    if (justConnected) setTimeout(refreshAll, 6000);
    // Alle 5 Minuten im Hintergrund auffrischen, wenn der Tab sichtbar ist.
    setInterval(() => { if (document.visibilityState === 'visible' && !['admin', 'profile'].includes(state.panel)) refreshAll(); }, 5 * 60_000);
  });
})();
