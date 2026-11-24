// The Rams pick'em mascot: an original bold-cartoon ram built from SVG layers.
// Every item is one layer drawn in the same 512x512 space, so any combination stacks.
// Slots: bg, effect, outfit, neck, horns, eyes, mouth, head.

const OUT = "#15172b";        // outline
const WOOL = "#f4ecd8", FACE = "#d9b98a", MUZZLE = "#f1dfc0", EAR_IN = "#e7a3a0";
const S = `stroke="${OUT}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"`;

// ---------- base ram (layers that items can replace) ----------

const LEFT_HORN = "M 205 168 C 150 96, 54 118, 54 204 C 54 268, 124 298, 156 258 C 180 228, 156 192, 124 204";
const mirror = (inner) => `<g transform="translate(512,0) scale(-1,1)">${inner}</g>`;

function horns({ color = "#c8a46a", ridge = "#7e5f32", extra = "" } = {}) {
  const one = `<path d="${LEFT_HORN}" fill="none" stroke="${OUT}" stroke-width="58" stroke-linecap="round"/>
    <path d="${LEFT_HORN}" fill="none" stroke="${color}" stroke-width="42" stroke-linecap="round"/>
    <path d="${LEFT_HORN}" fill="none" stroke="${ridge}" stroke-opacity=".45" stroke-width="42" stroke-dasharray="5 15"/>`;
  return `<g>${one}${mirror(one)}${extra}</g>`;
}

const WOOL_BODY = `<path d="M 92 512 C 96 418, 168 370, 256 370 C 344 370, 416 418, 420 512 Z" fill="${WOOL}" ${S}/>
  <path d="M 150 452 q 14 -16 28 0 q 14 -16 28 0 M 306 452 q 14 -16 28 0 q 14 -16 28 0" fill="none" stroke="#d8c9a6" stroke-width="6" stroke-linecap="round"/>`;

const EARS = mirror(`<path d="M 186 292 C 152 300, 116 318, 100 344 C 140 350, 172 334, 192 316 Z" fill="${FACE}" ${S}/>
  <path d="M 176 306 C 154 312, 132 324, 122 336 C 146 338, 166 328, 180 318 Z" fill="${EAR_IN}"/>`)
  + `<path d="M 186 292 C 152 300, 116 318, 100 344 C 140 350, 172 334, 192 316 Z" fill="${FACE}" ${S}/>
  <path d="M 176 306 C 154 312, 132 324, 122 336 C 146 338, 166 328, 180 318 Z" fill="${EAR_IN}"/>`;

const HEAD = `<path d="M 176 204 C 170 160, 210 136, 256 136 C 302 136, 342 160, 336 204 L 330 300 C 326 350, 296 380, 256 380 C 216 380, 186 350, 182 300 Z" fill="${FACE}" ${S}/>
  <path d="M 196 300 C 200 340, 226 362, 256 364" fill="none" stroke="#c49f6c" stroke-width="8" stroke-linecap="round" opacity=".7"/>`;

const EYES = `<ellipse cx="222" cy="252" rx="22" ry="25" fill="#fff" ${S}/><ellipse cx="290" cy="252" rx="22" ry="25" fill="#fff" ${S}/>
  <circle cx="228" cy="257" r="10" fill="${OUT}"/><circle cx="284" cy="257" r="10" fill="${OUT}"/>
  <circle cx="231" cy="253" r="3.5" fill="#fff"/><circle cx="287" cy="253" r="3.5" fill="#fff"/>
  <path d="M 194 218 L 246 232 M 318 218 L 266 232" stroke="${OUT}" stroke-width="13" stroke-linecap="round"/>`;

const MUZZLE_ = `<ellipse cx="256" cy="324" rx="60" ry="46" fill="${MUZZLE}" ${S}/>
  <ellipse cx="238" cy="312" rx="8" ry="6" fill="${OUT}"/><ellipse cx="274" cy="312" rx="8" ry="6" fill="${OUT}"/>
  <path d="M 234 342 Q 258 358 282 336" fill="none" stroke="${OUT}" stroke-width="7" stroke-linecap="round"/>`;

const TUFT_C = [[220, 152, 28], [256, 140, 32], [292, 152, 28], [238, 172, 24], [274, 172, 24], [200, 172, 18], [312, 172, 18]];
const TUFT = TUFT_C.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 5}" fill="${OUT}"/>`).join("")
  + TUFT_C.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${WOOL}"/>`).join("");

const DEFAULT_BG = `<rect width="512" height="512" fill="#1b2440"/><circle cx="256" cy="230" r="210" fill="#243258"/>`;

// ---------- items ----------

