/* Spotlfy – Neuigkeiten („Was ist neu?“).
   Bei JEDER Änderung an der App hier oben einen neuen Eintrag ergänzen (neueste zuerst):
   - id: eindeutig und aufsteigend (Datum + Buchstabe), date: 'YYYY-MM-DD'
   - items: höchstens 4–5 kurze Punkte, je Icon, Titel (t) und ein knapper Satz (d) in allen 7 Sprachen
     [de, en, fr, es, it, sv, da]; optional go: Bereich zum Ausprobieren
     ('overview', 'top', 'times', 'genres', 'trends', 'history', 'wrapped', 'friends', 'profile', 'glass', 'records').
   Nutzer sehen beim nächsten Öffnen einmalig ein Pop-up mit allen Einträgen, die sie noch nicht kennen. */
window.SpotlfyNews = [
  {
    id: '2026-11-14f',
    date: '2026-11-14',
    items: [
      {
        icon: '🖼️', go: 'records',
        t: ['Fehlende Cover ergänzt', 'Missing covers filled in', 'Pochettes manquantes ajoutées', 'Portadas que faltaban', 'Copertine mancanti aggiunte', 'Saknade omslag tillagda', 'Manglende covers tilføjet'],
        d: ['Auch Platten und CDs in deiner Sammlung bekommen ihr Cover nachträglich.', 'Records and CDs in your collection now get their cover afterwards, too.', 'Les vinyles et CD de ta collection reçoivent aussi leur pochette.', 'Los discos y CD de tu colección también reciben su portada.', 'Anche dischi e CD della tua collezione ricevono la copertina.', 'Även skivor och cd-skivor i samlingen får sitt omslag i efterhand.', 'Også plader og cd’er i din samling får deres cover bagefter.'],
      },
    ],
  },
  {
    id: '2026-11-14e',
    date: '2026-11-14',
    items: [
      {
        icon: '🖼️', go: 'top',
        t: ['Cover viel schneller', 'Covers load much faster', 'Pochettes bien plus rapides', 'Portadas mucho más rápidas', 'Copertine molto più veloci', 'Omslag mycket snabbare', 'Covers meget hurtigere'],
        d: ['Nach einem Import erscheinen die Albumcover jetzt in wenigen Minuten.', 'After an import, album covers now show up within minutes.', 'Après un import, les pochettes apparaissent en quelques minutes.', 'Tras importar, las portadas aparecen en pocos minutos.', 'Dopo un’importazione le copertine compaiono in pochi minuti.', 'Efter en import syns omslagen nu inom några minuter.', 'Efter en import vises covers nu på få minutter.'],
      },
    ],
  },
  {
    id: '2026-11-14d',
    date: '2026-11-14',
    items: [
      {
        icon: '👆', go: 'wrapped',
        t: ['Rückblick wegwischen', 'Swipe away your review', 'Balaie pour fermer', 'Desliza para cerrar', 'Scorri per chiudere', 'Svep bort återblicken', 'Swipe tilbageblikket væk'],
        d: ['Hoch oder runter wischen schließt die Story.', 'Swipe up or down to close the story.', 'Balaie vers le haut ou le bas pour fermer la story.', 'Desliza arriba o abajo para cerrar la historia.', 'Scorri su o giù per chiudere la storia.', 'Svep upp eller ner för att stänga storyn.', 'Swipe op eller ned for at lukke storyen.'],
      },
    ],
  },
  {
    id: '2026-11-14c',
    date: '2026-11-14',
    items: [
      {
        icon: '🫧', go: 'glass',
        t: ['Liquid Glass', 'Liquid Glass', 'Liquid Glass', 'Liquid Glass', 'Liquid Glass', 'Liquid Glass', 'Liquid Glass'],
        d: ['Neuer Look aus Glas – im Profil unter Farbschema einschalten.', 'A new glass look – turn it on in your profile under colour scheme.', 'Un nouveau look en verre – à activer dans le profil, thème.', 'Nuevo aspecto de cristal – actívalo en el perfil, tema.', 'Nuovo look in vetro – attivalo nel profilo, tema.', 'Nytt glasutseende – slå på i profilen under färgtema.', 'Nyt glas-look – slå det til i profilen under farvetema.'],
      },
      {
        icon: '🎵', go: 'wrapped',
        t: ['Rückblick mit Musik', 'Year in review with music', 'Rétrospective en musique', 'Resumen con música', 'Riepilogo con musica', 'Återblick med musik', 'Tilbageblik med musik'],
        d: ['Zu jeder Folie läuft ein passender Song – mit DJ-Übergängen, stummschaltbar.', 'Every slide plays a matching song – with DJ transitions, can be muted.', 'Chaque diapo joue un titre assorti – transitions DJ, son coupable.', 'Cada diapositiva suena con su canción – transiciones DJ, silenciable.', 'Ogni slide ha la sua canzone – transizioni da DJ, silenziabile.', 'Varje bild spelar en passande låt – DJ-övergångar, kan tystas.', 'Hvert dias spiller en passende sang – DJ-overgange, kan slås fra.'],
      },
      {
        icon: '✨', go: 'wrapped',
        t: ['Anschaulichere Folien', 'Livelier slides', 'Diapos plus vivantes', 'Diapositivas más vivas', 'Slide più vivaci', 'Livligare bilder', 'Mere levende dias'],
        d: ['Plattenspieler, Genre-Donut, 24-Stunden-Uhr und flüssige Übergänge.', 'Turntable, genre donut, 24-hour clock and smooth transitions.', 'Platine, donut des genres, horloge 24 h et transitions fluides.', 'Tocadiscos, donut de géneros, reloj de 24 h y transiciones fluidas.', 'Giradischi, ciambella dei generi, orologio 24 h e transizioni fluide.', 'Skivspelare, genremunk, 24-timmarsklocka och mjuka övergångar.', 'Pladespiller, genre-donut, 24-timers ur og bløde overgange.'],
      },
      {
        icon: '✍️', go: 'records',
        t: ['Autogramme', 'Autographs', 'Autographes', 'Autógrafos', 'Autografi', 'Autografer', 'Autografer'],
        d: ['Legendäre Platten und CDs tragen jetzt ein eigenes Künstler-Autogramm.', 'Legendary records and CDs now carry their own artist autograph.', 'Les vinyles et CD légendaires portent un autographe de l’artiste.', 'Los discos y CD legendarios llevan un autógrafo del artista.', 'I dischi e CD leggendari hanno un autografo dell’artista.', 'Legendariska skivor och cd-skivor har nu en egen autograf.', 'Legendariske plader og cd’er har nu deres egen autograf.'],
      },
      {
        icon: '🪙', go: 'records',
        t: ['Glänzende Noten', 'Shiny notes', 'Notes brillantes', 'Notas brillantes', 'Note scintillanti', 'Glänsande noter', 'Skinnende noder'],
        d: ['Deine Noten funkeln, Preise sind immer sichtbar.', 'Your notes sparkle and prices are always shown.', 'Tes notes scintillent, les prix restent visibles.', 'Tus notas brillan y los precios siempre se ven.', 'Le tue note brillano, i prezzi sono sempre visibili.', 'Dina noter glittrar och priser syns alltid.', 'Dine noder funkler, og priser vises altid.'],
      },
    ],
  },
];
