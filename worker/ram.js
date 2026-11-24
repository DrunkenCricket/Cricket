// Rams pick'em mascot: an original full-body cartoon ram built from SVG layers (512x512).
// A ram "look" is { body, base, face, finish, <slot>: itemId, ... }. renderRam(look) -> SVG string.
// Items live in ITEMS (generated below), ~30 per section, each with a rarity.

import { TEXT } from "./textpaths.js";

const OUT = "#15172b";
const S = `stroke="${OUT}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"`;
const S6 = `stroke="${OUT}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"`;
const mirror = (inner) => `<g transform="translate(512,0) scale(-1,1)">${inner}</g>`;
const BLUE = "#003594", GOLD = "#ffa300", ROYAL = "#1f55d6";

/** Slogan text as outlines (no fonts needed). */
function txt(word, x, y, size, fill, stroke = "") {
  const t = TEXT[word];
  if (!t) return "";
  return `<path transform="translate(${(x - (t.w * size) / 2).toFixed(1)},${y}) scale(${size})" d="${t.d}" fill="${fill}"${stroke}/>`;
}

// ---------- rarity ----------
export const RARITY = {
  common: { label: "Common", color: 0x9aa3b2, weight: 600, refund: 10 },
  rare: { label: "Rare", color: 0x3b82f6, weight: 280, refund: 20 },
  epic: { label: "Epic", color: 0xa855f7, weight: 95, refund: 40 },
  legendary: { label: "Legendary", color: 0xffa300, weight: 22, refund: 100 },
  mythic: { label: "Mythic", color: 0xff4fd8, weight: 3, refund: 250 },
};

export const ITEMS = {};
const item = (id, name, slot, rarity, art = {}) => { ITEMS[id] = { id, name, slot, rarity, ...art }; };

// ---------- free base choices (not in crates) ----------
export const BODIES = {
  standard: {
    torso: "M 160 410 C 150 330, 190 300, 256 300 C 322 300, 362 330, 352 410 C 340 440, 172 440, 160 410 Z",
    armL: "M 168 334 C 138 348, 130 380, 136 404", armR: "M 344 334 C 374 348, 382 380, 376 404",
    upperL: "M 168 334 C 152 342, 142 354, 139 368", upperR: "M 344 334 C 360 342, 370 354, 373 368",
    handL: [136, 410], handR: [376, 410], arm: 20, legs: [214, 298], hip: 418,
    shoulders: [[176, 322], [336, 322]], bicepL: [148, 360], bicepR: [364, 360], chest: [256, 360], belt: 412,
  },
  belly: {
    torso: "M 150 400 C 132 330, 186 298, 256 298 C 326 298, 380 330, 362 400 C 360 452, 152 452, 150 400 Z",
    armL: "M 160 332 C 122 344, 112 376, 118 402", armR: "M 352 332 C 390 344, 400 376, 394 402",
    upperL: "M 160 332 C 140 338, 126 350, 122 364", upperR: "M 352 332 C 372 338, 386 350, 390 364",
    handL: [118, 408], handR: [394, 408], arm: 24, legs: [208, 304], hip: 430,
    shoulders: [[172, 320], [340, 320]], bicepL: [130, 358], bicepR: [382, 358], chest: [256, 350], belt: 426,
    skin: `<ellipse cx="256" cy="392" rx="74" ry="50" fill="#fff" opacity=".18"/><path d="M 252 400 q 4 6 8 0" stroke="${OUT}" stroke-width="5" fill="none"/>`,
  },
  buff: {
    torso: "M 176 418 C 170 370, 150 312, 186 300 C 220 290, 292 290, 326 300 C 362 312, 342 370, 336 418 C 316 432, 196 432, 176 418 Z",
    armL: "M 168 320 C 122 330, 108 368, 120 404", armR: "M 344 320 C 390 330, 404 368, 392 404",
    upperL: "M 168 320 C 144 324, 124 336, 116 356", upperR: "M 344 320 C 368 324, 388 336, 396 356",
    handL: [120, 410], handR: [392, 410], arm: 32, legs: [218, 294], hip: 420,
    shoulders: [[168, 312], [344, 312]], bicepL: [128, 348], bicepR: [384, 348], chest: [256, 340], belt: 414,
    skin: `<path d="M 200 336 q 28 18 52 0 M 260 336 q 28 18 52 0" stroke="${OUT}" stroke-width="6" fill="none"/>
      ${[364, 384, 404].map((y) => `<path d="M 232 ${y} l 18 0 M 262 ${y} l 18 0" stroke="${OUT}" stroke-width="5" stroke-linecap="round"/>`).join("")}
      <path d="M 256 350 l 0 66" stroke="${OUT}" stroke-width="4" opacity=".6"/>`,
  },
};
BODIES.thin = {
  torso: "M 182 410 C 176 336, 206 304, 256 304 C 306 304, 336 336, 330 410 C 320 432, 192 432, 182 410 Z",
  armL: "M 188 336 C 166 350, 160 380, 164 404", armR: "M 324 336 C 346 350, 352 380, 348 404",
  upperL: "M 188 336 C 176 342, 168 354, 166 366", upperR: "M 324 336 C 336 342, 344 354, 346 366",
  handL: [164, 410], handR: [348, 410], arm: 16, legs: [228, 284], hip: 418,
  shoulders: [[196, 324], [316, 324]], bicepL: [170, 360], bicepR: [342, 360], chest: [256, 354], belt: 414,
};
BODIES.med = BODIES.standard;
BODIES.large = BODIES.belly;
// Free body types everyone can pick. "buff" (abs) stays a crate unlock.
export const BODY_TYPES = { thin: "Thin", med: "Medium", large: "Large" };
item("body_buff", "Buff Body", "body", "epic");

/** Tank-top shape: thin straps, scoop neck, open armholes. Clipped to the torso when drawn. */
function tankPath(b) {
  const cx = 256, top = b.shoulders[0][1] - 26;
  const w = (b.shoulders[1][0] - b.shoulders[0][0]) / 160;
  const oL = cx - 50 * w, iL = cx - 30 * w, oR = cx + 50 * w, iR = cx + 30 * w;
  return `M 60 ${top + 104} C ${oL - 40} ${top + 104}, ${oL - 6} ${top + 70}, ${oL} ${top} L ${iL} ${top}
    Q ${cx} ${top + 132} ${iR} ${top} L ${oR} ${top} C ${oR + 6} ${top + 70}, ${oR + 40} ${top + 104}, 452 ${top + 104} L 452 520 L 60 520 Z`;
}

export const FACES = { tan: "#d9b98a", brown: "#a87a4f", dark: "#3d3330", gray: "#9a958f" };
// Base looks. Boy is the free starter. The girl base is guaranteed from a player's first crate
// (the backend hands out FIRST_CRATE instead of a random roll on crate #1).
item("base_boy", "Boy Ram", "base", "common", { starter: true });
item("base_girl", "Girl Ram", "base", "rare");
export const FIRST_CRATE = ["base_girl"];

// ---------- FLEECE (~30) ----------
const FLEECE_SOLIDS = [
  ["cream", "Classic Cream", "#f4ecd8", "common"], ["white", "Snow White", "#ffffff", "common"], ["black", "Black Sheep", "#2b2b33", "common"],
  ["gray", "Storm Gray", "#9aa3b2", "common"], ["brown", "Cocoa", "#8a5a3c", "common"], ["sand", "Desert Sand", "#e6c98f", "common"],
  ["blue", "Royal Blue", "#5b8cff", "rare"], ["navy", "Navy", "#1f3a7a", "rare"], ["gold", "Gold Rush", "#ffc82c", "rare"],
  ["pink", "Bubblegum", "#ff9ccf", "rare"], ["green", "Mint", "#5ee08f", "rare"], ["purple", "Grape", "#b18cff", "rare"],
  ["red", "Cherry", "#ff5a5a", "rare"], ["orange", "Tangerine", "#ff9a3c", "rare"], ["teal", "Teal", "#2ec4b6", "rare"],
  ["neon", "Neon Lime", "#c6ff3d", "epic"], ["hotpink", "Hot Pink", "#ff2fa0", "epic"], ["silver", "Chrome Silver", "#cfd6e0", "epic"],
];
for (const [k, n, c, r] of FLEECE_SOLIDS) item(`fleece_${k}`, `${n} Fleece`, "fleece", r, { fill: c });
const pat = (id, w, h, bgc, inner) => `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"><rect width="${w}" height="${h}" fill="${bgc}"/>${inner}</pattern>`;
const FLEECE_PATTERNS = [
  ["twotone", "Blue & Gold Split", "rare", pat("fp_twotone", 40, 40, "#5b8cff", `<rect width="20" height="40" fill="#ffc82c"/>`)],
  ["checker", "Checkerboard", "rare", pat("fp_checker", 24, 24, "#fff", `<rect width="12" height="12" fill="#2b2b33"/><rect x="12" y="12" width="12" height="12" fill="#2b2b33"/>`)],
  ["polka", "Polka Dot", "rare", pat("fp_polka", 22, 22, "#ff9ccf", `<circle cx="11" cy="11" r="5" fill="#fff"/>`)],
  ["camo", "Camo", "epic", pat("fp_camo", 60, 60, "#6b7d4a", `<circle cx="14" cy="16" r="12" fill="#3f4d2a"/><circle cx="44" cy="40" r="14" fill="#8f9a63"/><circle cx="40" cy="10" r="8" fill="#2f3a20"/>`)],
  ["leopard", "Leopard", "epic", pat("fp_leopard", 36, 36, "#e6b35a", `<circle cx="10" cy="10" r="6" fill="none" stroke="#3a2412" stroke-width="4"/><circle cx="28" cy="26" r="5" fill="none" stroke="#3a2412" stroke-width="4"/>`)],
  ["zebra", "Zebra", "epic", pat("fp_zebra", 24, 24, "#fff", `<path d="M 0 4 Q 12 0 24 6 L 24 10 Q 12 4 0 8 Z M 0 16 Q 12 12 24 18 L 24 21 Q 12 16 0 20 Z" fill="#111"/>`)],
  ["tiedye", "Tie-Dye", "epic", `<radialGradient id="fp_tiedye"><stop offset="0" stop-color="#ff5ec4"/><stop offset=".35" stop-color="#ffd84a"/><stop offset=".65" stop-color="#4ad8ff"/><stop offset="1" stop-color="#a66bff"/></radialGradient>`],
  ["rainbow", "Rainbow", "legendary", `<linearGradient id="fp_rainbow" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff4d4d"/><stop offset=".2" stop-color="#ffb84d"/><stop offset=".4" stop-color="#ffe94d"/><stop offset=".6" stop-color="#5ee08f"/><stop offset=".8" stop-color="#4d9bff"/><stop offset="1" stop-color="#b14dff"/></linearGradient>`],
  ["flame", "Flame", "legendary", `<linearGradient id="fp_flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff2a00"/><stop offset=".5" stop-color="#ff9a00"/><stop offset="1" stop-color="#ffe14d"/></linearGradient>`],
  ["galaxy", "Galaxy", "legendary", pat("fp_galaxy", 50, 50, "#1a0f40", `<circle cx="10" cy="12" r="2" fill="#fff"/><circle cx="34" cy="30" r="1.5" fill="#fff"/><circle cx="40" cy="8" r="1" fill="#fff"/><circle cx="22" cy="40" r="10" fill="#6b3cff" opacity=".35"/>`)],
  ["gold24k", "24K Gold", "legendary", `<linearGradient id="fp_gold24k" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#ffc82c"/><stop offset="1" stop-color="#b8860b"/></linearGradient>`],
  ["diamond", "Diamond", "mythic", pat("fp_diamond", 20, 20, "#bfefff", `<path d="M 10 0 L 20 10 L 10 20 L 0 10 Z" fill="#ffffff" opacity=".7"/>`)],
];
for (const [k, n, r, defs] of FLEECE_PATTERNS) item(`fleece_${k}`, `${n} Fleece`, "fleece", r, { fill: `url(#fp_${k})`, defs });

// ---------- HORNS: 6 shapes x 5 finishes = 30 ----------
const HORN_PATHS = {
  curl: "M 205 168 C 150 96, 54 118, 54 204 C 54 268, 124 298, 156 258 C 180 228, 156 192, 124 204",
  small: "M 200 166 C 168 126, 112 136, 112 184 C 112 220, 152 232, 166 208 C 176 192, 162 178, 148 184",
  sweep: "M 204 164 C 170 110, 110 80, 40 96 C 70 110, 96 120, 120 150",
  goat: "M 214 158 C 200 110, 186 70, 150 40",
  devil: "M 206 160 C 196 130, 182 112, 168 96",
  spiral: "M 214 156 C 210 110, 180 70, 196 40 C 206 24, 226 34, 218 52",
};
const HORN_W = { curl: 42, small: 32, sweep: 34, goat: 26, devil: 22, spiral: 26 };
const HORN_SHAPE_NAMES = { curl: "Big Curl", small: "Lil Curl", sweep: "Sweepback", goat: "Goat Spike", devil: "Devil", spiral: "Corkscrew" };
const HORN_FINISHES = [
  ["natural", "", "#c8a46a", "#7e5f32", "common"], ["ivory", "Ivory", "#f3ead6", "#b9a77f", "common"],
  ["royal", "Royal Blue", "#1f55d6", "#0b2f86", "rare"], ["gold", "Gold", "#ffc82c", "#c48a00", "epic"],
  ["fire", "Flaming", "#ff6a1a", "#c11a0a", "legendary"],
];
for (const shape of Object.keys(HORN_PATHS)) {
  for (const [fk, fname, color, ridge, rarity] of HORN_FINISHES) {
    const id = `horns_${shape}${fk === "natural" ? "" : "_" + fk}`;
    item(id, `${fname ? fname + " " : ""}${HORN_SHAPE_NAMES[shape]} Horns`, "horns", shape === "curl" && fk === "natural" ? "common" : rarity,
      { shape, color, ridge, fire: fk === "fire" });
  }
}
function hornLayer(h = ITEMS.horns_curl) {
  const d = HORN_PATHS[h.shape], w = HORN_W[h.shape];
  const one = `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="${w + 15}" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${h.color}" stroke-width="${w}" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${h.ridge}" stroke-opacity=".45" stroke-width="${w}" stroke-dasharray="5 14"/>
    ${h.fire ? `<path d="${d}" fill="none" stroke="#ffe14d" stroke-width="${w / 3}" stroke-linecap="round" opacity=".8"/>` : ""}`;
  return one + mirror(one);
}

