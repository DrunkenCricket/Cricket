// Full-body Rams pick'em mascot. Original art, built from SVG layers in a 512x512 space.
// A ram is a set of choices, one per slot; every item is one choice. renderRam(look) -> SVG.

const OUT = "#15172b";
const S = `stroke="${OUT}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"`;
const mirror = (inner) => `<g transform="translate(512,0) scale(-1,1)">${inner}</g>`;

// ---------- palettes ----------
export const FLEECE = { cream: "#f4ecd8", black: "#2b2b33", gold: "#ffc82c", pink: "#ff9ccf", blue: "#5b8cff",
  green: "#5ee08f", purple: "#b18cff", silver: "#cfd6e0", red: "#ff5a5a" };
export const FACES = { tan: "#d9b98a", brown: "#a87a4f", dark: "#3d3330" };

// ---------- bodies: torso shape, arm anchors, where things attach ----------
const BODIES = {
  standard: {
    torso: "M 160 410 C 150 330, 190 300, 256 300 C 322 300, 362 330, 352 410 C 340 440, 172 440, 160 410 Z",
    armL: "M 168 334 C 138 348, 130 380, 136 404", armR: "M 344 334 C 374 348, 382 380, 376 404",
    handL: [136, 410], handR: [376, 410], arm: 20, legs: [214, 298], hip: 418,
    shoulders: [[176, 322], [336, 322]],
  },
  belly: {
    torso: "M 150 400 C 132 330, 186 298, 256 298 C 326 298, 380 330, 362 400 C 360 452, 152 452, 150 400 Z",
    armL: "M 160 332 C 122 344, 112 376, 118 402", armR: "M 352 332 C 390 344, 400 376, 394 402",
    handL: [118, 408], handR: [394, 408], arm: 24, legs: [208, 304], hip: 430,
    shoulders: [[172, 320], [340, 320]],
    skin: `<ellipse cx="256" cy="392" rx="74" ry="50" fill="#fff" opacity=".18"/><path d="M 252 400 q 4 6 8 0" stroke="${OUT}" stroke-width="5" fill="none"/>`,
  },
  buff: {
    torso: "M 176 418 C 170 370, 150 312, 186 300 C 220 290, 292 290, 326 300 C 362 312, 342 370, 336 418 C 316 432, 196 432, 176 418 Z",
    armL: "M 168 320 C 122 330, 108 368, 120 404", armR: "M 344 320 C 390 330, 404 368, 392 404",
    handL: [120, 410], handR: [392, 410], arm: 32, legs: [218, 294], hip: 420,
    shoulders: [[168, 312], [344, 312]],
    skin: `<path d="M 200 336 q 28 18 52 0 M 260 336 q 28 18 52 0" stroke="${OUT}" stroke-width="6" fill="none"/>
      ${[364, 384, 404].map((y) => `<path d="M 232 ${y} l 18 0 M 262 ${y} l 18 0" stroke="${OUT}" stroke-width="5" stroke-linecap="round"/>`).join("")}
      <path d="M 256 350 l 0 66" stroke="${OUT}" stroke-width="4" opacity=".6"/>`,
  },
};

// ---------- horns: shape x size ----------
const HORN_PATHS = {
  curl: "M 205 168 C 150 96, 54 118, 54 204 C 54 268, 124 298, 156 258 C 180 228, 156 192, 124 204",
  small_curl: "M 200 166 C 168 126, 112 136, 112 184 C 112 220, 152 232, 166 208 C 176 192, 162 178, 148 184",
  sweep: "M 204 164 C 170 110, 110 80, 40 96 C 70 110, 96 120, 120 150",
  goat: "M 214 158 C 200 110, 186 70, 150 40",
  devil: "M 206 160 C 196 130, 182 112, 168 96",
  spiral_up: "M 214 156 C 210 110, 180 70, 196 40 C 206 24, 226 34, 218 52",
};
const HORN_WIDTH = { curl: 42, small_curl: 32, sweep: 34, goat: 26, devil: 22, spiral_up: 26 };

function hornLayer({ shape = "curl", size = 1, color = "#c8a46a", ridge = "#7e5f32", extra = "" } = {}) {
  const d = HORN_PATHS[shape] || HORN_PATHS.curl, w = HORN_WIDTH[shape] || 40;
  const taper = shape === "goat" || shape === "devil" || shape === "sweep";
  const one = taper
    ? `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="${w + 14}" stroke-linecap="round"/>
       <path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>
       <path d="${d}" fill="none" stroke="${ridge}" stroke-opacity=".45" stroke-width="${w}" stroke-dasharray="4 12"/>`
    : `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="${w + 16}" stroke-linecap="round"/>
       <path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>
       <path d="${d}" fill="none" stroke="${ridge}" stroke-opacity=".45" stroke-width="${w}" stroke-dasharray="5 15"/>`;
  // scale around the horn root so big/small horns stay attached to the head
  const scaled = `<g transform="translate(205,165) scale(${size}) translate(-205,-165)">${one}</g>`;
  return scaled + mirror(scaled) + extra;
}

