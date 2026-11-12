(() => {
  const $ = (s) => document.querySelector(s);
  const form = $('#auth-form');
  const err = $('#error');
  const btn = $('#submit-btn');
  let mode = 'login';

  function showError(msg) {
    err.textContent = msg;
    err.hidden = !msg;
  }

  // Segment-Control mit gleitender Markierung
  const tabs = $('#auth-tabs');
  const pill = document.createElement('span');
  pill.className = 'seg-pill';
  tabs.prepend(pill);
  const buttons = [...tabs.querySelectorAll('button')];

  function setMode(next, animate = true) {
    mode = next;
    const b = buttons.find((x) => x.dataset.mode === next);
    buttons.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    pill.style.transition = animate ? '' : 'none';
    pill.style.width = `${b.offsetWidth}px`;
    pill.style.transform = `translateX(${b.offsetLeft}px)`;
    const reg = next === 'register';
    $('#register-extra').hidden = !reg;
    $('#password').autocomplete = reg ? 'new-password' : 'current-password';
    btn.textContent = reg ? 'Konto erstellen' : 'Anmelden';
    showError('');
    try { history.replaceState(null, '', reg ? '/login#registrieren' : '/login'); } catch { /* egal */ }
  }
  buttons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  requestAnimationFrame(() => setMode(location.hash === '#registrieren' ? 'register' : 'login', false));
  window.addEventListener('resize', () => setMode(mode, false));

  fetch('/api/auth/config')
    .then((r) => r.json())
    .then((c) => {
      if (!c.allowRegistration) {
        buttons.find((b) => b.dataset.mode === 'register').hidden = true;
        setMode('login', false);
      }
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username').value.trim();
    const password = $('#password').value;
    if (!username || !password) return showError('Bitte Benutzername und Passwort eingeben.');
    if (mode === 'register') {
      if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
        return showError('Der Benutzername muss 3–24 Zeichen lang sein (Buchstaben, Zahlen, _ . -).');
      }
      if (password.length < 8) return showError('Das Passwort muss mindestens 8 Zeichen lang sein.');
      if (password !== $('#password2').value) return showError('Die Passwörter stimmen nicht überein.');
    }
    btn.disabled = true;
    showError('');
    try {
      const res = await fetch(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      location.href = mode === 'register' ? '/?welcome=1' : '/';
    } catch (ex) {
      showError(ex.message);
      btn.disabled = false;
    }
  });
})();
