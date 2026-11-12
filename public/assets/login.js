(() => {
  const $ = (s) => document.querySelector(s);
  const choice = $('#auth-choice');
  const form = $('#auth-form');
  const err = $('#error');
  const btn = $('#submit-btn');
  let mode = null;
  let allowRegistration = true;

  function showError(msg) {
    err.textContent = msg || '';
    err.hidden = !msg;
  }

  // Schritt 1 (Auswahl) ↔ Schritt 2 (Formular)
  function show(next) {
    mode = next;
    showError('');
    if (!next) {
      form.hidden = true;
      choice.hidden = false;
      choice.classList.remove('step-in');
      void choice.offsetWidth;
      choice.classList.add('step-in');
      try { history.replaceState(null, '', '/login'); } catch { /* egal */ }
      return;
    }
    const reg = next === 'register';
    choice.hidden = true;
    form.hidden = false;
    form.classList.remove('step-in');
    void form.offsetWidth;
    form.classList.add('step-in');
    $('#auth-title').textContent = reg ? 'Konto erstellen' : 'Anmelden';
    $('#register-extra').hidden = !reg;
    $('#password').autocomplete = reg ? 'new-password' : 'current-password';
    btn.textContent = reg ? 'Konto erstellen' : 'Anmelden';
    btn.disabled = false;
    $('#auth-switch').innerHTML = reg
      ? 'Schon ein Konto? <button type="button" data-mode="login">Anmelden</button>'
      : allowRegistration
        ? 'Noch kein Konto? <button type="button" data-mode="register">Registrieren</button>'
        : '';
    $('#username').focus();
    try { history.replaceState(null, '', reg ? '/login#registrieren' : '/login#anmelden'); } catch { /* egal */ }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) show(b.dataset.mode);
  });
  $('#auth-back').addEventListener('click', () => show(null));

  if (location.hash === '#registrieren') show('register');
  else if (location.hash === '#anmelden') show('login');

  fetch('/api/auth/config')
    .then((r) => r.json())
    .then((c) => {
      allowRegistration = c.allowRegistration !== false;
      if (!allowRegistration) {
        $('#choice-register').hidden = true;
        if (mode === 'register') show('login');
        else if (mode === 'login') show('login');
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
      location.href = mode === 'register' ? (data.isAdmin ? '/?welcome=1&admin=1' : '/?welcome=1') : '/';
    } catch (ex) {
      showError(ex.message);
      btn.disabled = false;
    }
  });
})();
