const err = new URLSearchParams(location.search).get('error');
if (err) {
  const el = document.getElementById('error');
  el.textContent = err === 'locked' ? 'Zu viele Versuche – bitte in 15 Minuten erneut probieren.' : 'Falsches Passwort.';
  el.hidden = false;
}