// ---------- SHIRTS: 10 designs x 3 cuts (tank, tee, long) = 30 ----------
const flamingos = Array.from({ length: 14 }, (_, i) => {
  const x = 150 + (i * 53) % 220, y = 310 + ((i * 37) % 120);
  return `<g transform="translate(${x},${y}) rotate(${(i % 3) * 12 - 12})"><path d="M 0 0 q -6 -14 6 -18 q 10 -2 8 8 q -4 8 -14 10 Z" fill="#ff6fae"/><path d="M 8 -18 q 6 -10 0 -16 q -4 -2 -6 2" stroke="#ff6fae" stroke-width="3" fill="none"/><path d="M 2 0 l 0 14" stroke="#ff6fae" stroke-width="2.5"/></g>`;
}).join("");
const vstripes = (c, w) => Array.from({ length: 14 }, (_, i) => `<rect x="${120 + i * w * 2}" y="280" width="${w}" height="200" fill="${c}"/>`).join("");
const RAM_ICON = (x, y, s, c) => `<g transform="translate(${x},${y}) scale(${s})" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round">
  <path d="M -14 -6 C -30 -26, -54 -18, -50 2 C -48 18, -30 20, -26 8"/><path d="M 14 -6 C 30 -26, 54 -18, 50 2 C 48 18, 30 20, 26 8"/>
  <path d="M -14 -10 C -14 20, -8 34, 0 38 C 8 34, 14 20, 14 -10 Z" fill="${c}" stroke="none"/></g>`;
const SHIRT_DESIGNS = [
  ["home", "Home Jersey", "common", { fill: BLUE, collar: GOLD, deco: (b) => txt("12", b.chest[0], b.chest[1] + 26, 54, GOLD) }],
  ["away", "Away Jersey", "common", { fill: "#f8f8f5", collar: BLUE, deco: (b) => txt("12", b.chest[0], b.chest[1] + 26, 54, BLUE) }],
  ["gold", "Gold Rush Jersey", "rare", { fill: "#ffb81c", collar: BLUE, deco: (b) => txt("00", b.chest[0], b.chest[1] + 26, 54, BLUE) }],
  ["whose", "WHOSE HOUSE Tee", "rare", { fill: BLUE, collar: BLUE, deco: (b) => txt("WHOSE", b.chest[0], b.chest[1] + 2, 26, GOLD) + txt("HOUSE", b.chest[0], b.chest[1] + 30, 26, GOLD) }],
  ["ramshouse", "RAMS HOUSE Tee", "rare", { fill: GOLD, collar: GOLD, deco: (b) => txt("RAMS", b.chest[0], b.chest[1] + 2, 28, BLUE) + txt("HOUSE", b.chest[0], b.chest[1] + 30, 26, BLUE) }],
  ["icon", "Ram Head Tee", "common", { fill: "#2b2b33", collar: "#2b2b33", deco: (b) => RAM_ICON(b.chest[0], b.chest[1], 0.8, GOLD) }],
  ["flamingo", "Flamingo Shirt", "rare",{ fill: "#7fd6c9", collar: "#5fb8ab", pattern: flamingos }],
  ["referee", "Referee Stripes", "rare", { fill: "#fff", collar: "#111", pattern: vstripes("#111", 14), sleeve: "#111" }],
  ["camo", "Camo Tee", "epic", { fill: "#6b7d4a", collar: "#3f4d2a", pattern: `<rect width="512" height="512" fill="url(#fp_camo)"/>`, defs: FLEECE_PATTERNS[3][3] }],
  ["goat", "GOAT Tee", "legendary", { fill: "#111", collar: GOLD, deco: (b) => txt("GOAT", b.chest[0], b.chest[1] + 18, 40, GOLD) + `<circle cx="${b.chest[0] + 46}" cy="${b.chest[1] - 22}" r="8" fill="#fff"/>` }],
];
// Every design comes in tank, short sleeve and long sleeve.
const CUTS = [["tank", "Tank"], ["tee", "Short Sleeve"], ["long", "Long Sleeve"]];
// Per-cut rarity overrides: all flamingos are rare, the flamingo tank is the rarest shirt.
const CUT_RARITY = { flamingo: { tank: "mythic", tee: "rare", long: "rare" } };
for (const [dk, dname, rarity, d] of SHIRT_DESIGNS) {
  for (const [ck, cname] of CUTS) {
    const base = dname.replace(/ (Tee|Jersey|Shirt)$/, "");
    item(`shirt_${dk}_${ck}`, `${base} ${cname}`, "shirt", CUT_RARITY[dk]?.[ck] || rarity, { design: d, cut: ck });
  }
}

// ---------- HEAD (~30), drawn in head space ----------
const capArt = (c, bill = c, front = false) => `<path d="M 196 150 C 200 104, 312 104, 316 150 Z" fill="${c}" ${S}/>${front
  ? `<path d="M 196 150 C 210 168, 302 168, 316 150 C 300 160, 212 160, 196 150 Z" fill="${bill}" ${S}/>`
  : `<path d="M 300 128 C 330 120, 356 128, 364 140 C 346 146, 324 146, 310 142 Z" fill="${bill}" ${S}/>`}`;
const helmetArt = (c, stripe) => `<path d="M 168 210 C 160 120, 230 92, 268 96 C 330 102, 360 150, 346 214 L 320 214 L 320 176 C 300 150, 214 150, 194 176 L 194 214 Z" fill="${c}" ${S}/><path d="M 256 98 L 256 150" stroke="${stripe}" stroke-width="14"/>`;
const beanieArt = (c, band, pom = true) => `<path d="M 190 156 C 190 86, 322 86, 322 156 Z" fill="${c}" ${S}/><rect x="182" y="144" width="148" height="30" rx="12" fill="${band}" ${S}/>${pom ? `<circle cx="256" cy="82" r="20" fill="#fff" ${S}/>` : ""}`;
const HEADS = [
  ["cap_blue", "Blue Cap", "common", capArt(BLUE, "#00266e")], ["cap_gold", "Gold Cap", "common", capArt(GOLD, "#d08a00")],
  ["cap_black", "Black Cap", "common", capArt("#222", "#111")], ["cap_front", "Front-Facing Cap", "common", capArt(BLUE, GOLD, true)],
  ["ref_cap", "Ref Cap", "rare", capArt("#111", "#111", true) + `<path d="M 256 104 L 256 150" stroke="#fff" stroke-width="5"/>`],
  ["beanie_gold", "Gold Beanie", "common", beanieArt("#ffb81c", BLUE)], ["beanie_blue", "Blue Beanie", "common", beanieArt(BLUE, GOLD)],
  ["beanie_black", "Black Beanie", "common", beanieArt("#222", "#444", false)],
  ["headband_blue", "Blue Headband", "common", `<rect x="180" y="176" width="152" height="22" rx="8" fill="${BLUE}" ${S}/>`],
  ["headband_gold", "Gold Headband", "common", `<rect x="180" y="176" width="152" height="22" rx="8" fill="${GOLD}" ${S}/>`],
  ["bucket", "Bucket Hat", "rare", `<path d="M 160 160 L 352 160 L 322 104 C 300 86, 212 86, 190 104 Z" fill="#e6d3a3" ${S}/>`],
  ["party", "Party Hat", "rare", `<path d="M 226 150 L 256 50 L 286 150 Z" fill="#ff5ec4" ${S}/><circle cx="256" cy="50" r="12" fill="${GOLD}" ${S}/>`],
  ["propeller", "Propeller Cap", "rare", capArt("#e5484d", "#2563eb", true) + `<path d="M 256 104 l 0 -24 M 220 74 L 292 86" stroke="${OUT}" stroke-width="8" stroke-linecap="round"/><ellipse cx="256" cy="80" rx="36" ry="8" fill="${GOLD}" ${S6}/>`],
  ["helmet_blue", "Game Helmet", "rare", helmetArt(BLUE, GOLD)], ["helmet_white", "Throwback Helmet", "rare", helmetArt("#f1f1ee", BLUE)],
  ["helmet_gold", "Gold Helmet", "epic", helmetArt("#ffc82c", BLUE)], ["helmet_chrome", "Chrome Helmet", "legendary", helmetArt("#cfd6e0", "#ffffff")],
  ["cowboy", "Giant Cowboy Hat", "epic", `<ellipse cx="256" cy="150" rx="190" ry="30" fill="#8a5a3c" ${S}/><path d="M 190 150 C 186 60, 326 60, 322 150 Z" fill="#a8703f" ${S}/><path d="M 192 132 L 320 132" stroke="#3a2412" stroke-width="12"/>`],
  ["sombrero", "Giant Sombrero", "epic", `<ellipse cx="256" cy="150" rx="210" ry="36" fill="#c8a060" ${S}/><path d="M 186 150 C 186 40, 326 40, 326 150 Z" fill="#d9b37a" ${S}/><path d="M 188 128 L 324 128" stroke="#e5484d" stroke-width="16"/>`],
  ["tophat", "Giant Top Hat", "epic", `<ellipse cx="256" cy="150" rx="110" ry="18" fill="#111" ${S}/><rect x="196" y="20" width="120" height="132" rx="8" fill="#1a1a1a" ${S}/><rect x="196" y="120" width="120" height="18" fill="${GOLD}"/>`],
  ["chef", "Chef Hat", "rare", `<rect x="200" y="110" width="112" height="44" fill="#fff" ${S}/><circle cx="216" cy="96" r="30" fill="#fff" ${S}/><circle cx="256" cy="80" r="34" fill="#fff" ${S}/><circle cx="296" cy="96" r="30" fill="#fff" ${S}/><rect x="204" y="100" width="104" height="30" fill="#fff"/>`],
  ["grad", "Grad Cap", "rare", `<path d="M 256 90 L 360 120 L 256 150 L 152 120 Z" fill="#111" ${S}/><path d="M 210 136 L 210 160 Q 256 176 302 160 L 302 136" fill="#222" ${S}/><path d="M 330 124 L 330 170" stroke="${GOLD}" stroke-width="6"/>`],
  ["pirate", "Pirate Hat", "epic", `<path d="M 150 156 C 170 70, 342 70, 362 156 C 300 136, 212 136, 150 156 Z" fill="#111" ${S}/><circle cx="256" cy="116" r="12" fill="#fff"/>`],
  ["viking", "Viking Helmet", "legendary", `<path d="M 186 170 C 186 100, 326 100, 326 170 Z" fill="#9aa3b2" ${S}/><path d="M 196 130 C 160 120, 140 90, 150 60 C 170 90, 186 100, 204 108 Z M 316 130 C 352 120, 372 90, 362 60 C 342 90, 326 100, 308 108 Z" fill="#f3ead6" ${S}/>`],
  ["crown", "Crown", "legendary", `<path d="M 194 160 L 182 92 L 222 124 L 256 78 L 290 124 L 330 92 L 318 160 Z" fill="#ffc82c" ${S}/><rect x="190" y="150" width="132" height="22" rx="6" fill="#e0a800" ${S}/><circle cx="256" cy="130" r="9" fill="#e5484d" ${S6}/>`],
  ["tiara", "Tiara", "epic", `<path d="M 200 160 L 216 132 L 236 150 L 256 118 L 276 150 L 296 132 L 312 160 Z" fill="#e6f0ff" ${S6}/><circle cx="256" cy="134" r="7" fill="#ff5ec4"/>`],
  ["flowers", "Flower Crown", "rare", [200, 228, 256, 284, 312].map((x, i) => `<circle cx="${x}" cy="${162 - (i % 2) * 8}" r="13" fill="${["#ff6fae", "#ffd84a", "#7fd0ff", "#ff6fae", "#ffd84a"][i]}" ${S6}/><circle cx="${x}" cy="${162 - (i % 2) * 8}" r="4" fill="#fff"/>`).join("")],
  ["halo", "Halo", "legendary", `<ellipse cx="256" cy="76" rx="70" ry="16" fill="none" stroke="#fff3b0" stroke-width="12"/><ellipse cx="256" cy="76" rx="70" ry="16" fill="none" stroke="#ffd84a" stroke-width="5"/>`],
  ["durag", "Durag", "rare", `<path d="M 182 170 C 180 100, 332 100, 330 170 C 300 160, 212 160, 182 170 Z" fill="${BLUE}" ${S}/><path d="M 320 160 C 350 190, 360 240, 344 280" stroke="${BLUE}" stroke-width="16" fill="none" stroke-linecap="round"/>`],
  ["headset", "Coach Headset", "epic", `<path d="M 176 210 C 176 100, 336 100, 336 210" fill="none" stroke="#222" stroke-width="12"/><rect x="160" y="196" width="28" height="44" rx="10" fill="#222" ${S6}/><rect x="324" y="196" width="28" height="44" rx="10" fill="#222" ${S6}/><path d="M 174 236 C 180 300, 220 330, 240 330" stroke="#222" stroke-width="6" fill="none"/><circle cx="244" cy="330" r="8" fill="#222"/>`],
];
for (const [k, n, r, svg] of HEADS) item(`head_${k}`, n, "head", r, { svg });

