// Holiday drop: Thanksgiving + Christmas signs, antlers, hats, sweaters and more (59 items).
// Imported by ram.js after the core catalog; uses the same item() helper.
export const SIGNS = [
  ["turkey", "Stuff Me Sign", "rare", ["STUFF ME", "LIKE A", "TURKEY"], "#c2410c"],
  ["chimney", "Chimney Sign", "epic", ["CUM DOWN", "MY", "CHIMNEY"], "#b91c1c"],
  ["ho", "Santa's Fave Sign", "rare", ["SANTA'S", "FAVORITE", "HO"], "#b91c1c"],
  ["jingle", "Jingle Sign", "rare", ["JINGLE", "MY BELLS"], "#15803d"],
  ["mistletoe", "Mistletoe Sign", "epic", ["MISTLETOE", "IS DOWN", "HERE"], "#15803d"],
  ["unwrap", "Unwrap Me Sign", "common", ["UNWRAP", "ME"], "#b91c1c"],
  ["gobble", "Gobble Sign", "common", ["GOBBLE", "TIL YOU", "WOBBLE"], "#a16207"],
  ["thicc", "Thicc Sign", "rare", ["THICC", "LIKE", "STUFFING"], "#a16207"],
  ["chestnuts", "Chestnuts Sign", "epic", ["ROAST", "MY", "CHESTNUTS"], "#7c2d12"],
  ["sleigh", "Sleigh Sign", "common", ["SLEIGH", "ALL DAY"], "#b91c1c"],
  ["naughty", "Naughty MVP Sign", "rare", ["NAUGHTY", "LIST", "MVP"], "#b91c1c"],
  ["gravy", "Gravy Sign", "rare", ["I LIKE IT", "WITH", "GRAVY"], "#a16207"],
  ["breast", "Breast or Thigh Sign", "rare", ["BREAST", "OR", "THIGH?"], "#c2410c"],
  ["eggnog", "Eggnog Sign", "common", ["SPIKE", "MY", "EGGNOG"], "#15803d"],
  ["package", "Big Package Sign", "epic", ["SANTA", "BROUGHT A", "BIG PACKAGE"], "#b91c1c"],
  ["hohold", "Ho Ho Hold Up Sign", "common", ["HO HO", "HOLD UP"], "#15803d"],
  ["pie", "Eat More Pie Sign", "common", ["EAT", "MORE", "PIE"], "#c2410c"],
  ["halls", "Deck the Halls Sign", "rare", ["DOWN TO", "DECK", "THE HALLS"], "#15803d"],
  ["basted", "Basted Sign", "rare", ["LET'S GET", "BASTED"], "#a16207"],
  ["nice", "Nice? Nah Sign", "common", ["NICE?", "NAH."], "#b91c1c"],
  // server inside jokes
  ["witherspoon", "Forbidden Name Sign", "epic", ["WE DO NOT", "USE THAT", "NAME HERE"], "#2b2b33"],
  ["meat", "VP of Meat Sign", "legendary", ["VP OF", "MEAT"], "#7c2d12"],
  ["spooner", "Pillow Spooner Sign", "rare", ["ANIME PILLOW", "SPOONER"], "#db2777"],
  ["hodor", "Hodor's Mom Sign", "rare", ["HODOR'S", "MOM"], "#334155"],
  ["illegal", "Illegal Stream Sign", "common", ["ILLEGAL", "STREAMING", "CHAMP"], "#2b2b33"],
  ["regulated", "Emotionally Regulated Sign", "rare", ["EMOTIONALLY", "REGULATED"], "#0e7490"],
];
export const SIGN_WORDS = [...new Set(SIGNS.flatMap((s) => s[3]).concat(["NAUGHTY", "GOBBLE"]))];

