(() => {
  // Als App installierbar machen (Android/Chrome: Vollbild ohne Browserleiste)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  const I = window.SpotlfyI18n;
  const t = I.t;
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
  const errText = (data, status) => (data.key ? t(`err.${data.key}`) : data.error || `HTTP ${status}`);

  // Schritt 1 (Auswahl) ↔ Schritt 2 (Formular)
  function show(next, { focus = true } = {}) {
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
    $('#auth-title').textContent = reg ? t('login.createAccount') : t('login.login');
    $('#register-extra').hidden = !reg;
    $('#password').autocomplete = reg ? 'new-password' : 'current-password';
    btn.textContent = reg ? t('login.createAccount') : t('login.login');
    btn.disabled = false;
    $('#auth-switch').innerHTML = reg
      ? `${t('login.haveAccount')} <button type="button" data-mode="login">${t('login.login')}</button>`
      : allowRegistration
        ? `${t('login.noAccount')} <button type="button" data-mode="register">${t('login.register')}</button>`
        : '';
    if (focus) $('#username').focus();
    try { history.replaceState(null, '', reg ? '/login#register' : '/login#login'); } catch { /* egal */ }
  }

  // Sprachauswahl (wird beim Anmelden für das Konto übernommen)
  function renderLang() {
    $('#login-lang').innerHTML = I.LANGS.map((l) =>
      `<button type="button" role="radio" aria-checked="${l === I.lang}" data-lang="${l}" title="${I.NAMES[l]}">${l.toUpperCase()}</button>`).join('');
  }
  renderLang();

  document.addEventListener('click', (e) => {
    const lb = e.target.closest('[data-lang]');
    if (lb) {
      I.setLang(lb.dataset.lang);
      renderLang();
      if (mode) show(mode, { focus: false });
      return;
    }
    const b = e.target.closest('[data-mode]');
    if (b) show(b.dataset.mode);
  });
  $('#auth-back').addEventListener('click', () => show(null));

  if (location.hash === '#register') show('register');
  else if (location.hash === '#login') show('login');

  fetch('/api/auth/config')
    .then((r) => r.json())
    .then((c) => {
      allowRegistration = c.allowRegistration !== false;
      if (!allowRegistration) {
        $('#choice-register').hidden = true;
        if (mode) show('login');
      }
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username').value.trim();
    const password = $('#password').value;
    if (!username || !password) return showError(t('login.fillIn'));
    if (mode === 'register') {
      if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) return showError(t('err.usernameInvalid'));
      if (password.length < 8) return showError(t('err.passwordShort'));
      if (password !== $('#password2').value) return showError(t('pw.mismatch'));
    }
    btn.disabled = true;
    showError('');
    try {
      const res = await fetch(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password, lang: I.lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(data, res.status));
      location.href = mode === 'register' ? (data.isAdmin ? '/?welcome=1&admin=1' : '/?welcome=1') : '/';
    } catch (ex) {
      showError(ex.message);
      btn.disabled = false;
    }
  });
})();
