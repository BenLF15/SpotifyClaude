# Hinweise für Claude

- **Bei jeder Änderung an der App** einen neuen Eintrag oben in `public/assets/changelog.js` ergänzen
  (neue, aufsteigende `id`, heutiges `date`, 1–4 kurze Punkte mit Icon, Titel `t` und einem knappen Satz `d`
  in allen 7 Sprachen [de, en, fr, es, it, sv, da], optional `go` zum Ausprobieren). Nutzer sehen das beim
  nächsten Öffnen einmalig als Pop-up „Neu in Spotlfy“. Reine Bugfixes/Interna ohne sichtbare Wirkung brauchen keinen Eintrag.
- Danach den Cache-Parameter `?v=…` in `public/*.html` hochzählen, damit Browser die neuen Dateien laden.
- Neue UI-Texte immer in `public/assets/i18n.js` in allen 7 Sprachen anlegen.
