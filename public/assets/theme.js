/* Spotlfy – Darstellung & Zoom-Sperre.
   Wird synchron im <head> geladen, damit die richtige Farbwelt schon vor dem ersten Zeichnen steht. */
(() => {
  'use strict';
  const root = document.documentElement;
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* egal */ } };

  // ---------------------------------------------------------------- Jahreszeiten (astronomisch, Nordhalbkugel)
  // Frühling ab 20.3., Sommer ab 21.6., Herbst ab 23.9., Winter ab 21.12.
  const SEASONS = {
    spring: { name: 'Frühling', icon: '🌸', start: [3, 20], next: 'summer' },
    summer: { name: 'Sommer', icon: '☀️', start: [6, 21], next: 'autumn' },
    autumn: { name: 'Herbst', icon: '🍂', start: [9, 23], next: 'winter' },
    winter: { name: 'Winter', icon: '❄️', start: [12, 21], next: 'spring' },
  };
  function seasonOf(date) {
    const md = (date.getMonth() + 1) * 100 + date.getDate();
    if (md >= 1221 || md < 320) return 'winter';
    if (md < 621) return 'spring';
    if (md < 923) return 'summer';
    return 'autumn';
  }
  function seasonEnd(key, date) {
    const [m, d] = SEASONS[SEASONS[key].next].start;
    let year = date.getFullYear();
    if (key === 'winter' && date.getMonth() >= 11) year += 1;
    return new Date(year, m - 1, d - 1);
  }
  // Admins können zum Testen ein Datum vorgeben (nur in diesem Browser)
  function effectiveDate() {
    const o = get('seasonDate');
    const d = o ? new Date(`${o}T12:00:00`) : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  // ---------------------------------------------------------------- Modus → Farbwelt
  const media = window.matchMedia('(prefers-color-scheme: light)');
  function resolve(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    if (mode === 'season') return seasonOf(effectiveDate());
    return media.matches ? 'light' : 'dark'; // system
  }
  const THEME_COLOR = { dark: '#0a0c0b', light: '#f3f6f3', spring: '#f7f1f4', summer: '#fff8e8', autumn: '#140d08', winter: '#0b1018' };

  function apply(mode) {
    const m = mode || get('theme') || 'dark';
    const theme = resolve(m);
    root.dataset.mode = m;
    root.dataset.theme = theme;
    root.style.colorScheme = ['light', 'spring', 'summer'].includes(theme) ? 'light' : 'dark';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
    window.dispatchEvent(new CustomEvent('spotlfy:theme', { detail: { mode: m, theme } }));
    return theme;
  }
  function setMode(mode) {
    set('theme', mode);
    return apply(mode);
  }
  media.addEventListener?.('change', () => { if ((get('theme') || 'dark') === 'system') apply('system'); });

  window.SpotlfyTheme = {
    SEASONS, seasonOf, seasonEnd, effectiveDate, apply, setMode, resolve,
    mode: () => get('theme') || 'dark',
    setSeasonDate(iso) { set('seasonDate', iso || null); return apply(); },
    seasonDate: () => get('seasonDate'),
  };
  apply();
  document.addEventListener('DOMContentLoaded', () => apply());

  // ---------------------------------------------------------------- Zoom sperren (Web-App-Gefühl)
  // iOS ignoriert user-scalable=no – daher Pinch- und Doppeltipp-Gesten zusätzlich abfangen.
  const stop = (e) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // Doppeltipp-Zoom verhindert CSS (touch-action: manipulation), ohne schnelle Taps zu schlucken.
  // Desktop: Strg/Cmd + Mausrad bzw. +/- abfangen
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
  });
})();
