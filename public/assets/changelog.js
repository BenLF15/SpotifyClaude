/* Spotlfy – Neuigkeiten („Was ist neu?“).
   Bei JEDER Änderung an der App hier oben einen neuen Eintrag ergänzen (neueste zuerst):
   - id: eindeutig und aufsteigend (Datum + Buchstabe), date: 'YYYY-MM-DD'
   - items: höchstens 4–5 kurze Punkte, je Icon, Titel (t) und ein knapper Satz (d) in allen 7 Sprachen
     [de, en, fr, es, it, sv, da]; optional go: Bereich zum Ausprobieren
     ('overview', 'top', 'times', 'genres', 'trends', 'history', 'wrapped', 'friends', 'profile', 'glass', 'records').
   Nutzer sehen beim nächsten Öffnen einmalig ein Pop-up mit allen Einträgen, die sie noch nicht kennen. */
window.SpotlfyNews = [
  {
    id: '2026-11-16b',
    date: '2026-11-16',
    items: [
      {
        icon: '🌟', go: 'records',
        t: ['Status zählt mit', 'Status counts too', 'Le statut compte aussi', 'El estatus también cuenta', 'Conta anche lo status', 'Status räknas också', 'Status tæller også'],
        d: ['Für die Seltenheit zählen jetzt auch Künstler-Status, Auszeichnungen, Wikipedia-Präsenz und aktuelle Charts.', 'Rarity now also considers artist status, awards, Wikipedia presence and current charts.', 'La rareté tient compte du statut de l’artiste, des distinctions, de Wikipédia et des charts.', 'La rareza ahora considera estatus del artista, premios, Wikipedia y listas actuales.', 'La rarità considera ora status dell’artista, premi, Wikipedia e classifiche.', 'Sällsyntheten räknar nu även artiststatus, utmärkelser, Wikipedia och listor.', 'Sjældenheden tæller nu også kunstnerstatus, priser, Wikipedia og hitlister.'],
      },
    ],
  },
  {
    id: '2026-11-16a',
    date: '2026-11-16',
    items: [
      {
        icon: '🏆', go: 'records',
        t: ['Seltenheit nach Bekanntheit', 'Rarity by fame', 'Rareté selon la notoriété', 'Rareza según la fama', 'Rarità in base alla notorietà', 'Sällsynthet efter kändhet', 'Sjældenhed efter kendthed'],
        d: ['Welthits und Erfolgsalben sind jetzt legendär oder mythisch, Geheimtipps gewöhnlich.', 'Global hits and blockbuster albums are now legendary or mythic, hidden gems common.', 'Tubes mondiaux et albums à succès sont légendaires ou mythiques, les pépites communes.', 'Éxitos mundiales y superventas son legendarios o míticos; las joyas escondidas, comunes.', 'Hit mondiali e album di successo sono leggendari o mitici, le chicche comuni.', 'Världshits och storsäljare är legendariska eller mytiska, dolda pärlor vanliga.', 'Verdenshits og storsællere er legendariske eller mytiske, skjulte perler almindelige.'],
      },
    ],
  },
  {
    id: '2026-11-15e',
    date: '2026-11-15',
    items: [
      {
        icon: '📱', go: null,
        t: ['Leiste unten auf dem Handy', 'Bottom bar on phones', 'Barre en bas sur mobile', 'Barra inferior en el móvil', 'Barra in basso sul telefono', 'Nedre fält på mobilen', 'Bundlinje på mobilen'],
        d: ['Übersicht, Top-Listen, Verlauf und Freunde sind jetzt mit dem Daumen erreichbar – der Rest steckt unter „Mehr“.', 'Overview, top lists, history and friends are now within thumb reach – everything else is under “More”.', 'Aperçu, classements, historique et amis à portée de pouce – le reste est dans « Plus ».', 'Resumen, tops, historial y amigos al alcance del pulgar; el resto en «Más».', 'Panoramica, classifiche, cronologia e amici a portata di pollice – il resto in «Altro».', 'Översikt, topplistor, historik och vänner nås med tummen – resten finns under ”Mer”.', 'Overblik, toplister, historik og venner kan nås med tommelfingeren – resten ligger under ”Mere”.'],
      },
    ],
  },
  {
    id: '2026-11-15d',
    date: '2026-11-15',
    items: [
      {
        icon: '📅', go: 'records',
        t: ['Jeden Tag neues Angebot', 'New offers every day', 'Nouvelles offres chaque jour', 'Ofertas nuevas cada día', 'Nuove offerte ogni giorno', 'Nya erbjudanden varje dag', 'Nye tilbud hver dag'],
        d: ['Der Plattenladen füllt Plattentisch und CD-Tisch jetzt täglich neu.', 'The record shop now restocks the record and CD tables every day.', 'Le disquaire renouvelle ses tables chaque jour.', 'La tienda renueva sus mesas cada día.', 'Il negozio rinnova i tavoli ogni giorno.', 'Skivbutiken fyller på skiv- och cd-borden varje dag.', 'Pladebutikken fylder plade- og cd-bordene op hver dag.'],
      },
    ],
  },
  {
    id: '2026-11-15c',
    date: '2026-11-15',
    items: [
      {
        icon: '🔊', go: 'records',
        t: ['Reinhören im Laden', 'Listen in the shop', 'Écoute en magasin', 'Escucha en la tienda', 'Ascolta nel negozio', 'Lyssna i butiken', 'Lyt i butikken'],
        d: ['Platte oder CD öffnen – der Song läuft, bis du wegklickst. Bei Alben der Hauptsong.', 'Open a record or CD – the song plays until you close it. Albums play their main song.', 'Ouvre un disque ou un CD – le titre joue jusqu’à la fermeture. Pour un album, le titre phare.', 'Abre un disco o CD: suena hasta que lo cierres. En álbumes, la canción principal.', 'Apri un disco o CD: la canzone suona finché non chiudi. Per gli album il brano principale.', 'Öppna en skiva eller cd – låten spelas tills du stänger. Album spelar huvudlåten.', 'Åbn en plade eller cd – sangen spiller, til du lukker. Albums spiller hovedsangen.'],
      },
    ],
  },
  {
    id: '2026-11-15b',
    date: '2026-11-15',
    items: [
      {
        icon: '🎄', go: 'records',
        t: ['Festlicher Plattenladen', 'Festive record shop', 'Disquaire en fête', 'Tienda de discos festiva', 'Negozio di dischi in festa', 'Festlig skivbutik', 'Festlig pladebutik'],
        d: ['Zu Weihnachten, Silvester, Ostern, Fasching, Mittsommer und deinem Geburtstag ist der Laden geschmückt.', 'At Christmas, New Year, Easter, carnival, midsummer and on your birthday the shop is decorated.', 'À Noël, au Nouvel An, à Pâques, au carnaval, à la Saint-Jean et à ton anniversaire, le magasin est décoré.', 'En Navidad, Año Nuevo, Pascua, Carnaval, San Juan y tu cumpleaños, la tienda está decorada.', 'A Natale, Capodanno, Pasqua, Carnevale, mezza estate e al tuo compleanno il negozio è addobbato.', 'Till jul, nyår, påsk, karneval, midsommar och din födelsedag är butiken pyntad.', 'Til jul, nytår, påske, fastelavn, sankthans og din fødselsdag er butikken pyntet.'],
      },
    ],
  },
  {
    id: '2026-11-14k',
    date: '2026-11-14',
    items: [
      {
        icon: '🎨', go: 'profile',
        t: ['Profilbild-Auswahl', 'Profile picture options', 'Choix de la photo', 'Opciones de foto', 'Scelta dell’immagine', 'Profilbildsval', 'Valg af profilbillede'],
        d: ['Tipp aufs Profilbild: Foto wählen, Selfie aufnehmen oder eine von 12 Vorlagen nehmen.', 'Tap your picture: choose a photo, take a selfie or pick one of 12 presets.', 'Touche ta photo : choisis une photo, prends un selfie ou un des 12 modèles.', 'Toca tu foto: elige una, hazte un selfie o usa una de 12 plantillas.', 'Tocca l’immagine: scegli una foto, scatta un selfie o usa uno dei 12 modelli.', 'Tryck på bilden: välj foto, ta en selfie eller välj en av 12 mallar.', 'Tryk på billedet: vælg foto, tag en selfie eller vælg en af 12 skabeloner.'],
      },
    ],
  },
  {
    id: '2026-11-14j',
    date: '2026-11-14',
    items: [
      {
        icon: '🎁', go: null,
        t: ['Seltenere Geschenke', 'Rarer gifts', 'Cadeaux plus rares', 'Regalos más raros', 'Regali più rari', 'Sällsyntare presenter', 'Sjældnere gaver'],
        d: ['Versteckte Geschenke können jetzt legendär – und ganz selten sogar mythisch – sein.', 'Hidden gifts can now be legendary – and very rarely even mythic.', 'Les cadeaux cachés peuvent être légendaires – et très rarement mythiques.', 'Los regalos ocultos pueden ser legendarios, y muy rara vez míticos.', 'I regali nascosti possono essere leggendari e, rarissimamente, mitici.', 'Gömda presenter kan nu vara legendariska – och mycket sällan mytiska.', 'Skjulte gaver kan nu være legendariske – og meget sjældent mytiske.'],
      },
    ],
  },
  {
    id: '2026-11-14i',
    date: '2026-11-14',
    items: [
      {
        icon: '🖼️', go: 'profile',
        t: ['Eigenes Profilbild', 'Your own profile picture', 'Ta propre photo de profil', 'Tu propia foto de perfil', 'La tua immagine del profilo', 'Egen profilbild', 'Dit eget profilbillede'],
        d: ['Im Profil aufs Bild tippen, Foto wählen, zuschneiden – fertig.', 'Tap your picture in the profile, pick a photo, crop – done.', 'Touche ta photo dans le profil, choisis, recadre – c’est fait.', 'Toca tu foto en el perfil, elige una, recórtala y listo.', 'Tocca l’immagine nel profilo, scegli, ritaglia – fatto.', 'Tryck på bilden i profilen, välj foto, beskär – klart.', 'Tryk på billedet i profilen, vælg foto, beskær – færdig.'],
      },
      {
        icon: '🌊', go: null,
        t: ['Sanftere Übergänge', 'Smoother transitions', 'Transitions plus douces', 'Transiciones más suaves', 'Transizioni più morbide', 'Mjukare övergångar', 'Blødere overgange'],
        d: ['Bereiche gleiten ineinander, Fenster blenden weich ein und aus.', 'Sections glide into each other, windows fade in and out softly.', 'Les sections glissent, les fenêtres apparaissent en douceur.', 'Las secciones se deslizan y las ventanas aparecen suavemente.', 'Le sezioni scorrono, le finestre appaiono e spariscono dolcemente.', 'Vyer glider in i varandra, fönster tonar mjukt in och ut.', 'Visninger glider ind i hinanden, vinduer toner blødt ind og ud.'],
      },
    ],
  },
  {
    id: '2026-11-14h',
    date: '2026-11-14',
    items: [
      {
        icon: '🎙️', go: 'records',
        t: ['Das Studio ist offen', 'The studio is open', 'Le studio est ouvert', 'El estudio está abierto', 'Lo studio è aperto', 'Studion är öppen', 'Studiet er åbent'],
        d: ['Im Laden geradeaus durch die Tür – mit zwei neuen Stationen.', 'Straight ahead through the door in the shop – with two new stations.', 'Tout droit au fond du magasin – avec deux nouvelles stations.', 'Al fondo de la tienda, por la puerta – con dos estaciones nuevas.', 'In fondo al negozio, oltre la porta – con due nuove postazioni.', 'Rakt fram genom dörren i butiken – med två nya stationer.', 'Lige frem gennem døren i butikken – med to nye stationer.'],
      },
      {
        icon: '✨', go: 'records',
        t: ['Platten veredeln', 'Refine records', 'Améliorer les disques', 'Mejorar discos', 'Migliora i dischi', 'Förädla skivor', 'Forædl plader'],
        d: ['Hebe Platten und CDs gegen Noten eine Seltenheit höher – bis mythisch.', 'Raise records and CDs one rarity higher for notes – up to mythic.', 'Monte tes disques et CD d’une rareté contre des notes – jusqu’à mythique.', 'Sube discos y CD una rareza a cambio de notas, hasta mítico.', 'Alza dischi e CD di una rarità con le note, fino a mitico.', 'Höj skivor och cd en sällsynthet mot noter – ända till mytisk.', 'Hæv plader og cd’er én sjældenhed for noder – helt op til mytisk.'],
      },
      {
        icon: '🎧', go: 'records',
        t: ['Intro-Quiz', 'Intro quiz', 'Quiz d’intro', 'Quiz de intros', 'Quiz degli intro', 'Introquiz', 'Introquiz'],
        d: ['Jeden Tag 5 Songs an 1–4 Sekunden erkennen und Noten verdienen.', 'Recognise 5 songs from 1–4 seconds every day and earn notes.', 'Reconnais 5 titres en 1 à 4 secondes chaque jour et gagne des notes.', 'Reconoce 5 canciones en 1–4 segundos cada día y gana notas.', 'Riconosci 5 canzoni in 1–4 secondi ogni giorno e guadagna note.', 'Känn igen 5 låtar på 1–4 sekunder varje dag och tjäna noter.', 'Genkend 5 sange på 1–4 sekunder hver dag og tjen noder.'],
      },
    ],
  },
  {
    id: '2026-11-14g',
    date: '2026-11-14',
    items: [
      {
        icon: '🚪', go: 'records',
        t: ['Begehbarer Plattenladen', 'Walk-in record shop', 'Disquaire à visiter', 'Tienda de discos recorrible', 'Negozio di dischi da esplorare', 'Skivbutik att gå in i', 'Pladebutik du kan gå ind i'],
        d: ['Tür auf, rein: rechts Platten, links CDs – antippen, anheben, kaufen.', 'Open the door: records on the right, CDs on the left – tap, lift, buy.', 'Entre : vinyles à droite, CD à gauche – touche, soulève, achète.', 'Entra: vinilos a la derecha, CD a la izquierda – toca, levanta, compra.', 'Entra: vinili a destra, CD a sinistra – tocca, solleva, compra.', 'In genom dörren: skivor till höger, cd till vänster – tryck, lyft, köp.', 'Ind ad døren: plader til højre, cd’er til venstre – tryk, løft, køb.'],
      },
      {
        icon: '🌈', go: 'records',
        t: ['Neue Seltenheit: Mythisch', 'New rarity: Mythic', 'Nouvelle rareté : Mythique', 'Nueva rareza: Mítico', 'Nuova rarità: Mitico', 'Ny sällsynthet: Mytisk', 'Ny sjældenhed: Mytisk'],
        d: ['Holografisch, signiert und noch seltener als legendär.', 'Holographic, signed and even rarer than legendary.', 'Holographique, dédicacé et plus rare que légendaire.', 'Holográfico, firmado y aún más raro que legendario.', 'Olografico, autografato e più raro del leggendario.', 'Holografisk, signerad och ännu ovanligare än legendarisk.', 'Holografisk, signeret og endnu sjældnere end legendarisk.'],
      },
    ],
  },
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