export const RARITY = {
  common: { label: "Common", color: 0x9aa3b2, odds: 60, refund: 10 },
  rare: { label: "Rare", color: 0x3b82f6, odds: 28, refund: 20 },
  epic: { label: "Epic", color: 0xa855f7, odds: 10, refund: 40 },
  legendary: { label: "Legendary", color: 0xffa300, odds: 2, refund: 100 },
};

const stars = Array.from({ length: 26 }, (_, i) => {
  const x = (i * 97) % 500 + 6, y = (i * 53) % 300 + 8, r = (i % 3) + 1.5;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${0.4 + (i % 4) * 0.15}"/>`;
}).join("");

const rays = (color, n = 16) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2, b = a + Math.PI / n;
  const p = (t) => `${256 + Math.cos(t) * 520},${230 + Math.sin(t) * 520}`;
  return `<path d="M 256 230 L ${p(a)} L ${p(b)} Z" fill="${color}"/>`;
}).join("");

const jerseyShape = (fill) => `<path d="M 86 512 C 92 420, 160 372, 256 372 C 352 372, 420 420, 426 512 Z" fill="${fill}" ${S}/>`;

export const ITEMS = {
  // backgrounds
  bg_turf: { name: "Turf", slot: "bg", rarity: "common",
    svg: `<rect width="512" height="512" fill="#2f7d3a"/>${[90, 190, 290, 390, 490].map((y) => `<rect y="${y}" width="512" height="8" fill="#fff" opacity=".22"/>`).join("")}` },
  bg_night: { name: "Night Game", slot: "bg", rarity: "common",
    svg: `<rect width="512" height="512" fill="#0b1026"/>${stars}<circle cx="430" cy="80" r="34" fill="#fdf3c7"/><circle cx="444" cy="70" r="30" fill="#0b1026"/>` },
  bg_sunset: { name: "Stadium Sunset", slot: "bg", rarity: "rare",
    svg: `<defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1d6e"/><stop offset=".55" stop-color="#d9467a"/><stop offset="1" stop-color="#ffb347"/></linearGradient></defs><rect width="512" height="512" fill="url(#sun)"/><circle cx="256" cy="420" r="120" fill="#ffd36b" opacity=".55"/>` },
  bg_rays: { name: "Golden Rays", slot: "bg", rarity: "epic",
    svg: `<rect width="512" height="512" fill="#ffb400"/>${rays("#ffd34d")}<circle cx="256" cy="230" r="150" fill="#fff3b0" opacity=".35"/>` },
  bg_storm: { name: "Lightning Storm", slot: "bg", rarity: "legendary",
    svg: `<rect width="512" height="512" fill="#1a0f33"/><circle cx="120" cy="90" r="120" fill="#2b1a55"/><circle cx="400" cy="60" r="140" fill="#2b1a55"/>
      <path d="M 70 20 L 40 150 L 80 150 L 50 270 L 140 120 L 96 120 L 128 20 Z" fill="#ffd400" ${S}/>
      <path d="M 450 40 L 420 160 L 456 160 L 430 260 L 500 140 L 466 140 L 492 40 Z" fill="#ffd400" ${S}/>` },

  // effects (drawn behind the ram)
  fx_aura: { name: "Champion Aura", slot: "effect", rarity: "legendary",
    svg: `<circle cx="256" cy="250" r="200" fill="#ffd400" opacity=".18"/><circle cx="256" cy="250" r="168" fill="none" stroke="#ffd400" stroke-width="10" stroke-dasharray="2 22" stroke-linecap="round" opacity=".9"/>` },

  // horns
  horns_ivory: { name: "Ivory Horns", slot: "horns", rarity: "common", horns: { color: "#f3ead6", ridge: "#b9a77f" } },
  horns_blue: { name: "Royal Blue Horns", slot: "horns", rarity: "rare", horns: { color: "#1f55d6", ridge: "#0b2f86" } },
  horns_gold: { name: "Gold Horns", slot: "horns", rarity: "epic",
    horns: { color: "#ffc82c", ridge: "#c48a00", extra: `<path d="M 96 150 q 10 -16 30 -14" stroke="#fff6c2" stroke-width="8" fill="none" stroke-linecap="round"/>` } },
  horns_fire: { name: "Flaming Horns", slot: "horns", rarity: "legendary",
    horns: { color: "#ff6a1a", ridge: "#c11a0a",
      extra: mirror(`<path d="M 70 150 C 40 120, 60 80, 50 50 C 90 80, 100 60, 96 30 C 130 70, 120 110, 110 140 Z" fill="#ffcf33" ${S}/>`)
        + `<path d="M 70 150 C 40 120, 60 80, 50 50 C 90 80, 100 60, 96 30 C 130 70, 120 110, 110 140 Z" fill="#ffcf33" ${S}/>` } },

  // outfits
  hoodie_gray: { name: "Gray Hoodie", slot: "outfit", rarity: "common",
    svg: `${jerseyShape("#6b7280")}<path d="M 180 384 C 200 420, 312 420, 332 384" fill="#4b5563" ${S}/>
      <path d="M 236 410 L 230 470 M 276 410 L 282 470" stroke="#e5e7eb" stroke-width="6" stroke-linecap="round"/>
      <rect x="196" y="470" width="120" height="42" rx="12" fill="#5b6270" ${S}/>` },
  jersey_blue: { name: "Home Blue Jersey", slot: "outfit", rarity: "common",
    svg: `${jerseyShape("#003594")}<path d="M 210 374 L 256 420 L 302 374" fill="#ffa300" ${S}/>
      <path d="M 104 462 C 112 440, 126 424, 140 414 M 408 462 C 400 440, 386 424, 372 414" stroke="#ffa300" stroke-width="14" fill="none" stroke-linecap="round"/>
      <path d="M 104 462 C 112 440, 126 424, 140 414 M 408 462 C 400 440, 386 424, 372 414" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>` },
  jersey_white: { name: "Throwback White", slot: "outfit", rarity: "rare",
    svg: `${jerseyShape("#f8f8f5")}<path d="M 214 374 Q 256 412 298 374" fill="none" stroke="#003594" stroke-width="12"/>
      <path d="M 100 470 C 110 446, 124 428, 140 418 M 412 470 C 402 446, 388 428, 372 418" stroke="#003594" stroke-width="12" fill="none" stroke-linecap="round"/>
      <path d="M 94 490 C 104 466, 118 448, 134 438 M 418 490 C 408 466, 394 448, 378 438" stroke="#ffa300" stroke-width="10" fill="none" stroke-linecap="round"/>` },
  puffer_gold: { name: "Gold Puffer", slot: "outfit", rarity: "epic",
    svg: `${jerseyShape("#ffb81c")}${[420, 452, 484].map((y) => `<path d="M 100 ${y + 10} Q 256 ${y - 30} 412 ${y + 10}" fill="none" stroke="#c98a00" stroke-width="6"/>`).join("")}
      <path d="M 256 376 L 256 512" stroke="${OUT}" stroke-width="6"/><path d="M 196 378 C 220 396, 292 396, 316 378 L 316 400 C 292 418, 220 418, 196 400 Z" fill="#ffd25e" ${S}/>` },
  pads_legend: { name: "Hall of Fame Pads", slot: "outfit", rarity: "legendary",
    svg: `${jerseyShape("#003594")}<path d="M 80 470 C 70 410, 120 372, 200 380 L 210 440 C 160 438, 120 452, 80 470 Z" fill="#ffc82c" ${S}/>
      <path d="M 432 470 C 442 410, 392 372, 312 380 L 302 440 C 352 438, 392 452, 432 470 Z" fill="#ffc82c" ${S}/>
      <path d="M 120 420 q 30 -18 64 -14 M 392 420 q -30 -18 -64 -14" stroke="#fff6c2" stroke-width="7" fill="none" stroke-linecap="round"/>` },

  // neck
  bandana_blue: { name: "Blue Bandana", slot: "neck", rarity: "common",
    svg: `<path d="M 192 360 C 220 378, 292 378, 320 360 L 256 430 Z" fill="#1f55d6" ${S}/><circle cx="244" cy="384" r="4" fill="#fff"/><circle cx="268" cy="384" r="4" fill="#fff"/><circle cx="256" cy="402" r="4" fill="#fff"/>` },
  chain_gold: { name: "Gold Chain", slot: "neck", rarity: "rare",
    svg: `<path d="M 186 366 C 200 430, 312 430, 326 366" fill="none" stroke="${OUT}" stroke-width="20" stroke-linecap="round"/>
      <path d="M 186 366 C 200 430, 312 430, 326 366" fill="none" stroke="#ffc82c" stroke-width="11" stroke-dasharray="12 6" stroke-linecap="round"/>
      <circle cx="256" cy="424" r="20" fill="#ffc82c" ${S}/><circle cx="256" cy="424" r="8" fill="#fff6c2"/>` },

  // eyes
  shades: { name: "Shades", slot: "eyes", rarity: "common",
    svg: `<path d="M 190 238 L 322 238" stroke="${OUT}" stroke-width="12" stroke-linecap="round"/>
      <rect x="190" y="232" width="62" height="40" rx="14" fill="#111" ${S}/><rect x="262" y="232" width="62" height="40" rx="14" fill="#111" ${S}/>
      <path d="M 202 244 l 16 0 M 274 244 l 16 0" stroke="#5b6b9a" stroke-width="6" stroke-linecap="round"/>` },
  eyeblack: { name: "Eye Black", slot: "eyes", rarity: "common",
    svg: `<rect x="200" y="284" width="44" height="12" rx="4" fill="${OUT}"/><rect x="268" y="284" width="44" height="12" rx="4" fill="${OUT}"/>` },
  laser_eyes: { name: "Laser Eyes", slot: "eyes", rarity: "epic",
    svg: `<path d="M 228 257 L 0 470 L 0 512 L 40 512 Z M 284 257 L 512 470 L 512 512 L 472 512 Z" fill="#ff2a2a" opacity=".85"/>
      <circle cx="228" cy="257" r="16" fill="#ff2a2a"/><circle cx="284" cy="257" r="16" fill="#ff2a2a"/><circle cx="228" cy="257" r="7" fill="#fff"/><circle cx="284" cy="257" r="7" fill="#fff"/>` },

  // mouth
  grill_gold: { name: "Gold Grill", slot: "mouth", rarity: "epic",
    svg: `<path d="M 236 340 Q 258 362 282 338 L 280 350 Q 258 368 238 352 Z" fill="#ffc82c" stroke="${OUT}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M 250 346 l 0 10 M 262 346 l 0 10 M 272 342 l 0 10" stroke="#c48a00" stroke-width="3"/>` },

  // head
  cap_back: { name: "Backwards Cap", slot: "head", rarity: "common",
    svg: `<path d="M 196 150 C 200 104, 312 104, 316 150 Z" fill="#003594" ${S}/><path d="M 300 128 C 330 120, 356 128, 364 140 C 346 146, 324 146, 310 142 Z" fill="#00266e" ${S}/>
      <rect x="236" y="138" width="40" height="14" rx="6" fill="#ffa300" ${S}/>` },
  beanie_gold: { name: "Gold Beanie", slot: "head", rarity: "common",
    svg: `<path d="M 190 156 C 190 86, 322 86, 322 156 Z" fill="#ffb81c" ${S}/><rect x="182" y="144" width="148" height="30" rx="12" fill="#003594" ${S}/>
      <circle cx="256" cy="82" r="20" fill="#fff" ${S}/><path d="M 216 120 l 0 22 M 240 112 l 0 30 M 272 112 l 0 30 M 296 120 l 0 22" stroke="#d99a00" stroke-width="6" stroke-linecap="round"/>` },
  helmet_blue: { name: "Game Helmet", slot: "head", rarity: "rare",
    svg: `<path d="M 168 210 C 160 120, 230 92, 268 96 C 330 102, 360 150, 346 214 L 320 214 L 320 176 C 300 150, 214 150, 194 176 L 194 214 Z" fill="#003594" ${S}/>
      <path d="M 256 98 L 256 150" stroke="#ffa300" stroke-width="16"/><path d="M 256 98 L 256 150" stroke="#fff" stroke-width="5"/>` },
  crown: { name: "Crown", slot: "head", rarity: "legendary",
    svg: `<path d="M 194 160 L 182 92 L 222 124 L 256 78 L 290 124 L 330 92 L 318 160 Z" fill="#ffc82c" ${S}/>
      <rect x="190" y="150" width="132" height="22" rx="6" fill="#e0a800" ${S}/>
      <circle cx="256" cy="130" r="9" fill="#e5484d" ${S}/><circle cx="222" cy="140" r="7" fill="#3b82f6"/><circle cx="290" cy="140" r="7" fill="#3b82f6"/>` },
};