// ---------- EYES (~15) & MOUTH (~15), head space ----------
const glasses = (lens, frame = "#111", shape = "rect") => `<path d="M 188 240 L 324 240" stroke="${frame}" stroke-width="10"/>${shape === "round"
  ? `<circle cx="222" cy="252" r="28" fill="${lens}" ${S}/><circle cx="290" cy="252" r="28" fill="${lens}" ${S}/>`
  : `<rect x="188" y="232" width="64" height="42" rx="14" fill="${lens}" ${S}/><rect x="260" y="232" width="64" height="42" rx="14" fill="${lens}" ${S}/>`}
  <path d="M 200 244 l 16 0 M 272 244 l 16 0" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".5"/>`;
const EYES = [
  ["shades", "Shades", "common", glasses("#111")], ["shades_gold", "Gold Shades", "rare", glasses("#3a2a00", GOLD)],
  ["aviators", "Aviators", "rare", glasses("#5a3a1a", "#c0c6cf", "round")], ["nerd", "Nerd Glasses", "common", glasses("rgba(255,255,255,.15)", "#111", "round")],
  ["heart", "Heart Glasses", "epic", `<path d="M 188 240 L 324 240" stroke="#ff2fa0" stroke-width="8"/><path d="M 222 280 C 190 260, 196 228, 222 244 C 248 228, 254 260, 222 280 Z M 290 280 C 258 260, 264 228, 290 244 C 316 228, 322 260, 290 280 Z" fill="#ff2fa0" ${S}/>`],
  ["star", "Star Glasses", "epic", [222, 290].map((x) => `<path d="M ${x} 222 L ${x + 9} 244 L ${x + 32} 246 L ${x + 14} 260 L ${x + 20} 284 L ${x} 270 L ${x - 20} 284 L ${x - 14} 260 L ${x - 32} 246 L ${x - 9} 244 Z" fill="${GOLD}" ${S6}/>`).join("")],
  ["3d", "3D Glasses", "rare", `<rect x="186" y="232" width="140" height="44" rx="6" fill="#fff" ${S}/><rect x="196" y="240" width="54" height="28" fill="#e5484d"/><rect x="262" y="240" width="54" height="28" fill="#2fb7e6"/>`],
  ["goggles", "Ski Goggles", "epic", `<rect x="182" y="228" width="148" height="50" rx="24" fill="#ff9a3c" ${S}/><path d="M 196 244 Q 256 228 316 244" stroke="#fff" stroke-width="5" fill="none" opacity=".6"/>`],
  ["monocle", "Monocle", "rare", `<circle cx="290" cy="252" r="28" fill="rgba(255,255,255,.12)" stroke="${GOLD}" stroke-width="7"/><path d="M 316 262 C 330 300, 324 330, 310 350" stroke="${GOLD}" stroke-width="3" fill="none"/>`],
  ["patch", "Eye Patch", "rare", `<path d="M 180 220 L 330 296" stroke="#111" stroke-width="6"/><ellipse cx="290" cy="254" rx="28" ry="26" fill="#111" ${S6}/>`],
  ["eyeblack", "Eye Black", "common", `<rect x="200" y="284" width="44" height="12" rx="4" fill="${OUT}"/><rect x="268" y="284" width="44" height="12" rx="4" fill="${OUT}"/>`],
  ["eyeblack_gold", "Gold Eye Black", "rare", `<rect x="200" y="284" width="44" height="12" rx="4" fill="${GOLD}" ${S6}/><rect x="268" y="284" width="44" height="12" rx="4" fill="${GOLD}" ${S6}/>`],
  ["visor", "Smoked Visor", "epic", `<path d="M 180 230 L 332 230 L 326 276 L 186 276 Z" fill="#111" opacity=".85" ${S}/><path d="M 196 240 L 236 240" stroke="#7aa2ff" stroke-width="5"/>`],
  ["laser_red", "Laser Eyes", "legendary", `<path d="M 228 257 L 0 470 L 0 512 L 40 512 Z M 284 257 L 512 470 L 512 512 L 472 512 Z" fill="#ff2a2a" opacity=".85"/><circle cx="228" cy="257" r="16" fill="#ff2a2a"/><circle cx="284" cy="257" r="16" fill="#ff2a2a"/>`],
  ["laser_gold", "Gold Laser Eyes", "mythic", `<path d="M 228 257 L 0 470 L 0 512 L 40 512 Z M 284 257 L 512 470 L 512 512 L 472 512 Z" fill="#ffd400" opacity=".9"/><circle cx="228" cy="257" r="16" fill="#fff6c2"/><circle cx="284" cy="257" r="16" fill="#fff6c2"/>`],
];
for (const [k, n, r, svg] of EYES) item(`eyes_${k}`, n, "eyes", r, { svg });
const grillArt = (c) => `<path d="M 232 340 Q 258 362 284 336 L 282 350 Q 258 368 234 352 Z" fill="${c}" stroke="${OUT}" stroke-width="5"/><path d="M 248 346 l 0 10 M 260 346 l 0 10 M 272 342 l 0 10" stroke="#00000044" stroke-width="2.5"/>`;
const MOUTHS = [
  ["grill_gold", "Gold Grill", "epic", grillArt("#ffc82c")], ["grill_silver", "Silver Grill", "rare", grillArt("#cfd6e0")],
  ["grill_diamond", "Diamond Grill", "legendary", grillArt("#bfefff") + `<path d="M 244 348 l 4 -4 l 4 4 M 266 346 l 4 -4 l 4 4" stroke="#fff" stroke-width="2"/>`],
  ["grill_rainbow", "Rainbow Grill", "legendary", grillArt("url(#fp_rainbow)"), FLEECE_PATTERNS[7][3]],
  ["paci_blue", "Blue Pacifier", "common", `<circle cx="256" cy="344" r="22" fill="#7fd0ff" ${S}/><circle cx="256" cy="344" r="9" fill="#fff"/><path d="M 236 362 q 20 26 40 0" fill="none" stroke="#2563eb" stroke-width="8" stroke-linecap="round"/>`],
  ["paci_pink", "Pink Pacifier", "common", `<circle cx="256" cy="344" r="22" fill="#ffb3d9" ${S}/><circle cx="256" cy="344" r="9" fill="#fff"/><path d="M 236 362 q 20 26 40 0" fill="none" stroke="#ff2fa0" stroke-width="8" stroke-linecap="round"/>`],
  ["guard_blue", "Blue Mouthguard", "common", `<path d="M 232 340 Q 258 360 284 336 L 282 348 Q 258 364 234 350 Z" fill="#3b82f6" stroke="${OUT}" stroke-width="5"/>`],
  ["guard_gold", "Gold Mouthguard", "rare", `<path d="M 232 340 Q 258 360 284 336 L 282 348 Q 258 364 234 350 Z" fill="${GOLD}" stroke="${OUT}" stroke-width="5"/>`],
  ["stache", "Handlebar Mustache", "rare", `<path d="M 256 330 C 236 318, 210 324, 202 344 C 214 336, 230 336, 256 340 C 282 336, 298 336, 310 344 C 302 324, 276 318, 256 330 Z" fill="#3a2412" ${S6}/>`],
  ["beard", "Big Beard", "epic", `<path d="M 202 330 C 200 400, 240 420, 256 420 C 272 420, 312 400, 310 330 C 290 356, 222 356, 202 330 Z" fill="#6b4423" ${S}/>`],
  ["tongue", "Tongue Out", "common", `<path d="M 246 344 C 246 372, 270 372, 270 344 Z" fill="#ff6f8f" ${S6}/>`],
  ["lollipop", "Lollipop", "rare", `<path d="M 270 344 L 316 372" stroke="#fff" stroke-width="5"/><circle cx="322" cy="378" r="16" fill="#ff5ec4" ${S6}/><path d="M 314 372 q 8 6 16 0" stroke="#fff" stroke-width="3" fill="none"/>`],
  ["gum", "Bubble Gum", "rare", `<circle cx="256" cy="352" r="26" fill="#ff9ccf" ${S6}/><circle cx="248" cy="344" r="6" fill="#fff" opacity=".7"/>`],
  ["whistle_mouth", "Whistle", "rare", `<rect x="244" y="338" width="34" height="18" rx="6" fill="#cfd6e0" ${S6}/><circle cx="276" cy="347" r="9" fill="#cfd6e0" ${S6}/>`],
  ["toothpick", "Toothpick", "common", `<path d="M 270 342 L 310 330" stroke="#e6c98f" stroke-width="5" stroke-linecap="round"/>`],
];
for (const [k, n, r, svg, defs] of MOUTHS) item(`mouth_${k}`, n, "mouth", r, { svg, defs });

// ---------- NECK (~30), body space ----------
const chain = (c, w = 11, big = false, pendant = "") => `<path d="M 196 304 C 204 ${big ? 420 : 380}, 308 ${big ? 420 : 380}, 316 304" fill="none" stroke="${OUT}" stroke-width="${w + 9}" stroke-linecap="round"/>
  <path d="M 196 304 C 204 ${big ? 420 : 380}, 308 ${big ? 420 : 380}, 316 304" fill="none" stroke="${c}" stroke-width="${w}" stroke-dasharray="${w + 2} ${w / 2}" stroke-linecap="round"/>${pendant}`;
const medal = (c) => `<path d="M 226 300 L 256 360 L 286 300" fill="none" stroke="${BLUE}" stroke-width="10"/><circle cx="256" cy="372" r="22" fill="${c}" ${S}/><path d="M 256 362 l 4 8 l 9 1 l -7 6 l 2 9 l -8 -5 l -8 5 l 2 -9 l -7 -6 l 9 -1 Z" fill="#fff" opacity=".8"/>`;
const bandana = (c, dots = "#fff") => `<path d="M 196 306 C 220 324, 292 324, 316 306 L 256 376 Z" fill="${c}" ${S}/><circle cx="244" cy="330" r="4" fill="${dots}"/><circle cx="268" cy="330" r="4" fill="${dots}"/><circle cx="256" cy="348" r="4" fill="${dots}"/>`;
const tie = (c, bow = false, dots = "") => bow
  ? `<path d="M 256 314 L 222 298 L 222 330 Z M 256 314 L 290 298 L 290 330 Z" fill="${c}" ${S6}/><circle cx="256" cy="314" r="8" fill="${c}" ${S6}/>${dots}`
  : `<path d="M 246 306 L 266 306 L 262 320 L 274 392 L 256 408 L 238 392 L 250 320 Z" fill="${c}" ${S6}/>`;