// ---------- head pieces (head art space, placed with HEAD_T) ----------
const HEAD_T = "translate(256,186) scale(.78) translate(-256,-250)";
const ears = (face) => {
  const e = `<path d="M 186 292 C 152 300, 116 318, 100 344 C 140 350, 172 334, 192 316 Z" fill="${face}" ${S}/>
    <path d="M 176 306 C 154 312, 132 324, 122 336 C 146 338, 166 328, 180 318 Z" fill="#e7a3a0"/>`;
  return e + mirror(e);
};
const headShape = (face) => `<path d="M 176 204 C 170 160, 210 136, 256 136 C 302 136, 342 160, 336 204 L 330 300 C 326 350, 296 380, 256 380 C 216 380, 186 350, 182 300 Z" fill="${face}" ${S}/>`;
const eyes = (girl) => `<ellipse cx="222" cy="252" rx="22" ry="25" fill="#fff" ${S}/><ellipse cx="290" cy="252" rx="22" ry="25" fill="#fff" ${S}/>
  <circle cx="228" cy="257" r="10" fill="${OUT}"/><circle cx="284" cy="257" r="10" fill="${OUT}"/>
  <circle cx="231" cy="253" r="3.5" fill="#fff"/><circle cx="287" cy="253" r="3.5" fill="#fff"/>
  ${girl
    ? `<path d="M 198 236 l -10 -8 M 204 230 l -6 -10 M 212 228 l -2 -11 M 314 236 l 10 -8 M 308 230 l 6 -10 M 300 228 l 2 -11" stroke="${OUT}" stroke-width="5" stroke-linecap="round"/>
       <path d="M 200 214 Q 222 204 244 214 M 268 214 Q 290 204 312 214" stroke="${OUT}" stroke-width="8" fill="none" stroke-linecap="round"/>
       <ellipse cx="206" cy="292" rx="14" ry="8" fill="#ff8fb0" opacity=".55"/><ellipse cx="306" cy="292" rx="14" ry="8" fill="#ff8fb0" opacity=".55"/>`
    : `<path d="M 194 218 L 246 232 M 318 218 L 266 232" stroke="${OUT}" stroke-width="13" stroke-linecap="round"/>`}`;
const muzzle = (face) => `<ellipse cx="256" cy="324" rx="60" ry="46" fill="${face === FACES.dark ? "#6a5a52" : "#f1dfc0"}" ${S}/>
  <ellipse cx="238" cy="312" rx="8" ry="6" fill="${OUT}"/><ellipse cx="274" cy="312" rx="8" ry="6" fill="${OUT}"/>
  <path d="M 234 342 Q 258 358 282 336" fill="none" stroke="${OUT}" stroke-width="7" stroke-linecap="round"/>`;
const TUFT = [[220, 152, 28], [256, 140, 32], [292, 152, 28], [238, 172, 24], [274, 172, 24], [200, 172, 18], [312, 172, 18]];
const tuft = (c) => TUFT.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 5}" fill="${OUT}"/>`).join("")
  + TUFT.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join("");

// ---------- shirts: fill + pattern clipped to the body ----------
const stripes = (c, w = 22) => Array.from({ length: 14 }, (_, i) => `<rect x="${120 + i * w * 2}" y="280" width="${w}" height="200" fill="${c}"/>`).join("");
const flamingos = Array.from({ length: 14 }, (_, i) => {
  const x = 150 + (i * 53) % 220, y = 310 + ((i * 37) % 120);
  return `<g transform="translate(${x},${y}) rotate(${(i % 3) * 12 - 12})"><path d="M 0 0 q -6 -14 6 -18 q 10 -2 8 8 q -4 8 -14 10 Z" fill="#ff6fae"/>
    <path d="M 8 -18 q 6 -10 0 -16 q -4 -2 -6 2" stroke="#ff6fae" stroke-width="3" fill="none"/><path d="M 2 0 l 0 14" stroke="#ff6fae" stroke-width="2.5"/></g>`;
}).join("") + Array.from({ length: 8 }, (_, i) => `<path d="M ${160 + i * 30} ${300 + (i % 2) * 70} q 10 -14 20 0 q -10 14 -20 0" fill="#2fbf71" opacity=".8"/>`).join("");

