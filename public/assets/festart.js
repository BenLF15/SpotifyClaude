/* Festliche Grafiken für Spotlfy: eigene, flache SVG-Motive (statt Emojis) und eine Canvas-Partikelanimation
   (Schnee, Feuerwerk, Konfetti, Blüten, Ballons). Keine externen Dateien, keine IDs (mehrfach einbettbar). */
(function () {
  'use strict';
  const star = (cx, cy, R, r, n = 5, rot = -90) => {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = ((rot + (i * 180) / n) * Math.PI) / 180; const rr = i % 2 ? r : R;
      pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  const ring = (n, f) => Array.from({ length: n }, (_, i) => f((360 / n) * i, i)).join('');
  const HL = 'fill="#fff" opacity=".35"'; // Glanzlicht

  const ART = {
    // ---------------------------------------------------------------- Weihnachten
    tree: `<rect x="28" y="50" width="8" height="10" rx="2" fill="#8a5a3b"/>
      <g stroke-linejoin="round" stroke-width="4"><polygon points="32,10 47,28 17,28" fill="#1f9d55" stroke="#1f9d55"/>
      <polygon points="32,20 51,40 13,40" fill="#23ad5f" stroke="#23ad5f"/><polygon points="32,31 55,52 9,52" fill="#27bd67" stroke="#27bd67"/></g>
      <path d="M20 37 Q32 43 45 35 M15 49 Q32 56 50 47" stroke="#ffd23f" stroke-width="2" fill="none" stroke-linecap="round"/>
      <circle cx="24" cy="31" r="3" fill="#ff4d5e"/><circle cx="39" cy="44" r="3" fill="#3fa9ff"/><circle cx="27" cy="47" r="3" fill="#ffd23f"/><circle cx="40" cy="27" r="2.6" fill="#ff7ad9"/>
      <polygon points="${star(32, 9, 8, 3.4)}" fill="#ffd23f" stroke="#ffb000" stroke-width="1" stroke-linejoin="round"/>`,
    star: `<polygon points="${star(32, 34, 27, 11.5)}" fill="#ffd23f" stroke="#f5a700" stroke-width="3" stroke-linejoin="round"/>
      <polygon points="${star(32, 34, 27, 11.5)}" fill="none"/><path d="M32 12 L37 27 L32 30Z" ${HL}/>`,
    gift: `<rect x="9" y="28" width="46" height="30" rx="4" fill="#ff4d5e"/><rect x="6" y="20" width="52" height="12" rx="3" fill="#e63946"/>
      <rect x="28" y="20" width="8" height="38" fill="#ffd23f"/><rect x="9" y="32" width="46" height="3" fill="#000" opacity=".12"/>
      <path d="M32 20 C24 6 12 10 18 18 C21 21 28 20 32 20Z M32 20 C40 6 52 10 46 18 C43 21 36 20 32 20Z" fill="#ffd23f" stroke="#f5a700" stroke-width="2" stroke-linejoin="round"/>
      <rect x="12" y="38" width="5" height="16" rx="2" ${HL}/>`,
    bauble: `<path d="M32 4 a5 5 0 1 1 0.01 0" fill="none" stroke="#c9a227" stroke-width="2.5"/><rect x="26" y="12" width="12" height="7" rx="2" fill="#e8c35a"/>
      <circle cx="32" cy="39" r="21" fill="#e63946"/><path d="M12 36 Q22 30 32 36 T52 36" stroke="#fff" stroke-width="3" fill="none" opacity=".85"/>
      <path d="M12 44 Q22 38 32 44 T52 44" stroke="#ffd23f" stroke-width="3" fill="none"/><ellipse cx="24" cy="29" rx="6" ry="4" transform="rotate(-30 24 29)" ${HL}/>`,
    snowflake: `<g stroke="#dff1ff" stroke-width="4" stroke-linecap="round" fill="none">${ring(6, (a) => `<g transform="rotate(${a} 32 32)"><path d="M32 32V6M32 14l-7-6M32 14l7-6M32 23l-5-4M32 23l5-4"/></g>`)}</g>
      <circle cx="32" cy="32" r="5" fill="#fff"/>`,
    santa: `<path d="M8 46 C12 22 30 8 46 14 C54 17 56 28 54 34 L46 26 C44 34 46 42 50 46Z" fill="#e63946"/>
      <path d="M46 14 C54 17 56 28 54 34" fill="none" stroke="#b81d2c" stroke-width="2"/><rect x="4" y="42" width="50" height="13" rx="6.5" fill="#fff"/>
      <circle cx="54" cy="36" r="7" fill="#fff"/><rect x="4" y="50" width="50" height="5" rx="2.5" fill="#dfe7ee"/>`,
    candy: `<path d="M26 58 V24 a10 10 0 0 1 20 0 v3" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
      <path d="M26 58 V24 a10 10 0 0 1 20 0 v3" fill="none" stroke="#e63946" stroke-width="10" stroke-linecap="round" stroke-dasharray="5 6"/>`,
    // ---------------------------------------------------------------- Neujahr
    firework: `<g stroke-linecap="round" stroke-width="3.2">${ring(12, (a, i) => `<line x1="32" y1="32" x2="32" y2="${i % 2 ? 12 : 5}" stroke="${['#ffd23f', '#ff7ad9', '#3ec5ff', '#7ae582'][i % 4]}" transform="rotate(${a} 32 32)" stroke-dasharray="${i % 2 ? '4 4' : '20 3 2 30'}"/>`)}</g>
      ${ring(12, (a, i) => `<circle cx="32" cy="${i % 2 ? 8 : 2.8}" r="2.2" fill="${['#ffd23f', '#ff7ad9', '#3ec5ff', '#7ae582'][i % 4]}" transform="rotate(${a} 32 32)"/>`)}<circle cx="32" cy="32" r="5" fill="#fff"/>`,
    champagne: `<g transform="rotate(-12 24 34)"><path d="M16 8 h16 l-1.5 20 a6.5 6.5 0 0 1 -13 0Z" fill="#ffe08a" stroke="#e8c35a" stroke-width="1.5"/>
      <path d="M17 16 h14 l-.8 12 a6 6 0 0 1 -12.4 0Z" fill="#f5c542"/><rect x="23" y="34" width="2.4" height="16" fill="#e8c35a"/><ellipse cx="24" cy="52" rx="8" ry="2.6" fill="#e8c35a"/></g>
      <g transform="rotate(12 42 34)"><path d="M34 8 h16 l-1.5 20 a6.5 6.5 0 0 1 -13 0Z" fill="#ffe08a" stroke="#e8c35a" stroke-width="1.5"/>
      <path d="M35 16 h14 l-.8 12 a6 6 0 0 1 -12.4 0Z" fill="#f5c542"/><rect x="41" y="34" width="2.4" height="16" fill="#e8c35a"/><ellipse cx="42" cy="52" rx="8" ry="2.6" fill="#e8c35a"/></g>
      <circle cx="31" cy="6" r="2" fill="#fff"/><circle cx="35" cy="2.6" r="1.4" fill="#fff"/><circle cx="28" cy="2" r="1.1" fill="#fff"/>`,
    sparkle: `<path d="M32 3 C34 23 41 30 61 32 C41 34 34 41 32 61 C30 41 23 34 3 32 C23 30 30 23 32 3Z" fill="#ffd23f"/>
      <path d="M32 3 C34 23 41 30 61 32 L32 32Z" fill="#fff" opacity=".4"/><path d="M52 6 C52.6 11 54 12.4 59 13 C54 13.6 52.6 15 52 20 C51.4 15 50 13.6 45 13 C50 12.4 51.4 11 52 6Z" fill="#fff6c8"/>`,
    clock: `<circle cx="32" cy="34" r="24" fill="#fff8e1" stroke="#e8c35a" stroke-width="5"/>${ring(12, (a) => `<line x1="32" y1="14" x2="32" y2="18" stroke="#9a7a2a" stroke-width="2.4" stroke-linecap="round" transform="rotate(${a} 32 34)"/>`)}
      <path d="M32 34 V17 M32 34 L34 21" stroke="#2b2b2b" stroke-width="3.2" stroke-linecap="round"/><circle cx="32" cy="34" r="3" fill="#e63946"/>
      <rect x="26" y="4" width="12" height="6" rx="2" fill="#e8c35a"/>`,
    tophat: `<ellipse cx="32" cy="52" rx="28" ry="7" fill="#1d1f2b"/><path d="M16 50 V14 a3 3 0 0 1 3 -3 h26 a3 3 0 0 1 3 3 V50Z" fill="#2a2d3d"/>
      <rect x="16" y="38" width="32" height="7" fill="#e8c35a"/><rect x="20" y="14" width="5" height="22" rx="2" fill="#fff" opacity=".12"/>`,
    // ---------------------------------------------------------------- Ostern
    egg: `<path d="M32 5 C46 5 55 29 55 40 C55 52 45 60 32 60 C19 60 9 52 9 40 C9 29 18 5 32 5Z" fill="#9fd8ff"/>
      <polyline points="11,33 17,27 23,33 29,27 35,33 41,27 47,33 53,27" fill="none" stroke="#ff8fc7" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="M10 45 H54" stroke="#ffe066" stroke-width="5"/><circle cx="20" cy="53" r="2.5" fill="#fff"/><circle cx="32" cy="55" r="2.5" fill="#fff"/><circle cx="44" cy="53" r="2.5" fill="#fff"/>
      <circle cx="26" cy="17" r="2.2" fill="#fff"/><circle cx="38" cy="17" r="2.2" fill="#fff"/><ellipse cx="22" cy="20" rx="4" ry="8" transform="rotate(20 22 20)" ${HL}/>`,
    egg2: `<path d="M32 5 C46 5 55 29 55 40 C55 52 45 60 32 60 C19 60 9 52 9 40 C9 29 18 5 32 5Z" fill="#ffb3d1"/>
      <path d="M12 30 Q22 24 32 30 T52 30" stroke="#fff" stroke-width="4" fill="none"/><path d="M10 42 Q21 36 32 42 T54 42" stroke="#b8f0c8" stroke-width="5" fill="none"/>
      <ellipse cx="22" cy="20" rx="4" ry="8" transform="rotate(20 22 20)" ${HL}/>`,
    bunny: `<ellipse cx="22" cy="18" rx="7" ry="16" fill="#f2f2f5" transform="rotate(-10 22 18)"/><ellipse cx="22" cy="19" rx="3.2" ry="11" fill="#ffb3d1" transform="rotate(-10 22 19)"/>
      <ellipse cx="42" cy="18" rx="7" ry="16" fill="#f2f2f5" transform="rotate(10 42 18)"/><ellipse cx="42" cy="19" rx="3.2" ry="11" fill="#ffb3d1" transform="rotate(10 42 19)"/>
      <ellipse cx="32" cy="43" rx="20" ry="17" fill="#fff"/><circle cx="25" cy="40" r="2.8" fill="#2b2b3b"/><circle cx="39" cy="40" r="2.8" fill="#2b2b3b"/>
      <path d="M29 47 l3 3 l3 -3Z" fill="#ff8fc7"/><circle cx="20" cy="48" r="3.4" fill="#ffb3d1" opacity=".7"/><circle cx="44" cy="48" r="3.4" fill="#ffb3d1" opacity=".7"/>`,
    chick: `<circle cx="32" cy="30" r="17" fill="#ffd93b"/><path d="M28 14 q2 -8 6 -2 q3 -5 4 2" fill="#ffc400"/>
      <circle cx="26" cy="27" r="2.6" fill="#2b2b2b"/><circle cx="38" cy="27" r="2.6" fill="#2b2b2b"/><path d="M28 33 L32 30 L36 33 L32 37Z" fill="#ff8a1e"/>
      <path d="M10 40 L16 34 L22 41 L28 34 L34 41 L40 34 L46 41 L52 34 L54 40 C54 52 44 60 32 60 C20 60 10 52 10 40Z" fill="#fff" stroke="#e6e1d6" stroke-width="1.5"/>`,
    tulip: `<path d="M32 62 V34" stroke="#3f9d4f" stroke-width="4" stroke-linecap="round"/><path d="M32 54 C22 50 16 40 18 34 C26 38 31 44 32 54Z" fill="#59c26b"/>
      <path d="M32 50 C42 46 47 38 46 32 C38 36 33 42 32 50Z" fill="#4bb05c"/><path d="M18 12 L25 20 L32 8 L39 20 L46 12 C48 26 44 36 32 36 C20 36 16 26 18 12Z" fill="#ff6b9e"/>
      <path d="M32 8 L39 20 L32 36 C26 36 24 26 32 8Z" fill="#ff8fb5"/>`,
    // ---------------------------------------------------------------- Fasching
    mask: `<path d="M18 22 C14 8 22 4 26 18" fill="#ff4fa3"/><path d="M28 20 C28 4 36 4 36 20" fill="#3bd1c4"/><path d="M38 18 C42 4 50 8 46 22" fill="#ffd23f"/>
      <path d="M4 26 C14 18 26 22 32 27 C38 22 50 18 60 26 C60 42 49 48 40 43 C36 41 35 37 32 37 C29 37 28 41 24 43 C15 48 4 42 4 26Z" fill="#7b5cff" stroke="#ffd23f" stroke-width="2.5" stroke-linejoin="round"/>
      <ellipse cx="20" cy="32" rx="7" ry="4.5" fill="#1d1640"/><ellipse cx="44" cy="32" rx="7" ry="4.5" fill="#1d1640"/>
      <circle cx="32" cy="27" r="2.6" fill="#ffd23f"/><path d="M8 28 C14 24 22 24 26 26" stroke="#fff" stroke-width="2" fill="none" opacity=".4"/>`,
    horn: `<path d="M6 50 L40 22 L48 34Z" fill="#ffd23f"/><path d="M14 43.5 L19 49 M22 37 L28 43 M30 30 L36 37" stroke="#ff4fa3" stroke-width="4"/>
      <ellipse cx="44" cy="28" rx="4" ry="7.5" transform="rotate(-50 44 28)" fill="#ff8a3b"/>
      <path d="M47 23 C52 16 60 22 54 26 C48 30 58 36 60 30" stroke="#3bd1c4" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="56" cy="12" r="2.5" fill="#7b5cff"/><rect x="48" y="6" width="4" height="4" fill="#ff4fa3" transform="rotate(20 50 8)"/><circle cx="60" cy="40" r="2" fill="#ffd23f"/>`,
    popper: `<path d="M10 58 L22 30 L36 44Z" fill="#7b5cff"/><path d="M14 49 L27 55 M18 40 L32 47" stroke="#ffd23f" stroke-width="3.5"/>
      <path d="M30 34 C34 20 44 26 40 16 M34 40 C46 34 52 42 58 30" stroke="#ff4fa3" stroke-width="3" fill="none" stroke-linecap="round"/>
      <rect x="40" y="6" width="5" height="5" fill="#3bd1c4" transform="rotate(30 42 8)"/><circle cx="52" cy="16" r="3" fill="#ffd23f"/><rect x="54" y="44" width="5" height="5" fill="#ff8a3b" transform="rotate(-20 56 46)"/>
      <circle cx="30" cy="12" r="2.5" fill="#3fa9ff"/><polygon points="${star(48, 30, 4, 1.8)}" fill="#fff"/>`,
    // ---------------------------------------------------------------- Midsommar
    daisy: `${ring(12, (a) => `<ellipse cx="32" cy="15" rx="5.2" ry="12" fill="#fff" stroke="#ece8de" stroke-width="1" transform="rotate(${a} 32 32)"/>`)}
      <circle cx="32" cy="32" r="9" fill="#ffc83b"/><circle cx="29" cy="29" r="3" fill="#ffe08a"/>`,
    strawberry: `<path d="M32 60 C16 52 8 36 12 26 C16 18 26 20 32 22 C38 20 48 18 52 26 C56 36 48 52 32 60Z" fill="#ef3b4d"/>
      <path d="M22 18 L32 22 L42 18 L38 14 L32 16 L26 12Z M32 22 L32 8" fill="#3f9d4f" stroke="#3f9d4f" stroke-width="3" stroke-linejoin="round"/>
      ${[[22, 32], [32, 30], [42, 32], [18, 40], [28, 40], [38, 40], [46, 40], [24, 48], [34, 48], [30, 55]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.3" ry="2" fill="#ffe08a"/>`).join('')}
      <ellipse cx="20" cy="30" rx="3" ry="6" transform="rotate(30 20 30)" ${HL}/>`,
    leaf: `<path d="M8 56 C8 24 28 8 58 6 C56 36 40 56 8 56Z" fill="#59c26b"/><path d="M8 56 C24 40 36 26 52 12" stroke="#2f8a40" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M22 42 L20 30 M30 34 L30 22 M38 26 L40 16 M22 42 L34 42 M30 34 L42 34" stroke="#2f8a40" stroke-width="1.6" stroke-linecap="round"/>`,
    sun: `${ring(12, (a, i) => `<path d="M32 2 L35.5 12 L28.5 12Z" fill="${i % 2 ? '#ffb000' : '#ffd23f'}" transform="rotate(${a} 32 32)" stroke-linejoin="round"/>`)}
      <circle cx="32" cy="32" r="16" fill="#ffd23f"/><circle cx="32" cy="32" r="16" fill="none" stroke="#ffb000" stroke-width="2"/><path d="M22 28 a11 11 0 0 1 10 -10" stroke="#fff" stroke-width="3" fill="none" opacity=".5" stroke-linecap="round"/>`,
    flowercrown: `<path d="M4 44 Q32 58 60 44" stroke="#3f9d4f" stroke-width="4" fill="none" stroke-linecap="round"/>
      ${[[10, 44, '#fff'], [20, 49, '#ff8fc7'], [32, 51, '#ffe066'], [44, 49, '#c9a8ff'], [54, 44, '#fff']].map(([x, y, c]) => `<g>${ring(5, (a) => `<circle cx="${x}" cy="${y - 5}" r="4" fill="${c}" transform="rotate(${a} ${x} ${y})"/>`)}<circle cx="${x}" cy="${y}" r="3" fill="#ffc83b"/></g>`).join('')}
      <path d="M15 46 l-3 -6 M27 50 l0 -7 M39 50 l3 -7 M50 47 l4 -6" stroke="#59c26b" stroke-width="3" stroke-linecap="round"/>`,
    // ---------------------------------------------------------------- Geburtstag
    balloon: `<path d="M32 46 C30 52 36 54 32 62" stroke="#9aa3ad" stroke-width="1.6" fill="none"/><path d="M28 48 L36 48 L32 43Z" fill="#e0306b"/>
      <ellipse cx="32" cy="24" rx="17" ry="21" fill="#ff4f8b"/><ellipse cx="25" cy="15" rx="4.5" ry="7.5" transform="rotate(25 25 15)" ${HL}/>`,
    balloons: `<path d="M20 40 C22 50 28 52 30 62 M44 38 C42 50 36 52 32 62" stroke="#9aa3ad" stroke-width="1.5" fill="none"/>
      <ellipse cx="20" cy="22" rx="13" ry="16" fill="#3ec5ff"/><path d="M17 38 L23 38 L20 35Z" fill="#2a9fd6"/><ellipse cx="15" cy="15" rx="3" ry="5.5" transform="rotate(25 15 15)" ${HL}/>
      <ellipse cx="44" cy="20" rx="13" ry="16" fill="#ff4f8b"/><path d="M41 36 L47 36 L44 33Z" fill="#e0306b"/><ellipse cx="39" cy="13" rx="3" ry="5.5" transform="rotate(25 39 13)" ${HL}/>`,
    cake: `<rect x="8" y="38" width="48" height="20" rx="4" fill="#ff9ac9"/><rect x="14" y="24" width="36" height="16" rx="4" fill="#fff4e0"/>
      <path d="M14 30 q4 6 8 0 q4 6 8 0 q4 6 8 0 q4 6 8 0 q4 6 4 0 V26 a4 4 0 0 0 -4 -2 H18 a4 4 0 0 0 -4 2Z" fill="#ff6b9e"/>
      <path d="M8 44 q5 6 10 0 q5 6 10 0 q5 6 10 0 q5 6 10 0 q4 6 8 0 V42 a4 4 0 0 0 -4 -4 H12 a4 4 0 0 0 -4 4Z" fill="#fff"/>
      ${[22, 32, 42].map((x, i) => `<rect x="${x - 2}" y="12" width="4" height="12" rx="1.5" fill="${['#3ec5ff', '#ffd23f', '#7ae582'][i]}"/><path d="M${x} 4 C${x + 4} 8 ${x + 3} 12 ${x} 12 C${x - 3} 12 ${x - 4} 8 ${x} 4Z" fill="#ffb000"/><circle cx="${x}" cy="9.5" r="1.4" fill="#fff6c8"/>`).join('')}
      <circle cx="16" cy="52" r="2" fill="#fff"/><circle cx="32" cy="53" r="2" fill="#ffd23f"/><circle cx="48" cy="52" r="2" fill="#3ec5ff"/>`,
    partyhat: `<path d="M32 4 L52 56 H12Z" fill="#7b5cff"/><path d="M26 20 L38 20 M21 32 L43 32 M17 44 L47 44" stroke="#ffd23f" stroke-width="4"/>
      <path d="M32 4 L52 56 H44Z" fill="#000" opacity=".12"/><rect x="8" y="52" width="48" height="8" rx="4" fill="#ff4f8b"/><circle cx="32" cy="5" r="5.5" fill="#3ec5ff"/>`,
    // ---------------------------------------------------------------- Allgemein
    wreath: `<circle cx="32" cy="32" r="21" fill="none" stroke="#1f8a4c" stroke-width="12"/>
      ${ring(14, (a, i) => `<ellipse cx="32" cy="11" rx="4" ry="7.5" fill="${i % 2 ? '#2fae63' : '#23964f'}" transform="rotate(${a} 32 32) rotate(${i % 2 ? 35 : -35} 32 11)"/>`)}
      ${ring(7, (a) => `<circle cx="32" cy="12.5" r="2.6" fill="#ff4d5e" transform="rotate(${a + 20} 32 32)"/>`)}
      <path d="M32 50 L22 61 L27 61 L32 55 L37 61 L42 61Z" fill="#e63946"/><path d="M32 50 C22 42 18 52 24 54 C27 55 30 52 32 50Z M32 50 C42 42 46 52 40 54 C37 55 34 52 32 50Z" fill="#e63946" stroke="#b81d2c" stroke-width="1.5"/><circle cx="32" cy="50" r="3" fill="#b81d2c"/>`,
    plant: `<path d="M32 44 C30 30 22 22 10 20 C12 32 20 40 32 44Z" fill="#2f9b57"/><path d="M32 44 C34 28 44 16 58 14 C56 30 46 40 32 44Z" fill="#3cb46a"/>
      <path d="M32 44 C31 26 30 14 34 4 C40 14 38 32 32 44Z" fill="#28874b"/><path d="M32 44 C24 34 18 34 8 36 C14 42 22 46 32 44Z" fill="#46c477"/>
      <path d="M32 44 L20 24 M32 44 L50 20 M32 44 L33 10" stroke="#1d6b3a" stroke-width="1.2" fill="none"/>
      <path d="M18 44 H46 L42 62 H22Z" fill="#e6dccb"/><path d="M16 42 H48 V47 H16Z" fill="#f4ede1"/><path d="M40 47 H45 L41.5 62 H38Z" fill="#000" opacity=".08"/>`,
    note: `<path d="M24 46 V12 L52 6 V40" stroke="#1db954" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M24 14 L52 8 V16 L24 22Z" fill="#1db954"/>
      <ellipse cx="17" cy="47" rx="9" ry="7" fill="#1db954" transform="rotate(-20 17 47)"/><ellipse cx="45" cy="41" rx="9" ry="7" fill="#1db954" transform="rotate(-20 45 41)"/>`,
  };

  function svg(name, cls = '') {
    const a = ART[name];
    if (!a) return '';
    return `<svg class="fa fa-${name}${cls ? ` ${cls}` : ''}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${a}</svg>`;
  }

  // ==================================================================== Canvas-Partikel
  const PAL = {
    christmas: ['#ffffff', '#dff1ff', '#bfe3ff'],
    newyear: ['#ffd23f', '#ff7ad9', '#3ec5ff', '#7ae582', '#ffffff', '#ff8c42'],
    carnival: ['#ff4fa3', '#ffd23f', '#3bd1c4', '#7b5cff', '#3fa9ff', '#ff8a3b'],
    birthday: ['#ff4f8b', '#ffd23f', '#3ec5ff', '#9b7bff', '#7be08a', '#ff9f43'],
    easter: ['#ffb3d1', '#fff3a6', '#b8f0c8', '#c9dcff', '#e6ccff', '#ffffff'],
    midsummer: ['#ffffff', '#ffe066', '#ff9ac9', '#8fdc6f', '#c9a8ff'],
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (l) => l[(Math.random() * l.length) | 0];
  let running = null;

  function play(kind, { duration = 4600, intensity = 1 } = {}) {
    if (running) running.stop();
    const cv = document.createElement('canvas');
    cv.className = 'fx-canvas';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0; let H = 0;
    const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const small = W < 600;
    const pal = PAL[kind] || PAL.carnival;
    const P = []; const rockets = []; const timers = [];
    const k = (small ? 0.6 : 1) * intensity;
    const light = getComputedStyle(document.documentElement).colorScheme === 'light';

    // ---- Teilchen-Fabriken
    const confetti = (x, y, vx, vy) => P.push({ t: 'conf', x, y, vx, vy, w: rnd(6, 11), h: rnd(9, 16), c: pick(pal), rot: rnd(0, 6.3), vr: rnd(-0.25, 0.25), ph: rnd(0, 6.3), vph: rnd(0.12, 0.3), shape: Math.random() < 0.25 ? 'circle' : Math.random() < 0.2 ? 'ribbon' : 'rect', life: 1, g: 0.32, drag: 0.985 });
    const cannon = (fromLeft) => {
      const x = fromLeft ? -10 : W + 10; const y = H * 0.82;
      for (let i = 0; i < 52 * k; i++) {
        const a = (fromLeft ? rnd(-78, -38) : rnd(-142, -102)) * (Math.PI / 180); const s = rnd(11, 22) * (small ? 0.85 : 1);
        confetti(x, y, Math.cos(a) * s, Math.sin(a) * s);
      }
    };
    const explode = (x, y, hue) => {
      const n = (small ? 44 : 76); const c1 = hue; const c2 = pick(pal);
      const ringShot = Math.random() < 0.35;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05); const s = ringShot ? rnd(5.4, 6) : rnd(1.5, 6.5);
        P.push({ t: 'spark', x, y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, c: i % 4 === 0 ? c2 : c1, life: 1, decay: rnd(0.011, 0.018), g: 0.06, drag: 0.975, tw: Math.random() < 0.3 });
      }
      P.push({ t: 'flash', x, y, c: c1, life: 1, decay: 0.08 });
    };
    const rocket = () => {
      const x = rnd(W * 0.15, W * 0.85);
      rockets.push({ x, y: H + 10, vx: rnd(-1, 1), vy: -rnd(H * 0.0165, H * 0.021) - 6, ty: rnd(H * 0.12, H * 0.42), c: pick(pal) });
    };
    const flake = (y0) => P.push({ t: 'snow', x: rnd(-20, W + 20), y: y0 ?? rnd(-H * 0.6, -10), z: rnd(0.35, 1), sw: rnd(0, 6.3), vsw: rnd(0.01, 0.03), rot: rnd(0, 6.3), vr: rnd(-0.02, 0.02), crystal: Math.random() < 0.28, life: 1 });
    const petal = () => P.push({ t: 'petal', x: rnd(-W * 0.3, W * 0.9), y: rnd(-H * 0.5, -10), vx: rnd(0.6, 1.8), vy: rnd(1.1, 2.2), rot: rnd(0, 6.3), vr: rnd(-0.04, 0.04), ph: rnd(0, 6.3), s: rnd(7, 13), c: pick(pal), leaf: kind === 'midsummer' && Math.random() < 0.25, life: 1 });
    const balloon = () => P.push({ t: 'balloon', x: rnd(W * 0.05, W * 0.95), y: H + rnd(30, H * 0.5), vy: -rnd(2.2, 3.6), sw: rnd(0, 6.3), r: rnd(18, 28) * (small ? 0.8 : 1), c: pick(pal), life: 1 });

    // ---- Ablauf je Fest
    const at = (ms, f) => timers.push(setTimeout(f, ms));
    if (kind === 'newyear') { for (let i = 0; i < (small ? 6 : 9); i++) at(i * 420 + rnd(0, 200), rocket); }
    else if (kind === 'christmas') { for (let i = 0; i < 90 * k; i++) flake(); }
    else if (kind === 'easter' || kind === 'midsummer') { for (let i = 0; i < 54 * k; i++) petal(); }
    else if (kind === 'birthday') {
      for (let i = 0; i < 14 * k; i++) balloon();
      // Konfetti-Regen von oben (statt seitlicher Kanonen)
      const shower = (m) => { for (let i = 0; i < m; i++) { confetti(rnd(0, W), rnd(-80, -10), rnd(-1.5, 1.5), rnd(0.5, 2.5)); P[P.length - 1].g = 0.09; } };
      at(150, () => shower(Math.round(60 * k))); at(900, () => shower(Math.round(40 * k)));
    }
    else { at(0, () => cannon(true)); at(180, () => cannon(false)); at(1100, () => { cannon(true); cannon(false); }); }

    const start = performance.now(); let raf = 0; let last = start;
    const drawSnow = (p) => {
      const r = 2 + p.z * 4.5;
      ctx.globalAlpha = 0.5 + p.z * 0.5;
      if (p.crystal) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.strokeStyle = light ? '#8fbfe8' : '#fff'; ctx.lineWidth = 1.3 + p.z; ctx.lineCap = 'round';
        const L = r * 2.2;
        for (let i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L); ctx.moveTo(0, -L * 0.55); ctx.lineTo(-L * 0.3, -L * 0.8); ctx.moveTo(0, -L * 0.55); ctx.lineTo(L * 0.3, -L * 0.8); ctx.stroke(); }
        ctx.restore();
      } else {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, light ? 'rgba(150,195,240,1)' : 'rgba(255,255,255,1)'); g.addColorStop(1, light ? 'rgba(150,195,240,0)' : 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
      }
    };
    const drawBalloon = (p) => {
      const x = p.x + Math.sin(p.sw) * 10; const { r } = p;
      ctx.strokeStyle = 'rgba(150,160,170,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, p.y + r * 1.2);
      ctx.bezierCurveTo(x - 8, p.y + r * 1.8, x + 8, p.y + r * 2.4, x, p.y + r * 3.2); ctx.stroke();
      ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(x, p.y, r * 0.86, r * 1.05, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 4, p.y + r * 1.16); ctx.lineTo(x + 4, p.y + r * 1.16); ctx.lineTo(x, p.y + r * 0.98); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.ellipse(x - r * 0.32, p.y - r * 0.42, r * 0.16, r * 0.3, 0.5, 0, 7); ctx.fill();
    };
    const frame = (now) => {
      const el = now - start; const dt = Math.min(2.2, (now - last) / 16.7); last = now;
      const fadeOut = el > duration - 900 ? Math.max(0, (duration - el) / 900) : 1;
      ctx.clearRect(0, 0, W, H);
      // Raketen
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 0.16 * dt;
        P.push({ t: 'spark', x: r.x + rnd(-1, 1), y: r.y + 6, px: r.x, py: r.y, vx: rnd(-0.4, 0.4), vy: rnd(0.5, 1.5), c: '#ffd9a0', life: 0.7, decay: 0.05, g: 0.02, drag: 0.95 });
        if (r.y <= r.ty || r.vy >= 0) { explode(r.x, r.y, r.c); rockets.splice(i, 1); }
      }
      if (kind === 'newyear' && !light) { ctx.globalCompositeOperation = 'lighter'; }
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        if (p.t === 'conf') {
          p.vx *= p.drag ** dt; p.vy = p.vy * p.drag ** dt + p.g * dt; if (p.vy > 4.2) p.vy = 4.2;
          p.x += (p.vx + Math.sin(p.ph) * 0.8) * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.ph += p.vph * dt;
          const sy = Math.cos(p.ph);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, sy); ctx.globalAlpha = fadeOut;
          ctx.fillStyle = p.c;
          if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.w * 0.5, 0, 7); ctx.fill(); }
          else if (p.shape === 'ribbon') { ctx.strokeStyle = p.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.bezierCurveTo(-3, -7, 3, 7, 8, 0); ctx.stroke(); }
          else { ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(-p.w / 2, -p.h / 2, p.w / 3, p.h); }
          ctx.restore();
          if (p.y > H + 30) P.splice(i, 1);
        } else if (p.t === 'spark') {
          p.px = p.x; p.py = p.y; p.vx *= p.drag ** dt; p.vy = p.vy * p.drag ** dt + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt;
          if (p.life <= 0) { P.splice(i, 1); continue; }
          const a = p.life * (p.tw ? (Math.random() < 0.5 ? 1 : 0.3) : 1);
          ctx.globalAlpha = a; ctx.strokeStyle = p.c; ctx.lineWidth = small ? 2.4 : 3; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.px - p.vx * 2, p.py - p.vy * 2); ctx.lineTo(p.x, p.y); ctx.stroke();
        } else if (p.t === 'flash') {
          p.life -= p.decay * dt; if (p.life <= 0) { P.splice(i, 1); continue; }
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 90); g.addColorStop(0, `rgba(255,255,255,${0.55 * p.life})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 90, 0, 7); ctx.fill();
        } else if (p.t === 'snow') {
          p.sw += p.vsw * dt; p.rot += p.vr * dt; p.y += (0.6 + p.z * 1.7) * dt; p.x += Math.sin(p.sw) * 0.6 * p.z * dt;
          ctx.save(); const a0 = fadeOut; ctx.globalAlpha = a0; drawSnow(p); ctx.restore();
          if (p.y > H + 20) { if (el < duration - 1600) { p.y = -10; p.x = rnd(0, W); } else P.splice(i, 1); }
        } else if (p.t === 'petal') {
          p.ph += 0.05 * dt; p.rot += p.vr * dt; p.x += (p.vx + Math.sin(p.ph) * 1.2) * dt; p.y += p.vy * dt;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, 0.55 + Math.abs(Math.cos(p.ph)) * 0.45); ctx.globalAlpha = 0.92 * fadeOut;
          if (p.leaf) { ctx.fillStyle = '#59c26b'; ctx.beginPath(); ctx.ellipse(0, 0, p.s * 1.1, p.s * 0.45, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#2f8a40'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-p.s, 0); ctx.lineTo(p.s, 0); ctx.stroke(); }
          else { ctx.fillStyle = p.c; ctx.beginPath(); ctx.moveTo(0, -p.s); ctx.bezierCurveTo(p.s * 0.9, -p.s * 0.6, p.s * 0.7, p.s * 0.6, 0, p.s); ctx.bezierCurveTo(-p.s * 0.7, p.s * 0.6, -p.s * 0.9, -p.s * 0.6, 0, -p.s); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-p.s * 0.2, -p.s * 0.3, p.s * 0.18, p.s * 0.4, 0.3, 0, 7); ctx.fill(); }
          ctx.restore();
          if (p.y > H + 20) P.splice(i, 1);
        } else if (p.t === 'balloon') {
          p.sw += 0.03 * dt; p.y += p.vy * dt;
          ctx.save(); ctx.globalAlpha = fadeOut; drawBalloon(p); ctx.restore();
          if (p.y < -p.r * 4) P.splice(i, 1);
        }
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      if (el < duration && (P.length || rockets.length || el < 1200)) raf = requestAnimationFrame(frame);
      else stop();
    };
    function stop() { cancelAnimationFrame(raf); timers.forEach(clearTimeout); removeEventListener('resize', size); cv.remove(); if (running === handle) running = null; }
    const handle = { stop };
    running = handle;
    addEventListener('resize', size);
    raf = requestAnimationFrame(frame);
    return handle;
  }

  window.FestArt = { svg, play, names: Object.keys(ART) };
})();
