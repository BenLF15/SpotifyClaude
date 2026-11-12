/* Spotlfy – Dashboard-Frontend (Vanilla JS + Chart.js) */
(() => {
  'use strict';

  // ---------------------------------------------------------------- Helpers
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

  const state = {
    range: store.get('range', '30d'),
    timelineMode: store.get('timelineMode', 'daily'),
    trendMode: 'minutes',
    rankKind: store.get('rankKind', 'artists'),
    rankRange: store.get('rankRange', 'short_term'),
    dashboard: null,
    trends: null,
    user: null,
  };

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: 'same-origin', ...opts });
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
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
  const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' });
  const monthFmtLong = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
  const dayMonthFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
  const parseDay = (s) => new Date(`${s}T12:00:00`);

  function initials(name) {
    return esc((name || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '♪');
  }
  function imgOrPlaceholder(src, name) {
    return src
      ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
      : `<div class="placeholder" aria-hidden="true">${initials(name)}</div>`;
  }

  // Zahlen hochzählen
  function countUp(el, to) {
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

  // Einblenden beim Scrollen
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
      }, { rootMargin: '0px 0px -40px 0px' })
    : null;
  $$('.reveal').forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i, 6) * 50}ms`;
    io ? io.observe(el) : el.classList.add('is-visible');
  });

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
    window.addEventListener('resize', () => {
      const sel = buttons.find((b) => b.getAttribute('aria-selected') === 'true');
      if (sel) select(sel, false);
    });
  }

  // ---------------------------------------------------------------- Chart.js Setup
  const COLORS = {
    accent: '#1ed760',
    grid: 'rgba(255,255,255,0.06)',
    tick: '#7d877f',
    // Kategoriale Reihenfolge (validiert für dunkle Flächen): Blau, Orange, Aqua, Gelb, Magenta
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
  };
  const charts = {};

  function setupChartDefaults() {
    const C = window.Chart;
    C.defaults.font.family = "'Inter', system-ui, sans-serif";
    C.defaults.font.size = 12;
    C.defaults.locale = 'de-DE';
    C.defaults.color = COLORS.tick;
    C.defaults.animation.duration = reduceMotion ? 0 : 900;
    C.defaults.animation.easing = 'easeOutQuart';
    C.defaults.maintainAspectRatio = false;
    C.defaults.plugins.legend.display = false;
    Object.assign(C.defaults.plugins.tooltip, {
      backgroundColor: '#202722', borderColor: 'rgba(255,255,255,0.14)', borderWidth: 1,
      titleColor: '#f0f2f0', bodyColor: '#b4bcb6', padding: 10, cornerRadius: 10,
      displayColors: false, titleFont: { weight: '650' }, caretSize: 0,
    });
  }

  const baseScales = (extra = {}) => ({
    x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
    y: { grid: { color: COLORS.grid }, border: { display: false }, beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 5, padding: 8 } },
    ...extra,
  });

  function verticalGradient(ctx, area, rgb) {
    const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, `rgba(${rgb},0.35)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    return g;
  }

  function upsertChart(key, canvas, config) {
    if (charts[key]) {
      charts[key].data = config.data;
      charts[key].options = config.options;
      charts[key].update();
    } else {
      charts[key] = new window.Chart(canvas, config);
    }
  }

  // ---------------------------------------------------------------- Status
  async function loadStatus() {
    const s = await api('/api/status');
    state.user = s.user;
    $('#auth-banner').hidden = !s.user?.auth_expired;
    $('#user-line').textContent = s.user ? s.user.display_name || s.user.id : '';
    if (s.user?.avatar_url) {
      const img = $('#brand-img');
      img.src = s.user.avatar_url;
      img.referrerPolicy = 'no-referrer';
      img.classList.add('avatar-sm');
    }
    $('#view-tabs').hidden = !s.user?.is_admin;
    const job = s.jobs.recently_played;
    $('#last-sync').textContent = job
      ? `${job.ok ? 'Zuletzt synchronisiert' : 'Sync fehlgeschlagen'} ${relTime(job.finished_at)}`
      : '';
    const pending = s.counts.tracks_pending || 0;
    $('#footer').textContent = [
      `${fmt(s.counts.plays)} Plays gespeichert`,
      s.counts.imported ? `${fmt(s.counts.imported)} davon importiert` : null,
      s.snapshots.days ? `${fmt(s.snapshots.days)} Ranking-Snapshots` : null,
      pending ? `${fmt(pending)} Songs warten auf Cover` : null,
    ].filter(Boolean).join(' · ');
    return s;
  }

  // ---------------------------------------------------------------- Dashboard
  async function loadDashboard() {
    document.body.classList.add('is-loading');
    try {
      const d = await api(`/api/dashboard?range=${state.range}`);
      state.dashboard = d;
      renderKpis(d.overview);
      renderTimeline();
      renderArtists(d.topArtists);
      renderTracks(d.topTracks);
      renderHeatmap(d.heatmap);
      renderGenres(d.genres);
      renderRecent(d.recent);
    } catch (err) {
      if (err.message !== 'unauthorized') toast(`Laden fehlgeschlagen: ${err.message}`, true);
    } finally {
      document.body.classList.remove('is-loading');
    }
  }

  function renderKpis(o) {
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
  }

  function renderTimeline() {
    const d = state.dashboard;
    if (!d) return;
    const weekly = state.timelineMode === 'weekly';
    const rows = weekly ? d.timeline.weekly : d.timeline.daily;
    const labels = rows.map((r) => (weekly ? r.week : r.day));
    const values = rows.map((r) => r.minutes);
    const total = values.reduce((a, b) => a + b, 0);
    const avg = rows.length ? total / rows.length : 0;
    $('#timeline-caption').textContent = rows.length
      ? `Ø ${fmt(avg)} Minuten pro ${weekly ? 'Woche' : 'Tag'}${!weekly && state.range === 'all' ? ' · letzte 365 Tage' : ''}`
      : '';
    const canvas = $('#timeline-chart');
    upsertChart('timeline', canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: (ctx) => (ctx.raw > avg ? COLORS.accent : 'rgba(30,215,96,0.55)'),
          hoverBackgroundColor: '#5cf08f',
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom',
          barPercentage: 0.85,
          categoryPercentage: rows.length > 120 ? 1 : 0.9,
          maxBarThickness: 28,
        }],
      },
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
          tooltip: {
            callbacks: {
              title: (items) => {
                const l = items[0].label;
                return weekly ? `Woche ab ${dateFmtYear.format(parseDay(l))}` : dateFmt.format(parseDay(l));
              },
              label: (item) => `${fmt(item.raw)} Minuten`,
            },
          },
        },
      },
    });
  }

  function renderArtists(list) {
    const el = $('#top-artists');
    if (!list.length) { el.innerHTML = '<li class="empty">Noch keine Daten in diesem Zeitraum.</li>'; return; }
    el.innerHTML = list.slice(0, 12).map((a, i) => `
      <li class="artist" title="${esc(a.name)} – ${fmt(a.minutes)} Min., ${fmt(a.plays)} Plays">
        <div class="avatar-wrap"><div class="avatar">${imgOrPlaceholder(a.image, a.name)}</div><span class="rank-badge">${i + 1}</span></div>
        <div class="artist-name">${esc(a.name)}</div>
        <div class="artist-meta">${fmt(a.minutes)} Min.</div>
      </li>`).join('');
  }

  function renderTracks(list) {
    const el = $('#top-tracks');
    if (!list.length) { el.innerHTML = '<li class="empty">Noch keine Daten in diesem Zeitraum.</li>'; return; }
    const max = list[0].plays || 1;
    el.innerHTML = list.slice(0, 10).map((t, i) => `
      <li class="track">
        <span class="num">${i + 1}</span>
        <div class="cover">${imgOrPlaceholder(t.image, t.name)}</div>
        <div class="t-main">
          <div class="t-title">${esc(t.name)}</div>
          <div class="t-sub">${esc(t.artists)}</div>
          <div class="bar-inline" data-w="${(t.plays / max) * 100}"></div>
        </div>
        <div class="t-stat">${fmt(t.plays)}×<small>${fmt(t.minutes)} Min.</small></div>
      </li>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.bar-inline', el).forEach((b) => { b.style.width = `${b.dataset.w}%`; });
    }));
  }

  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const DAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  function renderHeatmap(grid) {
    const el = $('#heatmap');
    el.classList.remove('is-ready');
    const max = Math.max(1, ...grid.flat());
    const wide = window.innerWidth >= 700;
    let html = '<span></span>';
    for (let h = 0; h < 24; h++) {
      html += `<span class="heat-col-label">${h % (wide ? 3 : 6) === 0 ? h : ''}</span>`;
    }
    grid.forEach((row, d) => {
      html += `<span class="heat-row-label">${DAYS[d]}</span>`;
      row.forEach((v, h) => {
        const t = v / max;
        const alpha = v === 0 ? 0.04 : 0.1 + 0.9 * Math.pow(t, 0.75);
        html += `<span class="heat-cell" role="gridcell" data-d="${d}" data-h="${h}" data-v="${v}" data-a="${alpha.toFixed(3)}" aria-label="${DAYS_LONG[d]} ${h} Uhr: ${v} Minuten"></span>`;
      });
    });
    el.innerHTML = html;
    $$('.heat-cell', el).forEach((c) => {
      c.style.background = `rgba(30,215,96,${c.dataset.a})`;
      c.style.transitionDelay = reduceMotion ? '0ms' : `${(Number(c.dataset.h) + Number(c.dataset.d) * 2) * 12}ms`;
    });
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-ready')));
  }

  function bindHeatTooltip() {
    const el = $('#heatmap');
    const tip = $('#heat-tip');
    const show = (cell) => {
      const d = Number(cell.dataset.d);
      const h = Number(cell.dataset.h);
      tip.innerHTML = `${DAYS_LONG[d]}, ${String(h).padStart(2, '0')}–${String((h + 1) % 24).padStart(2, '0')} Uhr<br><strong>${fmt(cell.dataset.v)} Minuten</strong>`;
      const r = cell.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 90), window.innerWidth - 90);
      tip.style.left = `${x}px`;
      tip.style.top = `${r.top}px`;
      tip.hidden = false;
    };
    el.addEventListener('pointerover', (e) => { const c = e.target.closest('.heat-cell'); if (c) show(c); });
    el.addEventListener('pointerleave', () => { tip.hidden = true; });
    el.addEventListener('click', (e) => { const c = e.target.closest('.heat-cell'); if (c) show(c); });
    window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  }

  function renderGenres(g) {
    const el = $('#genres');
    $('#genre-caption').textContent = g.items.length
      ? `Anteil an der Hörzeit · Genres für ${Math.round(g.coverage * 100)} % der Hörzeit bekannt`
      : 'Anteil an der Hörzeit';
    if (!g.items.length) {
      el.innerHTML = '<li class="empty">Noch keine Genre-Daten. Spotify liefert Genres nicht für jeden Künstler – der Cron-Job lädt sie nach und nach.</li>';
      return;
    }
    const max = g.items[0].share || 1;
    el.innerHTML = g.items.slice(0, 10).map((x) => `
      <li class="genre-row" title="${fmt(x.minutes)} Minuten">
        <span class="genre-name">${esc(x.genre)}</span>
        <span class="genre-val">${(x.share * 100).toFixed(x.share < 0.1 ? 1 : 0)} %</span>
        <span class="genre-track"><span class="genre-fill" data-w="${(x.share / max) * 100}"></span></span>
      </li>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.genre-fill', el).forEach((b, i) => { b.style.transitionDelay = `${i * 60}ms`; b.style.width = `${b.dataset.w}%`; });
    }));
  }

  function renderRecent(list) {
    const el = $('#recent');
    if (!list.length) { el.innerHTML = '<li class="empty">Noch nichts gehört – oder noch nicht synchronisiert.</li>'; return; }
    el.innerHTML = list.map((t) => `
      <li class="track">
        <div class="cover">${imgOrPlaceholder(t.image, t.name)}</div>
        <div class="t-main"><div class="t-title">${esc(t.name)}</div><div class="t-sub">${esc(t.artists)}</div></div>
        <div class="t-stat"><small>${relTime(t.played_at)}</small></div>
      </li>`).join('');
  }

  // ---------------------------------------------------------------- Entwicklung
  async function loadTrends() {
    try {
      state.trends = await api('/api/trends');
      renderTrends();
    } catch (err) {
      if (err.message !== 'unauthorized') toast(`Entwicklung: ${err.message}`, true);
    }
  }

  function isCurrentMonth(m) {
    const now = new Date();
    return m === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function renderTrends() {
    const rows = state.trends?.monthly || [];
    const key = state.trendMode;
    const label = { minutes: 'Minuten', artists: 'verschiedene Künstler', new_artists: 'neue Künstler' }[key];
    upsertChart('trend', $('#trend-chart'), {
      type: 'line',
      data: {
        labels: rows.map((r) => r.month),
        datasets: [{
          data: rows.map((r) => r[key]),
          borderColor: COLORS.accent,
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          // Der laufende Monat ist noch unvollständig → gestrichelt
          segment: { borderDash: (ctx) => (ctx.p1DataIndex === rows.length - 1 && isCurrentMonth(rows.at(-1)?.month) ? [5, 5] : undefined) },
          backgroundColor: (ctx) => (ctx.chart.chartArea ? verticalGradient(ctx.chart.ctx, ctx.chart.chartArea, '30,215,96') : 'transparent'),
          pointRadius: rows.length > 36 ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: COLORS.accent,
          pointBorderColor: '#121614',
          pointBorderWidth: 2,
        }],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        scales: baseScales({
          x: {
            grid: { display: false }, border: { display: false },
            ticks: { maxRotation: 0, autoSkipPadding: 20, callback(v) { return monthFmt.format(new Date(`${this.getLabelForValue(v)}-15`)); } },
          },
        }),
        plugins: {
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

  // ---------------------------------------------------------------- Spotify-Ranking
  async function loadRanking() {
    try {
      const r = await api(`/api/spotify-top?kind=${state.rankKind}&range=${state.rankRange}`);
      renderRanking(r);
    } catch (err) {
      if (err.message !== 'unauthorized') toast(`Ranking: ${err.message}`, true);
    }
  }

  function renderRanking(r) {
    const list = $('#rank-list');
    $('#ranking-caption').textContent = r.date
      ? `Stand ${dateFmtYear.format(parseDay(r.date))} · Pfeile zeigen die Veränderung zur Vorwoche`
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
          pointBorderColor: '#121614',
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

  // ---------------------------------------------------------------- Sync & Import
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
      toast(err.status === 409 ? 'Spotify-Verbindung abgelaufen – bitte neu anmelden.' : `Sync fehlgeschlagen: ${err.message}`, true);
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
      if (any) { toast('Import abgeschlossen – Cover & Genres werden im Hintergrund nachgeladen'); refreshAll(); }
    }
    input.addEventListener('change', () => { handle(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove('is-over'); }));
    zone.addEventListener('drop', (e) => handle(e.dataTransfer.files));
  }

  // ---------------------------------------------------------------- Start
  async function refreshAll() {
    await Promise.all([loadStatus().catch(() => {}), loadDashboard(), loadTrends(), loadRanking()]);
  }

  function handleQueryFlags() {
    const q = new URLSearchParams(location.search);
    if (q.has('welcome')) toast('Willkommen! Deine ersten Daten werden geladen …');
    if (q.has('welcome')) history.replaceState(null, '', '/');
    return q.has('welcome');
  }

  // ---------------------------------------------------------------- Admin: Nutzer & Logins
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

  async function loadAdmin() {
    try {
      const d = await api('/api/admin/users');
      const weekAgo = Date.now() - 7 * 864e5;
      countUp($('[data-admin="users"]'), d.users.length);
      countUp($('[data-admin="active"]'), d.users.filter((u) => u.last_seen_at && new Date(u.last_seen_at) > weekAgo).length);
      countUp($('[data-admin="logins"]'), d.users.reduce((a, u) => a + (u.login_count || 0), 0));
      countUp($('[data-admin="plays"]'), d.users.reduce((a, u) => a + (u.plays || 0), 0));

      $('#admin-users').innerHTML = d.users.length
        ? d.users.map((u) => `
          <li class="user-row">
            ${userAvatar(u)}
            <div class="t-main">
              <div class="user-name">${esc(u.display_name || u.id)}
                ${u.is_admin ? '<span class="tag tag-admin">Admin</span>' : ''}
                ${u.auth_expired ? '<span class="tag tag-warn">Verbindung abgelaufen</span>' : ''}
                ${u.product ? `<span class="tag tag-muted">${esc(u.product)}</span>` : ''}
              </div>
              <div class="user-mail">${u.email ? `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : '<span class="muted">keine E-Mail freigegeben</span>'}</div>
              <div class="user-meta">Spotify-ID ${esc(u.id)}${u.country ? ` · ${esc(u.country)}` : ''} · registriert ${fmtDT(u.created_at)}</div>
            </div>
            <div class="user-side">
              ${fmt(u.plays)} Plays<small>${fmt(u.minutes)} Min.</small>
              <small>Login ${relTime(u.last_login_at) || '–'} · ${fmt(u.login_count)}×</small>
            </div>
          </li>`).join('')
        : '<li class="empty">Noch keine Nutzer.</li>';

      $('#admin-logins').innerHTML = d.logins.length
        ? d.logins.map((l) => `
          <li>
            ${userAvatar({ ...l, id: l.user_id })}
            <div class="who">${esc(l.display_name || l.user_id)} <span>${esc(l.email || '')}${l.user_agent ? ` · ${esc(shortAgent(l.user_agent))}` : ''}</span></div>
            <time datetime="${esc(l.at)}">${fmtDT(l.at)}</time>
          </li>`).join('')
        : '<li class="empty">Noch keine Logins.</li>';
    } catch (err) {
      if (err.message !== 'unauthorized') toast(`Nutzerliste: ${err.message}`, true);
    }
  }

  function showView(view) {
    $('#view-stats').hidden = view !== 'stats';
    $('#view-admin').hidden = view !== 'admin';
    if (view === 'admin') loadAdmin();
    else Object.values(charts).forEach((c) => c.resize());
  }

  async function deleteAccount() {
    const ok = confirm('Dein Konto und alle gespeicherten Hördaten werden endgültig gelöscht. Fortfahren?');
    if (!ok) return;
    try {
      await api('/api/me', { method: 'DELETE' });
      location.href = '/login';
    } catch (err) {
      toast(`Löschen fehlgeschlagen: ${err.message}`, true);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupChartDefaults();
    segmented($('#range-control'), 'range', state.range, (v) => { state.range = v; store.set('range', v); loadDashboard(); });
    segmented($('#timeline-mode'), 'mode', state.timelineMode, (v) => { state.timelineMode = v; store.set('timelineMode', v); renderTimeline(); });
    segmented($('#trend-mode'), 'mode', state.trendMode, (v) => { state.trendMode = v; renderTrends(); });
    segmented($('#rank-kind'), 'kind', state.rankKind, (v) => { state.rankKind = v; store.set('rankKind', v); loadRanking(); });
    segmented($('#rank-range'), 'range', state.rankRange, (v) => { state.rankRange = v; store.set('rankRange', v); loadRanking(); });
    $('#sync-btn').addEventListener('click', runSync);
    bindHeatTooltip();
    bindImport();
    $('#delete-account').addEventListener('click', deleteAccount);
    $('#admin-refresh').addEventListener('click', loadAdmin);
    const justConnected = handleQueryFlags();
    refreshAll().then(() => {
      if (state.user?.is_admin) segmented($('#view-control'), 'view', 'stats', showView);
    });
    // Nach dem Verbinden läuft der erste Sync im Hintergrund – kurz danach neu laden.
    if (justConnected) setTimeout(refreshAll, 6000);
    // Alle 5 Minuten im Hintergrund auffrischen, wenn der Tab sichtbar ist.
    setInterval(() => { if (document.visibilityState === 'visible') refreshAll(); }, 5 * 60_000);
  });
})();