export const SHIRTS = {
  shirtless: null,
  jersey_blue: { fill: "#003594", sleeve: "#003594", pattern: "", collar: "#ffa300", trim: "#ffa300" },
  jersey_white: { fill: "#f8f8f5", sleeve: "#f8f8f5", pattern: "", collar: "#003594", trim: "#003594" },
  flamingo: { fill: "#7fd6c9", sleeve: "#7fd6c9", pattern: flamingos, collar: "#5fb8ab" },
  referee: { fill: "#fff", sleeve: "#111", pattern: stripes("#111", 16), collar: "#111" },
  hoodie: { fill: "#6b7280", sleeve: "#6b7280", pattern: `<rect x="206" y="380" width="100" height="40" rx="12" fill="#5b6270"/><path d="M 238 312 L 234 356 M 274 312 L 278 356" stroke="#e5e7eb" stroke-width="5" stroke-linecap="round"/>`, collar: "#4b5563" },
};

// ---------- the ram ----------
export function renderRam(look = {}, size = 512) {
  const body = BODIES[look.body] || BODIES.standard;
  const face = FACES[look.face] || FACES.tan;
  const fleece = FLEECE[look.fleece] || FLEECE.cream;
  const shirt = look.shirt in SHIRTS ? SHIRTS[look.shirt] : SHIRTS.jersey_blue;
  const skinTone = fleece;                       // shirtless shows the fleece
  const sleeve = shirt ? shirt.sleeve : skinTone;
  const [lx, rx] = body.legs;
  const id = Math.random().toString(36).slice(2, 7);
  const add = look.addons || {};                 // { bg, effect, neck, eyes, mouth, head, hand, shoes, pads, horns }

  const legs = [lx, rx].map((x) => `<path d="M ${x} ${body.hip - 6} L ${x} 466" stroke="${OUT}" stroke-width="40" stroke-linecap="round"/>
    <path d="M ${x} ${body.hip - 6} L ${x} 462" stroke="${skinTone}" stroke-width="26" stroke-linecap="round"/>`).join("");
  // shoe art is drawn around x=0 and slid under each leg; hooves by default
  const shoes = add.shoes || `<path d="M -22 472 q 22 -18 44 0 l 0 12 l -44 0 Z" fill="#3a2a1a" ${S}/>`;
  const feet = [lx, rx].map((x) => `<g transform="translate(${x},0)">${shoes}</g>`).join("");
  const arm = (d) => `<path d="${d}" stroke="${OUT}" stroke-width="${body.arm + 14}" fill="none" stroke-linecap="round"/>
    <path d="${d}" stroke="${sleeve}" stroke-width="${body.arm}" fill="none" stroke-linecap="round"/>`;
  const hand = ([x, y]) => `<circle cx="${x}" cy="${y}" r="${body.arm * 0.7 + 4}" fill="${face}" ${S}/>`;

  const torso = shirt
    ? `<clipPath id="t${id}"><path d="${body.torso}"/></clipPath>
       <path d="${body.torso}" fill="${shirt.fill}"/>
       <g clip-path="url(#t${id})">${shirt.pattern}</g>
       <path d="${body.torso}" fill="none" ${S}/>
       <path d="M 228 302 L 256 330 L 284 302" fill="${shirt.collar}" ${S}/>`
    : `<path d="${body.torso}" fill="${skinTone}" ${S}/>${body.skin || ""}`;

  const pads = add.pads ? body.shoulders.map(([x, y], i) => {
    const s = i ? -1 : 1;
    return `<path d="M ${x + 40 * s} ${y - 6} C ${x} ${y - 30}, ${x - 40 * s} ${y - 10}, ${x - 44 * s} ${y + 26} C ${x - 20 * s} ${y + 20}, ${x + 20 * s} ${y + 20}, ${x + 40 * s} ${y + 20} Z" fill="${add.pads}" ${S}/>`;
  }).join("") : "";

  const handItem = add.hand ? `<g transform="translate(${body.handR[0]},${body.handR[1]})">${add.hand}</g>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
${add.bg || `<rect width="512" height="512" fill="#1b2440"/><circle cx="256" cy="230" r="210" fill="#243258"/>`}
<ellipse cx="256" cy="486" rx="160" ry="18" fill="#000" opacity=".25"/>
${add.effect || ""}
${legs}${feet}
${arm(body.armL)}${arm(body.armR)}
${torso}${pads}
${hand(body.handL)}${hand(body.handR)}${handItem}
<g transform="${HEAD_T}">
  ${ears(face)}${headShape(face)}${eyes(look.base === "girl")}${muzzle(face)}
  ${add.mouth || ""}${add.eyes || ""}
  ${hornLayer(add.horns)}
  ${tuft(fleece)}
  ${add.head || ""}
</g>
${add.neck || ""}
</svg>`;
}