/** Adds the holiday items. h = helpers from ram.js. */
export function addHoliday(h) {
  const { item, txt, TEXT, OUT, S, S6, mirror, shirt } = h;
  const add = (id, name, rarity, art) => item(id, name, id.split("_")[0], rarity, art);   // slot comes from the id prefix
  // ---- signs, held up on a stick in the right hand ----
  const sign = (lines, color) => {
    const widest = Math.max(...lines.map((l) => TEXT[l]?.w || 4));
    const size = Math.min(22, 128 / widest), lh = size * 1.12, top = -50 - lines.length * lh - 16;
    return `<path d="M 4 12 L 4 -50" stroke="#8a5a3c" stroke-width="7" stroke-linecap="round"/>
      <rect x="-58" y="${top}" width="148" height="${lines.length * lh + 22}" rx="6" fill="#fff8ee" stroke="${OUT}" stroke-width="5"/>
      <rect x="-52" y="${top + 6}" width="136" height="${lines.length * lh + 10}" rx="4" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="7 5"/>
      ${lines.map((l, i) => txt(l, 16, top + 11 + (i + 1) * lh - lh * 0.18, size, color)).join("")}`;
  };
  for (const [k, n, r, lines, c] of SIGNS) item(`hand_sign_${k}`, n, "hand", r, { svg: sign(lines, c) });

  // ---- antlers & holiday horns (replace the horns) ----
  const antler = (c, lights = false) => {
    const one = `<path d="M 212 160 C 196 120, 170 96, 150 60 M 180 108 C 160 104, 140 92, 128 72 M 166 86 C 170 66, 162 46, 172 28 M 196 136 C 214 116, 214 96, 226 80"
      fill="none" stroke="${OUT}" stroke-width="22" stroke-linecap="round"/>
      <path d="M 212 160 C 196 120, 170 96, 150 60 M 180 108 C 160 104, 140 92, 128 72 M 166 86 C 170 66, 162 46, 172 28 M 196 136 C 214 116, 214 96, 226 80"
      fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round"/>
      ${lights ? [[150, 60], [128, 72], [172, 28], [226, 80], [182, 104]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="7" fill="${["#ff3b3b", "#ffd400", "#3bd16f", "#3b8bff", "#ff5ec4"][i]}" stroke="${OUT}" stroke-width="2.5"/>`).join("") : ""}`;
    return one + mirror(one);
  };
  const cane = (() => {
    const d = "M 210 162 C 196 120, 190 80, 160 62 C 136 48, 112 64, 118 88";
    const one = `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="28" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="#e11d2e" stroke-width="18" stroke-dasharray="9 11"/>`;
    return one + mirror(one);
  })();
  add("horns_antlers", "Reindeer Antlers", "rare", { art: antler("#8a5a3c") });
  add("horns_antlers_gold", "Gold Antlers", "legendary", { art: antler("#ffc82c") });
  add("horns_antlers_lit", "Light-Up Antlers", "epic", { art: antler("#8a5a3c", true) });
  add("horns_candycane", "Candy Cane Horns", "epic", { art: cane });

  // ---- hats ----
  const santa = (c = "#e11d2e") => `<path d="M 186 158 C 190 100, 250 70, 300 84 C 340 96, 360 130, 372 170 L 344 164 C 330 128, 312 116, 300 116 L 318 158 Z" fill="${c}" ${S}/>
    <rect x="174" y="146" width="164" height="30" rx="14" fill="#fff" ${S}/><circle cx="364" cy="176" r="18" fill="#fff" ${S}/>`;
  const HATS = [
    ["santa", "Santa Hat", "common", santa()],
    ["santa_gold", "Gold Santa Hat", "epic", santa("#ffc82c")],
    ["elf", "Elf Hat", "rare", `<path d="M 190 158 L 256 40 L 322 158 Z" fill="#16a34a" ${S}/><path d="M 256 40 C 280 30, 300 44, 310 30" fill="none" stroke="#16a34a" stroke-width="10" stroke-linecap="round"/><circle cx="312" cy="28" r="10" fill="#ffd400" ${S6}/><path d="M 184 150 L 328 150 L 316 170 L 300 152 L 284 170 L 268 152 L 252 170 L 236 152 L 220 170 L 204 152 L 192 170 Z" fill="#e11d2e" stroke="${OUT}" stroke-width="4"/>`],
    ["pilgrim", "Pilgrim Hat", "rare", `<ellipse cx="256" cy="152" rx="104" ry="18" fill="#1f1f1f" ${S}/><path d="M 204 152 L 214 70 L 298 70 L 308 152 Z" fill="#2b2b33" ${S}/><rect x="208" y="124" width="96" height="18" fill="#7c5a2a"/><rect x="242" y="120" width="28" height="26" fill="none" stroke="#ffc82c" stroke-width="5"/>`],
    ["turkey", "Turkey Hat", "epic", `<ellipse cx="256" cy="120" rx="76" ry="44" fill="#c8834a" ${S}/><path d="M 196 104 C 180 70, 200 60, 214 84 M 316 104 C 332 70, 312 60, 298 84" fill="none" stroke="${OUT}" stroke-width="14" stroke-linecap="round"/><path d="M 196 104 C 180 70, 200 60, 214 84 M 316 104 C 332 70, 312 60, 298 84" fill="none" stroke="#e6b35a" stroke-width="7" stroke-linecap="round"/><circle cx="196" cy="68" r="10" fill="#fff" ${S6}/><circle cx="316" cy="68" r="10" fill="#fff" ${S6}/><path d="M 220 100 q 36 -24 72 0" stroke="#e6b35a" stroke-width="5" fill="none" opacity=".7"/>`],
    ["mistletoe", "Mistletoe Headband", "epic", `<path d="M 186 170 C 186 110, 326 110, 326 170" fill="none" stroke="${OUT}" stroke-width="10"/><path d="M 256 112 L 256 30" stroke="#6b7280" stroke-width="4"/><ellipse cx="240" cy="30" rx="18" ry="9" fill="#16a34a" ${S6}/><ellipse cx="272" cy="30" rx="18" ry="9" fill="#16a34a" ${S6}/><circle cx="252" cy="38" r="6" fill="#fff" stroke="${OUT}" stroke-width="2"/><circle cx="262" cy="40" r="6" fill="#fff" stroke="${OUT}" stroke-width="2"/><path d="M 246 22 q 10 -10 20 0" stroke="#e11d2e" stroke-width="6" fill="none"/>`],
    ["snowflake", "Snowflake Beanie", "common", `<path d="M 190 156 C 190 86, 322 86, 322 156 Z" fill="#1d4ed8" ${S}/><rect x="182" y="144" width="148" height="30" rx="12" fill="#fff" ${S}/><circle cx="256" cy="82" r="20" fill="#fff" ${S}/><path d="M 256 104 L 256 136 M 242 112 L 270 128 M 270 112 L 242 128" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`],
    ["nye", "New Year's Crown", "rare", `<path d="M 194 160 L 186 100 L 222 128 L 256 84 L 290 128 L 326 100 L 318 160 Z" fill="#111" ${S}/><path d="M 200 150 L 312 150" stroke="#ffc82c" stroke-width="8"/>${[[186, 100], [256, 84], [326, 100]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#ffc82c" ${S6}/>`).join("")}`],
  ];
  for (const [k, n, r, svg] of HATS) item(`head_${k}`, n, "head", r, { svg });

  // ---- noses ----
  add("nose_rudolph", "Rudolph Nose", "rare", { svg: `<circle cx="256" cy="310" r="40" fill="#ff2a2a" opacity=".18"/><circle cx="256" cy="312" r="22" fill="#e11d2e" stroke="${OUT}" stroke-width="5"/><circle cx="248" cy="304" r="6" fill="#fff" opacity=".7"/>` });
  add("nose_rudolph_gold", "Gold Rudolph Nose", "legendary", { svg: `<circle cx="256" cy="310" r="44" fill="#ffd400" opacity=".25"/><circle cx="256" cy="312" r="22" fill="#ffc82c" stroke="${OUT}" stroke-width="5"/><circle cx="248" cy="304" r="6" fill="#fff" opacity=".8"/>` });
  add("nose_carrot", "Snowman Carrot Nose", "common", { svg: `<path d="M 252 302 L 330 318 L 252 324 Z" fill="#f97316" stroke="${OUT}" stroke-width="5" stroke-linejoin="round"/><path d="M 280 310 l 4 8 M 302 314 l 3 6" stroke="#c2410c" stroke-width="3"/>` });

  // ---- shirts (tank / short / long) ----
  const sweaterKnit = [...Array.from({ length: 12 }, (_, i) => `<path d="M ${110 + i * 26} 340 l 13 -13 l 13 13" fill="none" stroke="#fff" stroke-width="5"/>`),
    ...Array.from({ length: 12 }, (_, i) => `<path d="M ${110 + i * 26} 404 l 13 13 l 13 -13" fill="none" stroke="#fff" stroke-width="5"/>`),
    ...Array.from({ length: 9 }, (_, i) => `<path d="M ${130 + i * 34} 372 l 0 -10 M ${125 + i * 34} 367 l 10 0 M ${126 + i * 34} 363 l 8 8 M ${134 + i * 34} 363 l -8 8" stroke="#ffd400" stroke-width="3"/>`)].join("");
  shirt("ugly", "Ugly Christmas Sweater", "rare", { fill: "#b91c1c", collar: "#15803d", sleeve: "#15803d", pattern: `<rect x="100" y="352" width="312" height="40" fill="#15803d"/>${sweaterKnit}` });
  shirt("naughty", "NAUGHTY Tee", "epic", { fill: "#b91c1c", collar: "#fff", deco: (b) => txt("NAUGHTY", b.chest[0], b.chest[1] + 18, 26, "#fff") });
  shirt("gobble", "GOBBLE Tee", "common", { fill: "#a16207", collar: "#7c2d12", deco: (b) => txt("GOBBLE", b.chest[0], b.chest[1] + 18, 28, "#fff3b0") });

  // ---- neck ----
  const bulbs = (n) => Array.from({ length: n }, (_, i) => { const t = i / (n - 1), x = 196 + t * 120, y = 306 + Math.sin(t * Math.PI) * 58;
    return `<ellipse cx="${x}" cy="${y + 7}" rx="5" ry="8" fill="${["#ff3b3b", "#ffd400", "#3bd16f", "#3b8bff"][i % 4]}" stroke="${OUT}" stroke-width="2"/>`; }).join("");
  add("neck_lights", "Christmas Lights", "rare", { svg: `<path d="M 196 304 C 204 380, 308 380, 316 304" fill="none" stroke="#14532d" stroke-width="4"/>${bulbs(9)}` });
  add("neck_tinsel", "Tinsel Boa", "rare", { svg: `<path d="M 192 306 C 214 334, 298 334, 320 306" fill="none" stroke="#ffc82c" stroke-width="22" stroke-linecap="round" stroke-dasharray="2 4"/><path d="M 192 306 C 214 334, 298 334, 320 306" fill="none" stroke="#fff6c2" stroke-width="10" stroke-linecap="round" stroke-dasharray="1 6"/>` });
  add("neck_bells", "Jingle Bell Collar", "common", { svg: `<path d="M 200 306 C 220 326, 292 326, 312 306" stroke="#b91c1c" stroke-width="12" fill="none"/>${[220, 256, 292].map((x) => `<circle cx="${x}" cy="${326}" r="9" fill="#ffc82c" ${S6}/><path d="M ${x - 4} ${328} l 8 0" stroke="${OUT}" stroke-width="2"/>`).join("")}` });
  add("neck_candyscarf", "Candy Cane Scarf", "common", { svg: `<path d="M 194 306 C 220 330, 292 330, 318 306" stroke="#fff" stroke-width="28" fill="none" stroke-linecap="round"/><path d="M 194 306 C 220 330, 292 330, 318 306" stroke="#e11d2e" stroke-width="28" fill="none" stroke-dasharray="10 10"/><rect x="286" y="318" width="26" height="76" fill="#fff" ${S6}/><path d="M 286 330 l 26 -8 M 286 352 l 26 -8 M 286 374 l 26 -8" stroke="#e11d2e" stroke-width="8"/>` });

  // ---- in hand ----
  add("hand_candycane", "Candy Cane", "common", { svg: `<path d="M 0 10 L 0 -60 C 0 -84, 30 -84, 30 -60" fill="none" stroke="${OUT}" stroke-width="16" stroke-linecap="round"/><path d="M 0 10 L 0 -60 C 0 -84, 30 -84, 30 -60" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/><path d="M 0 10 L 0 -60 C 0 -84, 30 -84, 30 -60" fill="none" stroke="#e11d2e" stroke-width="9" stroke-dasharray="6 7"/>` });
  add("hand_eggnog", "Eggnog Mug", "common", { svg: `<rect x="-18" y="-44" width="36" height="42" rx="6" fill="#16a34a" ${S6}/><path d="M 18 -34 q 16 0 16 12 q 0 12 -16 12" fill="none" stroke="${OUT}" stroke-width="6"/><ellipse cx="0" cy="-44" rx="18" ry="6" fill="#fff6c2" stroke="${OUT}" stroke-width="3"/><path d="M -8 -50 q 4 -8 8 0 q 4 -8 8 0" stroke="#fff" stroke-width="3" fill="none"/>` });
  add("hand_present", "Present", "rare", { svg: `<rect x="-26" y="-56" width="52" height="46" fill="#1d4ed8" ${S6}/><rect x="-5" y="-56" width="10" height="46" fill="#ffc82c"/><rect x="-26" y="-38" width="52" height="10" fill="#ffc82c"/><path d="M 0 -56 C -18 -76, -24 -56, 0 -56 C 18 -76, 24 -56, 0 -56" fill="#ffc82c" stroke="${OUT}" stroke-width="3"/>` });
  add("hand_pie", "Pumpkin Pie", "common", { svg: `<path d="M -32 -14 L 32 -14 L 26 0 L -26 0 Z" fill="#c8834a" ${S6}/><ellipse cx="0" cy="-14" rx="32" ry="10" fill="#ea8a2f" stroke="${OUT}" stroke-width="4"/><circle cx="0" cy="-17" r="6" fill="#fff"/>` });
  add("hand_mistletoe", "Mistletoe On A Stick", "epic", { svg: `<path d="M 0 10 L -4 -140" stroke="#6b7280" stroke-width="5"/><ellipse cx="-18" cy="-140" rx="20" ry="10" fill="#16a34a" ${S6}/><ellipse cx="14" cy="-140" rx="20" ry="10" fill="#16a34a" ${S6}/><circle cx="-6" cy="-132" r="7" fill="#fff" stroke="${OUT}" stroke-width="2"/><circle cx="6" cy="-130" r="7" fill="#fff" stroke="${OUT}" stroke-width="2"/>` });

  // ---- backgrounds ----
  const snow = (n) => Array.from({ length: n }, (_, i) => `<circle cx="${(i * 97) % 510}" cy="${(i * 61) % 470}" r="${1.5 + (i % 3)}" fill="#fff" opacity=".85"/>`).join("");
  add("bg_snowynight", "Snowy Night", "rare", { svg: `<rect width="512" height="512" fill="#0f1f4a"/>${snow(80)}<path d="M 0 430 Q 128 400 256 430 T 512 420 L 512 512 L 0 512 Z" fill="#f4f8ff"/>` });
  add("bg_fireplace", "Fireplace & Stockings", "epic", { svg: `<rect width="512" height="512" fill="#5b1f1f"/><rect x="60" y="240" width="392" height="272" fill="#9a4a2a" stroke="${OUT}" stroke-width="6"/><rect x="40" y="226" width="432" height="24" fill="#6b3a20" stroke="${OUT}" stroke-width="6"/><rect x="150" y="320" width="212" height="192" fill="#1a0a05"/>${[0, 1, 2].map((i) => `<path d="M ${200 + i * 56} 512 C ${190 + i * 56} 450, ${222 + i * 56} 430, ${214 + i * 56} 390 C ${240 + i * 56} 430, ${244 + i * 56} 470, ${236 + i * 56} 512 Z" fill="${i % 2 ? "#ff9a00" : "#ff5a1a"}"/>`).join("")}${[90, 170, 330, 410].map((x, i) => `<path d="M ${x} 250 L ${x} 300 L ${x + 22} 300 L ${x + 22} 280 L ${x + 12} 250 Z" fill="${i % 2 ? "#16a34a" : "#e11d2e"}" stroke="${OUT}" stroke-width="3"/><rect x="${x - 2}" y="246" width="26" height="10" fill="#fff"/>`).join("")}` });
  add("bg_xmastree", "Christmas Tree", "rare", { svg: `<rect width="512" height="512" fill="#122b1e"/>${snow(30)}<path d="M 400 60 L 470 200 L 440 200 L 490 320 L 450 320 L 500 440 L 300 440 L 350 320 L 310 320 L 360 200 L 330 200 Z" fill="#15803d" stroke="${OUT}" stroke-width="5"/><path d="M 400 40 l 8 18 l 20 2 l -15 13 l 5 19 l -18 -10 l -18 10 l 5 -19 l -15 -13 l 20 -2 Z" fill="#ffd400"/>${[[380, 180], [420, 260], [360, 300], [440, 380], [380, 400], [460, 300]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="9" fill="${["#ff3b3b", "#ffd400", "#3b8bff"][i % 3]}" stroke="${OUT}" stroke-width="2"/>`).join("")}` });
  add("bg_thanksgiving", "Thanksgiving Table", "rare", { svg: `<rect width="512" height="512" fill="#7c2d12"/><rect y="360" width="512" height="152" fill="#a16207"/><ellipse cx="400" cy="380" rx="90" ry="22" fill="#f4f1ea" stroke="${OUT}" stroke-width="5"/><ellipse cx="400" cy="350" rx="70" ry="44" fill="#c8834a" stroke="${OUT}" stroke-width="5"/><path d="M 340 340 C 320 320, 330 300, 346 314 M 460 340 C 480 320, 470 300, 454 314" stroke="${OUT}" stroke-width="10" stroke-linecap="round" fill="none"/>${Array.from({ length: 7 }, (_, i) => `<ellipse cx="${60 + i * 12}" cy="${150 + (i % 2) * 10}" rx="10" ry="40" fill="${["#c2410c", "#ea580c", "#facc15"][i % 3]}" transform="rotate(${-30 + i * 10} 96 200)"/>`).join("")}` });

  // ---- fleece ----
  add("fleece_candycane", "Candy Cane Fleece", "epic", { fill: "url(#fp_candycane)", defs: `<pattern id="fp_candycane" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="28" height="28" fill="#fff"/><rect width="12" height="28" fill="#e11d2e"/></pattern>` });
  add("fleece_gingerbread", "Gingerbread Fleece", "rare", { fill: "url(#fp_ginger)", defs: `<pattern id="fp_ginger" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#b8763a"/><path d="M 0 20 q 10 -8 20 0 t 20 0" stroke="#fff" stroke-width="3" fill="none"/></pattern>` });

  // ---- feet ----
  add("feet_elf", "Elf Shoes", "rare", { svg: `<path d="M -24 484 C -26 460, 10 458, 30 472 C 44 470, 52 456, 46 448 C 58 456, 52 484, 30 484 Z" fill="#16a34a" ${S}/><circle cx="46" cy="448" r="6" fill="#ffd400" stroke="${OUT}" stroke-width="2"/>` });
  add("feet_santa", "Santa Boots", "common", { svg: `<path d="M -22 484 L -22 434 L 14 434 L 14 462 C 28 466, 36 474, 36 484 Z" fill="#111" ${S}/><rect x="-26" y="428" width="44" height="14" rx="6" fill="#fff" ${S6}/>` });

  // ---- gear ----
  add("gear_santasack", "Santa's Sack", "epic", { behind: `<path d="M 300 300 C 380 280, 420 340, 410 420 C 400 470, 320 470, 300 430 Z" fill="#b91c1c" ${S}/><path d="M 300 300 C 320 290, 340 290, 356 300" stroke="#ffc82c" stroke-width="8" fill="none"/><rect x="350" y="250" width="30" height="40" fill="#1d4ed8" ${S6}/><rect x="378" y="262" width="34" height="30" fill="#16a34a" ${S6}/>` });
}
