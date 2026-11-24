// Public pick'em site served by the Worker.
//   /              the page
//   /api/week      this week's polls with who picked each side (live from Discord)
//   /api/history   last graded week (right/wrong) + season standings (from data/picks.csv)
//
// Needs the DISCORD_BOT_TOKEN Worker secret to read poll voters, avatars and logo emojis.

import { renderRam, ITEMS, SLOT_NAMES } from "./ram.js";

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

export async function handleSite(request, env, ctx) {
  const { pathname } = new URL(request.url);
  try {
    if (pathname === "/api/week") return json(await weekData(env, ctx), 60);
    if (pathname === "/api/history") return json(await historyData(env, ctx), 120);
    if (pathname === "/api/herd") return json(await herdData(env, ctx), 60);
  } catch (e) {
    return json({ error: String(e.message || e) }, 10);
  }
  const ram = pathname.match(/^\/ram\/(\d{5,25})(\.svg)?$/);
  if (ram && env.GAME) {
    const r = await env.GAME.get(env.GAME.idFromName("main")).look(ram[1]);
    const look = { ...(r?.look || {}) };
    if (new URL(request.url).searchParams.has("bare")) look.bg = "none";   // for the Herd pasture
    const svg = renderRam(look, 512, "css");
    if (ram[2]) return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=30" } });
    return new Response(ramPage(r?.name || "Ram", svg, look), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=30" } });
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
.pasture{position:relative;height:560px;border-radius:18px;overflow:hidden;border:1px solid var(--line);
  background:radial-gradient(ellipse 60% 30% at 20% 34%,#3f9a4a 0 99%,transparent 100%),radial-gradient(ellipse 70% 32% at 85% 36%,#358a40 0 99%,transparent 100%),
  linear-gradient(#6fb6ff 0,#a9d8ff 30%,#4caf50 30.2%,#2e7d32 100%)}
.sun{position:absolute;right:8%;top:6%;width:70px;height:70px;border-radius:50%;background:#ffe27a;box-shadow:0 0 40px #ffe27a}
.fence{position:absolute;left:0;right:0;top:31%;height:26px;background:repeating-linear-gradient(90deg,#8a5a3c 0 8px,transparent 8px 60px),linear-gradient(transparent 6px,#a8703f 6px 11px,transparent 11px 17px,#a8703f 17px 22px,transparent 22px)}
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
<nav><button data-t="week" class="on">This Week</button><button data-t="last">Last Week</button><button data-t="table">Standings</button><button data-t="herd">Herd</button></nav>
</div></header>
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
  sub.textContent = herd.rams.length + " rams in the pasture";
  if (!herd.rams.length) { view.innerHTML = '<div class="empty">No rams yet. Open your first crate with /crate in Discord.</div>'; return; }
  view.innerHTML = '<p class="note">Click a ram to see its gear. Get your own with /crate in Discord.</p><div class="pasture" id="pa"><div class="sun"></div><div class="fence"></div></div>';
  const pa = document.getElementById("pa"), still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sheep = herd.rams.map((r) => {
    const el = document.createElement("a");
    el.className = "rw"; el.href = "/ram/" + r.id;
    el.innerHTML = '<img src="/ram/' + r.id + '.svg?bare" alt=""><span>' + esc(r.name) + (r.points ? '<b>' + r.points + '</b>' : "") + '</span>';
    pa.appendChild(el);
    return { el, img: el.firstChild, x: rnd(8, 92), y: rnd(48, 96), tx: 0, ty: 0, wait: rnd(0, 3) };
  });
  sheep.forEach((s) => { s.tx = s.x; s.ty = s.y; });
  let last = performance.now();
  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const s of sheep) {
      if (!still) {
        if (s.wait > 0) s.wait -= dt;
        else {
          const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
          if (d < 0.5) { s.wait = rnd(1.5, 5); s.tx = Math.max(6, Math.min(94, s.x + rnd(-30, 30))); s.ty = rnd(48, 96); }
          else { const v = 4 * dt / d; s.x += dx * v; s.y += dy * v * 0.6; }
        }
      }
      const k = 0.62 + (s.y - 48) / 48 * 0.5;
      s.el.style.left = s.x + "%"; s.el.style.top = s.y + "%";
      s.el.style.transform = "scale(" + k.toFixed(3) + ")"; s.el.style.transformOrigin = "50% 100%";
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
