// Public pick'em site served by the Worker.
//   /              the page
//   /api/week      this week's polls with who picked each side (live from Discord)
//   /api/history   last graded week (right/wrong) + season standings (from data/picks.csv)
//
// Needs the DISCORD_BOT_TOKEN Worker secret to read poll voters, avatars and logo emojis.

import { renderRam, ITEMS, SLOT_NAMES, RARITY, BODY_TYPES } from "./ram.js";
import { lockerUser } from "./gamecmds.js";
import { CRATE_COST } from "./game.js";

const RAW = "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/";
const APP_ID = "1574684181361852416";
const API = "https://discord.com/api/v10";

// ---------- small helpers ----------

const json = (obj, maxAge = 60) =>
  new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` },
  });

async function cached(ctx, key, ttl, build) {
  const cache = caches.default;
  const req = new Request(`https://cache.rams-bot/${key}`);
  const hit = await cache.match(req);
  if (hit) return hit.json();
  const value = await build();
  ctx.waitUntil(cache.put(req, new Response(JSON.stringify(value), { headers: { "Cache-Control": `max-age=${ttl}` } })));
  return value;
}

async function bot(env, path) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(API + path, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "User-Agent": "DiscordBot (rams-bot, 1.0)" },
    });
    if (res.status === 429) {
      const wait = (await res.json().catch(() => ({}))).retry_after || 1;
      await new Promise((r) => setTimeout(r, wait * 1000 + 200));
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${res.status} on ${path}`);
    return res.json();
  }
  throw new Error("Discord rate limit");
}

async function raw(path, ttl = 60) {
  const res = await fetch(RAW + path, { cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return res.text();
}

function avatarUrl(id, hash) {
  if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
}

const person = (u) => ({ id: u.id, name: u.global_name || u.username, avatar: avatarUrl(u.id, u.avatar) });

async function logos(env, ctx) {
  return cached(ctx, "logos", 86400, async () => {
    const items = (await bot(env, `/applications/${APP_ID}/emojis`)).items || [];
    return Object.fromEntries(items.map((e) => [e.name.toUpperCase(), `https://cdn.discordapp.com/emojis/${e.id}.png?size=96`]));
  });
}

async function voters(env, channel, message, answer) {
  const out = [];
  let after = "";
  for (;;) {
    const page = (await bot(env, `/channels/${channel}/polls/${message}/answers/${answer}?limit=100${after}`)).users || [];
    out.push(...page);
    if (page.length < 100) return out;
    after = `&after=${page[page.length - 1].id}`;
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
  }));
  return out;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; if (row.length > 1) rows.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); if (row.length > 1) rows.push(row); }
  const [h, ...d] = rows;
  return d.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

// ---------- data ----------

async function weekData(env, ctx) {
  return cached(ctx, "week", 90, async () => {
    const state = JSON.parse(await raw("state/pickem.json"));
    const logo = await logos(env, ctx);
    const now = Date.now();
    const games = await pool(state.polls || [], 4, async (p) => {
      const sides = [];
      for (const [answer, abbr] of Object.entries(p.answers)) {
        const users = (await voters(env, state.channel_id, p.message_id, answer)).map(person);
        sides.push({ abbr, logo: logo[abbr] || null, users });
      }
      return { game: p.game, kick: p.kick, rams: !!p.rams, locked: new Date(p.kick).getTime() <= now, sides };
    });
    // Remember avatars so the history tab can show them too.
    const seen = {};
    games.forEach((g) => g.sides.forEach((s) => s.users.forEach((u) => { seen[u.id] = u.avatar; })));
    ctx.waitUntil(mergeAvatars(seen));
    return { label: state.label, season: state.season, games };
  });
}

async function mergeAvatars(add) {
  const cache = caches.default, req = new Request("https://cache.rams-bot/avatars");
  const hit = await cache.match(req);
  const map = hit ? await hit.json() : {};
  Object.assign(map, add);
  await cache.put(req, new Response(JSON.stringify(map), { headers: { "Cache-Control": "max-age=604800" } }));
  return map;
}

async function historyData(env, ctx) {
  return cached(ctx, "history", 300, async () => {
    const all = parseCSV(await raw("data/picks.csv", 120));
    const logo = await logos(env, ctx);
    if (!all.length) return { label: null, games: [], standings: [] };
    const season = Math.max(...all.map((r) => +r.season));
    const rows = all.filter((r) => +r.season === season);
    const order = (l) => parseInt(l.replace(/\D/g, "")) || 99;
    const label = [...new Set(rows.map((r) => r.label))].sort((a, b) => order(a) - order(b)).pop();

    // avatars: what we've seen live, plus a few lookups for anyone missing
    const hit = await caches.default.match(new Request("https://cache.rams-bot/avatars"));
    const avatars = hit ? await hit.json() : {};
    const missing = [...new Set(rows.map((r) => r.user_id))].filter((id) => !avatars[id]).slice(0, 15);
    const found = {};
    await pool(missing, 3, async (id) => {
      try { const u = await bot(env, `/users/${id}`); found[id] = avatarUrl(u.id, u.avatar); }
      catch { found[id] = avatarUrl(id, null); }
    });
    if (missing.length) ctx.waitUntil(mergeAvatars(found));
    Object.assign(avatars, found);
    const who = (r) => ({ id: r.user_id, name: r.user_name, avatar: avatars[r.user_id] || avatarUrl(r.user_id, null) });

    const games = {};
    for (const r of rows.filter((r) => r.label === label)) {
      const g = (games[r.event_id] ||= { game: r.game, winner: r.winner, rams: r.game.includes("LAR"), sides: {} });
      (g.sides[r.pick] ||= []).push(who(r));
    }
    const gameList = Object.values(games).map((g) => {
      const [away, home] = g.game.split(" @ ");
      return { game: g.game, winner: g.winner, rams: g.rams,
               sides: [away, home].map((abbr) => ({ abbr, logo: logo[abbr] || null, users: g.sides[abbr] || [] })) };
    }).sort((a, b) => b.rams - a.rams);

    const t = {};
    for (const r of rows) {
      const p = (t[r.user_id] ||= { ...who(r), w: 0, l: 0 });
      r.correct === "1" ? p.w++ : p.l++;
    }
    const standings = Object.values(t).sort((a, b) => b.w - a.w || a.l - b.l);
    return { season, label, games: gameList, standings };
  });
}

// ---------- routes ----------

// Everyone with a ram, plus everyone who has made a pick (they get the default ram until they open a crate).
async function herdData(env, ctx) {
  const hist = await historyData(env, ctx);
  const herd = new Map(hist.standings.map((p) => [p.id, { id: p.id, name: p.name, avatar: p.avatar, points: 0 }]));
  if (env.GAME) {
    for (const u of await env.GAME.get(env.GAME.idFromName("main")).herd()) {
      herd.set(u.id, { ...(herd.get(u.id) || { avatar: avatarUrl(u.id, null) }), id: u.id, name: u.name || herd.get(u.id)?.name || "Ram", points: u.points });
    }
  }
  return { rams: [...herd.values()] };
}