export const SLOTS = ["bg", "effect", "outfit", "neck", "horns", "eyes", "mouth", "head"];

/** Just the head (ears through headwear), for reuse in full-body layouts. */
export function headSVG(equipped = {}) {
  const it = (slot) => ITEMS[equipped[slot]];
  const layer = (slot) => (it(slot) ? it(slot).svg : "");
  return `${EARS}${HEAD}${EYES}${MUZZLE_}${layer("mouth")}${layer("eyes")}${horns(it("horns")?.horns)}${TUFT}${layer("head")}`;
}
export { OUT, WOOL, FACE, S, DEFAULT_BG };

/** SVG for a ram wearing `equipped` ({slot: itemId}). */
export function ramSVG(equipped = {}, size = 512) {
  const it = (slot) => ITEMS[equipped[slot]];
  const layer = (slot, fallback = "") => (it(slot) ? it(slot).svg : fallback);
  const hornStyle = it("horns")?.horns;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
${layer("bg", DEFAULT_BG)}
${layer("effect")}
${layer("outfit", WOOL_BODY)}
${layer("neck")}
${EARS}
${HEAD}
${EYES}
${MUZZLE_}
${layer("mouth")}
${layer("eyes")}
${horns(hornStyle)}
${TUFT}
${layer("head")}
</svg>`;
}
