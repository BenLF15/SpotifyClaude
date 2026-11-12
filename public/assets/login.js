const MESSAGES = {
  access_denied: 'Du hast die Anmeldung bei Spotify abgebrochen.',
  user_not_registered:
    'Dein Spotify-Konto ist für diese App noch nicht freigeschaltet. Bitte den Betreiber, dich in der Spotify-App unter „User Management“ hinzuzufügen.',
  state_mismatch: 'Die Anmeldung ist abgelaufen. Bitte versuche es noch einmal.',
  invalid_grant: 'Die Anmeldung ist abgelaufen. Bitte versuche es noch einmal.',
  profile_failed: 'Dein Spotify-Profil konnte nicht geladen werden. Bitte versuche es später noch einmal.',
};
const err = new URLSearchParams(location.search).get('error');
if (err) {
  const el = document.getElementById('error');
  el.textContent = MESSAGES[err] || `Anmeldung fehlgeschlagen (${err}). Bitte versuche es noch einmal.`;
  el.hidden = false;
  history.replaceState(null, '', '/login');
}