const NECKS = [
  ["chain_gold", "Gold Chain", "rare", chain("#ffc82c")], ["chain_silver", "Silver Chain", "common", chain("#cfd6e0")],
  ["chain_rainbow", "Rainbow Chain", "epic", chain("url(#fp_rainbow)"), FLEECE_PATTERNS[7][3]],
  ["chain_giant", "Giant Gold Chain", "epic", chain("#ffc82c", 16, true, `<circle cx="256" cy="400" r="34" fill="#ffc82c" ${S}/>${txt("$", 256, 414, 40, OUT)}`)],
  ["chain_diamond", "Giant Diamond Chain", "legendary", chain("#bfefff", 16, true, `<path d="M 256 370 L 286 396 L 256 436 L 226 396 Z" fill="#dff7ff" ${S}/>`)],
  ["chain_ram", "Ram Pendant", "legendary", chain("#ffc82c", 12, false, `<circle cx="256" cy="378" r="26" fill="${BLUE}" ${S}/>${RAM_ICON(256, 378, 0.42, GOLD)}`)],
  ["chain_mvp", "MVP Chain", "mythic", chain("#ffc82c", 16, true, `<rect x="216" y="380" width="80" height="44" rx="10" fill="#ffc82c" ${S}/>${txt("MVP", 256, 414, 32, OUT)}`)],
  ["whistle", "Ref Whistle", "common", `<path d="M 220 304 L 256 360 L 292 304" stroke="#111" stroke-width="4" fill="none"/><rect x="244" y="356" width="30" height="16" rx="6" fill="#cfd6e0" ${S6}/>`],
  ["bandana_blue", "Blue Bandana", "common", bandana(ROYAL)], ["bandana_gold", "Gold Bandana", "common", bandana(GOLD, BLUE)],
  ["bandana_red", "Red Bandana", "common", bandana("#e5484d")], ["bandana_black", "Black Bandana", "common", bandana("#222")],
  ["medal_gold", "Gold Medal", "epic", medal("#ffc82c")], ["medal_silver", "Silver Medal", "rare", medal("#cfd6e0")], ["medal_bronze", "Bronze Medal", "common", medal("#c8834a")],
  ["tie_red", "Red Tie", "common", tie("#e5484d")], ["tie_blue", "Blue Tie", "common", tie(BLUE)],
  ["bowtie_gold", "Gold Bow Tie", "rare", tie(GOLD, true)], ["bowtie_pink", "Pink Bow Tie", "rare", tie("#ff6fae", true)],
  ["scarf", "Team Scarf", "rare", `<path d="M 194 306 C 220 330, 292 330, 318 306" stroke="${BLUE}" stroke-width="30" fill="none" stroke-linecap="round"/><path d="M 194 306 C 220 330, 292 330, 318 306" stroke="${GOLD}" stroke-width="30" fill="none" stroke-dasharray="14 14"/><rect x="286" y="318" width="28" height="80" fill="${BLUE}" ${S6}/>`],
  ["lei", "Flower Lei", "rare", Array.from({ length: 9 }, (_, i) => { const t = i / 8, x = 196 + t * 120, y = 306 + Math.sin(t * Math.PI) * 60; return `<circle cx="${x}" cy="${y}" r="12" fill="${["#ff6fae", "#ffd84a", "#ff9a3c"][i % 3]}" ${S6}/>`; }).join("")],
  ["cape_red", "Red Cape", "epic", "", null, `<path d="M 180 310 L 120 480 L 392 480 L 332 310 Z" fill="#e5484d" ${S}/>`],
  ["cape_blue", "Blue Cape", "epic", "", null, `<path d="M 180 310 L 120 480 L 392 480 L 332 310 Z" fill="${BLUE}" ${S}/>`],
  ["cape_gold", "Gold Cape", "legendary", "", null, `<path d="M 180 310 L 120 480 L 392 480 L 332 310 Z" fill="${GOLD}" ${S}/>`],
  ["lanyard", "All Access Pass", "rare", `<path d="M 220 304 L 256 360 L 292 304" stroke="${GOLD}" stroke-width="6" fill="none"/><rect x="224" y="356" width="64" height="44" rx="6" fill="#fff" ${S6}/>${txt("ALL ACCESS", 256, 384, 10, BLUE)}`],
  ["cowbell", "Cowbell", "rare", `<path d="M 220 304 L 256 344 L 292 304" stroke="#6b4423" stroke-width="8" fill="none"/><path d="M 240 344 L 272 344 L 282 384 L 230 384 Z" fill="#ffc82c" ${S}/>`],
  ["headphones", "Neck Headphones", "rare", `<path d="M 204 300 C 210 350, 302 350, 308 300" stroke="#222" stroke-width="10" fill="none"/><rect x="190" y="296" width="26" height="36" rx="8" fill="#222" ${S6}/><rect x="296" y="296" width="26" height="36" rx="8" fill="#222" ${S6}/>`],
  ["collar", "Spiked Collar", "epic", `<path d="M 200 306 C 220 326, 292 326, 312 306" stroke="#111" stroke-width="16" fill="none"/>${[214, 234, 256, 278, 298].map((x) => `<path d="M ${x - 6} 316 L ${x} 302 L ${x + 6} 316 Z" fill="#cfd6e0"/>`).join("")}`],
  ["towel", "Shoulder Towel", "common", `<path d="M 300 300 C 330 300, 352 320, 350 400 L 326 400 C 328 340, 316 322, 296 318 Z" fill="#fff" ${S}/><path d="M 330 380 l 18 0" stroke="${GOLD}" stroke-width="6"/>`],
];
for (const [k, n, r, svg, defs, behind] of NECKS) item(`neck_${k}`, n, "neck", r, { svg, defs, behind });

// ---------- HANDS (~30), drawn around the right hand at 0,0 ----------
const ball = (c, lace = "#fff") => `<g transform="translate(18,-26) rotate(-30)"><ellipse rx="30" ry="18" fill="${c}" ${S}/><path d="M -12 0 L 12 0 M -6 -5 l 0 10 M 0 -5 l 0 10 M 6 -5 l 0 10" stroke="${lace}" stroke-width="3"/></g>`;
// penalty flags: a weighted cloth bundle, mid-throw
const penalty = (c) => `<g transform="translate(14,-30) rotate(-14)">
  <path d="M -26 -18 C -14 -30, 10 -26, 24 -20 C 30 -4, 26 12, 18 22 C 0 28, -18 24, -28 14 C -32 2, -30 -8, -26 -18 Z" fill="${c}" ${S}/>
  <path d="M -12 -12 C -2 -2, 6 4, 14 8 M -18 6 C -8 8, 0 2, 4 -6" stroke="#00000033" stroke-width="4" fill="none" stroke-linecap="round"/>
  <circle cx="20" cy="18" r="9" fill="${c}" ${S6}/><path d="M 26 24 l 8 8" stroke="${c}" stroke-width="6" stroke-linecap="round"/></g>`;
const foam = (c, word = "#1") => `<path d="M -22 10 L -26 -40 C -26 -54, -10 -56, -8 -42 L -6 -92 C -6 -106, 12 -106, 12 -92 L 14 -40 C 30 -46, 34 -28, 26 -10 L 22 10 Z" fill="${c}" ${S}/>${txt(word, 0, -8, 18, "#fff")}`;
const HANDS = [
  ["football", "Football", "common", ball("#8b4a22")], ["football_gold", "Gold Football", "epic", ball("#ffc82c", OUT)],
  ["football_chrome", "Chrome Football", "legendary", ball("#cfd6e0", OUT)], ["football_fire", "Flaming Football", "legendary", ball("#ff6a1a", "#ffe14d") + `<path d="M -10 -50 C -20 -70, 0 -76, -4 -92 C 16 -76, 14 -60, 6 -48 Z" fill="#ffd400" ${S6}/>`],
  ["flag_yellow", "Penalty Flag", "rare", penalty("#ffd400")], ["flag_red", "Challenge Flag", "epic", penalty("#e5484d")],
  ["foam_gold", "Gold Foam Finger", "common", foam(GOLD)], ["foam_blue", "Blue Foam Finger", "common", foam(BLUE)],
  ["trophy", "Trophy", "legendary", `<path d="M -22 -70 L 22 -70 L 18 -36 C 14 -24, -14 -24, -18 -36 Z" fill="#ffc82c" ${S}/><path d="M -6 -24 L 6 -24 L 8 -6 L -8 -6 Z" fill="#ffc82c" ${S6}/><rect x="-18" y="-8" width="36" height="12" rx="3" fill="#6b4423" ${S6}/>`],
  ["hotdog", "Stadium Hot Dog", "common", `<g transform="translate(14,-20) rotate(-20)"><rect x="-34" y="-12" width="68" height="24" rx="12" fill="#e0a65a" ${S}/><rect x="-38" y="-6" width="76" height="12" rx="6" fill="#c0392b" ${S6}/><path d="M -28 -2 q 8 -6 16 0 q 8 6 16 0 q 8 -6 16 0" stroke="#ffd400" stroke-width="4" fill="none"/></g>`],
  ["nachos", "Nachos", "common", `<path d="M -30 -10 L 30 -10 L 22 10 L -22 10 Z" fill="#e5484d" ${S}/><path d="M -24 -10 L -14 -34 L -2 -10 M 0 -10 L 10 -36 L 22 -10" fill="#ffc82c" ${S6}/>`],
  ["soda", "Big Soda", "common", `<path d="M -16 -60 L 16 -60 L 12 10 L -12 10 Z" fill="#e5484d" ${S}/><path d="M 4 -60 L 14 -84" stroke="#fff" stroke-width="5"/>`],
  ["popcorn", "Popcorn", "common", `<path d="M -20 -40 L 20 -40 L 14 10 L -14 10 Z" fill="#fff" ${S}/>${vstripes("#e5484d", 6).replace(/y="280"/g, 'y="-40"').replace(/height="200"/g, 'height="50"').replace(/x="(\d+)"/g, (m, x) => `x="${(+x - 120) / 3 - 18}"`)}${[-12, 0, 12, -6, 6].map((x, i) => `<circle cx="${x}" cy="${-46 - (i % 2) * 8}" r="9" fill="#fff6c2" ${S6}/>`).join("")}`],
  ["pizza", "Pizza Slice", "common", `<path d="M -26 -40 L 26 -40 L 0 16 Z" fill="#ffc82c" ${S}/><path d="M -26 -40 L 26 -40" stroke="#c8834a" stroke-width="10"/><circle cx="-6" cy="-22" r="5" fill="#c0392b"/><circle cx="8" cy="-12" r="5" fill="#c0392b"/>`],
  ["turkeyleg", "Turkey Leg", "rare", `<ellipse cx="14" cy="-34" rx="22" ry="28" fill="#a8703f" ${S}/><path d="M -2 -10 L -10 10" stroke="#fff" stroke-width="10" stroke-linecap="round"/>`],
  ["icecream", "Ice Cream", "rare", `<path d="M -14 -30 L 14 -30 L 0 10 Z" fill="#e6b35a" ${S6}/><circle cy="-40" r="16" fill="#ff9ccf" ${S6}/><circle cy="-62" r="13" fill="#7fd0ff" ${S6}/>`],
  ["phone", "Phone", "common", `<rect x="-12" y="-46" width="24" height="44" rx="5" fill="#222" ${S6}/><rect x="-8" y="-40" width="16" height="30" fill="#5b8cff"/>`],
  ["megaphone", "Megaphone", "rare", `<path d="M -10 -20 L 40 -44 L 40 4 L -10 -10 Z" fill="${GOLD}" ${S}/><rect x="-20" y="-22" width="14" height="16" fill="${BLUE}" ${S6}/>`],
  ["pompom_blue", "Blue Pom-Pom", "rare", `<g>${Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return `<path d="M 0 -24 L ${Math.cos(a) * 30} ${-24 + Math.sin(a) * 30}" stroke="${BLUE}" stroke-width="9" stroke-linecap="round"/>`; }).join("")}<circle cy="-24" r="14" fill="${BLUE}"/></g>`],
  ["pompom_gold", "Gold Pom-Pom", "rare", `<g>${Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return `<path d="M 0 -24 L ${Math.cos(a) * 30} ${-24 + Math.sin(a) * 30}" stroke="${GOLD}" stroke-width="9" stroke-linecap="round"/>`; }).join("")}<circle cy="-24" r="14" fill="${GOLD}"/></g>`],
  ["pennant", "Pennant", "common", `<path d="M 0 10 L 0 -80" stroke="#6b4423" stroke-width="6"/><path d="M 0 -80 L 70 -62 L 0 -44 Z" fill="${BLUE}" ${S6}/>${txt("RAMS", 26, -56, 13, GOLD)}`],
  ["dfense", "D-FENSE Sign", "rare", `<path d="M 0 10 L 0 -40" stroke="#6b4423" stroke-width="6"/><rect x="-50" y="-96" width="100" height="56" rx="4" fill="#fff" ${S6}/>${txt("D-FENSE", 0, -60, 18, BLUE)}`],
  ["clipboard", "Coach Clipboard", "rare", `<rect x="-22" y="-60" width="44" height="60" rx="4" fill="#a8703f" ${S6}/><rect x="-16" y="-52" width="32" height="44" fill="#fff"/><path d="M -10 -40 l 8 8 M -2 -40 l -8 8 M 6 -24 a 6 6 0 1 0 0.1 0" stroke="${OUT}" stroke-width="3" fill="none"/>`],
  ["coin", "Coin Toss", "rare", `<circle cx="10" cy="-50" r="16" fill="#ffc82c" ${S6}/><path d="M 0 -16 l 6 -12" stroke="${OUT}" stroke-width="3" opacity=".4"/>`],
  ["money", "Stack of Cash", "epic", `<rect x="-26" y="-36" width="52" height="30" rx="4" fill="#5ee08f" ${S6}/>${txt("$", 0, -14, 22, "#1f7a3a")}`],
  ["mic", "Microphone", "rare", `<rect x="-6" y="-30" width="12" height="36" rx="4" fill="#222" ${S6}/><circle cy="-40" r="14" fill="#9aa3b2" ${S6}/>`],
  ["ring", "Championship Ring", "mythic", `<circle cx="0" cy="-30" r="20" fill="none" stroke="#ffc82c" stroke-width="10"/><path d="M -14 -54 L 14 -54 L 18 -44 L -18 -44 Z" fill="#bfefff" ${S6}/>`],
  ["cheese", "Foam Cheese Wedge", "rare", `<path d="M -30 -10 L 30 -10 L 30 -44 Z" fill="#ffd84a" ${S}/><circle cx="16" cy="-22" r="5" fill="#e6b800"/>`],
];
for (const [k, n, r, svg] of HANDS) item(`hand_${k}`, n, "hand", r, { svg });