// Locker API: every call carries the signed link token; it only ever acts on that token's own user.
async function lockerApi(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, 0); }
  const uid = await lockerUser(env, body.t);
  if (!uid) return json({ error: "This locker link expired. Run /locker in Discord for a new one." }, 0);
  const g = env.GAME.get(env.GAME.idFromName("main"));
  let extra = {};
  if (body.op === "crate") {
    const r = await g.openCrate(uid);
    if (r.error) extra.error = r.error.replace(/\*\*/g, "");
    else extra.reveal = { item: r.item, dupe: r.dupe, refund: r.refund, guaranteed: r.guaranteed, bought: r.bought };
  } else if (body.op === "equip") {
    const r = await g.equip(uid, String(body.item));
    if (r.error) extra.error = r.error.replace(/\*\*/g, "");
  } else if (body.op === "unequip" && SLOT_NAMES[body.slot]) {
    await g.setLook(uid, body.slot, null);
  } else if (body.op === "body" && BODY_TYPES[body.type]) {
    await g.setLook(uid, "body", body.type);
  }
  return json({ uid, ...(await g.locker(uid)), ...extra }, 0);
}

export async function handleSite(request, env, ctx) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/locker" && request.method === "POST" && env.GAME) return lockerApi(request, env);
  if (pathname === "/locker" || pathname === "/lockeroom") return new Response(lockerPage(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  try {
    if (pathname === "/api/week") return json(await weekData(env, ctx), 60);
    if (pathname === "/api/history") return json(await historyData(env, ctx), 120);
    if (pathname === "/api/herd") return json(await herdData(env, ctx), 60);
  } catch (e) {
    return json({ error: String(e.message || e) }, 10);
  }
  // /ram/ID (page), /ram/ID.svg, and /ram/ID/OPTS~STAMP.svg where OPTS is "now", "bare" or an item id to try on.
  // The path form exists because the PNG proxy Discord uses drops query strings.
  const pathOpts = pathname.match(/^\/ram\/(\d{5,25})\/([a-z0-9_]+?)(-bare)?~\d+\.svg$/);
  const ram = pathOpts ? [pathname, pathOpts[1], ".svg"] : pathname.match(/^\/ram\/(\d{5,25})(\.svg)?$/);
  if (ram && env.GAME) {
    const r = await env.GAME.get(env.GAME.idFromName("main")).look(ram[1]);
    const look = { ...(r?.look || {}) };
    const q = new URL(request.url).searchParams;
    if (pathOpts?.[2] === "bare" || pathOpts?.[3]) q.set("bare", "1");
    if (pathOpts && ITEMS[pathOpts[2]]) q.set("try", pathOpts[2]);
    if (q.has("bare")) look.bg = "none";                                   // Herd pasture and fights
    if (ITEMS[q.get("pose")]?.slot === "pose") look.pose = q.get("pose");  // fight celebrations
    const tryOn = ITEMS[q.get("try")];                                     // crate reveal: wear the new item
    if (tryOn) look[tryOn.slot === "body" ? "body" : tryOn.slot] = tryOn.id;
    const svg = renderRam(look, 512, "css");
    if (ram[2]) return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=30" } });
    return new Response(ramPage(r?.name || "Ram", svg, look), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=30" } });
  }
  const fm = pathname.match(/^\/fight\/(\d+)$/);
  if (fm && env.GAME) {
    const f = await env.GAME.get(env.GAME.idFromName("main")).fight(Number(fm[1]));
    if (!f) return new Response("No such fight", { status: 404 });
    return new Response(fightPage(f), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=15" } });
  }
  if (pathname === "/" || pathname === "/index.html") {
    return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  }
  return new Response("Not found", { status: 404 });
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function ramPage(name, svg, look) {
  const worn = Object.entries(look).filter(([, v]) => ITEMS[v]).map(([s, v]) => `<li><b>${esc(SLOT_NAMES[s] || s)}</b> ${esc(ITEMS[v].name)} <i class="${ITEMS[v].rarity}">${ITEMS[v].rarity}</i></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}'s Ram</title><meta property="og:title" content="${esc(name)}'s Ram">
<style>:root{--bg:#0d1328;--card:#151d3b;--ink:#eef2ff;--dim:#9aa6c7}
body{margin:0;background:var(--bg);color:var(--ink);font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{max-width:520px;width:100%}h1{margin:0 0 12px;font-size:24px}.ram{border-radius:20px;overflow:hidden;line-height:0}.ram svg{width:100%;height:auto}
ul{list-style:none;padding:0;margin:16px 0 0;display:grid;gap:6px}li{background:var(--card);border-radius:10px;padding:8px 12px;display:flex;gap:8px}li b{color:var(--dim);min-width:90px}
i{margin-left:auto;font-style:normal;font-size:12px;text-transform:uppercase}.common{color:#9aa3b2}.rare{color:#3b82f6}.epic{color:#a855f7}.legendary{color:#ffa300}.mythic{color:#ff4fd8}.secret{color:#5ee08f}
a{color:#ffc82c}</style></head><body><main><h1>🐏 ${esc(name)}'s Ram</h1><div class="ram">${svg}</div><ul>${worn}</ul>
<p><a href="/">Pick'em board</a></p></main></body></html>`;
}

// A football field: blue and gold end zones, yard lines every 10, numbers along the bottom.
const FIELD_CSS = `.field{position:relative;overflow:hidden;border-radius:18px;border:3px solid #fff;
  background:repeating-linear-gradient(90deg,#2f8f3c 0 4.2%,#2a8236 4.2% 8.4%)}
.field .ez{position:absolute;top:0;bottom:0;width:8%;display:grid;place-items:center}
.field .ez b{writing-mode:vertical-rl;font:900 clamp(18px,4vw,44px)/1 system-ui,sans-serif;letter-spacing:6px;color:#fff;opacity:.9}
.field .ez.l{left:0;background:#003594}.field .ez.l b{transform:rotate(180deg)}
.field .ez.r{right:0;background:#ffa300}.field .ez.r b{color:#003594}
.field .yl{position:absolute;top:0;bottom:0;width:3px;margin-left:-1.5px;background:rgba(255,255,255,.75)}
.field .hm{position:absolute;top:33%;bottom:33%;left:8%;right:8%;background:repeating-linear-gradient(90deg,rgba(255,255,255,.55) 0 2px,transparent 2px 1.68%);
  -webkit-mask:linear-gradient(#000 0 8%,transparent 8% 92%,#000 92%);mask:linear-gradient(#000 0 8%,transparent 8% 92%,#000 92%)}
.field .num{position:absolute;bottom:6%;transform:translateX(-50%);color:rgba(255,255,255,.8);font:800 clamp(12px,2.2vw,24px)/1 system-ui,sans-serif;letter-spacing:2px}`;
const FIELD = `<div class="ez l"><b>RAMS</b></div><div class="ez r"><b>HERD</b></div><div class="hm"></div>`
  + Array.from({ length: 11 }, (_, i) => `<div class="yl" style="left:${8 + i * 8.4}%"></div>`).join("")
  + [10, 20, 30, 40, 50, 40, 30, 20, 10].map((n, i) => `<div class="num" style="left:${16.4 + i * 8.4}%">${n}</div>`).join("");

function lockerPage() {
  const meta = {
    slots: SLOT_NAMES, bodies: BODY_TYPES, cost: CRATE_COST,
    rarity: Object.fromEntries(Object.entries(RARITY).map(([k, v]) => [k, { label: v.label, weight: v.weight, color: "#" + v.color.toString(16).padStart(6, "0") }])),
    // every crate item, for the spinning reel
    items: Object.values(ITEMS).filter((i) => i.slot !== "base" && i.rarity !== "secret").map((i) => [i.id, i.name, i.slot, i.rarity]),
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Lockeroom</title><meta name="robots" content="noindex">
<style>:root{--bg:#0b1024;--card:#151d3b;--card2:#1c2650;--line:#26315f;--ink:#eef2ff;--dim:#9aa6c7;--gold:#ffc82c;--blue:#003594}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,sans-serif;padding:16px}
main{max-width:1100px;margin:0 auto}
h1{margin:0;font:900 clamp(24px,5vw,40px)/1 system-ui,sans-serif;letter-spacing:2px}h1 span{color:var(--gold)}
.sub{color:var(--dim);margin:6px 0 14px}.sub b{color:var(--gold)}
/* the room: a wall of lockers, a bench, a floor */
.room{position:relative;height:min(62vw,470px);min-height:330px;border-radius:18px;overflow:hidden;border:1px solid var(--line);
  background:linear-gradient(#0000 0 74%,#5a3b22 74% 77%,#3b2716 77% 78%,#2a2f3d 78%),
  repeating-linear-gradient(90deg,#123a8f 0 calc(12.5% - 6px),#0a2560 calc(12.5% - 6px) 12.5%)}
.room::before{content:"";position:absolute;inset:0 0 26% 0;background:
  repeating-linear-gradient(90deg,#0000 0 3%,rgba(0,0,0,.35) 3% 3.4%,#0000 3.4% 12.5%) 0 14%/100% 8% no-repeat,
  repeating-linear-gradient(#0000 0 6px,rgba(0,0,0,.28) 6px 9px) 2% 12%/7% 10% repeat-x,
  linear-gradient(90deg,#0000 0 9.6%,#c9d3ea 9.6% 10.4%,#0000 10.4%) 0 48%/12.5% 12% repeat-x}
.room::after{content:"";position:absolute;left:0;right:0;top:0;height:7%;background:linear-gradient(#0a1a40,#123a8f);box-shadow:0 4px 10px rgba(0,0,0,.5)}
.bench{position:absolute;left:6%;right:6%;bottom:24%;height:4%;background:#a8703f;border-radius:6px;box-shadow:0 6px 0 #6b4423}
.nums{position:absolute;left:0;right:0;top:9%;display:grid;grid-template-columns:repeat(8,1fr);text-align:center;font:800 13px system-ui;color:var(--gold);opacity:.85}
.lr-ram{position:absolute;bottom:6%;left:30%;width:min(34vw,280px);transform:translateX(-50%);z-index:4}
.lr-ram img{width:100%;display:block;transform-origin:50% 90%}
.crate{position:absolute;bottom:9%;left:70%;width:min(20vw,160px);transform:translateX(-50%);z-index:3}
.crate svg{width:100%;display:block}.crate .lid{transform-box:fill-box;transform-origin:0% 100%}
.flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:8}
.word{position:absolute;left:58%;top:22%;transform:translateX(-50%);z-index:9;font:900 clamp(28px,6vw,60px)/1 system-ui;color:#ffd400;-webkit-text-stroke:3px #15172b;opacity:0;pointer-events:none}
/* the reel */
.reel{position:absolute;left:0;right:0;top:50%;height:150px;margin-top:-75px;background:rgba(5,8,20,.92);border-top:2px solid var(--gold);border-bottom:2px solid var(--gold);
  overflow:hidden;z-index:10;display:none}
.reel .strip{position:absolute;top:10px;left:0;display:flex;gap:8px;will-change:transform}
.reel .card{width:130px;height:126px;flex:none;border-radius:10px;background:linear-gradient(#1c2650,#121937);border-bottom:5px solid;padding:10px;display:flex;flex-direction:column;justify-content:space-between}
.reel .card .e{font-size:38px;line-height:1;text-align:center}.reel .card .n{font-weight:700;font-size:13px;line-height:1.15}.reel .card .r{font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase}
.reel .card.win{box-shadow:0 0 0 3px var(--gold),0 0 30px var(--gold)}
.reel .mark{position:absolute;left:50%;top:0;bottom:0;width:3px;margin-left:-1.5px;background:var(--gold);box-shadow:0 0 12px var(--gold);z-index:2}
.reel .mark::before,.reel .mark::after{content:"";position:absolute;left:-8px;border:9px solid transparent}
.reel .mark::before{top:0;border-top-color:var(--gold)}.reel .mark::after{bottom:0;border-bottom-color:var(--gold)}
.bar{display:flex;gap:10px;align-items:center;margin:14px 0;flex-wrap:wrap}
button{background:var(--card2);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font:600 14px system-ui;cursor:pointer}
button.on{border-color:var(--gold);color:var(--gold)}button:disabled{opacity:.45;cursor:default}
.buy{background:var(--gold);color:#111;border:0;font-size:17px;padding:13px 22px;font-weight:800}
.reveal{display:none;margin-left:auto;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-left:5px solid;border-radius:12px;padding:8px 12px}
.reveal b{font-size:17px}.reveal small{display:block;font-weight:800;letter-spacing:1px;text-transform:uppercase;font-size:11px}
.card0{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}.chips button{padding:6px 10px;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.it{text-align:left;padding:10px;border-left-width:4px}.it small{display:block;color:var(--dim);font-weight:500;margin-top:2px}
.it.on{background:#24305f;box-shadow:inset 0 0 0 1px var(--gold)}.it.on::after{content:" ✓";color:var(--gold)}
.err{color:#ff8080}.empty{color:var(--dim);padding:24px;text-align:center}a{color:var(--gold)}
</style></head>
<body><main><h1>THE <span>LOCKEROOM</span></h1><div class="sub" id="sub">Loading...</div>
<div class="room" id="room"><div class="nums">${[12, 99, 7, 24, 33, 81, 10, 2].map((n) => `<span>${n}</span>`).join("")}</div><div class="bench"></div>
<div class="lr-ram" id="ram"><img alt="Your ram"></div>
<div class="crate" id="crate"><svg viewBox="0 0 120 110"><g class="lid"><rect x="4" y="14" width="112" height="20" rx="4" fill="#0a2560" stroke="#15172b" stroke-width="4"/><rect x="4" y="14" width="112" height="6" fill="#ffc82c"/></g>
<rect x="8" y="32" width="104" height="72" rx="6" fill="#123a8f" stroke="#15172b" stroke-width="4"/><path d="M8 32 L112 104 M112 32 L8 104" stroke="#0a2560" stroke-width="8"/>
<rect x="8" y="32" width="104" height="72" rx="6" fill="none" stroke="#ffc82c" stroke-width="3" stroke-dasharray="10 6"/>
<circle cx="60" cy="68" r="20" fill="#ffc82c" stroke="#15172b" stroke-width="4"/><path d="M52 62 c-8 -10 -20 -4 -16 6 M68 62 c8 -10 20 -4 16 6" stroke="#15172b" stroke-width="5" fill="none" stroke-linecap="round"/><text x="60" y="76" text-anchor="middle" font-family="system-ui" font-weight="900" font-size="18" fill="#15172b">?</text></svg></div>
<div class="flash" id="flash"></div><div class="word" id="word">BONK!</div>
<div class="reel" id="reel"><div class="strip" id="strip"></div><div class="mark"></div></div></div>
<div class="bar"><button class="buy" id="buy">Open crate</button><span id="bodies"></span><span class="err" id="err"></span>
<div class="reveal" id="rev"></div></div>
<div class="card0"><div class="chips" id="chips"></div><div class="grid" id="grid"></div></div>
<p><a href="/">Pick'em</a> · <a href="/#herd">See the herd</a></p></main>
<script>
const M = ${JSON.stringify(meta).replace(/</g, "\\u003c")};
// The key comes from /lockeroom in Discord. This browser remembers it until it expires, so the site's Lockeroom tab works too.
let T = new URLSearchParams(location.hash.slice(1)).get("t");
try {
  if (T) localStorage.setItem("lr_t", T);
  else T = localStorage.getItem("lr_t");
  if (T && Number(T.split(".")[1]) * 1000 < Date.now()) { localStorage.removeItem("lr_t"); T = null; }
} catch {}
if (T && !location.hash) history.replaceState(null, "", "#t=" + T);
const ICON = { fleece: "🧶", horns: "🐏", shirt: "👕", head: "🧢", eyes: "🕶️", mouth: "😁", neck: "📿", hand: "🏈", feet: "👟", gear: "🛡️", tattoo: "💉", marks: "🩹", bg: "🏟️", finish: "✨", pose: "🙌", body: "💪" };
const h = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let S = null, filter = "all", busy = false;
const ramSrc = (opt) => "/ram/" + S.uid + "/" + (opt ? opt + "-bare" : "bare") + "~" + Date.now() + ".svg";
async function call(op, extra) {
  const r = await fetch("/api/locker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: T, op, ...extra }) });
  const d = await r.json(); $("err").textContent = d.error || "";
  if (r.status === 401 || /link expired/.test(d.error || "")) { try { localStorage.removeItem("lr_t"); } catch {} }
  if (d.uid) { S = d; if (op !== "crate") $("ram").firstChild.src = ramSrc(); draw(); }
  return d;
}
function draw() {
  $("sub").innerHTML = h(S.name || "Your ram") + " · <b>" + S.points + " RUTS</b> · " + S.crates + " crate" + (S.crates === 1 ? "" : "s") + " waiting · " + S.items.length + " items";
  $("bodies").innerHTML = Object.entries(M.bodies).map(([k, n]) => '<button data-b="' + k + '" class="' + ((S.look.body || "med") === k ? "on" : "") + '">' + n + "</button>").join(" ");
  const b = $("buy");
  if (!busy) { b.textContent = S.crates > 0 ? "📦 Open crate (" + S.crates + ")" : "📦 Buy crate · " + M.cost + " RUTS"; b.disabled = S.crates < 1 && S.points < M.cost; }
  const slots = [...new Set(S.items.map((i) => i.slot))];
  $("chips").innerHTML = ['<button data-f="all" class="' + (filter === "all" ? "on" : "") + '">All</button>'].concat(slots.map((sl) =>
    '<button data-f="' + sl + '" class="' + (filter === sl ? "on" : "") + '">' + (ICON[sl] || "") + " " + h(M.slots[sl] || sl) + "</button>")).join("");
  const list = S.items.filter((i) => filter === "all" || i.slot === filter);
  $("grid").innerHTML = list.length ? list.map((i) => {
    const r = M.rarity[i.rarity] || { label: "Secret", color: "#5ee08f" }, on = S.look[i.slot] === i.id || (i.slot === "body" && S.look.body === i.id);
    return '<button class="it' + (on ? " on" : "") + '" data-i="' + i.id + '" data-s="' + i.slot + '" style="border-left-color:' + r.color + '">' + (ICON[i.slot] || "") + " " + h(i.name)
      + '<small><span style="color:' + r.color + '">' + r.label + "</span> · " + h(M.slots[i.slot] || i.slot) + "</small></button>";
  }).join("") : '<div class="empty">Your locker is empty. Open a crate!</div>';
}
function randomItem() {
  const tiers = Object.entries(M.rarity); let x = Math.random() * tiers.reduce((s, [, v]) => s + v.weight, 0);
  let tier = tiers[0][0]; for (const [k, v] of tiers) { if ((x -= v.weight) < 0) { tier = k; break; } }
  const pool = M.items.filter((i) => i[3] === tier); return pool[Math.floor(Math.random() * pool.length)];
}
const cardHtml = (i, win) => { const r = M.rarity[i[3]] || { label: "Secret", color: "#5ee08f" };
  return '<div class="card' + (win ? " win-target" : "") + '" style="border-bottom-color:' + r.color + '"><div class="e">' + (ICON[i[2]] || "🎁") + '</div><div class="n">' + h(i[1]) + '</div><div class="r" style="color:' + r.color + '">' + r.label + "</div></div>"; };
async function unbox() {
  if (busy) return; busy = true; $("rev").style.display = "none";
  const btn = $("buy"); btn.disabled = true; btn.textContent = "Opening...";
  const ramEl = $("ram"), crate = $("crate"), img = ramEl.firstChild;
  const reqP = call("crate");
  // 1. headbutt the crate
  await ramEl.animate([{ left: "30%" }, { left: "20%" }], { duration: 380, easing: "ease-out", fill: "forwards" }).finished;
  img.animate([{ transform: "rotate(0)" }, { transform: "rotate(14deg)" }], { duration: 200, fill: "forwards" });
  await ramEl.animate([{ left: "20%" }, { left: "52%" }], { duration: 300, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" }).finished;
  $("flash").animate([{ opacity: .8 }, { opacity: 0 }], { duration: 250 });
  $("word").animate([{ opacity: 0, transform: "translateX(-50%) scale(.4)" }, { opacity: 1, transform: "translateX(-50%) scale(1.2)", offset: .3 }, { opacity: 0, transform: "translateX(-50%) scale(1)" }], { duration: 700 });
  $("room").animate([{ transform: "translate(0)" }, { transform: "translate(-8px,4px)" }, { transform: "translate(7px,-4px)" }, { transform: "translate(0)" }], { duration: 240 });
  crate.querySelector(".lid").animate([{ transform: "translate(0,0) rotate(0)" }, { transform: "translate(30px,-60px) rotate(-50deg)", opacity: 0 }], { duration: 600, fill: "forwards" });
  crate.animate([{ transform: "translateX(-50%) scale(1)" }, { transform: "translateX(-50%) scale(1.15,.85)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 300 });
  ramEl.animate([{ left: "52%" }, { left: "30%" }], { duration: 450, easing: "ease-out", fill: "forwards" });
  img.animate([{ transform: "rotate(14deg)" }, { transform: "rotate(0)" }], { duration: 300, fill: "forwards" });
  const d = await reqP;
  if (!d.reveal) { busy = false; crate.querySelector(".lid").getAnimations().forEach((a) => a.cancel()); draw(); return; }
  // 2. spin the reel and land on the item the server rolled
  const won = d.reveal.item, W = 138, N = 48, WIN = 42, reel = $("reel"), strip = $("strip");
  const cards = Array.from({ length: N }, (_, k) => k === WIN ? [won.id, won.name, won.slot, won.rarity] : randomItem());
  strip.innerHTML = cards.map((c, k) => cardHtml(c, k === WIN)).join("");
  strip.style.transition = "none"; strip.style.transform = "translateX(0)"; reel.style.display = "block";
  const target = WIN * W + 65 + (Math.random() - .5) * 90 - reel.clientWidth / 2;
  await sleep(60);
  strip.style.transition = "transform 5.2s cubic-bezier(.06,.7,.1,1)"; strip.style.transform = "translateX(" + (-target) + "px)";
  await sleep(5400);
  strip.children[WIN].classList.add("win");
  await sleep(1100);
  reel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).finished.then(() => { reel.style.display = "none"; });
  // 3. the ram tries it on
  img.src = ramSrc(won.id);
  img.animate([{ transform: "translateY(0)" }, { transform: "translateY(-10%)" }, { transform: "translateY(0)" }], { duration: 450, iterations: 2 });
  crate.querySelector(".lid").getAnimations().forEach((a) => a.cancel());
  const r = M.rarity[won.rarity] || { label: "SECRET", color: "#5ee08f" }, rv = $("rev");
  rv.style.display = "flex"; rv.style.borderLeftColor = r.color;
  rv.innerHTML = "<div><small style=\\"color:" + r.color + "\\">" + r.label + " " + h(M.slots[won.slot] || won.slot) + "</small><b>" + h(won.name) + "</b>"
    + (d.reveal.dupe ? "<div>Already had it: +" + d.reveal.refund + " RUTS</div>" : "") + "</div>"
    + (d.reveal.dupe ? "" : '<button data-i="' + won.id + '" data-s="' + won.slot + '">Equip</button>');
  busy = false; draw();
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t || busy) return;
  if (t.id === "buy") unbox();
  else if (t.dataset.b) call("body", { type: t.dataset.b });
  else if (t.dataset.f) { filter = t.dataset.f; draw(); }
  else if (t.dataset.i) t.classList.contains("on") ? call("unequip", { slot: t.dataset.s }) : call("equip", { item: t.dataset.i });
});
if (!T) {
  $("sub").innerHTML = "Locked. Type <b>/lockeroom</b> in Discord and click the button to get in. Your key works for 2 hours in this browser.";
  $("buy").disabled = true; $("buy").textContent = "🔒 Run /lockeroom in Discord";
  $("ram").firstChild.src = "/ram/100000000000000000/bare~0.svg";
} else call("state");
</script></body></html>`;
}

function fightPage(f) {
  const data = { id: f.id, a: f.a, b: f.b, an: f.a_name, bn: f.b_name, winner: f.winner, rounds: f.rounds, seed: f.seed, pot: f.stake * 2, status: f.status };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ram Fight #${f.id}</title><meta property="og:title" content="Ram Fight #${f.id}: ${esc(f.a_name)} vs ${esc(f.b_name)}">
<style>:root{--bg:#0d1328;--gold:#ffc82c}body{margin:0;background:var(--bg);color:#eef2ff;font:16px system-ui,sans-serif;padding:16px}
main{max-width:980px;margin:0 auto}h1{margin:4px 0 14px;font-size:clamp(20px,4vw,30px)}h1 span{color:var(--gold)}
${FIELD_CSS}
.stage{height:min(52vw,460px);min-height:280px}
.ram{position:absolute;bottom:10%;width:30%;max-width:240px;transform:translateX(-50%);z-index:5}
.ram img{width:100%;display:block;transform-origin:50% 90%}
.ram .nm{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);background:rgba(0,0,0,.65);padding:2px 10px;border-radius:8px;font-weight:700;font-size:14px;white-space:nowrap}
.boom{position:absolute;left:50%;top:38%;width:160px;height:160px;margin:-80px 0 0 -80px;z-index:9;opacity:0;pointer-events:none}
.word{position:absolute;left:50%;top:18%;transform:translateX(-50%);z-index:10;font:900 clamp(28px,6vw,64px)/1 system-ui,sans-serif;color:#ffd400;-webkit-text-stroke:3px #15172b;opacity:0;pointer-events:none}
.stars{position:absolute;left:50%;top:-4%;width:60%;height:24%;transform:translateX(-50%);display:none}
.stars i{position:absolute;left:50%;top:50%;font-style:normal;font-size:clamp(16px,3vw,28px);animation:orbit 1.2s linear infinite}
@keyframes orbit{from{transform:rotate(0deg) translateX(46px) rotate(0deg) scaleY(1.6)}to{transform:rotate(360deg) translateX(46px) rotate(-360deg) scaleY(1.6)}}
.ring{position:absolute;width:22px;height:22px;margin:-11px;border-radius:50%;border:5px solid #ffd400;box-shadow:inset 0 0 0 2px #b8860b,0 0 0 2px #b8860b;z-index:8}
.banner{margin-top:16px;padding:14px 18px;border-radius:14px;background:#151d3b;font-size:18px;min-height:28px}
.banner b{color:var(--gold)}button{margin-top:12px;background:var(--gold);color:#111;border:0;border-radius:10px;padding:10px 18px;font:700 15px system-ui;cursor:pointer}
a{color:var(--gold)}
</style></head><body><main>
<h1>Fight #${f.id}: <span>${esc(f.a_name)}</span> vs <span>${esc(f.b_name)}</span></h1>
<div class="stage field" id="st">${FIELD}
<svg class="boom" id="boom" viewBox="-50 -50 100 100"><path d="M0 -48 L10 -16 L44 -28 L20 -2 L46 22 L12 16 L4 48 L-8 18 L-42 32 L-20 4 L-46 -20 L-12 -14 Z" fill="#fff6c2" stroke="#ffd400" stroke-width="4"/></svg>
<div class="word" id="word"></div>
<div class="ram" id="A"><img alt=""><div class="stars"><i>⭐</i><i style="animation-delay:-.4s">⭐</i><i style="animation-delay:-.8s">✨</i></div><div class="nm">${esc(f.a_name)}</div></div>
<div class="ram" id="B"><img alt=""><div class="stars"><i>⭐</i><i style="animation-delay:-.4s">⭐</i><i style="animation-delay:-.8s">✨</i></div><div class="nm">${esc(f.b_name)}</div></div>
</div>
<div class="banner" id="msg">Get ready...</div>
<button id="again" hidden>Watch again</button> <a href="/#herd">See the whole herd</a>
<script>
const F = ${JSON.stringify(data).replace(/</g, "\\u003c")};
${FIGHT_JS}
</script></main></body></html>`;
}

// Fight playback. Everything random comes from the fight's seed, so every replay is the same fight.
const FIGHT_JS = String.raw`
const st = document.getElementById("st"), msg = document.getElementById("msg"), boom = document.getElementById("boom"), word = document.getElementById("word");
const R = { A: document.getElementById("A"), B: document.getElementById("B") };
const src = (id, pose) => "/ram/" + id + ".svg?bare" + (pose ? "&pose=" + pose : "");
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const move = (el, x, ms, ease = "ease-in-out", extra = "") => el.animate([{ left: el.style.left }, { left: x + "%" }], { duration: ms, easing: ease, fill: "forwards" }).finished.then(() => { el.style.left = x + "%"; });
const tilt = (el, deg, ms = 200) => el.querySelector("img").animate([{ transform: getComputedStyle(el.querySelector("img")).transform }, { transform: "rotate(" + deg + "deg)" }], { duration: ms, fill: "forwards" }).finished;
const WORDS = ["BONK!", "CRACK!", "THUD!", "WHAM!", "KLONK!", "SMASH!"];
function reset() {
  for (const k of ["A", "B"]) { const el = R[k]; el.getAnimations().forEach((a) => a.cancel()); el.querySelector("img").getAnimations().forEach((a) => a.cancel());
    el.querySelector("img").src = src(F[k.toLowerCase()]); el.querySelector("img").style.transform = ""; el.querySelector(".stars").style.display = "none"; }
  R.A.style.left = "28%"; R.B.style.left = "72%";
  document.querySelectorAll(".ring").forEach((r) => r.remove());
}
function impact(rand) {
  word.textContent = WORDS[Math.floor(rand() * WORDS.length)];
  boom.animate([{ opacity: 1, transform: "scale(.2) rotate(0deg)" }, { opacity: 1, transform: "scale(1.3) rotate(20deg)", offset: .4 }, { opacity: 0, transform: "scale(1.6) rotate(30deg)" }], { duration: 420 });
  word.animate([{ opacity: 0, transform: "translateX(-50%) scale(.4)" }, { opacity: 1, transform: "translateX(-50%) scale(1.15)", offset: .3 }, { opacity: 0, transform: "translateX(-50%) scale(1)" }], { duration: 700 });
  st.animate([{ transform: "translate(0,0)" }, { transform: "translate(-8px,4px)" }, { transform: "translate(7px,-5px)" }, { transform: "translate(-4px,2px)" }, { transform: "translate(0,0)" }], { duration: 260 });
}
function coins(el, rand) {
  const box = st.getBoundingClientRect(), r = el.getBoundingClientRect();
  const x0 = r.left - box.left + r.width / 2, y0 = r.top - box.top + r.height * 0.35;
  for (let i = 0; i < 14; i++) {
    const c = document.createElement("div"); c.className = "ring"; st.appendChild(c);
    let x = x0, y = y0, vx = (rand() - .5) * 520, vy = -260 - rand() * 360, t0 = performance.now(), last = t0, bounces = 0;
    const floor = box.height * 0.92;
    (function fly(now) {
      const dt = (now - last) / 1000; last = now; vy += 900 * dt; x += vx * dt; y += vy * dt;
      if (y > floor && bounces < 2) { y = floor; vy *= -0.5; vx *= 0.7; bounces++; }
      c.style.left = x + "px"; c.style.top = y + "px"; c.style.transform = "scaleX(" + Math.abs(Math.cos(now / 90 + i)).toFixed(2) + ")";
      const age = now - t0; c.style.opacity = age > 1600 ? Math.max(0, 1 - (age - 1600) / 600) : 1;
      if (age < 2200) requestAnimationFrame(fly); else c.remove();
    })(t0);
  }
}
async function play() {
  document.getElementById("again").hidden = true; reset();
  if (F.status !== "done") { msg.innerHTML = F.status === "pending" ? "Waiting for <b>" + h(F.bn) + "</b> to accept..." : "This fight was called off."; return; }
  const rand = rng(F.seed), win = F.winner === F.a ? "A" : "B", lose = win === "A" ? "B" : "A";
  msg.textContent = "Round 1..."; await sleep(700);
  for (let r = 1; r <= F.rounds; r++) {
    msg.textContent = r === F.rounds ? "Final headbutt..." : "Round " + r + "...";
    await Promise.all([move(R.A, 16, 420), move(R.B, 84, 420), tilt(R.A, -6), tilt(R.B, 6)]);
    await sleep(150 + rand() * 250);
    await Promise.all([tilt(R.A, 14, 120), tilt(R.B, -14, 120), move(R.A, 42, 380, "cubic-bezier(.5,0,1,1)"), move(R.B, 58, 380, "cubic-bezier(.5,0,1,1)")]);
    impact(rand);
    if (r < F.rounds) {   // both stagger; someone gets pushed a little further
      const pushed = rand() < .5 ? "A" : "B";
      await Promise.all([move(R.A, pushed === "A" ? 26 : 34, 300, "ease-out"), move(R.B, pushed === "B" ? 74 : 66, 300, "ease-out"), tilt(R.A, 0), tilt(R.B, 0)]);
      await sleep(400);
    } else {
      const out = lose === "A" ? 18 : 82;
      await Promise.all([move(R[lose], out, 520, "cubic-bezier(.1,.8,.3,1)"), move(R[win], win === "A" ? 40 : 60, 300, "ease-out"),
        R[lose].querySelector("img").animate([{ transform: "rotate(" + (lose === "A" ? -20 : 20) + "deg)" }, { transform: "rotate(" + (lose === "A" ? -8 : 8) + "deg) translateY(14%) scaleY(.82)" }], { duration: 520, fill: "forwards" }).finished]);
      coins(R[lose], rand);
      R[lose].querySelector(".stars").style.display = "block";
      await tilt(R[win], 0);
      R[win].querySelector("img").src = src(F[win.toLowerCase()], rand() < .5 ? "pose_td" : "pose_roof");
      R[win].querySelector("img").animate([{ transform: "translateY(0)" }, { transform: "translateY(-12%)" }, { transform: "translateY(0)" }], { duration: 500, iterations: 3 });
      msg.innerHTML = "<b>" + h(win === "A" ? F.an : F.bn) + "</b> wins " + F.pot + " RUTS!";
    }
  }
  document.getElementById("again").hidden = false;
}
document.getElementById("again").onclick = play;
for (const k of ["A", "B"]) R[k].querySelector("img").src = src(F[k.toLowerCase()]);
play();
`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rams Pick'em</title>
<style>
:root{--bg:#0e1116;--card:#171b22;--card2:#1e232c;--line:#2a303b;--text:#e8ebf0;--muted:#8b93a1;
--blue:#003594;--gold:#ffa300;--good:#2fbf71;--bad:#e5484d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:linear-gradient(135deg,var(--blue),#001a4d);padding:28px 16px 0;border-bottom:3px solid var(--gold)}
.wrap{max-width:1100px;margin:0 auto}
h1{margin:0;font-size:28px;letter-spacing:.5px}h1 span{color:var(--gold)}
.sub{color:#c9d3ea;margin:4px 0 18px}
nav{display:flex;gap:4px}
nav button{background:none;border:0;color:#c9d3ea;font:inherit;font-weight:600;padding:10px 16px;border-radius:10px 10px 0 0;cursor:pointer}
nav button.on{background:var(--bg);color:var(--gold)}
nav .navlink{color:#c9d3ea;font-weight:600;padding:10px 16px;text-decoration:none;border-radius:10px 10px 0 0}nav .navlink:hover{color:var(--gold)}
main{padding:20px 16px 48px}
.note{color:var(--muted);margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.game{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;position:relative}
.game.rams{grid-column:1/-1;border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
.tag{position:absolute;top:-10px;left:14px;background:var(--gold);color:#111;font-weight:800;font-size:11px;letter-spacing:1px;padding:2px 8px;border-radius:6px}
.meta{display:flex;justify-content:space-between;color:var(--muted);font-size:13px;margin-bottom:10px}
.lock{color:var(--gold)}
.vs{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:start}
.at{color:var(--muted);font-weight:700;padding-top:22px}
.side{background:var(--card2);border-radius:12px;padding:10px;min-height:120px;text-align:center;border:2px solid transparent}
.side.win{border-color:var(--good)}.side.lose{opacity:.55}
.team{display:flex;align-items:center;justify-content:center;gap:8px;font-weight:800;font-size:18px}
.team img{width:44px;height:44px;object-fit:contain}
.count{color:var(--muted);font-size:12px;margin:2px 0 8px}
.faces{display:flex;flex-wrap:wrap;justify-content:center;padding-left:8px}
.face{position:relative;margin-left:-8px;margin-bottom:4px}
.face img{width:30px;height:30px;border-radius:50%;border:2px solid var(--card2);display:block;background:#333;transition:transform .15s}
.face:hover img{transform:translateY(-4px) scale(1.15);border-color:var(--gold);z-index:2;position:relative}
.face .tip{position:absolute;bottom:115%;left:50%;transform:translateX(-50%);background:#000;color:#fff;font-size:12px;white-space:nowrap;padding:3px 8px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .12s;z-index:5}
.face:hover .tip{opacity:1}
.lose .face img{filter:grayscale(1)}
.bar{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-top:12px;background:var(--line)}
.bar i{display:block;background:var(--blue)}.bar b{display:block;background:var(--gold)}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:14px;overflow:hidden}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.8px}
td.n{font-variant-numeric:tabular-nums}
.who{display:flex;align-items:center;gap:10px}.who img{width:30px;height:30px;border-radius:50%}
.pct{display:flex;align-items:center;gap:8px}.pct span{height:6px;background:var(--gold);border-radius:3px}
.empty{color:var(--muted);padding:40px;text-align:center}
.pasture{height:560px}
${FIELD_CSS}
.rw{position:absolute;width:150px;margin-left:-75px;margin-top:-150px;text-align:center;cursor:pointer;text-decoration:none;color:#fff}
.rw img{width:150px;height:150px;display:block;transition:transform .25s}
.rw span{display:inline-block;margin-top:-14px;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:8px;font-size:12px;font-weight:700;white-space:nowrap}
.rw span b{color:var(--gold);font-weight:700;margin-left:4px}
.rw:hover span{background:var(--gold);color:#111}.rw:hover span b{color:#111}
@media (max-width:560px){.pasture{height:460px}.rw,.rw img{width:110px}.rw{margin-left:-55px;margin-top:-110px}.rw img{height:110px}}
@media (max-width:560px){.grid{grid-template-columns:1fr}h1{font-size:22px}nav button{padding:10px 10px}}
</style>
</head>
<body>
<header><div class="wrap">
<h1>RAMS <span>PICK'EM</span></h1>
<div class="sub" id="sub">Loading...</div>
<nav><button data-t="week" class="on">This Week</button><button data-t="last">Last Week</button><button data-t="table">Standings</button><button data-t="herd">Herd</button><a class="navlink" href="/lockeroom">Lockeroom</a></nav>
</div></header>
<template id="fieldtpl">${FIELD}</template>
<main><div class="wrap" id="view"><div class="empty">Loading picks...</div></div></main>
<script>
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const view = document.getElementById("view"), sub = document.getElementById("sub");
let week = null, hist = null, herd = null, tab = "week", raf = 0;
const when = (iso) => new Date(iso).toLocaleString([], {weekday:"short", hour:"numeric", minute:"2-digit"});

function faces(users) {
  return '<div class="faces">' + users.map((u) =>
    '<div class="face"><img loading="lazy" src="' + esc(u.avatar) + '" alt=""><span class="tip">' + esc(u.name) + '</span></div>').join("") + '</div>';
}
function side(s, total, result) {
  const n = s.users.length, pct = total ? Math.round(100 * n / total) : 0;
  const cls = result ? (result === s.abbr ? " win" : result === "TIE" ? "" : " lose") : "";
  return '<div class="side' + cls + '"><div class="team">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="">' : "") + esc(s.abbr) + '</div>'
    + '<div class="count">' + n + ' pick' + (n === 1 ? "" : "s") + ' · ' + pct + '%</div>' + faces(s.users) + '</div>';
}
function card(g, result) {
  const [a, h] = g.sides, total = a.users.length + h.users.length;
  const ap = total ? 100 * a.users.length / total : 50;
  const status = result ? (result === "TIE" ? "Final · tie" : "Final · " + esc(result) + " won")
    : (g.locked ? '<span class="lock">Locked</span>' : "Open · locks at kickoff");
  return '<div class="game' + (g.rams ? " rams" : "") + '">' + (g.rams ? '<div class="tag">RAMS GAME</div>' : "")
    + '<div class="meta"><span>' + (g.kick ? when(g.kick) : esc(g.game)) + '</span><span>' + status + '</span></div>'
    + '<div class="vs">' + side(a, total, result) + '<div class="at">@</div>' + side(h, total, result) + '</div>'
    + '<div class="bar"><i style="width:' + ap + '%"></i><b style="width:' + (100 - ap) + '%"></b></div></div>';
}
// Herd: every ram wanders the pasture, pauses, wanders again. Lower on screen = closer = bigger.
function pasture() {
  if (!herd) { view.innerHTML = '<div class="empty">Rounding up the herd...</div>'; return; }
  sub.textContent = herd.rams.length + " rams on the field";
  if (!herd.rams.length) { view.innerHTML = '<div class="empty">No rams yet. Open your first crate with /crate in Discord.</div>'; return; }
  view.innerHTML = '<p class="note">Click a ram to see its gear. Get your own with /crate in Discord, or settle it with /fight.</p><div class="pasture field" id="pa">' + document.getElementById("fieldtpl").innerHTML + '</div>';
  // Windows/Mac "reduce motion" settings only tone this down (no trotting bounce, no sprints); the rams still roam.
  const pa = document.getElementById("pa"), calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sheep = herd.rams.map((r) => {
    const el = document.createElement("a");
    el.className = "rw"; el.href = "/ram/" + r.id;
    el.innerHTML = '<img src="/ram/' + r.id + '.svg?bare" alt=""><span>' + esc(r.name) + (r.points ? '<b>' + r.points + ' RUTS</b>' : "") + '</span>';
    pa.appendChild(el);
    return { el, img: el.firstChild, x: rnd(14, 86), y: rnd(24, 96), tx: 0, ty: 0, wait: rnd(0, 0.8), speed: rnd(2.5, 4), t: rnd(0, 6) };
  });
  sheep.forEach((s) => { s.tx = s.x; s.ty = s.y; });
  let last = performance.now();
  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const s of sheep) {
      {
        if (s.wait > 0) s.wait -= dt;
        else {
          const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
          if (d < 0.5) {   // arrived: short breather, then a new spot anywhere on the field (sometimes a sprint)
            s.wait = Math.random() < .3 ? rnd(2, 4) : rnd(0.5, 1.5);
            s.tx = rnd(14, 86); s.ty = rnd(24, 96); s.speed = !calm && Math.random() < .15 ? rnd(6, 8) : rnd(2.5, 4);
          } else { const v = Math.min(1, s.speed * dt / d); s.x += dx * v; s.y += dy * v; s.t += dt * (4 + s.speed * 0.8); }
        }
      }
      const k = 0.6 + (s.y - 24) / 72 * 0.5;
      s.el.style.left = s.x + "%"; s.el.style.top = s.y + "%";
      const hop = s.wait > 0 || calm ? 0 : -Math.abs(Math.sin(s.t)) * 6;   // trotting bounce while moving
      s.el.style.transform = "translateY(" + hop.toFixed(1) + "px) scale(" + k.toFixed(3) + ")"; s.el.style.transformOrigin = "50% 100%";
      s.el.style.zIndex = Math.round(s.y * 10);
    }
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
}

function render() {
  cancelAnimationFrame(raf);
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
  if (tab === "herd") { pasture(); return; }
  if (tab === "week") {
    if (!week) return;
    if (week.error) { view.innerHTML = '<div class="empty">Couldn\\'t load this week: ' + esc(week.error) + '</div>'; return; }
    sub.textContent = (week.label || "This week") + " · live picks from Discord";
    view.innerHTML = week.games.length
      ? '<p class="note">Hover a face to see who picked it. Updates every couple of minutes.</p><div class="grid">'
        + week.games.map((g) => card(g)).join("") + '</div>'
      : '<div class="empty">New polls go up Tuesday at noon. Check Last Week and Standings in the meantime.</div>';
  } else if (tab === "last") {
    if (!hist) return;
    sub.textContent = (hist.label || "No graded weeks yet") + " · results";
    view.innerHTML = hist.games.length ? '<div class="grid">' + hist.games.map((g) => card(g, g.winner)).join("") + '</div>'
      : '<div class="empty">Nothing graded yet.</div>';
  } else {
    if (!hist) return;
    sub.textContent = (hist.season || "") + " season standings";
    view.innerHTML = '<table><thead><tr><th>#</th><th>Picker</th><th>W-L</th><th>Win %</th></tr></thead><tbody>'
      + hist.standings.map((p, i) => { const pct = p.w + p.l ? Math.round(100 * p.w / (p.w + p.l)) : 0;
        return '<tr><td class="n">' + (i + 1) + '</td><td><div class="who"><img src="' + esc(p.avatar) + '" alt="">' + esc(p.name) + '</div></td>'
          + '<td class="n">' + p.w + '-' + p.l + '</td><td><div class="pct"><span style="width:' + pct + 'px"></span>' + pct + '%</div></td></tr>'; }).join("")
      + '</tbody></table>';
  }
}
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => { tab = b.dataset.t; history.replaceState(null, "", "#" + tab); render(); });
if (["week", "last", "table", "herd"].includes(location.hash.slice(1))) tab = location.hash.slice(1);
fetch("/api/week").then((r) => r.json()).then((d) => { week = d; if (tab === "week") render(); }).catch((e) => { week = {error: e.message}; render(); });
render();
fetch("/api/history").then((r) => r.json()).then((d) => { hist = d; if (tab === "last" || tab === "table") render(); }).catch(() => {});
fetch("/api/herd").then((r) => r.json()).then((d) => { herd = d; if (tab === "herd") render(); }).catch(() => { herd = { rams: [] }; });
</script>
</body>
</html>`;
