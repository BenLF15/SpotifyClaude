/* Spotlfy – Dashboard-Frontend (Vanilla JS + Chart.js) */
(() => {
  'use strict';

  // ================================================================ Helpers
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const nf = new Intl.NumberFormat('de-DE');
  const fmt = (n) => nf.format(Math.round(n || 0));
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
  };

  const PANELS = ['overview', 'top', 'times', 'genres', 'trends', 'history', 'admin', 'profile'];
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
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code });
    return data;
  }

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

  function relTime(date) {
    if (!date) return '';
    const diff = (Date.now() - new Date(date)) / 1000;
    if (diff < 60) return 'gerade eben';
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
    if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
    const d = Math.floor(diff / 86400);
    return d === 1 ? 'gestern' : `vor ${d} Tagen`;
  }

  const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  const dateFmtYear = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  const dayMonthFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
  const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' });
  const monthFmtLong = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
  const longDayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const parseDay = (s) => new Date(`${s}T12:00:00`);
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const DAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const hh = (h) => String(h).padStart(2, '0');
  const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

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
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
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
  const COLORS = {
    accent: '#1ed760',
    grid: 'rgba(255,255,255,0.06)',
    tick: '#7d877f',
    // Kategoriale Reihenfolge (für dunkle Flächen validiert): Blau, Orange, Aqua, Gelb, Magenta, Grün, Violett, Rot
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    other: '#4a524c',
    surface: '#141916',
  };
  const accentA = (a) => `rgba(30,215,96,${a})`;
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
      ctx.strokeStyle = 'rgba(240,242,240,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      const text = opts.label;
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = 'rgba(20,25,22,0.92)';
      ctx.fillRect(left, yy - 8, w, 16);
      ctx.fillStyle = '#d6dbd7';
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
    C.defaults.locale = 'de-DE';
    C.defaults.color = COLORS.tick;
    C.defaults.animation.duration = reduceMotion ? 0 : 800;
    C.defaults.animation.easing = 'easeOutQuart';
    C.defaults.maintainAspectRatio = false;
    C.defaults.plugins.legend.display = false;
    Object.assign(C.defaults.plugins.tooltip, {
      backgroundColor: '#212823', borderColor: 'rgba(255,255,255,0.14)', borderWidth: 1,
      titleColor: '#f0f2f0', bodyColor: '#b4bcb6', padding: 10, cornerRadius: 10,
      displayColors: false, titleFont: { weight: '650' }, caretSize: 0,
    });
  }

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
    return s;
  }

  // ================================================================ Profil
  function renderProfile(s) {
    const sp = s.spotify;
    const acc = s.account;
    const av = $('#profile-avatar');
    av.innerHTML = sp?.avatar_url
      ? `<img src="${esc(sp.avatar_url)}" alt="" referrerpolicy="no-referrer" />`
      : esc((acc.username[0] || '?').toUpperCase());
    $('#profile-name').innerHTML = `${esc(acc.username)}${acc.is_admin ? ' <span class="tag tag-admin">Admin</span>' : ''}`;
    $('#profile-sub').textContent = [sp?.display_name, sp?.email].filter(Boolean).join(' · ') || 'Spotify noch nicht verbunden';

    const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
    const spRows = sp
      ? [
          row('Status', sp.auth_expired
            ? '<span class="status-dot bad"></span>Verbindung abgelaufen'
            : '<span class="status-dot ok"></span>Verbunden'),
          row('Spotify-Name', esc(sp.display_name || '–')),
          row('E-Mail', esc(sp.email || '–')),
          row('Spotify-ID', `<code>${esc(sp.id)}</code>`),
          sp.product ? row('Abo', esc(sp.product)) : '',
          sp.country ? row('Land', esc(sp.country)) : '',
        ]
      : [row('Status', '<span class="status-dot bad"></span>Nicht verbunden')];
    $('#profile-spotify').innerHTML = spRows.join('');
    $('#profile-spotify-actions').innerHTML = sp
      ? `${sp.auth_expired ? '<a class="btn btn-primary" href="/auth/login">Neu verbinden</a>' : ''}
         <button class="btn btn-ghost" data-action="disconnect" type="button">Spotify trennen</button>`
      : '<a class="btn btn-primary" href="/auth/login">Mit Spotify verbinden</a>';

    if (sp && s.counts) {
      const job = s.jobs?.recently_played;
      const pending = s.counts.tracks_pending || 0;
      $('#profile-data').innerHTML = [
        row('Gespeicherte Plays', fmt(s.counts.plays)),
        row('Davon importiert', fmt(s.counts.imported)),
        row('Ranking-Snapshots', fmt(s.snapshots?.days)),
        row('Letzter Sync', job
          ? `<span class="status-dot ${job.ok ? 'ok' : 'bad'}"></span>${job.ok ? '' : 'fehlgeschlagen · '}${esc(relTime(job.finished_at))}`
          : '–'),
        row('Automatischer Sync', 'alle 30 Minuten'),
        pending ? row('Warten auf Cover', `${fmt(pending)} ${pending === 1 ? 'Song' : 'Songs'}`) : '',
      ].join('');
    } else {
      $('#profile-data').innerHTML = row('Daten', 'Verbinde Spotify, um deine Hörhistorie zu speichern.');
    }
    $('#profile-data-actions').hidden = !sp;

    $('#profile-account').innerHTML = [
      row('Benutzername', esc(acc.username)),
      row('Rolle', acc.is_admin ? 'Admin' : 'Nutzer'),
      acc.created_at ? row('Mitglied seit', esc(dateFmtYear.format(new Date(acc.created_at)))) : '',
    ].join('');
  }

  // ================================================================ Daten laden
  async function loadDashboard() {
    try {
      state.dashboard = await api(`/api/dashboard?range=${state.range}`);
      renderPanel(state.panel);
    } catch (err) {
      if (err.message !== 'unauthorized' && err.code !== 'NOT_CONNECTED') toast(`Laden fehlgeschlagen: ${err.message}`, true);
    }
  }
  async function loadTrends() {
    try {
      state.trends = await api('/api/trends');
      if (state.panel === 'trends') renderTrends();
    } catch (err) {
      if (err.message !== 'unauthorized' && err.code !== 'NOT_CONNECTED') toast(`Entwicklung: ${err.message}`, true);
    }
  }
  async function loadRanking() {
    try {
      state.ranking = await api(`/api/spotify-top?kind=${state.rankKind}&range=${state.rankRange}`);
      if (state.panel === 'trends') renderRanking();
    } catch (err) {
      if (err.message !== 'unauthorized' && err.code !== 'NOT_CONNECTED') toast(`Ranking: ${err.message}`, true);
    }
  }

  function renderPanel(panel) {
    const d = state.dashboard;
    if (panel === 'trends') {
      if (state.trends) renderTrends(); else loadTrends();
      if (state.ranking) renderRanking(); else loadRanking();
      return;
    }
    if (panel === 'admin') return loadAdmin();
    if (panel === 'profile') { if (state.status) renderProfile(state.status); return; }
    if (!d) return;
    if (panel === 'overview') {
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
    } else if (panel === 'history') {
      renderRecent(d.recent);
    }
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
      sub.innerHTML = `<span class="delta ${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)} %</span> zum Vorzeitraum`;
    } else {
      sub.textContent = `≈ ${fmt(o.minutes / 60)} Stunden`;
    }
    $('[data-kpi-sub="activeDays"]').textContent = `an ${fmt(o.activeDays)} Tagen`;
    $('[data-kpi-sub="newArtists"]').textContent = o.newArtists != null ? `davon ${fmt(o.newArtists)} neu` : 'verschiedene';
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
        <stop offset="0" stop-color="#1ed760" stop-opacity="0.35"/><stop offset="1" stop-color="#1ed760" stop-opacity="0"/></linearGradient></defs>
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
  const insight = (icon, label, value, sub = '') =>
    `<div class="insight"><div class="insight-icon">${ICONS[icon]}</div>
      <div class="insight-label">${esc(label)}</div>
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

  function renderInsights(d) {
    const days = RANGE_DAYS[state.range] || 365;
    const daily = d.timeline.daily.slice(-days);
    const peak = peakOf(d.heatmap);
    const bestDay = daily.reduce((a, r) => (r.minutes > (a?.minutes ?? -1) ? r : a), null);
    const streak = longestStreak(daily);
    const topGenre = d.genres.items[0];
    $('#insights').innerHTML = [
      peak.v > 0 ? insight('clock', 'Lieblingszeit', `${DAYS[peak.d]} · ${hh(peak.h)}–${hh((peak.h + 1) % 24)} Uhr`) : insight('clock', 'Lieblingszeit', '–'),
      bestDay?.minutes ? insight('star', 'Bester Tag', dateFmt.format(parseDay(bestDay.day)), `${fmt(bestDay.minutes)} Min.`) : insight('star', 'Bester Tag', '–'),
      insight('flame', 'Längste Serie', `${fmt(streak)} ${streak === 1 ? 'Tag' : 'Tage'}`, 'am Stück'),
      d.overview.newArtists != null
        ? insight('spark', 'Neu entdeckt', `${fmt(d.overview.newArtists)} Künstler`)
        : insight('tag', 'Top-Genre', topGenre ? topGenre.genre : '–', topGenre ? `${Math.round(topGenre.share * 100)} %` : ''),
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
      ? `Ø ${fmt(avg)} Min. pro ${weekly ? 'Woche' : 'Tag'} · Rekord ${fmt(max)} Min.${!weekly && state.range === 'all' ? ' · letzte 365 Tage' : ''}`
      : '';
    upsertChart('timeline', $('#timeline-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: (ctx) => (ctx.raw === max && max > 0 ? COLORS.accent : ctx.raw >= avg ? accentA(0.7) : accentA(0.38)),
          hoverBackgroundColor: '#5cf08f',
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
          avgLine: { value: avg, label: `Ø ${fmt(avg)}` },
          tooltip: {
            callbacks: {
              title: (items) => {
                const l = items[0].label;
                return weekly ? `Woche ab ${dateFmtYear.format(parseDay(l))}` : dateFmt.format(parseDay(l));
              },
              label: (item) => {
                const diff = avg ? Math.round(((item.raw - avg) / avg) * 100) : 0;
                return `${fmt(item.raw)} Minuten (${diff >= 0 ? '+' : ''}${diff} % zum Ø)`;
              },
            },
          },
        },
      },
    });
  }

  // Ranglisten mit Balken (Künstler: Minuten, Songs: Plays)
  function renderRankBars(el, list, kind, offset = 0, maxOverride) {
    if (!list.length) { el.innerHTML = offset ? '' : '<li class="empty">Noch keine Daten in diesem Zeitraum.</li>'; return; }
    const val = (x) => (kind === 'artist' ? x.minutes : x.plays);
    const max = maxOverride || val(list[0]) || 1;
    el.innerHTML = list.map((x, i) => `
      <li class="rb">
        <span class="num">${offset + i + 1}</span>
        <div class="cover${kind === 'artist' ? ' round' : ''}">${imgOrPlaceholder(x.image, x.name)}</div>
        <div class="rb-main">
          <div class="rb-title">${esc(x.name)}</div>
          <div class="rb-sub">${kind === 'artist' ? `${fmt(x.plays)} Plays · ${fmt(x.tracks)} Songs` : esc(x.artists)}</div>
          <div class="rb-bar"><span data-w="${Math.max(2, (val(x) / max) * 100)}"></span></div>
        </div>
        <div class="rb-val">${kind === 'artist' ? `${fmt(x.minutes)}<small>Min.</small>` : `${fmt(x.plays)}×<small>${fmt(x.minutes)} Min.</small>`}</div>
      </li>`).join('');
    growBars(el, '.rb-bar span');
  }

  function renderPodium(top3) {
    const el = $('#podium');
    if (!top3.length) { el.innerHTML = '<p class="empty">Noch keine Daten in diesem Zeitraum.</p>'; return; }
    const order = [top3[1], top3[0], top3[2]].map((a, i) => (a ? { a, place: [2, 1, 3][i] } : null)).filter(Boolean);
    el.innerHTML = order.map(({ a, place }) => `
      <div class="podium-item p${place}">
        <div class="pimg">${imgOrPlaceholder(a.image, a.name)}</div>
        <div class="podium-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="podium-meta">${fmt(a.minutes)} Min. · ${fmt(a.plays)} Plays</div>
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
      insight('clock', 'Hauptzeit', `${hh(peakH)}–${hh((peakH + 1) % 24)} Uhr`),
      insight('calendar', 'Lieblingstag', DAYS_LONG[peakD]),
      night >= morning
        ? insight('moon', 'Nachteule', `${Math.round(night * 100)} %`, '22–5 Uhr')
        : insight('sun', 'Frühaufsteher', `${Math.round(morning * 100)} %`, '5–11 Uhr'),
      insight('star', 'Wochenende', `${Math.round(weekend * 100)} %`, 'deiner Hörzeit'),
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
      html += `<span class="heat-row-label">${DAYS[d]}</span>`;
      row.forEach((v, h) => {
        const alpha = v === 0 ? 0.04 : 0.1 + 0.9 * Math.pow(v / max, 0.75);
        const isPeak = d === peak.d && h === peak.h && v > 0;
        html += `<span class="heat-cell${isPeak ? ' peak' : ''}" role="gridcell" data-d="${d}" data-h="${h}" data-v="${v}" data-a="${alpha.toFixed(3)}" aria-label="${DAYS_LONG[d]} ${h} Uhr: ${v} Minuten"></span>`;
      });
    });
    el.innerHTML = html;
    $$('.heat-cell', el).forEach((c) => {
      c.style.background = `rgba(30,215,96,${c.dataset.a})`;
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
      tip.innerHTML = `${DAYS_LONG[d]}, ${hh(h)}–${hh((h + 1) % 24)} Uhr<br><strong>${fmt(cell.dataset.v)} Minuten</strong>`;
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
          hoverBackgroundColor: '#5cf08f',
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom',
          barPercentage: 0.82,
          categoryPercentage: 0.92,
        }],
      },
      options: {
        scales: baseScales({ y: { display: false, beginAtZero: true } }),
        plugins: {
          tooltip: { callbacks: { title: (items) => tooltipTitle(items[0].dataIndex), label: (item) => `${fmt(item.raw)} Minuten` } },
        },
      },
    });
  }

  function renderHourCharts(grid) {
    const { hours, days } = sumsOf(grid);
    intensityBars('hours', $('#hours-chart'), hours.map((_, h) => (h % 3 === 0 ? `${h}` : '')), hours,
      (i) => `${hh(i)}–${hh((i + 1) % 24)} Uhr`);
    intensityBars('weekdays', $('#weekday-chart'), DAYS, days, (i) => DAYS_LONG[i]);
  }

  // ================================================================ Genres
  function renderGenres(g) {
    const list = $('#genres');
    $('#genre-caption').textContent = g.items.length
      ? `Anteil an deiner Hörzeit · Grau = weitere Genres · bekannt für ${Math.round(g.coverage * 100)} % der Hörzeit`
      : 'Anteil an deiner Hörzeit';
    if (!g.items.length) {
      list.innerHTML = '<li class="empty">Noch keine Genre-Daten. Spotify liefert Genres nicht für jeden Künstler – sie werden nach und nach geladen.</li>';
      $('#donut-center').innerHTML = '';
      charts.donut?.destroy();
      delete charts.donut;
      return;
    }
    const slices = g.items.slice(0, 7);
    const otherShare = Math.max(0, 1 - slices.reduce((a, i) => a + i.share, 0));
    const withOther = otherShare > 0.005;
    const data = [...slices.map((i) => i.share), ...(withOther ? [otherShare] : [])];
    const labels = [...slices.map((i) => i.genre), ...(withOther ? ['Sonstige'] : [])];
    const colors = [...slices.map((_, i) => COLORS.series[i]), COLORS.other];
    upsertChart('donut', $('#genre-donut'), {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: COLORS.surface, borderWidth: 2, hoverOffset: 6 }] },
      options: {
        cutout: '68%',
        layout: { padding: 6 },
        animation: { animateRotate: !reduceMotion, duration: reduceMotion ? 0 : 900 },
        plugins: {
          tooltip: { displayColors: true, callbacks: { label: (item) => ` ${item.label}: ${(item.raw * 100).toFixed(1)} %` } },
        },
      },
    });
    const top = slices[0];
    $('#donut-center').innerHTML = `<span>Top-Genre</span><b>${Math.round(top.share * 100)} %</b><strong>${esc(top.genre)}</strong>`;
    const max = g.items[0].share || 1;
    list.innerHTML = g.items.slice(0, 12).map((x, i) => {
      const color = i < 7 ? COLORS.series[i] : COLORS.other;
      return `<li class="genre-row" title="${fmt(x.minutes)} Minuten">
        <span class="genre-dot" style="background:${color}"></span>
        <span class="genre-name">${esc(x.genre)}</span>
        <span class="genre-val">${(x.share * 100).toFixed(x.share < 0.1 ? 1 : 0)} %</span>
        <span class="genre-track"><span class="genre-fill" data-w="${(x.share / max) * 100}" style="background:${color}"></span></span>
      </li>`;
    }).join('');
    growBars(list, '.genre-fill');
  }

  // ================================================================ Verlauf
  function renderRecent(list) {
    const el = $('#recent');
    if (!list.length) { el.innerHTML = '<p class="empty">Noch nichts gehört – oder noch nicht synchronisiert.</p>'; return; }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const label = (d) => {
      const day = new Date(d);
      day.setHours(0, 0, 0, 0);
      const diff = Math.round((today - day) / 864e5);
      return diff === 0 ? 'Heute' : diff === 1 ? 'Gestern' : longDayFmt.format(day);
    };
    const groups = [];
    for (const t of list) {
      const l = label(t.played_at);
      if (!groups.length || groups.at(-1).label !== l) groups.push({ label: l, items: [] });
      groups.at(-1).items.push(t);
    }
    el.innerHTML = groups.map((g) => `
      <div class="day-group">
        <div class="day-label"><span>${esc(g.label)}</span><span>${g.items.length} ${g.items.length === 1 ? 'Song' : 'Songs'}</span></div>
        <ul class="recent-list">${g.items.map((t) => `
          <li class="track">
            <div class="cover">${imgOrPlaceholder(t.image, t.name)}</div>
            <div class="t-main"><div class="t-title">${esc(t.name)}</div><div class="t-sub">${esc(t.artists)}</div></div>
            <div class="t-stat">${timeFmt.format(new Date(t.played_at))}</div>
          </li>`).join('')}</ul>
      </div>`).join('');
  }

  // ================================================================ Entwicklung
  function isCurrentMonth(m) {
    const now = new Date();
    return m === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function renderTrends() {
    const rows = state.trends?.monthly || [];
    const key = state.trendMode;
    const label = { minutes: 'Minuten', artists: 'verschiedene Künstler', new_artists: 'neue Künstler' }[key];
    const values = rows.map((r) => r[key]);
    const complete = rows.filter((r) => !isCurrentMonth(r.month));
    const avg = complete.length ? complete.reduce((a, r) => a + r[key], 0) / complete.length : 0;
    const best = rows.reduce((a, r) => (r[key] > (a?.[key] ?? -1) ? r : a), null);
    $('#trend-caption').textContent = best
      ? `${rows.length} Monate · Bester Monat: ${monthFmtLong.format(new Date(`${best.month}-15`))} (${fmt(best[key])} ${label})`
      : 'über deine gesamte Historie';
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
          backgroundColor: (ctx) => (ctx.chart.chartArea ? verticalGradient(ctx.chart.ctx, ctx.chart.chartArea, '30,215,96') : 'transparent'),
          segment: { borderDash: (ctx) => (ctx.p1DataIndex === rows.length - 1 && isCurrentMonth(rows.at(-1)?.month) ? [5, 5] : undefined) },
          pointRadius: (ctx) => (rows[ctx.dataIndex] === best ? 5 : rows.length > 36 ? 0 : 3),
          pointHoverRadius: 6,
          pointBackgroundColor: (ctx) => (rows[ctx.dataIndex] === best ? '#ffffff' : COLORS.accent),
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
          avgLine: { value: avg, label: `Ø ${fmt(avg)}` },
          tooltip: {
            callbacks: {
              title: (items) => monthFmtLong.format(new Date(`${items[0].label}-15`)),
              label: (item) => `${fmt(item.raw)} ${label}${item.dataIndex === rows.length - 1 && isCurrentMonth(item.label) ? ' (bisher)' : ''}`,
            },
          },
        },
      },
    });
  }

  function renderRanking() {
    const r = state.ranking;
    if (!r) return;
    const list = $('#rank-list');
    $('#ranking-caption').textContent = r.date
      ? `Stand ${dateFmtYear.format(parseDay(r.date))} · Pfeile: Veränderung zur Vorwoche`
      : 'Tägliche Snapshots deiner Spotify-Top-Listen';
    if (!r.items.length) {
      list.innerHTML = '<li class="empty">Noch kein Snapshot – der erste entsteht beim nächsten Sync.</li>';
    } else {
      const round = state.rankKind === 'artists' ? ' round' : '';
      list.innerHTML = r.items.slice(0, 10).map((it) => {
        let ch = '<span class="rank-change new">neu</span>';
        if (it.prev_rank != null) {
          const diff = it.prev_rank - it.rank;
          ch = diff > 0 ? `<span class="rank-change up">▲ ${diff}</span>`
            : diff < 0 ? `<span class="rank-change down">▼ ${-diff}</span>`
            : '<span class="rank-change same">–</span>';
        }
        return `<li class="track">
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
            labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 14, color: '#b4bcb6' },
          },
          tooltip: {
            displayColors: true,
            usePointStyle: true,
            callbacks: {
              title: (items) => dateFmtYear.format(parseDay(items[0].label)),
              label: (item) => ` ${item.dataset.label}: Platz ${item.raw}`,
            },
          },
        },
      },
    });
  }

  // ================================================================ Sync & Import
  async function runSync() {
    const btn = $('#sync-btn');
    if (btn.classList.contains('is-busy')) return;
    btn.classList.add('is-busy');
    try {
      const r = await api('/api/sync', { method: 'POST' });
      const n = r.recent?.inserted ?? 0;
      toast(n ? `${n} neue Plays gespeichert` : 'Alles aktuell – keine neuen Plays');
      await refreshAll();
    } catch (err) {
      toast(err.status === 409 ? 'Spotify-Verbindung abgelaufen – bitte neu verbinden.' : `Sync fehlgeschlagen: ${err.message}`, true);
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
        li.innerHTML = `<span>${esc(file.name)}</span><span class="muted">wird importiert …</span>`;
        log.append(li);
        try {
          const text = await file.text();
          JSON.parse(text); // früh validieren
          const r = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
          li.lastElementChild.className = 'ok';
          li.lastElementChild.textContent = r.unsupported && !r.candidates
            ? 'Kurzformat ohne Track-IDs – bitte „Extended“ History nutzen'
            : `+${fmt(r.inserted)} Plays (${fmt(r.duplicates)} doppelt)`;
          any = any || r.inserted > 0;
        } catch (err) {
          li.lastElementChild.className = 'err';
          li.lastElementChild.textContent = err instanceof SyntaxError ? 'Kein gültiges JSON' : err.message;
        }
      }
      if (any) { toast('Import abgeschlossen – Cover & Genres werden im Hintergrund nachgeladen'); state.trends = null; refreshAll(); }
    }
    input.addEventListener('change', () => { handle(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('is-over'); }));
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
    if (changed) window.scrollTo({ top: 0, behavior: 'auto' });
    if (state.spotify || panel === 'admin' || panel === 'profile') renderPanel(state.panel);
  }

  async function refreshAll() {
    await loadStatus().catch((err) => {
      if (err.message !== 'unauthorized') toast(`Status: ${err.message}`, true);
    });
    applyView();
    if (state.panel === 'admin') loadAdmin();
    if (!state.spotify) return;
    state.trends = null;
    state.ranking = null;
    const jobs = [loadDashboard()];
    if (state.panel === 'trends') jobs.push(loadTrends(), loadRanking());
    await Promise.all(jobs);
  }

  const SPOTIFY_ERRORS = {
    access_denied: 'Du hast die Verbindung mit Spotify abgebrochen.',
    user_not_registered: 'Dein Spotify-Konto ist für diese App noch nicht freigeschaltet. Bitte den Betreiber, dich in der Spotify-App unter „User Management“ hinzuzufügen.',
    already_linked: 'Dieses Spotify-Konto ist bereits mit einem anderen Spotlfy-Konto verbunden.',
    state_mismatch: 'Die Verbindung ist abgelaufen – bitte noch einmal versuchen.',
  };

  function handleQueryFlags() {
    const q = new URLSearchParams(location.search);
    if (q.has('welcome')) {
      toast(q.has('admin')
        ? 'Willkommen! Du bist als erster Nutzer Admin – den Admin-Tab findest du oben.'
        : 'Willkommen bei Spotlfy! Verbinde jetzt dein Spotify-Konto.');
    }
    if (q.has('connected')) toast('Spotify verbunden – deine ersten Daten werden geladen …');
    if (q.has('spotify_error')) {
      const e = q.get('spotify_error');
      toast(SPOTIFY_ERRORS[e] || `Spotify-Verbindung fehlgeschlagen (${e}).`, true);
    }
    if ([...q.keys()].length) history.replaceState(null, '', '/');
    return q.has('connected');
  }

  // ================================================================ Konto
  async function changePassword() {
    const current = prompt('Aktuelles Passwort:');
    if (current === null) return;
    const next = prompt('Neues Passwort (mindestens 8 Zeichen):');
    if (next === null) return;
    if (next.length < 8) return toast('Das neue Passwort muss mindestens 8 Zeichen lang sein.', true);
    if (prompt('Neues Passwort wiederholen:') !== next) return toast('Die Passwörter stimmen nicht überein.', true);
    try {
      await api('/api/me/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) });
      toast('Passwort geändert.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function disconnectSpotify() {
    if (!confirm('Spotify-Verbindung trennen? Deine bisherigen Daten bleiben gespeichert und sind beim erneuten Verbinden wieder da.')) return;
    try {
      await api('/api/me/disconnect', { method: 'POST' });
      location.reload();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function deleteAccount() {
    if (!confirm('Dein Spotlfy-Konto und alle gespeicherten Hördaten werden endgültig gelöscht. Fortfahren?')) return;
    try {
      await api('/api/me', { method: 'DELETE' });
      location.href = '/login';
    } catch (err) {
      toast(`Löschen fehlgeschlagen: ${err.message}`, true);
    }
  }

  // ================================================================ Admin
  const dateTimeFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fmtDT = (d) => (d ? dateTimeFmt.format(new Date(d)) : '–');

  function shortAgent(ua) {
    if (!ua) return '';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return [br, os].filter(Boolean).join(' · ');
  }

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
              ${u.id === me ? '<span class="tag tag-muted">Du</span>' : ''}
              ${u.is_admin ? '<span class="tag tag-admin">Admin</span>' : ''}
              ${!u.spotify_user_id ? '<span class="tag tag-muted">Spotify nicht verbunden</span>' : ''}
              ${u.auth_expired ? '<span class="tag tag-warn">Verbindung abgelaufen</span>' : ''}
              ${u.product ? `<span class="tag tag-muted">${esc(u.product)}</span>` : ''}
            </div>
            ${u.spotify_user_id ? `
              <div class="user-mail">${esc(u.display_name || '')}${u.display_name ? ' · ' : ''}${u.email ? `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : '<span class="muted">keine E-Mail</span>'}</div>
              <div class="user-meta">Spotify-ID ${esc(u.spotify_user_id)}${u.country ? ` · ${esc(u.country)}` : ''} · letzter Sync ${u.last_sync ? `${relTime(u.last_sync)}${u.last_sync_ok === false ? ' (Fehler)' : ''}` : '–'}</div>`
              : ''}
            <div class="user-meta">registriert ${fmtDT(u.created_at)}</div>
            <div class="user-actions">
              ${u.spotify_user_id ? `<button class="btn btn-ghost btn-xs" data-act="sync" ${u.auth_expired ? 'disabled title="Verbindung abgelaufen"' : ''}>Jetzt synchronisieren</button>` : ''}
              ${u.id === me ? '' : '<button class="btn btn-ghost btn-xs" data-act="reset">Passwort zurücksetzen</button>'}
              ${u.id === me ? '' : `<button class="btn btn-ghost btn-xs" data-act="${u.is_admin ? 'unadmin' : 'admin'}">${u.is_admin ? 'Admin entziehen' : 'Zum Admin machen'}</button>`}
              ${u.id === me ? '' : '<button class="btn btn-ghost btn-xs btn-danger" data-act="delete">Löschen</button>'}
            </div>
          </div>
          <div class="user-side">
            ${fmt(u.plays)} Plays<small>${fmt(u.minutes)} Min.</small>
            <small>Login ${relTime(u.last_login_at) || '–'} · ${fmt(u.login_count)}×</small>
          </div>
        </li>`).join('')
      : `<li class="empty">${q ? 'Keine Treffer.' : 'Noch keine Konten.'}</li>`;
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
        if (!confirm(`Konto „${name}“ samt aller Hördaten endgültig löschen?`)) return;
        btn.disabled = true;
        await api(base, { method: 'DELETE' });
        toast(`${name} wurde gelöscht`);
      } else if (act === 'admin' || act === 'unadmin') {
        if (act === 'admin' && !confirm(`„${name}“ Admin-Rechte geben? Admins sehen alle Konten mit Namen und E-Mails.`)) return;
        btn.disabled = true;
        await api(`${base}/admin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin: act === 'admin' }) });
        toast(act === 'admin' ? `${name} ist jetzt Admin` : `${name} ist kein Admin mehr`);
      } else if (act === 'reset') {
        if (!confirm(`Neues Passwort für „${name}“ erzeugen? Das alte Passwort funktioniert danach nicht mehr.`)) return;
        btn.disabled = true;
        const r = await api(`${base}/reset-password`, { method: 'POST' });
        prompt(`Neues Passwort für „${r.username}“ – jetzt kopieren und weitergeben (wird nur einmal angezeigt):`, r.password);
      } else if (act === 'sync') {
        btn.disabled = true;
        btn.textContent = 'Synchronisiere …';
        const r = await api(`${base}/sync`, { method: 'POST' });
        toast(`${name}: ${fmt(r.recent?.inserted ?? 0)} neue Plays`);
      }
      await loadAdmin();
    } catch (err) {
      toast(`Aktion fehlgeschlagen: ${err.message}`, true);
      btn.disabled = false;
    }
  }

  function renderSystem(sys) {
    const rows = [
      ['Datenbank', `${sys.database.size} · ${sys.database.version}`],
      ['Plays gesamt', fmt(sys.catalog.plays)],
      ['Songs im Katalog', `${fmt(sys.catalog.tracks)}${sys.catalog.tracks_pending ? ` (${fmt(sys.catalog.tracks_pending)} ohne Cover)` : ''}`],
      ['Künstler im Katalog', `${fmt(sys.catalog.artists)}${sys.catalog.artists_pending ? ` (${fmt(sys.catalog.artists_pending)} ohne Genres)` : ''}`],
      ['Ranking-Snapshots', fmt(sys.catalog.snapshots)],
      ['Sync-Läufe (24 h)', `${fmt(sys.jobs.runs_24h)}${sys.jobs.errors_24h ? ` · ${fmt(sys.jobs.errors_24h)} Fehler` : ' · keine Fehler'}`],
      ['Letzter Sync', sys.jobs.last_run ? relTime(sys.jobs.last_run) : '–'],
      ['Zeitplan', sys.config.internalScheduler ? `alle ${sys.config.syncIntervalMinutes} Min.` : 'aus'],
      ['Keep-Alive', sys.config.keepAlive ? 'an' : 'aus'],
      ['Zeitzone', sys.config.timezone],
      ['Registrierung', sys.config.allowRegistration ? 'offen' : 'geschlossen'],
    ];
    $('#admin-system').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('#admin-errors').innerHTML = sys.errors.length
      ? sys.errors.map((e) => `
        <li>
          ${userAvatar({ display_name: e.username || e.display_name, id: e.user_id || '?' })}
          <div class="who">${esc(e.username || e.display_name || e.user_id || 'System')} <span>· ${esc(e.job)}</span>
            <span class="err-msg" title="${esc(e.message)}">${esc(e.message)}</span></div>
          <time datetime="${esc(e.started_at)}">${fmtDT(e.started_at)}</time>
        </li>`).join('')
      : '<li class="empty">Keine Fehler – alles läuft.</li>';
  }

  async function loadAdmin() {
    try {
      const [d, sys] = await Promise.all([api('/api/admin/accounts'), api('/api/admin/system')]);
      const weekAgo = Date.now() - 7 * 864e5;
      countUp($('[data-admin="users"]'), d.accounts.length);
      $('[data-admin-sub="connected"]').textContent = `${fmt(d.accounts.filter((u) => u.spotify_user_id).length)} mit Spotify`;
      countUp($('[data-admin="active"]'), d.accounts.filter((u) => u.last_seen_at && new Date(u.last_seen_at) > weekAgo).length);
      countUp($('[data-admin="logins"]'), d.accounts.reduce((a, u) => a + (u.login_count || 0), 0));
      countUp($('[data-admin="plays"]'), d.accounts.reduce((a, u) => a + (u.plays || 0), 0));
      adminAccounts = d.accounts;
      renderAdminUsers();
      renderSystem(sys);
      $('#admin-logins').innerHTML = d.logins.length
        ? d.logins.map((l) => `
          <li>
            ${userAvatar({ ...l, display_name: l.username, id: String(l.account_id) })}
            <div class="who">${esc(l.username)} <span>${esc([l.display_name, l.email, shortAgent(l.user_agent)].filter(Boolean).join(' · '))}</span></div>
            <time datetime="${esc(l.at)}">${fmtDT(l.at)}</time>
          </li>`).join('')
        : '<li class="empty">Noch keine Logins.</li>';
    } catch (err) {
      if (err.message !== 'unauthorized') toast(`Admin: ${err.message}`, true);
    }
  }

  // ================================================================ Start
  document.addEventListener('DOMContentLoaded', () => {
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
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-goto]');
      if (go) { showPanel(go.dataset.goto); return; }
      const b = e.target.closest('[data-action]');
      if (b) ({ password: changePassword, disconnect: disconnectSpotify, delete: deleteAccount })[b.dataset.action]?.();
    });
    $('#admin-refresh').addEventListener('click', loadAdmin);
    $('#admin-users').addEventListener('click', adminAction);
    $('#admin-search').addEventListener('input', renderAdminUsers);
    const justConnected = handleQueryFlags();
    refreshAll();
    // Nach dem Verbinden läuft der erste Sync im Hintergrund – kurz danach neu laden.
    if (justConnected) setTimeout(refreshAll, 6000);
    // Alle 5 Minuten im Hintergrund auffrischen, wenn der Tab sichtbar ist.
    setInterval(() => { if (document.visibilityState === 'visible' && state.panel !== 'admin') refreshAll(); }, 5 * 60_000);
  });
})();