// ---------- FEET (~30), drawn around x=0 under each leg ----------
const cleat = (c, stripe = "#fff", sole = OUT) => `<path d="M -30 476 C -30 448, 6 448, 32 466 L 34 480 L -30 480 Z" fill="${c}" ${S}/><path d="M -8 462 l 12 0" stroke="${stripe}" stroke-width="5"/>${[-22, -6, 10, 24].map((d) => `<rect x="${d}" y="480" width="6" height="7" fill="${sole}"/>`).join("")}`;
const sneaker = (c, accent) => `<path d="M -30 478 C -28 450, 8 450, 34 472 L 34 484 L -30 484 Z" fill="${c}" ${S}/><path d="M -30 476 L 34 476" stroke="${accent}" stroke-width="7"/>`;
const hightop = (c, accent) => `<path d="M -26 484 L -26 440 L 6 440 L 10 462 C 24 466, 34 472, 34 484 Z" fill="${c}" ${S}/><path d="M -26 476 L 34 476" stroke="${accent}" stroke-width="7"/>`;
const FEET = [
  ["cleat_blue", "Blue Cleats", "common", cleat(BLUE)], ["cleat_gold", "Gold Cleats", "rare", cleat("#ffc82c", BLUE)],
  ["cleat_white", "White Cleats", "common", cleat("#f5f5f2", BLUE)], ["cleat_black", "Black Cleats", "common", cleat("#222")],
  ["cleat_red", "Red Cleats", "common", cleat("#e5484d")], ["cleat_neon", "Neon Cleats", "rare", cleat("#c6ff3d", "#111")],
  ["cleat_pink", "Pink Cleats", "rare", cleat("#ff6fae")], ["cleat_chrome", "Chrome Cleats", "epic", cleat("#cfd6e0", "#fff")],
  ["cleat_fire", "Flaming Cleats", "legendary", cleat("#ff6a1a", "#ffe14d") + `<path d="M -34 470 C -46 456, -40 440, -48 428 C -30 440, -26 452, -24 466 Z" fill="#ffd400" ${S6}/>`],
  ["cleat_ice", "Ice Cleats", "legendary", cleat("#bfefff", "#fff") + `<path d="M -20 446 l 4 -10 l 4 10 M 10 448 l 4 -10 l 4 10" stroke="#fff" stroke-width="3"/>`],
  ["sneaker_red", "Retro Sneakers", "common", sneaker("#fff", "#e5484d")], ["sneaker_blue", "Blue Runners", "common", sneaker(BLUE, GOLD)],
  ["hightop_gold", "Gold High-Tops", "rare", hightop("#ffc82c", BLUE)], ["hightop_blue", "Blue High-Tops", "rare", hightop(BLUE, "#fff")],
  ["slides", "Slides & Socks", "common", `<rect x="-24" y="440" width="44" height="34" rx="8" fill="#fff" ${S6}/><path d="M -30 474 L 34 474 L 34 484 L -30 484 Z" fill="#222" ${S6}/><rect x="-28" y="460" width="56" height="12" fill="${BLUE}" ${S6}/>`],
  ["socks_striped", "Striped Tube Socks", "common", `<rect x="-14" y="420" width="28" height="56" fill="#fff" ${S6}/><path d="M -14 432 l 28 0 M -14 442 l 28 0" stroke="${BLUE}" stroke-width="5"/><path d="M -24 484 C -24 470, 10 466, 30 478 L 30 484 Z" fill="#fff" ${S6}/>`],
  ["cowboy_boots", "Cowboy Boots", "rare", `<path d="M -22 484 L -22 432 L 14 432 L 14 462 C 30 466, 38 474, 38 484 Z" fill="#8a5a3c" ${S}/><path d="M -16 446 q 14 10 28 0" stroke="#d9b37a" stroke-width="4" fill="none"/>`],
  ["rainboots", "Rain Boots", "common", `<path d="M -22 484 L -22 436 L 14 436 L 14 466 C 28 468, 34 476, 34 484 Z" fill="#ffd400" ${S}/>`],
  ["flipflops", "Flip-Flops", "common", `<path d="M -26 484 L 30 484 L 30 478 L -26 478 Z" fill="#2ec4b6" ${S6}/><path d="M 0 478 L -10 462 M 0 478 L 12 462" stroke="#ff6fae" stroke-width="5"/>`],
  ["skates", "Roller Skates", "epic", `<path d="M -22 470 L -22 432 L 14 432 L 14 452 C 28 456, 34 462, 34 470 Z" fill="#ff6fae" ${S}/><circle cx="-14" cy="480" r="8" fill="#ffd400" ${S6}/><circle cx="22" cy="480" r="8" fill="#ffd400" ${S6}/>`],
  ["bunny", "Bunny Slippers", "epic", `<ellipse cx="4" cy="472" rx="32" ry="16" fill="#fff" ${S}/><path d="M -6 460 C -14 430, -2 426, 0 456 M 12 460 C 10 430, 24 430, 18 460" fill="#fff" ${S6}/><circle cx="22" cy="470" r="3" fill="${OUT}"/>`],
  ["clown", "Clown Shoes", "epic", `<ellipse cx="14" cy="474" rx="46" ry="14" fill="#e5484d" ${S}/>`],
  ["heels", "Gold Heels", "epic", `<path d="M -24 484 L -20 466 C -4 456, 20 462, 32 478 L 32 484 Z" fill="#ffc82c" ${S6}/><path d="M -20 470 L -24 484" stroke="#ffc82c" stroke-width="6"/>`],
  ["wings", "Winged Sneakers", "legendary", sneaker("#fff", GOLD) + `<path d="M -28 462 C -48 446, -52 430, -40 424 C -36 438, -30 446, -22 452 Z" fill="#fff" ${S6}/>`],
  ["rocket", "Rocket Boots", "legendary", `<path d="M -22 470 L -22 432 L 14 432 L 14 470 Z" fill="#9aa3b2" ${S}/><path d="M -16 470 L -4 500 L 8 470 Z" fill="#ff6a1a"/>`],
  ["gold_hooves", "Gold-Plated Hooves", "mythic", `<path d="M -22 472 q 22 -18 44 0 l 0 12 l -44 0 Z" fill="#ffc82c" ${S}/><path d="M -12 466 l 8 0" stroke="#fff" stroke-width="4"/>`],
  ["boots_work", "Work Boots", "common", `<path d="M -22 484 L -22 440 L 14 440 L 16 462 C 30 466, 36 474, 36 484 Z" fill="#a8703f" ${S}/><path d="M -22 478 L 36 478" stroke="#3a2412" stroke-width="7"/>`],
  ["crocs", "Foam Clogs", "rare", `<path d="M -26 484 C -26 460, 16 456, 34 476 L 34 484 Z" fill="#5ee08f" ${S}/>${[-14, -2, 10].map((x) => `<circle cx="${x}" cy="470" r="3" fill="${OUT}"/>`).join("")}`],
];
for (const [k, n, r, svg] of FEET) item(`feet_${k}`, n, "feet", r, { svg });

// ---------- GEAR (~30): body-attached, may depend on body shape ----------
const pads = (c, trim) => (b) => b.shoulders.map(([x, y], i) => {
  const s = i ? -1 : 1;
  return `<path d="M ${x + 40 * s} ${y - 6} C ${x} ${y - 30}, ${x - 40 * s} ${y - 10}, ${x - 44 * s} ${y + 26} C ${x - 20 * s} ${y + 20}, ${x + 20 * s} ${y + 20}, ${x + 40 * s} ${y + 20} Z" fill="${c}" ${S}/>${trim ? `<path d="M ${x - 30 * s} ${y + 4} q ${30 * s} -14 ${60 * s} -4" stroke="${trim}" stroke-width="5" fill="none"/>` : ""}`;
}).join("");
const gloves = (c) => (b) => [b.handL, b.handR].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${b.arm * 0.7 + 6}" fill="${c}" ${S}/>`).join("");
const bands = (c) => (b) => [b.handL, b.handR].map(([x, y]) => `<rect x="${x - b.arm / 2 - 4}" y="${y - 30}" width="${b.arm + 8}" height="12" rx="4" fill="${c}" ${S6}/>`).join("");
const wings = (c, tip) => `<path d="M 200 330 C 120 250, 40 280, 30 200 C 90 230, 120 210, 150 260 C 120 230, 70 250, 60 300 C 120 300, 160 340, 200 360 Z" fill="${c}" ${S}/>${mirror(`<path d="M 200 330 C 120 250, 40 280, 30 200 C 90 230, 120 210, 150 260 C 120 230, 70 250, 60 300 C 120 300, 160 340, 200 360 Z" fill="${c}" ${S}/>`)}${tip || ""}`;
const GEAR = [
  ["pads_blue", "Blue Shoulder Pads", "common", { fn: pads(BLUE, GOLD) }], ["pads_gold", "Gold Shoulder Pads", "rare", { fn: pads("#ffc82c", BLUE) }],
  ["pads_white", "White Shoulder Pads", "common", { fn: pads("#f5f5f2", BLUE) }], ["pads_black", "Black Shoulder Pads", "common", { fn: pads("#222", "#9aa3b2") }],
  ["pads_chrome", "Chrome Shoulder Pads", "epic", { fn: pads("#cfd6e0", "#fff") }], ["pads_hof", "Hall of Fame Pads", "legendary", { fn: pads("#ffc82c", "#fff6c2") }],
  ["gloves_blue", "Blue Gloves", "common", { fn: gloves(BLUE) }], ["gloves_gold", "Gold Gloves", "rare", { fn: gloves("#ffc82c") }],
  ["gloves_white", "White Gloves", "common", { fn: gloves("#f5f5f2") }], ["gloves_red", "Red Gloves", "common", { fn: gloves("#e5484d") }],
  ["bands_blue", "Blue Sweatbands", "common", { fn: bands(BLUE) }], ["bands_gold", "Gold Sweatbands", "common", { fn: bands(GOLD) }],
  ["belt_ref", "Ref Belt + Flag", "rare", { fn: (b) => `<rect x="170" y="${b.belt - 10}" width="172" height="16" fill="#111" ${S6}/><path d="M 300 ${b.belt - 4} C 306 ${b.belt + 20}, 316 ${b.belt + 26}, 324 ${b.belt + 16} L 318 ${b.belt - 4} Z" fill="#ffd400" ${S6}/>` }],
  ["belt_champ", "Championship Belt", "legendary", { fn: (b) => `<rect x="160" y="${b.belt - 14}" width="192" height="24" fill="#111" ${S6}/><ellipse cx="256" cy="${b.belt - 2}" rx="44" ry="28" fill="#ffc82c" ${S}/>${RAM_ICON(256, b.belt - 4, 0.45, BLUE)}` }],
  ["hip_towel", "Hip Towel", "common", { fn: (b) => `<path d="M 300 ${b.belt - 8} L 324 ${b.belt - 8} L 330 ${b.belt + 50} L 304 ${b.belt + 50} Z" fill="#fff" ${S6}/>` }],
  ["fanny", "Fanny Pack", "rare", { fn: (b) => `<rect x="214" y="${b.belt - 10}" width="84" height="34" rx="12" fill="#ff6fae" ${S6}/><path d="M 170 ${b.belt - 4} L 342 ${b.belt - 4}" stroke="#222" stroke-width="6"/>` }],
  ["knee", "Knee Brace", "common", { fn: (b) => `<rect x="${b.legs[0] - 18}" y="440" width="36" height="16" rx="5" fill="#222" ${S6}/>` }],
  ["elbow", "Arm Sleeve", "common", { fn: (b) => `<path d="${b.armR}" stroke="#222" stroke-width="${b.arm - 2}" fill="none" stroke-dasharray="1 0" stroke-linecap="round" opacity=".85"/>` }],
  ["backpack", "Backpack", "common", { behind: `<rect x="176" y="296" width="160" height="120" rx="30" fill="#e5484d" ${S}/>` }],
  ["jetpack", "Jetpack", "legendary", { behind: `<rect x="170" y="290" width="70" height="120" rx="20" fill="#9aa3b2" ${S}/><rect x="272" y="290" width="70" height="120" rx="20" fill="#9aa3b2" ${S}/><path d="M 190 410 L 205 470 L 220 410 Z M 292 410 L 307 470 L 322 410 Z" fill="#ff6a1a"/>` }],
  ["wings_angel", "Angel Wings", "legendary", { behind: wings("#fff") }], ["wings_devil", "Devil Wings", "epic", { behind: wings("#7a1a1a") }],
  ["wings_gold", "Golden Wings", "mythic", { behind: wings("#ffc82c") }],
  ["tail_bow", "Tail Bow", "common", { behind: `<path d="M 330 400 C 370 400, 380 380, 372 366" stroke="${OUT}" stroke-width="20" fill="none" stroke-linecap="round"/><path d="M 360 372 L 346 358 L 374 356 Z M 360 372 L 388 382 L 374 356 Z" fill="#ff6fae" ${S6}/>` }],
  ["aura_gold", "Champion Aura", "legendary", { behind: `<circle cx="256" cy="280" r="220" fill="#ffd400" opacity=".18"/><circle cx="256" cy="280" r="186" fill="none" stroke="#ffd400" stroke-width="10" stroke-dasharray="2 22" stroke-linecap="round"/>` }],
  ["aura_blue", "Royal Aura", "epic", { behind: `<circle cx="256" cy="280" r="220" fill="#5b8cff" opacity=".2"/>` }],
  ["spotlight", "Spotlight", "rare", { behind: `<path d="M 200 0 L 312 0 L 420 512 L 92 512 Z" fill="#fff" opacity=".12"/>` }],
  ["confetti_fx", "Confetti Burst", "rare", { front: Array.from({ length: 30 }, (_, i) => `<rect x="${(i * 67) % 500}" y="${(i * 41) % 300}" width="10" height="5" fill="${[GOLD, BLUE, "#ff5ec4", "#5ee08f"][i % 4]}" transform="rotate(${i * 37} ${(i * 67) % 500} ${(i * 41) % 300})"/>`).join("") }],
  ["sweat", "Game-Day Sweat", "common", { front: `<path d="M 340 170 q 8 14 0 22 q -8 -8 0 -22 Z M 180 200 q 6 10 0 16 q -6 -6 0 -16 Z" fill="#7fd0ff" ${S6}/>` }],
];
for (const [k, n, r, art] of GEAR) item(`gear_${k}`, n, "gear", r, art);