// ---------- add-on art (each is an SVG snippet; hand items are drawn around 0,0 = the hand) ----------
export const ADDONS = {
  cleats_blue: `<path d="M -30 476 C -30 448, 6 448, 32 466 L 34 480 L -30 480 Z" fill="#003594" ${S}/><path d="M -8 462 l 12 0" stroke="#fff" stroke-width="5"/>${[-22, -6, 10, 24].map((d) => `<rect x="${d}" y="480" width="6" height="7" fill="${OUT}"/>`).join("")}`,
  cleats_gold: `<path d="M -30 476 C -30 448, 6 448, 32 466 L 34 480 L -30 480 Z" fill="#ffc82c" ${S}/><path d="M -8 462 l 12 0" stroke="#fff" stroke-width="5"/>${[-22, -6, 10, 24].map((d) => `<rect x="${d}" y="480" width="6" height="7" fill="${OUT}"/>`).join("")}`,
  football: `<g transform="translate(18,-26) rotate(-30)"><ellipse rx="30" ry="18" fill="#8b4a22" ${S}/><path d="M -12 0 L 12 0 M -6 -5 l 0 10 M 0 -5 l 0 10 M 6 -5 l 0 10" stroke="#fff" stroke-width="3"/></g>`,
  flag_yellow: `<path d="M 0 0 L 0 -70" stroke="${OUT}" stroke-width="6"/><path d="M 0 -70 C 30 -84, 46 -56, 74 -66 L 70 -28 C 44 -18, 28 -44, 0 -32 Z" fill="#ffd400" ${S}/>`,
  flag_red: `<path d="M 0 0 L 0 -70" stroke="${OUT}" stroke-width="6"/><path d="M 0 -70 C 30 -84, 46 -56, 74 -66 L 70 -28 C 44 -18, 28 -44, 0 -32 Z" fill="#e5484d" ${S}/>`,
  foam_finger: `<path d="M -22 10 L -26 -40 C -26 -54, -10 -56, -8 -42 L -6 -92 C -6 -106, 12 -106, 12 -92 L 14 -40 C 30 -46, 34 -28, 26 -10 L 22 10 Z" fill="#ffa300" ${S}/>`,
  pacifier: `<circle cx="256" cy="344" r="22" fill="#7fd0ff" ${S}/><circle cx="256" cy="344" r="9" fill="#fff"/><path d="M 236 362 q 20 26 40 0" fill="none" stroke="#ff7eb6" stroke-width="8" stroke-linecap="round"/>`,
  grill: `<path d="M 232 340 Q 258 362 284 336 L 282 350 Q 258 368 234 352 Z" fill="#ffc82c" stroke="${OUT}" stroke-width="5"/>`,
  mouthguard: `<path d="M 232 340 Q 258 360 284 336 L 282 348 Q 258 364 234 350 Z" fill="#3b82f6" stroke="${OUT}" stroke-width="5"/>`,
  shades: `<path d="M 188 240 L 324 240" stroke="${OUT}" stroke-width="12"/><rect x="188" y="232" width="64" height="42" rx="14" fill="#111" ${S}/><rect x="260" y="232" width="64" height="42" rx="14" fill="#111" ${S}/>`,
  giant_hat: `<ellipse cx="256" cy="150" rx="200" ry="34" fill="#c8a060" ${S}/><path d="M 186 150 C 186 40, 326 40, 326 150 Z" fill="#d9b37a" ${S}/><path d="M 188 128 L 324 128" stroke="#e5484d" stroke-width="16"/>`,
  ref_cap: `<path d="M 196 150 C 200 104, 312 104, 316 150 Z" fill="#111" ${S}/><path d="M 196 150 C 190 160, 160 162, 150 156 C 160 146, 180 142, 196 144 Z" fill="#111" ${S}/><path d="M 256 104 L 256 150" stroke="#fff" stroke-width="5"/>`,
  helmet: `<path d="M 168 210 C 160 120, 230 92, 268 96 C 330 102, 360 150, 346 214 L 320 214 L 320 176 C 300 150, 214 150, 194 176 L 194 214 Z" fill="#003594" ${S}/><path d="M 256 98 L 256 150" stroke="#ffa300" stroke-width="14"/>`,
  giant_chain: `<path d="M 186 320 C 196 420, 316 420, 326 320" fill="none" stroke="${OUT}" stroke-width="26" stroke-linecap="round"/><path d="M 186 320 C 196 420, 316 420, 326 320" fill="none" stroke="#ffc82c" stroke-width="15" stroke-dasharray="16 8"/><circle cx="256" cy="404" r="34" fill="#ffc82c" ${S}/><text x="256" y="416" font-size="34" font-family="Arial Black,Arial" font-weight="900" text-anchor="middle" fill="${OUT}">$</text>`,
  whistle: `<path d="M 214 312 L 256 360" stroke="#111" stroke-width="4"/><rect x="246" y="352" width="30" height="16" rx="6" fill="#cfd6e0" ${S}/>`,
};