// ---------- TATTOOS (~15) & MARKS (~15) ----------
const TATTOOS = [
  ["ram_bicep", "Ram Bicep Tattoo", "rare", (b) => RAM_ICON(b.bicepR[0], b.bicepR[1], 0.42, "#1f2a5a")],
  ["ram_chest", "Ram Chest Piece", "epic", (b) => RAM_ICON(b.chest[0], b.chest[1] - 10, 0.9, "#1f2a5a")],
  ["mom", "MOM Heart", "rare", (b) => `<path d="M ${b.bicepL[0]} ${b.bicepL[1] + 14} C ${b.bicepL[0] - 22} ${b.bicepL[1]}, ${b.bicepL[0] - 12} ${b.bicepL[1] - 18}, ${b.bicepL[0]} ${b.bicepL[1] - 6} C ${b.bicepL[0] + 12} ${b.bicepL[1] - 18}, ${b.bicepL[0] + 22} ${b.bicepL[1]}, ${b.bicepL[0]} ${b.bicepL[1] + 14} Z" fill="#c0392b" opacity=".85"/>${txt("MOM", b.bicepL[0], b.bicepL[1] + 2, 9, "#fff")}`],
  ["whose_chest", "WHOSE HOUSE Ink", "legendary", (b) => txt("WHOSE", b.chest[0], b.chest[1] - 2, 22, "#1f2a5a") + txt("HOUSE", b.chest[0], b.chest[1] + 22, 22, "#1f2a5a")],
  ["flames", "Flame Forearms", "epic", (b) => [b.handL, b.handR].map(([x, y]) => `<path d="M ${x - 8} ${y - 14} C ${x - 14} ${y - 30}, ${x} ${y - 36}, ${x - 4} ${y - 50} C ${x + 10} ${y - 36}, ${x + 10} ${y - 24}, ${x + 6} ${y - 14} Z" fill="#ff6a1a" opacity=".85"/>`).join("")],
  ["stars", "Star Shoulders", "rare", (b) => b.shoulders.map(([x, y]) => `<path d="M ${x} ${y + 4} l 4 9 l 10 1 l -8 6 l 3 10 l -9 -6 l -9 6 l 3 -10 l -8 -6 l 10 -1 Z" fill="#1f2a5a" opacity=".85"/>`).join("")],
  ["tribal", "Tribal Band", "rare", (b) => `<path d="M ${b.bicepR[0] - 16} ${b.bicepR[1]} q 8 -10 16 0 q 8 10 16 0" stroke="#1f2a5a" stroke-width="7" fill="none"/>`],
  ["twelve", "Number 12", "common", (b) => txt("12", b.bicepR[0], b.bicepR[1] + 8, 22, "#1f2a5a")],
  ["goat_ink", "GOAT Ink", "epic", (b) => txt("GOAT", b.bicepL[0], b.bicepL[1] + 6, 14, "#1f2a5a")],
  ["la", "LA Script", "rare", (b) => txt("LA", b.bicepL[0], b.bicepL[1] + 8, 22, "#1f2a5a")],
  ["horns_back", "Horn Shoulder Ink", "epic", (b) => b.shoulders.map(([x, y], i) => `<path d="M ${x} ${y + 30} c ${i ? 10 : -10} -14, ${i ? 24 : -24} -10, ${i ? 20 : -20} 4" stroke="#1f2a5a" stroke-width="6" fill="none"/>`).join("")],
  ["money_ink", "Dollar Sign", "common", (b) => txt("$", b.bicepR[0], b.bicepR[1] + 10, 28, "#1a7a3a")],
  ["full_sleeve", "Full Sleeve", "legendary", (b) => `<path d="${b.armR}" stroke="#1f2a5a" stroke-width="${b.arm - 6}" fill="none" stroke-dasharray="6 6" stroke-linecap="round" opacity=".55"/>`],
];
for (const [k, n, r, fn] of TATTOOS) item(`tattoo_${k}`, n, "tattoo", r, { fn });
const MARKS = [
  ["bite_arm", "Bite Marks (Arm)", "rare", (b) => `<g transform="translate(${b.bicepR[0]},${b.bicepR[1] + 14})"><path d="M -14 -4 q 14 -10 28 0 M -14 6 q 14 10 28 0" stroke="#c0392b" stroke-width="4" fill="none" stroke-dasharray="3 3"/></g>`],
  ["bite_leg", "Bite Marks (Leg)", "rare", (b) => `<g transform="translate(${b.legs[1]},446)"><path d="M -12 -4 q 12 -8 24 0 M -12 6 q 12 8 24 0" stroke="#c0392b" stroke-width="4" fill="none" stroke-dasharray="3 3"/></g>`],
  ["bite_ear", "Chewed Ear", "epic", () => `<path d="M 112 340 l 8 -8 l 4 10 l 8 -8" stroke="${OUT}" stroke-width="5" fill="none"/>`, true],
  ["scar_eye", "Eye Scar", "rare", () => `<path d="M 300 214 L 282 294" stroke="#8a2a2a" stroke-width="6"/><path d="M 286 236 l 12 4 M 284 256 l 12 4 M 282 276 l 12 4" stroke="#8a2a2a" stroke-width="3"/>`, true],
  ["stitches", "Cheek Stitches", "rare", () => `<path d="M 196 292 L 224 312" stroke="#8a2a2a" stroke-width="4"/><path d="M 200 290 l 6 10 M 208 296 l 6 10 M 216 302 l 6 10" stroke="${OUT}" stroke-width="3"/>`, true],
  ["bandaid", "Nose Band-Aid", "common", () => `<rect x="234" y="292" width="44" height="16" rx="6" fill="#f2c79a" ${S6}/>`, true],
  ["blackeye", "Black Eye", "common", () => `<ellipse cx="222" cy="256" rx="30" ry="30" fill="#5b3a7a" opacity=".45"/>`, true],
  ["bandage_horn", "Taped Horn", "rare", () => `<path d="M 80 180 l 24 -10 M 84 196 l 24 -10" stroke="#fff" stroke-width="10"/>`, true],
  ["paint_split", "Blue & Gold Face Paint", "rare", () => `<path d="M 256 140 L 256 380 L 182 300 L 176 204 Z" fill="${BLUE}" opacity=".55"/><path d="M 256 140 L 256 380 L 330 300 L 336 204 Z" fill="${GOLD}" opacity=".55"/>`, true],
  ["paint_stripes", "War Paint", "common", () => `<path d="M 196 280 l 40 -6 M 196 296 l 40 -6 M 316 280 l -40 -6 M 316 296 l -40 -6" stroke="${GOLD}" stroke-width="7" stroke-linecap="round"/>`, true],
  ["glitter", "Glitter Cheeks", "rare", () => [[206, 292], [306, 292], [214, 304], [298, 304]].map(([x, y]) => `<path d="M ${x} ${y - 6} l 2 6 l 6 2 l -6 2 l -2 6 l -2 -6 l -6 -2 l 6 -2 Z" fill="#fff6c2"/>`).join(""), true],
  ["freckles", "Freckles", "common", () => [[206, 296], [214, 288], [218, 300], [294, 288], [298, 300], [306, 294]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#8a5a3c"/>`).join(""), true],
  ["blush", "Rosy Cheeks", "common", () => `<ellipse cx="206" cy="294" rx="16" ry="9" fill="#ff8fb0" opacity=".6"/><ellipse cx="306" cy="294" rx="16" ry="9" fill="#ff8fb0" opacity=".6"/>`, true],
  ["grass", "Grass Stains", "common", (b) => `<path d="M ${b.legs[0] - 10} 452 q 10 -6 20 0" stroke="#2f7d3a" stroke-width="8" fill="none" opacity=".7"/>`],
  ["mud", "Mud Splatter", "common", (b) => `<circle cx="${b.chest[0] - 30}" cy="${b.chest[1] + 30}" r="12" fill="#6b4423" opacity=".7"/><circle cx="${b.chest[0] + 34}" cy="${b.chest[1] + 10}" r="8" fill="#6b4423" opacity=".7"/>`],
];
for (const [k, n, r, fn, face] of MARKS) item(`marks_${k}`, n, "marks", r, { fn, face: !!face });

// ---------- BACKGROUNDS (~30) ----------
const stars = (n, c = "#fff") => Array.from({ length: n }, (_, i) => `<circle cx="${(i * 97) % 500 + 6}" cy="${(i * 53) % 320 + 8}" r="${(i % 3) + 1.5}" fill="${c}" opacity="${0.4 + (i % 4) * 0.15}"/>`).join("");
const rays = (c1, c2, n = 16) => `<rect width="512" height="512" fill="${c1}"/>` + Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2, b2 = a + Math.PI / n, p = (t) => `${256 + Math.cos(t) * 520},${250 + Math.sin(t) * 520}`;
  return `<path d="M 256 250 L ${p(a)} L ${p(b2)} Z" fill="${c2}"/>`;
}).join("");
const solid = (c, c2) => `<rect width="512" height="512" fill="${c}"/><circle cx="256" cy="230" r="210" fill="${c2}"/>`;
const turfLines = `<rect width="512" height="512" fill="#2f7d3a"/>${[90, 190, 290, 390].map((y) => `<rect y="${y}" width="512" height="7" fill="#fff" opacity=".22"/>`).join("")}`;
const BGS = [
  ["navy", "Navy", "common", solid("#1b2440", "#243258")], ["royal", "Royal", "common", solid("#1f3fa0", "#2a52c4")], ["gold", "Gold", "common", solid("#e0a000", "#ffb81c")],
  ["white", "Clean White", "common", solid("#e9eef7", "#ffffff")], ["black", "Blackout", "common", solid("#111", "#1c1c1c")], ["red", "Red Zone", "common", solid("#8a1a1a", "#b02424")],
  ["turf", "Turf", "common", turfLines], ["endzone", "End Zone", "rare", `<rect width="512" height="512" fill="${BLUE}"/>${txt("RAMS", 256, 140, 110, GOLD)}<rect y="300" width="512" height="212" fill="#2f7d3a"/>`],
  ["night", "Night Game", "rare", `<rect width="512" height="512" fill="#0b1026"/>${stars(30)}<circle cx="430" cy="80" r="34" fill="#fdf3c7"/><circle cx="444" cy="70" r="30" fill="#0b1026"/>`],
  ["lights", "Stadium Lights", "rare", `<rect width="512" height="512" fill="#141a33"/>${[60, 180, 330, 450].map((x) => `<circle cx="${x}" cy="60" r="26" fill="#fff6c2"/><path d="M ${x - 26} 60 L ${x - 120} 512 L ${x + 120} 512 L ${x + 26} 60 Z" fill="#fff6c2" opacity=".07"/>`).join("")}`],
  ["sunset", "Stadium Sunset", "rare", `<defs><linearGradient id="bg_sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1d6e"/><stop offset=".55" stop-color="#d9467a"/><stop offset="1" stop-color="#ffb347"/></linearGradient></defs><rect width="512" height="512" fill="url(#bg_sun)"/><circle cx="256" cy="430" r="120" fill="#ffd36b" opacity=".55"/>`],
  ["beach", "Beach Day", "rare", `<rect width="512" height="512" fill="#7fd0ff"/><circle cx="420" cy="90" r="46" fill="#ffd84a"/><rect y="360" width="512" height="152" fill="#f2d49b"/><path d="M 0 360 Q 128 340 256 360 T 512 360 L 512 380 L 0 380 Z" fill="#2ec4b6"/>`],
  ["snow", "Snow Game", "rare", `<rect width="512" height="512" fill="#9fb4cf"/>${stars(60, "#fff")}<rect y="420" width="512" height="92" fill="#f4f8ff"/>`],
  ["rain", "Rain Game", "rare", `<rect width="512" height="512" fill="#3d4a5c"/>${Array.from({ length: 40 }, (_, i) => `<path d="M ${(i * 53) % 512} ${(i * 31) % 512} l -6 18" stroke="#9fc3ff" stroke-width="3" opacity=".6"/>`).join("")}`],
  ["clouds", "Blue Sky", "common", `<rect width="512" height="512" fill="#8ccfff"/>${[[100, 100], [360, 70], [250, 160]].map(([x, y]) => `<g fill="#fff"><circle cx="${x}" cy="${y}" r="30"/><circle cx="${x + 30}" cy="${y - 10}" r="36"/><circle cx="${x + 62}" cy="${y}" r="28"/></g>`).join("")}`],
  ["scoreboard", "Scoreboard", "epic", `<rect width="512" height="512" fill="#0d0d12"/><rect x="40" y="30" width="432" height="140" rx="10" fill="#1d1d26" ${S}/>${txt("RAMS", 150, 96, 40, GOLD)}${txt("99", 150, 150, 46, "#ff4d4d")}${txt("00", 362, 150, 46, "#ff4d4d")}`],
  ["confetti", "Confetti", "epic", `<rect width="512" height="512" fill="#1b2440"/>${Array.from({ length: 60 }, (_, i) => `<rect x="${(i * 67) % 512}" y="${(i * 41) % 512}" width="12" height="6" fill="${[GOLD, "#5b8cff", "#ff5ec4", "#5ee08f", "#fff"][i % 5]}" transform="rotate(${i * 37} ${(i * 67) % 512} ${(i * 41) % 512})"/>`).join("")}`],
  ["money", "Money Rain", "epic", `<rect width="512" height="512" fill="#123d22"/>${Array.from({ length: 24 }, (_, i) => `<g transform="translate(${(i * 83) % 480},${(i * 57) % 470}) rotate(${(i * 29) % 60 - 30})"><rect width="50" height="26" rx="3" fill="#5ee08f" ${S6}/>${txt("$", 25, 20, 18, "#1f7a3a")}</g>`).join("")}`],
  ["rays", "Golden Rays", "epic", rays("#ffb400", "#ffd34d")], ["blue_rays", "Royal Rays", "epic", rays("#1f3fa0", "#3d63d6")],
  ["fire", "On Fire", "epic", `<rect width="512" height="512" fill="#2a0a05"/>${Array.from({ length: 9 }, (_, i) => `<path d="M ${i * 64 - 20} 512 C ${i * 64 - 30} 400, ${i * 64 + 20} 380, ${i * 64 + 10} 300 C ${i * 64 + 60} 380, ${i * 64 + 70} 440, ${i * 64 + 60} 512 Z" fill="${i % 2 ? "#ff6a1a" : "#ffb02e"}"/>`).join("")}`],
  ["neon", "Neon Grid", "epic", `<rect width="512" height="512" fill="#12002b"/>${Array.from({ length: 12 }, (_, i) => `<path d="M 0 ${280 + i * i * 2.4} L 512 ${280 + i * i * 2.4}" stroke="#ff2fa0" stroke-width="2"/><path d="M 256 280 L ${-400 + i * 120} 512" stroke="#2fd8ff" stroke-width="2"/>`).join("")}<circle cx="256" cy="200" r="90" fill="#ff9a3c"/>`],
  ["galaxy", "Galaxy", "legendary", `<rect width="512" height="512" fill="#0a0620"/>${stars(70)}<circle cx="160" cy="160" r="140" fill="#6b3cff" opacity=".25"/><circle cx="380" cy="320" r="160" fill="#ff2fa0" opacity=".15"/>`],
  ["storm", "Lightning Storm", "legendary", `<rect width="512" height="512" fill="#1a0f33"/><path d="M 70 20 L 40 150 L 80 150 L 50 270 L 140 120 L 96 120 L 128 20 Z" fill="#ffd400" ${S}/><path d="M 450 40 L 420 160 L 456 160 L 430 260 L 500 140 L 466 140 L 492 40 Z" fill="#ffd400" ${S}/>`],
  ["trophy_room", "Trophy Room", "legendary", `<rect width="512" height="512" fill="#3a2412"/><rect y="200" width="512" height="14" fill="#6b4423"/>${[60, 160, 360, 460].map((x) => `<path d="M ${x - 18} 150 L ${x + 18} 150 L ${x + 14} 180 C ${x + 10} 192, ${x - 10} 192, ${x - 14} 180 Z" fill="#ffc82c" ${S6}/><rect x="${x - 12}" y="190" width="24" height="10" fill="#ffc82c"/>`).join("")}`],
  ["hall", "Hall of Fame", "legendary", rays("#2b1a05", "#4a3210", 24) + `<rect x="40" y="20" width="432" height="60" rx="8" fill="#ffc82c" ${S}/>${txt("GOAT", 256, 66, 40, OUT)}`],
  ["holo_bg", "Prism", "mythic", `<defs><linearGradient id="bg_holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5ec4"/><stop offset=".25" stop-color="#ffd84a"/><stop offset=".5" stop-color="#6bff9a"/><stop offset=".75" stop-color="#4ad8ff"/><stop offset="1" stop-color="#a66bff"/></linearGradient></defs><rect width="512" height="512" fill="url(#bg_holo)"/>${stars(30)}`],
  ["la_skyline", "City Skyline", "rare", `<rect width="512" height="512" fill="#ff9a6b"/><circle cx="256" cy="360" r="120" fill="#ffd36b"/>${[[20, 80], [70, 140], [120, 100], [170, 190], [220, 120], [290, 220], [350, 110], [400, 160], [450, 90]].map(([x, h]) => `<rect x="${x}" y="${420 - h}" width="44" height="${h + 100}" fill="#3b1d4e"/>`).join("")}<rect x="470" y="380" width="8" height="140" fill="#3b1d4e"/>`],
];
for (const [k, n, r, svg] of BGS) item(`bg_${k}`, n, "bg", r, { svg });

// ---------- POSES: arm angles in degrees at the shoulder (L positive = up and out, R mirrored), plus sway ----------
export const POSES = {
  idle: { L: 0, R: 0, s: 6 },
};
const POSE_LIST = [
  ["hips", "Hands on Hips", "common", -30, 30, 2], ["shrug", "Shrug", "common", 45, -45, 6], ["wave", "Wave", "common", 0, -150, 18],
  ["fist", "Fist Pump", "rare", 0, -150, 10], ["flex", "Flex", "rare", 95, -95, 4], ["point", "We're #1", "rare", 0, -160, 3],
  ["td", "Touchdown", "rare", 158, -158, 3], ["roof", "Raise the Roof", "epic", 140, -140, 14], ["hype", "Hype Arms", "epic", 120, -120, 26],
  ["victory", "Victory V", "legendary", 130, -130, 5],
];
for (const [k, n, r, L, R, sw] of POSE_LIST) { POSES[k] = { L, R, s: sw }; item(`pose_${k}`, n, "pose", r); }

// ---------- FINISHES (whole-ram art styles) ----------
export const FINISHES = { flat: "Flat", bold: "Bold Cartoon", street: "Street", sticker: "Sticker", holo: "Holo Sticker", uncanny: "Uncanny" };
item("finish_flat", "Flat Finish", "finish", "common");
item("finish_bold", "Bold Cartoon Finish", "finish", "rare");
item("finish_street", "Street Finish", "finish", "epic");
item("finish_sticker", "Sticker Finish", "finish", "legendary");
item("finish_holo", "Holo Sticker Finish", "finish", "mythic");
item("finish_uncanny", "Uncanny Finish", "finish", "secret");   // never listed in odds

export const SLOTS = ["base", "pose", "bg","fleece", "horns", "shirt", "head", "eyes", "mouth", "neck", "hand", "feet", "gear", "tattoo", "marks", "finish"];
export const SLOT_NAMES = { base: "Base", pose: "Pose", bg: "Background", fleece: "Fleece", horns: "Horns", shirt: "Shirt", head: "Head", eyes: "Eyes", mouth: "Mouth",
  neck: "Neck", hand: "Hand", feet: "Feet", gear: "Gear", tattoo: "Tattoo", marks: "Marks", finish: "Finish" };

// ---------- render ----------
const HEAD_T = "translate(256,186) scale(.78) translate(-256,-250)";
const TUFT = [[220, 152, 28], [256, 140, 32], [292, 152, 28], [238, 172, 24], [274, 172, 24], [200, 172, 18], [312, 172, 18]];
const GIRL_BUST = `<path d="M 206 346 C 214 372, 246 372, 254 352 M 258 352 C 266 372, 298 372, 306 346" fill="none" stroke="${OUT}" stroke-width="6" stroke-linecap="round" opacity=".75"/>
  <ellipse cx="228" cy="344" rx="22" ry="14" fill="#fff" opacity=".12"/><ellipse cx="284" cy="344" rx="22" ry="14" fill="#fff" opacity=".12"/>`;

// Idle loop, 3.2s: body bounces twice, head tilts side to side, arms sway, one blink.
// renderRam(look, size, t) draws frame t (0..1) for GIFs; renderRam(look, size, "css") returns an
// SVG that animates itself in a browser; no t = still pose.
export const LOOP_MS = 3200;
const moves = (t, pose) => {
  const p = 2 * Math.PI * t;
  return { bob: -3.5 * (1 - Math.cos(2 * p)), tilt: 5 * Math.sin(p), armR: -pose.s * Math.sin(2 * p), armL: pose.s * Math.sin(2 * p), blink: t >= 0.72 && t < 0.78 };
};
const pivot = (d) => d.match(/M\s*([\d.]+)\s+([\d.]+)/).slice(1).map(Number);

/** Re-aim the arms for a pose: straight-ish arm from the shoulder at the pose angle, longer when raised. */
function poseArms(b, pose) {
  const out = { ...b, upL: Math.abs(pose.L) >= 90, upR: Math.abs(pose.R) >= 90 };
  for (const [side, ang] of [["L", pose.L], ["R", pose.R]]) {
    if (!ang) continue;
    const [px, py] = pivot(b["arm" + side]), [hx, hy] = b["hand" + side];
    const a = (ang * Math.PI) / 180, vx = hx - px, vy = hy - py, len = Math.hypot(vx, vy) * (Math.abs(ang) >= 90 ? 1.8 : 1);
    const ux = (vx * Math.cos(a) - vy * Math.sin(a)) / Math.hypot(vx, vy), uy = (vx * Math.sin(a) + vy * Math.cos(a)) / Math.hypot(vx, vy);
    const ex = px + ux * len, ey = py + uy * len, bend = side === "L" ? -14 : 14;   // elbow bows outward
    const cx = px + ux * len * 0.5 - uy * bend, cy = py + uy * len * 0.5 + ux * bend;
    const f = (n) => n.toFixed(1);
    out["arm" + side] = `M ${px} ${py} Q ${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
    out["upper" + side] = `M ${px} ${py} Q ${f(px + (cx - px) * 0.45)} ${f(py + (cy - py) * 0.45)} ${f(px + ux * len * 0.42)} ${f(py + uy * len * 0.42)}`;
    out["hand" + side] = [ex, ey];
  }
  return out;
}

export function renderRam(look = {}, size = 512, t = null) {
  const I = (slot) => ITEMS[look[slot]];
  let body = BODIES[(look.body || "").replace("body_", "")] || BODIES.med;
  const pose = POSES[(look.pose || "").replace("pose_", "")] || POSES.idle;
  body = poseArms(body, pose);
  const css = t === "css", m = moves(typeof t === "number" ? t : 0, pose);
  const [pLx, pLy] = pivot(body.armL), [pRx, pRy] = pivot(body.armR);
  // a group that moves: either a fixed transform for this frame, or a CSS animation class
  const mv = (cls, transform, origin = "", vars = "") => css ? `class="a-${cls}" style="${origin ? `transform-origin:${origin};` : ""}${vars}"` : `transform="${transform}"`;
  const gBob = mv("bob", `translate(0 ${m.bob.toFixed(2)})`);
  const gHead = mv("head", `rotate(${m.tilt.toFixed(2)} 256 300)`, "256px 300px");
  const gArmR = mv("armR", `rotate(${m.armR.toFixed(2)} ${pRx} ${pRy})`, `${pRx}px ${pRy}px`, `--b:0deg;--s:${pose.s}deg`);
  const gArmL = mv("armL", `rotate(${m.armL.toFixed(2)} ${pLx} ${pLy})`, `${pLx}px ${pLy}px`, `--b:0deg;--s:${-pose.s}deg`);
  const girl = look.base === "girl" || look.base === "base_girl";
  const faceC = FACES[look.face] || FACES.tan;
  const fleeceItem = I("fleece") || ITEMS.fleece_cream;
  const fleece = fleeceItem.fill;
  const shirtItem = I("shirt");
  const design = shirtItem?.design, cut = shirtItem?.cut;
  const finish = (I("finish")?.id || "finish_bold").replace("finish_", "");
  const uncanny = finish === "uncanny";
  const [lx, rx] = body.legs;
  const defs = new Set();
  for (const s of SLOTS) { const it = I(s); if (it?.defs) defs.add(it.defs); if (it?.design?.defs) defs.add(it.design.defs); }
  if (fleeceItem.defs) defs.add(fleeceItem.defs);

  const gear = I("gear"), neck = I("neck");
  const legs = [lx, rx].map((x) => `<path d="M ${x} ${body.hip - 6} L ${x} 466" stroke="${OUT}" stroke-width="40" stroke-linecap="round"/>
    <path d="M ${x} ${body.hip - 6} L ${x} 462" stroke="${fleece}" stroke-width="26" stroke-linecap="round"/>`).join("");
  const shoe = I("feet")?.svg || `<path d="M -22 472 q 22 -18 44 0 l 0 12 l -44 0 Z" fill="#3a2a1a" ${S}/>`;
  const feet = [lx, rx].map((x) => `<g transform="translate(${x},0)">${shoe}</g>`).join("");

  // arms: fleece underneath, then sleeves by cut
  const sleeveC = design?.sleeve || design?.fill;
  const armBase = (d) => `<path d="${d}" stroke="${OUT}" stroke-width="${body.arm + 14}" fill="none" stroke-linecap="round"/><path d="${d}" stroke="${fleece}" stroke-width="${body.arm}" fill="none" stroke-linecap="round"/>`;
  const sleeve = (full, upper) => !design || cut === "tank" ? ""
    : `<path d="${cut === "long" ? full : upper}" stroke="${OUT}" stroke-width="${body.arm + 14}" fill="none" stroke-linecap="${cut === "long" ? "round" : "butt"}"/>
       <path d="${cut === "long" ? full : upper}" stroke="${sleeveC}" stroke-width="${body.arm}" fill="none" stroke-linecap="${cut === "long" ? "round" : "butt"}"/>`;
  const hands = [body.handL, body.handR].map(([x, y]) => uncanny
    ? `<path transform="translate(${x},${y})" d="M -12 -8 q -6 18 6 26 q 6 4 10 -2 q 4 6 10 2 q 6 -2 4 -12 q 4 -10 -8 -18 Z" fill="#e2bf98" stroke="#7a5634" stroke-width="2"/>`
    : `<circle cx="${x}" cy="${y}" r="${body.arm * 0.7 + 4}" fill="${faceC}" ${S}/>`);

  const decoBody = { ...body, chest: [body.chest[0], body.chest[1] + (cut === "tank" ? 24 : girl ? 14 : 0)] };
  const id = "c" + Math.random().toString(36).slice(2, 7);
  let torso;
  if (design && cut === "tank") {
    // fleece body first, then the tank clipped to torso ∩ tank shape, then its edge lines
    const tk = tankPath(body);
    torso = `<clipPath id="${id}"><path d="${body.torso}"/></clipPath>
      <path d="${body.torso}" fill="${fleece}"/>${body.skin || ""}
      <g clip-path="url(#${id})"><clipPath id="${id}t"><path d="${tk}"/></clipPath>
        <g clip-path="url(#${id}t)"><rect width="512" height="512" fill="${design.fill}"/>${design.pattern || ""}</g>
        <path d="${tk}" fill="none" stroke="${OUT}" stroke-width="7" stroke-linejoin="round"/></g>
      ${design.deco ? design.deco(decoBody) : ""}
      ${girl ? GIRL_BUST : ""}<path d="${body.torso}" fill="none" ${S}/>`;
  } else if (design) {
    torso = `<clipPath id="${id}"><path d="${body.torso}"/></clipPath><path d="${body.torso}" fill="${design.fill}"/>
      <g clip-path="url(#${id})">${design.pattern || ""}</g>${design.deco ? design.deco(decoBody) : ""}
      ${girl ? GIRL_BUST : ""}<path d="${body.torso}" fill="none" ${S}/>
      <path d="M 228 302 L 256 330 L 284 302" fill="${design.collar}" ${S}/>`;
  } else {
    torso = `<path d="${body.torso}" fill="${fleece}" ${S}/>${body.skin || ""}`;
    if (girl) torso += `<path d="M 200 330 C 214 312, 298 312, 312 330 L 312 372 C 290 384, 222 384, 200 372 Z" fill="#ff6fae" ${S}/>${GIRL_BUST}`;  // sports bra
  }
  const skinVisible = !design || cut === "tank";
  const tattoo = I("tattoo") && skinVisible ? I("tattoo").fn(body) : "";
  const marks = I("marks");
  const eyesBase = uncanny
    ? [222, 290].map((cx) => `<ellipse cx="${cx}" cy="252" rx="24" ry="17" fill="#f6efe4"/><circle cx="${cx + 2}" cy="253" r="11" fill="#7a5a1e"/><circle cx="${cx + 2}" cy="253" r="5" fill="#0a0a0a"/><circle cx="${cx - 2}" cy="248" r="3" fill="#fff"/><path d="M ${cx - 26} 248 Q ${cx} 228 ${cx + 26} 248" fill="${faceC}" stroke="#8a6440" stroke-width="2"/><path d="M ${cx - 25} 254 Q ${cx} 272 ${cx + 25} 254" fill="none" stroke="#9c7650" stroke-width="2.5"/>`).join("")
      + `<path d="M 230 340 Q 256 352 284 339 L 282 344 Q 256 356 232 345 Z" fill="#f4efe2"/>`
    : `<ellipse cx="222" cy="252" rx="22" ry="25" fill="#fff" ${S}/><ellipse cx="290" cy="252" rx="22" ry="25" fill="#fff" ${S}/>
      <circle cx="228" cy="257" r="10" fill="${OUT}"/><circle cx="284" cy="257" r="10" fill="${OUT}"/><circle cx="231" cy="253" r="3.5" fill="#fff"/><circle cx="287" cy="253" r="3.5" fill="#fff"/>
      ${girl ? `<path d="M 198 236 l -10 -8 M 204 230 l -6 -10 M 212 228 l -2 -11 M 314 236 l 10 -8 M 308 230 l 6 -10 M 300 228 l 2 -11" stroke="${OUT}" stroke-width="5" stroke-linecap="round"/>
        <path d="M 200 214 Q 222 204 244 214 M 268 214 Q 290 204 312 214" stroke="${OUT}" stroke-width="8" fill="none" stroke-linecap="round"/>`
        : `<path d="M 194 218 L 246 232 M 318 218 L 266 232" stroke="${OUT}" stroke-width="13" stroke-linecap="round"/>`}`;
  const earOne = `<path d="M 186 292 C 152 300, 116 318, 100 344 C 140 350, 172 334, 192 316 Z" fill="${faceC}" ${S}/><path d="M 176 306 C 154 312, 132 324, 122 336 C 146 338, 166 328, 180 318 Z" fill="#e7a3a0"/>`;
  const head = `<g transform="${HEAD_T}">
    ${earOne}${mirror(earOne)}
    <path d="M 176 204 C 170 160, 210 136, 256 136 C 302 136, 342 160, 336 204 L 330 300 C 326 350, 296 380, 256 380 C 216 380, 186 350, 182 300 Z" fill="${faceC}" ${S}/>
    ${eyesBase}
    ${uncanny ? "" : `<g ${css ? 'class="a-blink"' : `opacity="${m.blink ? 1 : 0}"`}><ellipse cx="222" cy="252" rx="22" ry="25" fill="${faceC}" ${S}/><ellipse cx="290" cy="252" rx="22" ry="25" fill="${faceC}" ${S}/><path d="M 204 256 q 18 10 36 0 M 272 256 q 18 10 36 0" stroke="${OUT}" stroke-width="6" fill="none" stroke-linecap="round"/></g>`}
    <ellipse cx="256" cy="324" rx="60" ry="46" fill="${look.face === "dark" ? "#6a5a52" : "#f1dfc0"}" ${S}/>
    <ellipse cx="238" cy="312" rx="8" ry="6" fill="${OUT}"/><ellipse cx="274" cy="312" rx="8" ry="6" fill="${OUT}"/>
    ${uncanny ? "" : `<path d="M 234 342 Q 258 358 282 336" fill="none" stroke="${OUT}" stroke-width="7" stroke-linecap="round"/>`}
    ${marks?.face ? marks.fn(body) : ""}
    ${I("mouth")?.svg || ""}${I("eyes")?.svg || ""}
    ${hornLayer(I("horns") || ITEMS.horns_curl)}
    ${TUFT.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 5}" fill="${OUT}"/>`).join("")}${TUFT.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fleece}"/>`).join("")}
    ${I("head")?.svg || ""}
  </g>`;

  // gloves and sweatbands ride on the hands, so they move with the arms
  const handGear = /^gear_(gloves|bands)/.test(gear?.id || "");
  const onHand = (side) => handGear ? gear.fn({ ...body, handL: side === "L" ? body.handL : [-999, -999], handR: side === "R" ? body.handR : [-999, -999] }) : "";
  const [hL, hR] = hands;
  const held = I("hand") ? `<g transform="translate(${body.handR[0]},${body.handR[1]})">${I("hand").svg}</g>` : "";
  const armL = `${armBase(body.armL)}${sleeve(body.armL, body.upperL)}`, armR = `${armBase(body.armR)}${sleeve(body.armR, body.upperR)}`;
  // raised arms go in front of the head and horns so they read
  const upper = `${body.upL ? `<g ${gArmL}>${armL}${hL}${onHand("L")}</g>` : ""}${body.upR ? `<g ${gArmR}>${armR}${hR}${onHand("R")}${held}</g>` : ""}`;
  let ram = `${gear?.behind || ""}${neck?.behind || ""}
    ${legs}${feet}
    <g ${gBob}>
      ${body.upL ? "" : `<g ${gArmL}>${armL}</g>`}${body.upR ? "" : `<g ${gArmR}>${armR}</g>`}
      ${torso}${tattoo}${marks && !marks.face ? marks.fn(body) : ""}
      ${gear?.fn && !handGear ? gear.fn(body) : ""}
      ${body.upL ? "" : `<g ${gArmL}>${hL}${onHand("L")}</g>`}
      ${body.upR ? "" : `<g ${gArmR}>${hR}${onHand("R")}${held}</g>`}
      <g ${gHead}>${head}</g>
      ${neck?.svg || ""}
      ${upper}
    </g>
    ${gear?.front || ""}`;

  const bg = look.bg === "none" ? "" : I("bg")?.svg || solid("#1b2440", "#243258");
  const shadow = `<ellipse cx="256" cy="488" rx="160" ry="18" fill="#000" opacity=".25"/>`;
  let filters = "", body2 = `${shadow}${ram}`;
  if (finish === "flat") body2 = body2.replace(new RegExp(`stroke="${OUT}" stroke-width="(9|6)"`, "g"), 'stroke="none" stroke-width="0"');
  if (finish === "street") {
    filters += `<filter id="sk"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter>`;
    body2 = `${Array.from({ length: 400 }, (_, i) => `<circle cx="${(i % 20) * 26 + 6}" cy="${Math.floor(i / 20) * 26 + 6}" r="${(2 + 4 * (Math.floor(i / 20) / 20)).toFixed(1)}" fill="#ff3d7f" opacity=".35"/>`).join("")}<g filter="url(#sk)">${body2}</g>`;
  }
  if (finish === "sticker" || finish === "holo") {
    filters += `<filter id="cut" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="12" result="d"/>
      <feGaussianBlur in="d" stdDeviation="6" result="b"/><feOffset in="b" dx="6" dy="10" result="o"/><feFlood flood-color="#000" flood-opacity=".4"/><feComposite in2="o" operator="in" result="sh"/>
      <feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="w"/><feMerge><feMergeNode in="sh"/><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    const inner = `<g transform="translate(256 256) scale(.86) translate(-256 -256)">${ram}</g>`;
    body2 = `<g filter="url(#cut)">${inner}</g>`;
    if (finish === "holo") {
      filters += `<filter id="sil" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="12" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in"/></filter>
        <linearGradient id="rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5ec4"/><stop offset=".2" stop-color="#ffd84a"/><stop offset=".4" stop-color="#6bff9a"/><stop offset=".6" stop-color="#4ad8ff"/><stop offset=".8" stop-color="#a66bff"/><stop offset="1" stop-color="#ff5ec4"/></linearGradient>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0"><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset=".65" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <mask id="hm"><g filter="url(#sil)">${inner}</g></mask>`;
      body2 += `<g mask="url(#hm)"><rect width="512" height="512" fill="url(#rb)" opacity=".38"/><rect width="512" height="512" fill="url(#sheen)" transform="rotate(-25 256 256)"/></g>`;
    }
  }
  if (uncanny) {
    filters += `<filter id="fur" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9 .25" numOctaves="3" seed="7"/>
      <feColorMatrix values="0 0 0 0 .35  0 0 0 0 .27  0 0 0 0 .18  0 0 0 .45 0"/><feComposite in2="SourceGraphic" operator="in"/><feBlend in="SourceGraphic" mode="multiply"/></filter>`;
    body2 = `<g filter="url(#fur)">${body2.replace(new RegExp(`stroke="${OUT}" stroke-width="(9|6)"`, "g"), 'stroke="#5a4030" stroke-width="2"')}</g>`;
  }
  const anim = css ? `<style>
    .a-bob{animation:rb ${LOOP_MS / 2}ms ease-in-out infinite}
    .a-head{transform-box:view-box;animation:rt ${LOOP_MS}ms ease-in-out infinite}
    .a-armR,.a-armL{transform-box:view-box;animation:sw ${LOOP_MS / 2}ms ease-in-out infinite}
    .a-blink{opacity:0;animation:bl ${LOOP_MS}ms steps(1) infinite}
    @keyframes rb{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
    @keyframes rt{0%,50%,100%{transform:rotate(0)}25%{transform:rotate(5deg)}75%{transform:rotate(-5deg)}}
    @keyframes sw{0%,50%,100%{transform:rotate(var(--b))}25%{transform:rotate(calc(var(--b) - var(--s)))}75%{transform:rotate(calc(var(--b) + var(--s)))}}
    @keyframes bl{0%{opacity:0}72%{opacity:1}78%{opacity:0}}
    @media (prefers-reduced-motion:reduce){[class^=a-]{animation:none!important}}</style>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${anim}<defs>${[...defs].join("")}${filters}</defs>${bg}${body2}</svg>`;
}

export function slotCounts() {
  const c = {};
  for (const it of Object.values(ITEMS)) c[it.slot] = (c[it.slot] || 0) + 1;
  return c;
}
