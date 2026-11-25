// Public pick'em site served by the Worker.
//   /              the page
//   /api/week      this week's polls with who picked each side (live from Discord)
//   /api/history   last graded week (right/wrong) + season standings (from data/picks.csv)
//
// Needs the DISCORD_BOT_TOKEN Worker secret to read poll voters, avatars and logo emojis.

import { renderRam, ITEMS, SLOT_NAMES, RARITY, BODY_TYPES, DEFAULT_LOOK, FACES, FACE_NAMES } from "./ram.js";
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
      return { game: p.game, kick: p.kick, rams: !!p.rams, weather: p.weather || null, locked: new Date(p.kick).getTime() <= now, sides };
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
// ---------- Live play-by-play for the Herd field (ESPN game summary) ----------
// Field coordinates: the Rams goal line is on the left. ball/first are yards from the Rams goal line.
const NFL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const RAMS_ID = "14";
async function ramsEvent(ctx) {
  return cached(ctx, "live-event", 300, async () => {
    const sb = await fetch(NFL + "/scoreboard", { cf: { cacheTtl: 60 } }).then((r) => r.json());
    const ev = (sb.events || []).find((e) => e.competitions?.[0]?.competitors?.some((c) => c.team?.id === RAMS_ID));
    return ev ? { id: ev.id, date: ev.date, state: ev.status?.type?.state } : null;
  });
}
function playOut(p) {
  const team = p.end?.team?.id || p.start?.team?.id;
  return { id: p.id, text: p.text || "", type: p.type?.text || "", q: p.period?.number, clock: p.clock?.displayValue || "",
    dd: p.start?.down ? p.start.shortDownDistanceText || "" : "", yds: p.statYardage ?? null,
    score: !!p.scoringPlay, turnover: !!p.isTurnover, team: p.start?.team?.id || team };
}
// yards from the Rams goal line for a play's start/end spot
const absYd = (spot) => spot && spot.yardsToEndzone != null && spot.team?.id ? (spot.team.id === RAMS_ID ? 100 - spot.yardsToEndzone : spot.yardsToEndzone) : null;
// drive chart kinds: run blue, pass green, lost yardage red, interception dashed red, penalty yellow
function playKind(p) {
  const t = (p.type?.text || "").toLowerCase();
  if (/interception/.test(t)) return "int";
  if (/sack/.test(t)) return "loss";
  if (/penalty/.test(t)) return "pen";
  if (/fumble/.test(t)) return p.isTurnover ? "int" : "rush";
  if (/pass/.test(t)) return "pass";
  if (/rush/.test(t)) return "rush";
  return null;   // kickoffs, punts, kicks, timeouts: not drawn
}
const STAT_COLS = { passing: ["C/ATT", "YDS", "TD", "INT"], rushing: ["CAR", "YDS", "AVG", "TD"], receiving: ["REC", "YDS", "TD", "LONG"], defensive: ["TOT", "SACKS", "TFL", "PD"] };
function boxStats(sum) {
  return (sum.boxscore?.players || []).map((tp) => ({ id: tp.team?.id, abbr: tp.team?.abbreviation,
    cats: Object.entries(STAT_COLS).map(([name, cols]) => {
      const c = (tp.statistics || []).find((x) => x.name === name);
      if (!c) return null;
      const idx = cols.map((l) => c.labels.indexOf(l));
      return { name, cols, rows: (c.athletes || []).slice(0, name === "defensive" ? 4 : 3).map((a) => ({ name: a.athlete?.displayName || "", num: a.athlete?.jersey || "", stats: idx.map((i) => i < 0 ? "" : a.stats[i]) })) };
    }).filter((c) => c && c.rows.length) }));
}
async function liveData(ctx) {
  const ev = await ramsEvent(ctx);
  if (!ev) return { state: "none" };
  const sum = await fetch(NFL + "/summary?event=" + ev.id, { cf: { cacheTtl: 8 } }).then((r) => r.json());
  const comp = sum.header?.competitions?.[0] || {};
  const st = comp.status?.type || {};
  const teams = (comp.competitors || []).map((c) => ({ id: c.team?.id, abbr: c.team?.abbreviation, score: c.score ?? "0",
    home: c.homeAway === "home", color: "#" + (c.team?.color || "555"), alt: "#" + (c.team?.alternateColor || "ffffff"), logo: c.team?.logos?.[0]?.href || c.team?.logo || "", poss: !!c.possession }));
  const out = { state: st.state || ev.state, detail: st.shortDetail || st.detail || "", date: ev.date, event: ev.id, teams, plays: [], drive: null };
  const dr = sum.drives || {};
  const drives = [...(dr.previous || []), ...(dr.current ? [dr.current] : [])];
  const flat = [];
  for (const d of drives) for (const p of d.plays || []) flat.push({ p, d });
  out.stats = boxStats(sum);
  if (out.state === "in") {   // timeouts live on the scoreboard's situation, not the summary
    try {
      const sb = await fetch(NFL + "/scoreboard", { cf: { cacheTtl: 8 } }).then((r) => r.json());
      const sit = (sb.events || []).find((e) => e.id === ev.id)?.competitions?.[0]?.situation;
      if (sit) for (const t of teams) t.to = t.home ? sit.homeTimeouts : sit.awayTimeouts;
    } catch {}
  }
  out.plays = flat.slice(-14).reverse().map(({ p, d }) => ({ ...playOut(p), abbr: d.team?.abbreviation || "" }));
  const last = flat[flat.length - 1];
  if (last && out.state !== "post") {   // where the ball is now
    const e = last.p.end || {}, team = e.team?.id;
    if (e.yardsToEndzone != null && team) {
      const rams = team === RAMS_ID, ball = rams ? 100 - e.yardsToEndzone : e.yardsToEndzone;
      const first = e.down ? Math.max(0, Math.min(100, rams ? ball + e.distance : ball - e.distance)) : null;
      const d = last.d;
      out.drive = { team, rams, ball, first, down: e.downDistanceText || e.shortDownDistanceText || "",
        summary: d.description || "", abbr: d.team?.abbreviation || "",
        chart: (d.plays || []).map((p) => {
          const kind = playKind(p), a = absYd(p.start); let b = absYd(p.end);
          if (!kind || a == null) return null;
          if (b == null) b = a;
          if (/incomplet/i.test(p.type?.text || "")) b = a;
          const dir = rams ? 1 : -1, gain = (b - a) * dir;
          return { a, b, kind: kind === "int" || kind === "pen" ? kind : gain < 0 ? "loss" : kind, yds: kind === "int" ? null : Math.round(gain), inc: /incomplet/i.test(p.type?.text || "") };
        }).filter(Boolean).slice(-12),
        start: d.start?.yardsToEndzone != null ? (rams ? 100 - d.start.yardsToEndzone : d.start.yardsToEndzone) : null };
    }
  }
  return out;
}

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
  } else if (body.op === "skin" && FACES[body.tone]) {
    await g.setLook(uid, "face", body.tone);
  }
  return json({ uid, ...(await g.locker(uid)), ...extra }, 0);
}

async function betsData(env, ctx) {
  if (!env.GAME) return { bets: [] };
  const stub = env.GAME.get(env.GAME.idFromName("main"));
  const [bets, hist, fights] = await Promise.all([stub.bets(), historyData(env, ctx).catch(() => ({ standings: [] })), stub.recentFights()]);
  const av = Object.fromEntries(hist.standings.map((p) => [p.id, p.avatar]));
  for (const b of bets) for (const u of b.users) u.avatar = av[u.id] || avatarUrl(u.id, null);
  return { bets, fights };
}

export async function handleSite(request, env, ctx) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/locker" && request.method === "POST" && env.GAME) return lockerApi(request, env);
  if (pathname === "/api/bingo" && env.GAME) {   // POST with a key: your card (+ re-roll); GET: the scoreboard only
    let body = {};
    if (request.method === "POST") { try { body = await request.json(); } catch {} }
    const uid = body.t ? await lockerUser(env, body.t) : null;
    try { return json({ ...(await env.GAME.get(env.GAME.idFromName("main")).bingo(uid, null, body.op)), me: uid, expired: !!body.t && !uid }, 0); }
    catch (e) { return json({ error: String(e.message || e) }, 0); }
  }
  if (pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /lockeroom\nDisallow: /lockerroom\nDisallow: /locker\n", { headers: { "Content-Type": "text/plain" } });
  if (pathname === "/locker" || pathname === "/lockeroom" || pathname === "/lockerroom") return new Response(lockerPage(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  try {
    if (pathname === "/api/week") return json(await weekData(env, ctx), 60);
    if (pathname === "/api/history") return json(await historyData(env, ctx), 120);
    if (pathname === "/api/herd") return json(await herdData(env, ctx), 60);
    if (pathname === "/api/bets") return json(await betsData(env, ctx), 30);
    if (pathname === "/api/live") return json(await liveData(ctx), 8);
    const pm = pathname.match(/^\/api\/player\/(\d{5,25})$/);   // public game stats: RUTS, crates, history
    if (pm && env.GAME) { const l = await env.GAME.get(env.GAME.idFromName("main")).locker(pm[1]); delete l.look; return json(l, 15); }
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
  if (pathname === "/npc/ref.svg") return new Response(renderRam({ bg: "none", shirt: "shirt_referee_tee", head: "head_ref_cap", neck: "neck_whistle", hand: "hand_flag_yellow", pose: "pose_point", feet: "feet_cleat_black" }, 512, "css"),
    { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
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

// The site's top bar for pages outside the tabbed app (the Locker Room), so the tabs are always one click away.
const TOPBAR_CSS = `.tb{background:linear-gradient(135deg,#003594,#001a4d);padding:22px 16px 0;border-bottom:3px solid #ffa300;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.tb .w{max-width:1100px;margin:0 auto}.tb .t{margin:0 0 14px;font:700 28px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;color:#e8ebf0}.tb .t span{color:#ffa300}
.tb nav{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}.tb nav::-webkit-scrollbar{display:none}
.tb nav a{white-space:nowrap;flex:0 0 auto;color:#c9d3ea;font-weight:600;padding:10px 16px;text-decoration:none;border-radius:10px 10px 0 0}.tb nav a:hover{color:#ffa300}
.tb nav a.on{background:var(--bg);color:#ffa300}@media (max-width:560px){.tb .t{font-size:22px}.tb nav a{padding:10px}}`;
const TOPBAR = (on) => `<header class="tb"><div class="w"><div class="t">RAMS <span>PICK'EM</span></div><nav>`
  + [["/#week", "This Week"], ["/#last", "Last Week"], ["/#table", "Standings"], ["/#bets", "Bets &amp; Fights"], ["/#herd", "Herd"], ["/#bingo", "Bingo"], ["/locker", "Locker Room"]]
    .map(([h, l]) => `<a href="${h}"${h === on ? ' class="on"' : ""}>${l}</a>`).join("") + `</nav></div></header>`;

// ---------- The Locker Room scene (1000 x 470): lockers with gear on the left, the shower in the back right ----------
const SC_OUT = "#15172b";
function lockerScene() {
  const jersey = (x, y, c, num, trim) => `<g transform="translate(${x} ${y})">
    <path d="M -9 -4 Q 0 -14 9 -4" stroke="#9aa3b2" stroke-width="3" fill="none"/>
    <path d="M -30 2 L -14 -6 L 14 -6 L 30 2 L 24 18 L 17 14 L 17 58 L -17 58 L -17 14 L -24 18 Z" fill="${c}" stroke="${SC_OUT}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M -9 -6 L 0 4 L 9 -6" fill="none" stroke="${trim}" stroke-width="3"/>
    <text x="0" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="22" fill="${trim}">${num}</text></g>`;
  const helmet = (x, y, c, stripe) => `<g transform="translate(${x} ${y})">
    <path d="M -24 8 C -26 -18, 22 -26, 26 2 L 26 10 L 6 10 L 6 2 L -8 2 L -10 10 Z" fill="${c}" stroke="${SC_OUT}" stroke-width="3"/>
    <path d="M 0 -15 C 6 -12, 12 -8, 14 -2" stroke="${stripe}" stroke-width="4" fill="none"/>
    <path d="M 8 4 L 30 4 M 8 9 L 30 9 M 30 2 L 30 12" stroke="#cfd6e0" stroke-width="2.5"/></g>`;
  const cleats = (x, y, c) => `<g transform="translate(${x} ${y})">${[0, 22].map((d) => `<path d="M ${d - 10} 0 C ${d - 10} -9, ${d + 2} -9, ${d + 12} -2 L ${d + 12} 2 L ${d - 10} 2 Z" fill="${c}" stroke="${SC_OUT}" stroke-width="2"/>`).join("")}</g>`;
  const photo = (x, y, rot, inner, art) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-14" y="-16" width="28" height="32" fill="#f4f1ea" stroke="#0004"/>
    <rect x="-11" y="-13" width="22" height="20" fill="${inner}"/>${art}<rect x="-6" y="-20" width="12" height="6" fill="#fff8" transform="rotate(${-rot})"/></g>`;
  const ramPic = `<circle cx="0" cy="-2" r="5" fill="#f4ecd8"/><path d="M -5 -5 q -6 -2 -5 4 M 5 -5 q 6 -2 5 4" stroke="#c8a46a" stroke-width="2" fill="none"/>`;
  const ballPic = `<ellipse cx="0" cy="-3" rx="7" ry="4.5" fill="#8b4a22"/><path d="M -3 -3 L 3 -3" stroke="#fff" stroke-width="1"/>`;
  const trophyPic = `<path d="M -4 -8 L 4 -8 L 3 -2 L -3 -2 Z M -1 -2 L 1 -2 L 1 2 L -1 2 Z" fill="#ffc82c"/>`;
  const W = 96, N = 7;
  const lockers = Array.from({ length: N }, (_, i) => {
    const x = 8 + i * W, open = i % 3 !== 1;
    const nums = [12, 99, 7, 24, 33, 81, 10], c = i % 2 ? "#ffc82c" : "#003594", trim = i % 2 ? "#003594" : "#ffc82c";
    const frame = `<rect x="${x}" y="40" width="${W - 6}" height="290" fill="#0a2560" stroke="${SC_OUT}" stroke-width="3"/>
      <rect x="${x + 18}" y="46" width="${W - 42}" height="16" rx="3" fill="#cfd6e0"/><text x="${x + (W - 6) / 2}" y="58" text-anchor="middle" font-family="system-ui" font-weight="800" font-size="12" fill="#003594">${nums[i]}</text>`;
    if (!open) return frame + `<rect x="${x + 6}" y="68" width="${W - 18}" height="256" rx="3" fill="#123a8f" stroke="${SC_OUT}" stroke-width="2"/>
      ${[0, 1, 2, 3, 4].map((k) => `<rect x="${x + 22}" y="${80 + k * 8}" width="${W - 50}" height="3" fill="#0a2560"/>`).join("")}
      <rect x="${x + W - 26}" y="180" width="6" height="26" rx="2" fill="#cfd6e0"/>
      ${photo(x + 30, 150, -6, "#7fd0ff", ramPic)}${photo(x + 58, 168, 5, "#2f8f3c", ballPic)}${photo(x + 32, 214, 3, "#3b1d6e", trophyPic)}`;
    return frame + `<rect x="${x + 6}" y="68" width="${W - 18}" height="256" fill="#06153a"/>
      <rect x="${x + 6}" y="110" width="${W - 18}" height="5" fill="#26315f"/>
      ${helmet(x + 44, 96, i === 3 ? "#ffc82c" : "#003594", i === 3 ? "#003594" : "#ffc82c")}
      ${jersey(x + 45, 140, c, nums[i], trim)}
      ${photo(x + 74, 136, 8, "#ff9ccf", ramPic)}
      ${cleats(x + 33, 316, i % 2 ? "#ffc82c" : "#f5f5f2")}`;
  }).join("");
  const tiles = `<pattern id="tile" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="#dfe9f2"/><path d="M 22 0 L 0 0 0 22" fill="none" stroke="#b9c8d6" stroke-width="2"/></pattern>
    <pattern id="tile2" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="#c9dbe9"/><path d="M 22 0 L 0 0 0 22" fill="none" stroke="#a3b8ca" stroke-width="2"/></pattern>`;
  const heads = [760, 880].map((x) => `<path d="M ${x + 20} 40 L ${x + 20} 70 L ${x} 70" fill="none" stroke="#9aa3b2" stroke-width="6"/><path d="M ${x - 14} 66 L ${x + 10} 66 L ${x + 6} 78 L ${x - 10} 78 Z" fill="#cfd6e0" stroke="${SC_OUT}" stroke-width="2"/>
    ${Array.from({ length: 7 }, (_, k) => `<path class="drip" d="M ${x - 9 + k * 3} 80 L ${x - 22 + k * 7} 300" stroke="#7fd0ff" stroke-width="2" stroke-dasharray="6 14" opacity=".7" style="animation-delay:-${(k * 0.13).toFixed(2)}s"/>`).join("")}`).join("");
  return `<svg class="scene" viewBox="0 0 1000 470" preserveAspectRatio="xMinYMax slice" aria-hidden="true"><defs>${tiles}</defs>
    <rect width="1000" height="470" fill="#0b1f52"/>
    <rect x="0" y="0" width="690" height="34" fill="#0a1a40"/><rect x="0" y="30" width="690" height="8" fill="#ffc82c"/>
    ${lockers}
    <rect x="690" y="0" width="310" height="340" fill="url(#tile)"/><rect x="690" y="0" width="10" height="340" fill="#9aa3b2"/>
    ${heads}
    <rect x="0" y="330" width="1000" height="140" fill="#2a2f3d"/><rect x="690" y="330" width="310" height="140" fill="url(#tile2)"/>
    <rect x="0" y="330" width="690" height="6" fill="#1c2030"/>
  </svg>`;
}
// Drawn in front of the showering rams: the half wall, the curtain rod, steam, and the bench.
function lockerFront() {
  return `<svg class="scene front" viewBox="0 0 1000 470" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
    <rect x="700" y="262" width="300" height="80" fill="url(#tile)" stroke="#9aa3b2" stroke-width="4"/><rect x="700" y="256" width="300" height="10" fill="#cfd6e0"/>
    <path d="M 700 20 L 1000 20" stroke="#9aa3b2" stroke-width="5"/>
    <path d="M 700 22 C 712 120, 690 200, 706 262 L 730 262 C 718 200, 738 120, 724 22 Z" fill="#ffc82c" opacity=".9" stroke="#15172b" stroke-width="2"/>
    ${[[780, 150, 70], [880, 120, 90], [940, 190, 60], [820, 220, 80]].map(([x, y, r], k) => `<ellipse class="steam" cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.5}" fill="#fff" style="animation-delay:-${k * 1.7}s"/>`).join("")}
    <rect x="40" y="350" width="620" height="16" rx="6" fill="#a8703f" stroke="#15172b" stroke-width="3"/><rect x="70" y="366" width="12" height="34" fill="#6b4423"/><rect x="618" y="366" width="12" height="34" fill="#6b4423"/>
  </svg>`;
}

function lockerPage() {
  const meta = {
    slots: SLOT_NAMES, bodies: BODY_TYPES, cost: CRATE_COST, defaults: DEFAULT_LOOK,
    skins: Object.fromEntries(Object.keys(FACES).map((k) => [k, [FACE_NAMES[k], FACES[k]]])),
    rarity: Object.fromEntries(Object.entries(RARITY).map(([k, v]) => [k, { label: v.label, weight: v.weight, color: "#" + v.color.toString(16).padStart(6, "0") }])),
    // every crate item, for the spinning reel
    // the whole catalog (the secret finish stays hidden until someone owns it); [id, name, slot, rarity, starter]
    items: Object.values(ITEMS).filter((i) => i.rarity !== "secret").map((i) => [i.id, i.name, i.slot, i.rarity, i.starter ? 1 : 0]),
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Locker Room</title><meta name="robots" content="noindex">
<style>:root{--bg:#0b1024;--card:#151d3b;--card2:#1c2650;--line:#26315f;--ink:#eef2ff;--dim:#9aa6c7;--gold:#ffc82c;--blue:#003594}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px}
${TOPBAR_CSS}
h1{margin:0;font:900 clamp(24px,5vw,40px)/1 system-ui,sans-serif;letter-spacing:2px}h1 span{color:var(--gold)}
.sub{color:var(--dim);margin:6px 0 14px}.sub b{color:var(--gold)}
/* the room: a wall of lockers, a bench, a floor */
.room{position:relative;height:min(62vw,470px);min-height:330px;border-radius:18px;overflow:hidden;border:1px solid var(--line);background:#0b1f52}
.room .scene{position:absolute;inset:0;width:100%;height:100%}.room .scene.front{z-index:2;pointer-events:none}
.room .drip{animation:drip .5s linear infinite}@keyframes drip{to{stroke-dashoffset:-40}}
.room .steam{opacity:.18;animation:steam 7s ease-in-out infinite}@keyframes steam{0%,100%{transform:translateY(0);opacity:.12}50%{transform:translateY(-24px);opacity:.3}}
.showerram{position:absolute;width:min(17vw,150px);z-index:1;transform:translateX(-50%)}
.showerram img{width:100%;display:block;animation:sway 3.4s ease-in-out infinite}@keyframes sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.bub{position:absolute;border:2px solid #fffc;border-radius:50%;z-index:3;animation:bub 4s linear infinite;pointer-events:none}
@keyframes bub{from{transform:translateY(0);opacity:.9}to{transform:translateY(-120px);opacity:0}}
.lr-ram{position:absolute;bottom:6%;left:30%;width:min(34vw,280px);transform:translateX(-50%);z-index:12}
.lr-ram img{width:100%;display:block;transform-origin:50% 90%}
.crate{position:absolute;bottom:5%;left:60%;width:min(26vw,220px);transform:translateX(-50%);z-index:4}
.crate .wheel{transform-box:fill-box;transform-origin:center}.crate.rolling .wheel{animation:spin .35s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.crate svg{width:100%;display:block}.crate .lid{transform-box:fill-box;transform-origin:0% 100%}
.flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:8}
.word{position:absolute;left:58%;top:22%;transform:translateX(-50%);z-index:9;font:900 clamp(28px,6vw,60px)/1 system-ui;color:#ffd400;-webkit-text-stroke:3px #15172b;opacity:0;pointer-events:none}
/* the reel */
.reel{position:absolute;left:0;right:0;top:3%;height:150px;background:rgba(5,8,20,.92);border-top:2px solid var(--gold);border-bottom:2px solid var(--gold);
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
.skins{display:inline-flex;gap:6px;align-items:center}.sk{width:28px;height:28px;padding:0;border-radius:50%;border:2px solid var(--line)}.sk.on{border-color:var(--gold);box-shadow:0 0 0 2px var(--gold)}
.buy{background:var(--gold);color:#111;border:0;font-size:17px;padding:13px 22px;font-weight:800}
.reveal{display:none;margin-left:auto;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-left:5px solid;border-radius:12px;padding:8px 12px}
.reveal b{font-size:17px}.reveal small{display:block;font-weight:800;letter-spacing:1px;text-transform:uppercase;font-size:11px}
.card0{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}.chips button{padding:6px 10px;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.it{text-align:left;padding:10px;border-left-width:4px}.it small{display:block;color:var(--dim);font-weight:500;margin-top:2px}
.it.on{background:#24305f;box-shadow:inset 0 0 0 1px var(--gold)}.it.on::after{content:" ✓";color:var(--gold)}
.it.locked{opacity:.4;cursor:default;filter:grayscale(.6)}.chips small{color:var(--dim);font-weight:500}
.err{color:#ff8080}.empty{color:var(--dim);padding:24px;text-align:center}a{color:var(--gold)}
</style></head>
<body>${TOPBAR("/locker")}<main><h1>THE <span>LOCKER ROOM</span></h1><div class="sub" id="sub">Loading...</div>
<div class="room" id="room">${lockerScene()}<div id="showers"></div>${lockerFront()}
<div class="lr-ram" id="ram"><img alt="Your ram"></div>
<div class="crate" id="crate"><svg viewBox="0 0 170 150" overflow="visible">
<path d="M 18 44 L 152 44 L 140 112 L 30 112 Z" fill="#9aa3b2" stroke="#15172b" stroke-width="4" stroke-linejoin="round"/>
<path d="M 22 50 L 148 50 L 137 106 L 33 106 Z" fill="#c9d3ea"/>
<path d="M 34 58 L 136 58 M 36 72 L 134 72 M 38 86 L 132 86 M 40 100 L 130 100" stroke="#9aa3b2" stroke-width="2"/>
<rect x="54" y="66" width="62" height="26" rx="4" fill="#ffc82c" stroke="#15172b" stroke-width="3"/><text x="85" y="84" text-anchor="middle" font-family="system-ui" font-weight="900" font-size="10" fill="#003594">LAUNDRY</text>
<path d="M 12 40 L 158 40" stroke="#cfd6e0" stroke-width="7" stroke-linecap="round"/><path d="M 12 40 L 158 40" stroke="#15172b" stroke-width="2" stroke-dasharray="0" opacity=".25"/>
<path d="M 152 44 C 160 40, 166 30, 162 18" fill="none" stroke="#cfd6e0" stroke-width="6" stroke-linecap="round"/>
<path d="M 30 112 L 140 112" stroke="#6b7280" stroke-width="6"/>
<g class="lid">
<path d="M 30 44 C 34 20, 64 14, 74 30 C 80 10, 112 12, 116 34 C 130 24, 150 34, 142 48 Z" fill="#f4f1ea" stroke="#15172b" stroke-width="3"/>
<path d="M 52 40 L 66 22 L 86 22 L 98 40 Z" fill="#003594" stroke="#15172b" stroke-width="3"/><text x="77" y="38" text-anchor="middle" font-family="system-ui" font-weight="900" font-size="12" fill="#ffc82c">?</text>
<path d="M 104 46 C 110 30, 126 28, 134 40" fill="none" stroke="#ffc82c" stroke-width="7" stroke-linecap="round"/>
<path d="M 30 46 C 22 50, 18 62, 24 70" fill="none" stroke="#ff7fb0" stroke-width="7" stroke-linecap="round"/></g>
<g class="wheels">${[38, 132].map((x) => `<g transform="translate(${x} 126)"><path d="M 0 -14 L 0 -6" stroke="#6b7280" stroke-width="5"/><g class="wheel"><circle r="10" fill="#2b2b33" stroke="#15172b" stroke-width="3"/><path d="M -6 0 L 6 0 M 0 -6 L 0 6" stroke="#9aa3b2" stroke-width="2"/></g></g>`).join("")}</g>
</svg></div>
<div class="flash" id="flash"></div><div class="word" id="word">BONK!</div>
<div class="reel" id="reel"><div class="strip" id="strip"></div><div class="mark"></div></div></div>
<div class="bar"><button class="buy" id="buy">Open crate</button><span id="bodies"></span><span id="skins" class="skins"></span><span class="err" id="err"></span>
<div class="reveal" id="rev"></div></div>
<div class="card0"><div class="chips" id="chips"></div><div class="grid" id="grid"></div></div>
<p><a href="/">Pick'em</a> · <a href="/#herd">See the herd</a></p></main>
<script>
const M = ${JSON.stringify(meta).replace(/</g, "\\u003c")};
// The key comes from /locker in Discord. This browser remembers it until it expires, so the site's Locker Room tab works too.
let T = new URLSearchParams(location.hash.slice(1)).get("t");
try {
  if (T) localStorage.setItem("lr_t", T);
  else T = localStorage.getItem("lr_t");
  if (T && Number(T.split(".")[1]) * 1000 < Date.now()) { localStorage.removeItem("lr_t"); T = null; }
} catch {}
if (T && !location.hash) history.replaceState(null, "", "#t=" + T);
const ICON = { fleece: "🧶", horns: "🐏", shirt: "👕", head: "🧢", eyes: "🕶️", nose: "💍", mouth: "😁", neck: "📿", arms: "🦩", hand: "🏈", feet: "👟", gear: "🛡️", tattoo: "💉", marks: "🩹", bg: "🏟️", finish: "✨", pose: "🙌", body: "💪" };
const h = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const $ = (id) => document.getElementById(id);
const SLOT = Object.assign({}, M.slots, { neck: "Neck & Scarves", head: "Hats", hand: "In Hand", feet: "Shoes", bg: "Background", body: "Body" });
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
  $("sub").innerHTML = h(S.name || "Your ram") + " · <b>" + S.points + " RUTS</b> · " + S.crates + " crate" + (S.crates === 1 ? "" : "s") + " waiting · " + S.items.length + " items · 🎯 Rare+ in " + (10 - (S.opened % 10)) + (10 - (S.opened % 10) === 1 ? " crate" : " crates");
  $("bodies").innerHTML = Object.entries(M.bodies).map(([k, n]) => '<button data-b="' + k + '" class="' + ((S.look.body || "med") === k ? "on" : "") + '">' + n + "</button>").join(" ");
  $("skins").innerHTML = Object.entries(M.skins).map(([k, [n, c]]) => '<button class="sk' + ((S.look.face || "tan") === k ? " on" : "") + '" data-skin="' + k + '" title="' + n + '" style="background:' + c + '"></button>').join("");
  const b = $("buy");
  if (!busy) { b.textContent = S.crates > 0 ? "📦 Open crate (" + S.crates + ")" : "📦 Buy crate · " + M.cost + " RUTS"; b.disabled = S.crates < 1 && S.points < M.cost; }
  // Wardrobe: every section, every option. Owned items wear on click; locked ones show what's out there.
  const owned = new Set(S.items.map((i) => i.id).concat(M.items.filter((i) => i[4]).map((i) => i[0])));
  const catalog = M.items.concat(S.items.filter((i) => !M.items.some((m) => m[0] === i.id)).map((i) => [i.id, i.name, i.slot, i.rarity, 0]));
  const sections = Object.keys(M.slots).concat("body").filter((sl) => catalog.some((i) => i[2] === sl));
  const count = (sl) => catalog.filter((i) => i[2] === sl && owned.has(i[0])).length + "/" + catalog.filter((i) => i[2] === sl).length;
  $("chips").innerHTML = ['<button data-f="all" class="' + (filter === "all" ? "on" : "") + '">✅ Owned (' + owned.size + ")</button>"].concat(sections.map((sl) =>
    '<button data-f="' + sl + '" class="' + (filter === sl ? "on" : "") + '">' + (ICON[sl] || "") + " " + h(SLOT[sl] || sl) + " <small>" + count(sl) + "</small></button>")).join("");
  const order = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4, secret: 5 };
  const list = catalog.filter((i) => filter === "all" ? owned.has(i[0]) : i[2] === filter)
    .sort((a, b) => (owned.has(b[0]) - owned.has(a[0])) || (order[a[3]] - order[b[3]]));
  $("grid").innerHTML = list.length ? list.map(([id, name, slot, rarity]) => {
    const r = M.rarity[rarity] || { label: "Secret", color: "#5ee08f" }, have = owned.has(id);
    const on = slot === "body" ? S.look.body === id : S.look[slot] === id || (!S.look[slot] && M.defaults[slot] === id);
    return '<button class="it' + (on ? " on" : "") + (have ? "" : " locked") + '"' + (have ? ' data-i="' + id + '" data-s="' + slot + '"' : " disabled")
      + ' style="border-left-color:' + r.color + '">' + (have ? (ICON[slot] || "") : "🔒") + " " + h(name)
      + '<small><span style="color:' + r.color + '">' + r.label + "</span> · " + h(SLOT[slot] || slot) + "</small></button>";
  }).join("") : '<div class="empty">Your locker is empty. Open a crate!</div>';
}
function randomItem() {
  const tiers = Object.entries(M.rarity); let x = Math.random() * tiers.reduce((s, [, v]) => s + v.weight, 0);
  let tier = tiers[0][0]; for (const [k, v] of tiers) { if ((x -= v.weight) < 0) { tier = k; break; } }
  const pool = M.items.filter((i) => i[3] === tier && i[2] !== "base" && !i[4]); return pool[Math.floor(Math.random() * pool.length)];
}
const cardHtml = (i, win) => { const r = M.rarity[i[3]] || { label: "Secret", color: "#5ee08f" };
  return '<div class="card' + (win ? " win-target" : "") + '" style="border-bottom-color:' + r.color + '"><div class="e">' + (ICON[i[2]] || "🎁") + '</div><div class="n">' + h(i[1]) + '</div><div class="r" style="color:' + r.color + '">' + r.label + "</div></div>"; };
const r0 = (i) => (M.rarity[i.rarity] || { color: "#5ee08f" }).color;
async function unbox() {
  if (busy) return; busy = true; $("rev").style.display = "none";
  const btn = $("buy"); btn.disabled = true; btn.textContent = "Opening...";
  const ramEl = $("ram"), crate = $("crate"), img = ramEl.firstChild;
  const reqP = call("crate");
  // 1. headbutt the crate
  await ramEl.animate([{ left: "30%" }, { left: "20%" }], { duration: 380, easing: "ease-out", fill: "forwards" }).finished;
  img.animate([{ transform: "rotate(0)" }, { transform: "rotate(14deg)" }], { duration: 200, fill: "forwards" });
  await ramEl.animate([{ left: "20%" }, { left: "44%" }], { duration: 300, easing: "cubic-bezier(.5,0,1,1)", fill: "forwards" }).finished;
  $("flash").animate([{ opacity: .8 }, { opacity: 0 }], { duration: 250 });
  $("word").animate([{ opacity: 0, transform: "translateX(-50%) scale(.4)" }, { opacity: 1, transform: "translateX(-50%) scale(1.2)", offset: .3 }, { opacity: 0, transform: "translateX(-50%) scale(1)" }], { duration: 700 });
  $("room").animate([{ transform: "translate(0)" }, { transform: "translate(-8px,4px)" }, { transform: "translate(7px,-4px)" }, { transform: "translate(0)" }], { duration: 240 });
  crate.querySelector(".lid").animate([{ transform: "translate(0,0) rotate(0)" }, { transform: "translate(10px,-70px) rotate(-25deg)", opacity: 1, offset: .6 }, { transform: "translate(20px,-90px) rotate(-40deg)", opacity: 0 }], { duration: 700, fill: "forwards" });
  crate.classList.add("rolling");   // the cart rolls back from the hit, then settles
  crate.animate([{ transform: "translateX(-50%)" }, { transform: "translateX(-10%) rotate(3deg)" }, { transform: "translateX(-40%) rotate(-1deg)" }, { transform: "translateX(-50%)" }],
    { duration: 900, easing: "ease-out" }).finished.then(() => crate.classList.remove("rolling"));
  ramEl.animate([{ left: "44%" }, { left: "30%" }], { duration: 450, easing: "ease-out", fill: "forwards" });
  img.animate([{ transform: "rotate(14deg)" }, { transform: "rotate(0)" }], { duration: 300, fill: "forwards" });
  const d = await reqP;
  if (!d.reveal) { busy = false; crate.querySelector(".lid").getAnimations().forEach((a) => a.cancel()); draw(); return; }
  // 2. spin the reel and land on the item the server rolled
  const won = d.reveal.item, W = 138, N = 48, WIN = 42, reel = $("reel"), strip = $("strip");
  const cards = Array.from({ length: N }, (_, k) => k === WIN ? [won.id, won.name, won.slot, won.rarity] : randomItem());
  strip.innerHTML = cards.map((c, k) => cardHtml(c, k === WIN)).join("");
  strip.style.transition = "none"; strip.style.transform = "translateX(0)"; reel.style.display = "block";
  // the ram hypes up in front of the reel while it spins
  img.src = ramSrc("pose_hype");
  const hype = img.animate([{ transform: "translateY(0) rotate(-3deg)" }, { transform: "translateY(-7%) rotate(3deg)" }, { transform: "translateY(0) rotate(-3deg)" }],
    { duration: 420, iterations: Infinity, easing: "ease-in-out" });
  const target = WIN * W + 65 + (Math.random() - .5) * 90 - reel.clientWidth / 2;
  await sleep(60);
  strip.style.transition = "transform 5.2s cubic-bezier(.06,.7,.1,1)"; strip.style.transform = "translateX(" + (-target) + "px)";
  await sleep(3200);
  hype.updatePlaybackRate(0.55);   // slows down with the reel, leaning in
  await sleep(2200);
  hype.cancel();
  strip.children[WIN].classList.add("win");
  await sleep(1100);
  reel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).finished.then(() => { reel.style.display = "none"; });
  // 3. the ram tries it on and celebrates (bigger for rarer pulls)
  const big = ["epic", "legendary", "mythic", "secret"].includes(won.rarity);
  img.src = ramSrc(won.id) + "?pose=" + (big ? "pose_roof" : "pose_td");
  img.animate([{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-" + (big ? 22 : 12) + "%) scale(" + (big ? 1.08 : 1.03) + ")" }, { transform: "translateY(0) scale(1)" }],
    { duration: 480, iterations: big ? 4 : 2, easing: "ease-out" });
  if (big) $("flash").animate([{ opacity: .6, background: r0(won) }, { opacity: 0 }], { duration: 900 });
  setTimeout(() => { if (!busy) img.src = ramSrc(won.id); }, big ? 3500 : 2200);
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
  else if (t.dataset.skin) call("skin", { tone: t.dataset.skin });
  else if (t.dataset.f) { filter = t.dataset.f; draw(); }
  else if (t.dataset.i) t.classList.contains("on") ? call("unequip", { slot: t.dataset.s }) : call("equip", { item: t.dataset.i });
});
// Two random rams from the herd hit the showers in the back.
fetch("/api/herd").then((r) => r.json()).then((d) => {
  const pool = (d.rams || []).filter((r) => !S || r.id !== S.uid).sort(() => Math.random() - 0.5).slice(0, 2);
  $("showers").innerHTML = pool.map((r, k) => '<div class="showerram" style="left:' + (k ? 89 : 76) + '%;bottom:' + (k ? 41 : 39) + '%"><img alt="" src="/ram/' + r.id + '/bare~0.svg" style="animation-delay:-' + k * 1.3 + 's"></div>').join("")
    + Array.from({ length: 6 }, (_, k) => '<i class="bub" style="left:' + (72 + k * 4.5) + '%;bottom:' + (42 + (k % 3) * 4) + '%;width:' + (6 + k % 3 * 4) + 'px;height:' + (6 + k % 3 * 4) + 'px;animation-delay:-' + k * 0.7 + 's"></i>').join("");
}).catch(() => {});
if (!T) {
  $("sub").innerHTML = "Locked. Type <b>/locker</b> in Discord and click the button to get in. Your key works for 2 hours in this browser.";
  $("buy").disabled = true; $("buy").textContent = "🔒 Run /locker in Discord";
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,700..900&display=swap">
<style>
:root{--bg:#0e1116;--card:#171b22;--card2:#1e232c;--line:#2a303b;--text:#e8ebf0;--muted:#8b93a1;
--blue:#003594;--gold:#ffa300;--good:#2fbf71;--bad:#e5484d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:linear-gradient(135deg,var(--blue),#001a4d);padding:28px 16px 0;border-bottom:3px solid var(--gold)}
.wrap{max-width:1100px;margin:0 auto}
h1{margin:0;font-size:28px;letter-spacing:.5px}h1 span{color:var(--gold)}
.sub{color:#c9d3ea;margin:4px 0 18px}
nav{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;max-width:100%}nav::-webkit-scrollbar{display:none}nav button,nav .navlink{white-space:nowrap;flex:0 0 auto}
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
.srow{margin-top:6px}.bt{font-size:20px;font-weight:700;margin:4px 0 6px}.bt b{color:var(--gold)}.bet .faces{justify-content:flex-start}
.bet.hit{border-color:var(--good)}.bet.miss,.bet.cancelled{opacity:.6}.rhit{color:var(--good);font-weight:700}.rmiss{color:#ef4444;font-weight:700}
.fights{display:grid;gap:8px}.fight{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;color:var(--text);text-decoration:none}
.fight:hover{border-color:var(--gold)}.fight b{color:var(--gold)}.fight.expired,.fight.declined,.fight.cancelled{opacity:.55}.fight u{color:var(--gold)}
h3.past{color:var(--muted);font-size:14px;text-transform:uppercase;letter-spacing:1px;margin:26px 0 10px}
.pasture{height:560px}
.bgwrap{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
.bgcard{flex:1 1 520px;max-width:640px;background:#003594;border:3px solid #ffc82c;border-radius:18px;padding:10px;box-shadow:0 10px 30px #0008}
.bghead{display:grid;grid-template-columns:repeat(5,1fr);text-align:center;margin-bottom:8px}
.bghead b{font:900 clamp(24px,5vw,40px)/1 Archivo,system-ui,sans-serif;font-stretch:125%;color:#ffc82c;text-shadow:0 3px 0 #15172b}
.bggrid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.bgsq{position:relative;aspect-ratio:1;background:#f4f1e8;color:#15172b;border-radius:10px;display:grid;place-items:center;text-align:center;padding:4px;overflow:hidden}
.bgsq span{font-weight:800;font-size:clamp(9px,1.6vw,13px);line-height:1.15;position:relative;z-index:1}
.bgsq.free{background:#ffc82c}.bgsq.free span{font:900 clamp(14px,2.6vw,22px)/1 Archivo,system-ui,sans-serif;font-stretch:125%}
.bgsq i{position:absolute;inset:10%;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffd95eee,#ffa300cc 60%,#e08a00aa);box-shadow:inset 0 -4px 8px #0003;animation:daub .35s ease-out}
.bgsq.hit span{z-index:2;color:#15172b}.bgsq.win{outline:3px solid #ff5ec4;outline-offset:-3px}
@keyframes daub{from{transform:scale(1.6);opacity:0}to{transform:scale(1);opacity:1}}
.bgside{flex:0 1 240px;display:grid;gap:10px}
.bgstat{background:#0f1733;border:1px solid #23305e;border-radius:14px;padding:12px 16px;display:flex;align-items:baseline;gap:8px}
.bgstat b{font-size:34px;font-weight:900}.bgstat b small{font-size:16px;color:var(--dim)}.bgstat span{color:var(--dim);font-weight:700}
.bgstat.gold{border-color:#ffc82c;background:#2a2410}.bgstat.gold b,.bgstat.gold span{color:#ffc82c}
.bgroll{background:#ffc82c;color:#15172b;border:0;border-radius:12px;padding:12px 16px;font-weight:900;font-size:16px;cursor:pointer}.bgroll:disabled{opacity:.5}
tr.mine td{background:#2a2410}
@media (max-width:560px){.bggrid{gap:4px}.bgsq{padding:2px;border-radius:7px}.bgcard{padding:6px}}
.lvbug{margin:0 0 10px}.lvbug:empty{display:none}
.lvbug{display:flex;justify-content:center;padding:26px 8px 12px;margin:0 0 10px;border-radius:14px;background:linear-gradient(180deg,transparent,#0008 40%,#000c)}
.fbug{display:flex;align-items:center;gap:0;font-family:Archivo,system-ui,sans-serif;font-stretch:125%;max-width:100%}
.fb-team{position:relative;background:var(--c);padding:6px 16px;min-width:84px;text-align:center;border-radius:4px}
.fb-team b{display:block;font-weight:900;font-size:30px;line-height:1;letter-spacing:1px;color:#fff;-webkit-text-stroke:2px var(--a);paint-order:stroke fill}
.fb-dd{position:absolute;left:0;right:0;bottom:100%;margin-bottom:3px;background:var(--c);border:2px solid var(--a);color:#fff;font:italic 800 13px/1 Archivo,system-ui,sans-serif;font-stretch:85%;padding:4px 6px;border-radius:4px;white-space:nowrap}
.fb-to{position:absolute;left:12px;right:12px;top:100%;margin-top:4px;display:flex;gap:5px}.fb-to i{flex:1;height:4px;border-radius:2px;background:#e9edf5}.fb-to i.used{background:#ffffff2a}
.fb-sc{min-width:66px;padding:0 10px;text-align:center;font-weight:900;font-size:42px;line-height:1;color:#eef1f6;text-shadow:0 0 10px #000,0 0 18px #000a;font-variant-numeric:tabular-nums}
.fb-mid{display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0f22b3;border:1px solid #ffffff22;border-radius:4px;padding:5px 14px;min-width:86px}
.fb-mid b{font-weight:900;font-size:24px;line-height:1;color:#fff;font-variant-numeric:tabular-nums}.fb-mid span{font-weight:800;font-size:12px;letter-spacing:1px;color:#c9cfdd;margin-top:3px}
@media (max-width:560px){.fb-team{min-width:60px;padding:5px 9px}.fb-team b{font-size:21px}.fb-sc{font-size:30px;min-width:44px;padding:0 6px}.fb-mid{min-width:64px;padding:4px 8px}.fb-mid b{font-size:18px}}
.lvdot{display:none;position:absolute;top:5px;left:5px;z-index:2;width:7px;height:7px;border-radius:50%;background:#ff3b3b;animation:blink 1s infinite}
@keyframes blink{50%{opacity:.2}}
.lvchart{position:absolute;inset:0;z-index:1100;pointer-events:none}
.dc{position:absolute;height:12px;margin-top:-6px;border-radius:6px;box-shadow:0 1px 3px #0007}
.dc em{position:absolute;top:50%;transform:translateY(-50%);font:800 11px/1 system-ui,sans-serif;font-style:normal;color:#fff;text-shadow:0 1px 2px #000;white-space:nowrap}
.dc.r em{left:calc(100% + 9px)}.dc.l em{right:calc(100% + 9px)}
.dc.r::after,.dc.l::after{content:"";position:absolute;top:50%;margin-top:-8px;border:8px solid transparent}
.dc.r::after{left:100%;border-left-color:inherit;border-left-width:9px;border-right:0}.dc.l::after{right:100%;border-right-color:inherit;border-right-width:9px;border-left:0}
.dc.rush{background:#2d7bff;border-color:#2d7bff}.dc.pass{background:#1fd16b;border-color:#1fd16b}.dc.loss{background:#ff3b3b;border-color:#ff3b3b}
.dc.pen{background:#ffd400;border-color:#ffd400;height:6px;margin-top:-3px}
.dc.int{background:none;border:3px dashed #ff3b3b;height:12px;box-shadow:none}.dc.int::after{display:none}
.dc.dot{width:12px;height:12px;margin-left:-6px;border-radius:50%;background:none;border:3px solid #1fd16b}.dc.dot em{left:16px}
.dc.dot.rush{border-color:#2d7bff}.dc.dot.int{border-style:dashed;border-color:#ff3b3b}
.lv-los,.lv-fd{position:absolute;top:0;bottom:0;width:4px;margin-left:-2px;z-index:2;pointer-events:none;transition:left .8s}
.lv-los{background:#2d7bff;box-shadow:0 0 8px #2d7bff}.lv-fd{background:#ffd400;box-shadow:0 0 8px #ffd400}
.lv-ball{position:absolute;top:1%;z-index:1200;transform:translateX(-50%);transition:left .8s;pointer-events:none;text-align:center}
.lv-ball i{display:block;width:44px;height:26px;margin:0 auto}.lv-ball b{display:inline-block;margin-top:3px;background:#15172b;color:#fff;border:2px solid #ffc82c;border-radius:8px;padding:1px 7px;font-size:12px;white-space:nowrap}
.lvgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;align-items:start}.lvgrid[hidden]{display:none}
@media (max-width:760px){.lvgrid{grid-template-columns:1fr}}
.lvplays,.lvstats{display:grid;gap:6px}.lvgrid h3{margin:0 0 2px;font-size:14px;text-transform:uppercase;letter-spacing:1px;color:var(--dim)}
.lvtabs{display:flex;gap:6px}.lvtabs button{flex:1;background:#0f1733;color:#fff;border:1px solid #23305e;border-radius:10px;padding:6px;font-weight:800;cursor:pointer}
.lvtabs button.on{background:#ffc82c;color:#15172b;border-color:#ffc82c}
.lvst{width:100%;table-layout:fixed;border-collapse:collapse;background:#0f1733;border:1px solid #23305e;border-radius:12px;overflow:hidden;font-size:13px}
.lvst th{background:#16204a;color:var(--dim);font-weight:800;text-align:right;padding:5px 8px;font-size:11px;letter-spacing:.5px}
.lvst th:first-child{text-align:left;color:#ffc82c;font-size:12px}.lvst td{padding:5px 8px;text-align:right;border-top:1px solid #1d2850;font-variant-numeric:tabular-nums}
.lvst th:first-child,.lvst td:first-child{width:44%}.lvst td:first-child{text-align:left;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lvst td small{display:inline-block;width:3.2em;color:var(--dim);font-weight:600}
.lvp{background:#0f1733;border:1px solid #23305e;border-radius:12px;padding:8px 12px;font-size:14px;line-height:1.35}
.lvp small{display:block;color:var(--dim);font-size:12px;margin-bottom:2px}.lvp.sc{border-color:#ffc82c;background:#2a2410}.lvp.to{border-color:#ff5e5e}
.lvp:first-child{border-width:2px}
${FIELD_CSS}
.rw{position:absolute;width:150px;margin-left:-75px;margin-top:-150px;text-align:center;cursor:pointer;text-decoration:none;color:#fff}
.rw img{width:150px;height:150px;display:block;transition:transform .25s}
.rw span{display:inline-block;margin-top:-14px;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:8px;font-size:12px;font-weight:700;white-space:nowrap}
.rw span b{color:var(--gold);font-weight:700;margin-left:4px}
.rw:hover span{background:var(--gold);color:#111}
#moments{position:fixed;right:16px;bottom:16px;z-index:5000;display:flex;flex-direction:column-reverse;gap:10px;pointer-events:none}
.moment{width:min(320px,calc(100vw - 32px));background:#000;border:3px solid var(--gold);border-radius:14px;overflow:hidden;
  box-shadow:0 10px 40px rgba(0,0,0,.6);animation:pop .35s cubic-bezier(.2,1.4,.4,1);transition:opacity .5s,transform .5s}
.moment.gone{opacity:0;transform:translateY(20px)}.moment img,.moment video{width:100%;display:block;max-height:260px;object-fit:cover}
.moment .mt{padding:8px 12px;font-size:15px}.moment .mt b{color:var(--gold)}.moment .mt span{color:var(--muted);float:right}
@keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
.pflag{position:absolute;font-size:44px;z-index:999;animation:toss .7s cubic-bezier(.3,1.5,.5,1)}
@keyframes toss{from{transform:translate(-120px,-200px) rotate(-200deg);opacity:0}to{transform:none;opacity:1}}
.confetti{position:absolute;top:-4%;width:9px;height:14px;z-index:1500;animation:fall linear forwards;pointer-events:none}
@keyframes fall{from{transform:translateY(0) rotate(0)}to{transform:translateY(560px) rotate(720deg)}}
.tdword{position:absolute;top:10%;transform:translateX(-50%);z-index:1600;font:900 clamp(26px,5vw,56px)/1 system-ui;color:#ffc82c;-webkit-text-stroke:2px #15172b;animation:pop .4s cubic-bezier(.2,1.4,.4,1);pointer-events:none}
.pflag{width:46px;height:46px;margin:-23px;z-index:980;animation:none;font-size:0}
.fball{position:absolute;width:34px;height:22px;margin:-11px -17px;z-index:1400;pointer-events:none}.fball.held{transition:none}
.boomfx{position:absolute;transform:translate(-50%,-50%);font-size:64px;z-index:1500;animation:pop .35s cubic-bezier(.2,1.4,.4,1);pointer-events:none}
.goalpost{position:absolute;left:86%;width:10%;top:18%;height:50%;z-index:1;pointer-events:none}
.rw img.mad{animation:shake .25s linear infinite}@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.madbub{position:absolute;left:50%;top:-6px;transform:translateX(-50%);font-size:26px;animation:pop .3s}
.rw.me{cursor:default}.rw.me span{background:var(--gold);color:#111;box-shadow:0 0 0 2px #111}.rw.me span b{color:#111}
.rw.me img{filter:drop-shadow(0 0 10px rgba(255,200,44,.9))}.pasture.field{cursor:crosshair}
.note b{color:var(--gold)}.rw:hover span b{color:#111}
@media (max-width:560px){.pasture{height:460px}.rw,.rw img{width:110px}.rw{margin-left:-55px;margin-top:-110px}.rw img{height:110px}}
@media (max-width:560px){.grid{grid-template-columns:1fr}h1{font-size:22px}nav button{padding:10px 10px}}
</style>
</head>
<body>
<header><div class="wrap">
<h1>RAMS <span>PICK'EM</span></h1>
<div class="sub" id="sub">Loading...</div>
<nav><button data-t="week" class="on">This Week</button><button data-t="last">Last Week</button><button data-t="table">Standings</button><button data-t="bets">Bets &amp; Fights</button><button data-t="herd">Herd</button><button data-t="bingo">Bingo</button><a class="navlink" href="/locker">Locker Room</a></nav>
</div></header>
<template id="fieldtpl">${FIELD}</template>
<main><div class="wrap" id="view"><div class="empty">Loading picks...</div></div></main>
<script>
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const view = document.getElementById("view"), sub = document.getElementById("sub");
let week = null, hist = null, herd = null, bets = null, fights = [], tab = "week", raf = 0;
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
    + '<div class="meta"><span>' + (g.kick ? when(g.kick) : esc(g.game)) + (g.weather ? " · " + esc(g.weather) : "") + '</span><span>' + status + '</span></div>'
    + '<div class="vs">' + side(a, total, result) + '<div class="at">@</div>' + side(h, total, result) + '</div>'
    + '<div class="bar"><i style="width:' + ap + '%"></i><b style="width:' + (100 - ap) + '%"></b></div></div>';
}
// Herd: every ram roams the field. If this browser holds a Locker Room key, that person's ram is theirs to drive:
// click or tap anywhere on the field to walk there, or hold the arrow keys / WASD.
const keys = {};
addEventListener("keydown", (e) => { if (tab === "herd" && /^(Arrow|[wasd]$)/i.test(e.key)) { keys[e.key.toLowerCase()] = true; e.preventDefault(); } });
addEventListener("keyup", (e) => { delete keys[e.key.toLowerCase()]; });
// One live connection per page: Herd moves and !flag / !TD moments both come through it.
let sock = null, herdHandler = null, lastSnap = null;
function connect() {
  sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/herd");
  sock.onopen = () => { const k = myKey(); if (k) sock.send(JSON.stringify({ t: "hello", k })); };
  sock.onmessage = (e) => { const m = JSON.parse(e.data);
    if (m.t === "snap") lastSnap = m;
    if (m.t === "moment") showMoment(m);
    if (herdHandler) herdHandler(m); };
  sock.onclose = () => setTimeout(connect, 5000);
}
const MOMENT = { flag: ["🟨", "FLAG!"], refsplan: ["🟨", "REFS PLAN!"], int: ["🫳", "INTERCEPTION!"], fumble: ["🏈", "FUMBLE!"], itsgood: ["🥅", "IT'S GOOD!"], tutu: ["🏃", "TUTU TO THE HOUSE!"], td: ["🏈", "TOUCHDOWN!"], touchdown: ["🏈", "TOUCHDOWN!"] };
function showMoment(m) {
  if (m.fx !== false && herdHandler) herdHandler({ t: "fx", cmd: m.cmd });
  if (!m.url) return;
  const [icon, title] = MOMENT[m.cmd] || ["🎉", "!" + m.cmd.toUpperCase()];
  const box = document.createElement("div"); box.className = "moment";
  box.innerHTML = (m.kind === "video" ? '<video autoplay muted loop playsinline src="' + esc(m.url) + '"></video>' : '<img alt="" src="' + esc(m.url) + '">')
    + '<div class="mt">' + icon + " <b>" + esc(title) + "</b> <span>" + esc(m.by) + "</span></div>";
  let stack = document.getElementById("moments");
  if (!stack) { stack = document.createElement("div"); stack.id = "moments"; document.body.appendChild(stack); }
  stack.appendChild(box);
  setTimeout(() => box.classList.add("gone"), 9000); setTimeout(() => box.remove(), 9600);
}
function myKey() { try { const t = localStorage.getItem("lr_t"); if (t && Number(t.split(".")[1]) * 1000 > Date.now()) return t; } catch {} return null; }
function myId() {
  try { const t = localStorage.getItem("lr_t"); if (t && Number(t.split(".")[1]) * 1000 > Date.now()) return t.split(".")[0]; } catch {}
  return null;
}
// ---------- Live play-by-play: ESPN-style drive tracker on the Herd field ----------
let live = null, liveSeen = null;
const yx = (y) => 8 + Math.max(0, Math.min(100, y)) * 0.84;   // yards from the Rams goal line to field %
const BALLSVG = '<svg viewBox="-20 -12 40 24" width="100%" height="100%"><ellipse rx="18" ry="10" fill="#8b4a22" stroke="#15172b" stroke-width="3"/><path d="M -7 0 L 7 0 M -4 -3 l 0 6 M 0 -3 l 0 6 M 4 -3 l 0 6" stroke="#fff" stroke-width="2"/></svg>';
let liveSide = "14";
function drawLive() {
  const bug = document.getElementById("lvbug");
  if (!bug) return;
  const L = live, el = (id) => document.getElementById(id);
  ["lvlos", "lvfd", "lvball"].forEach((id) => { el(id).hidden = true; });
  el("lvchart").innerHTML = ""; el("lvplays").innerHTML = ""; el("lvstats").innerHTML = ""; el("lvgrid").hidden = true;
  if (!L || L.state === "none" || !L.teams || L.teams.length < 2) { bug.innerHTML = ""; return; }
  const away = L.teams.find((t) => !t.home) || L.teams[0], home = L.teams.find((t) => t.home) || L.teams[1];
  const d = L.drive, pre = L.state === "pre";
  // FOX-style bug: team-color boxes with outlined initials, huge floating scores, the clock in the middle,
  // down & distance in a tab over the team with the ball, timeouts as three dashes under each team
  const pos = L.state === "in" && d ? d.team : null;
  const box = (t) => '<div class="fb-team" style="--c:' + t.color + ';--a:' + t.alt + '">'
    + (pos === t.id && d.down ? '<div class="fb-dd">' + esc(d.down.replace(/ at .*/, "")) + '</div>' : "")
    + '<b>' + esc(t.abbr) + '</b>'
    + (L.state === "in" ? '<div class="fb-to">' + [0, 1, 2].map((k) => '<i class="' + (t.to != null && k >= t.to ? "used" : "") + '"></i>').join("") + '</div>' : "") + '</div>';
  const score = (t) => '<div class="fb-sc">' + (pre ? "" : esc(t.score)) + '</div>';
  let mid;
  if (pre) mid = '<b>' + esc(new Date(L.date).toLocaleString([], { weekday: "short" })) + '</b><span>' + esc(new Date(L.date).toLocaleString([], { hour: "numeric", minute: "2-digit" })) + '</span>';
  else if (L.state === "post") mid = '<b>FINAL</b>';
  else { const part = L.detail.split(" - "); mid = '<b>' + esc(part[1] || part[0] || "") + '</b>' + (part[1] ? '<span>' + esc(part[0]) + '</span>' : ""); }
  bug.innerHTML = '<div class="fbug">' + box(away) + score(away) + '<div class="fb-mid">' + mid + '</div>' + score(home) + box(home) + '</div>';
  if (pre) return;
  if (L.state === "in" && d) {
    el("lvlos").style.left = yx(d.ball) + "%"; el("lvlos").hidden = false;
    if (d.first != null) { el("lvfd").style.left = yx(d.first) + "%"; el("lvfd").hidden = false; }
    const bl = el("lvball"); bl.style.left = yx(d.ball) + "%"; bl.firstChild.innerHTML = BALLSVG;
    bl.lastChild.textContent = (d.rams ? "▶ " : "◀ ") + (d.abbr || "") + (d.down ? " · " + d.down : ""); bl.hidden = false;
    // drive chart: one bar per snap, start spot to end spot
    el("lvchart").innerHTML = (d.chart || []).map((c, i) => {
      const x0 = yx(Math.min(c.a, c.b)), w = Math.abs(yx(c.b) - yx(c.a)), top = 14 + i * 5.4, fwd = c.b >= c.a;
      const lbl = c.inc ? "INC" : c.kind === "int" ? "INT" : c.kind === "pen" ? "PEN " + (c.yds > 0 ? "+" : "") + c.yds : (c.yds > 0 ? "+" : "") + c.yds;
      if (c.inc || w < 0.4) return '<div class="dc dot ' + c.kind + '" style="left:' + yx(c.a) + '%;top:' + top + '%"><em>' + lbl + '</em></div>';
      return '<div class="dc ' + c.kind + (fwd ? " r" : " l") + '" style="left:' + x0 + '%;width:' + w + '%;top:' + top + '%"><em>' + lbl + '</em></div>';
    }).join("");
  }
  el("lvgrid").hidden = false;
  el("lvplays").innerHTML = '<h3>Play-by-play</h3>' + (L.plays || []).slice(0, 8).map((p) => '<div class="lvp' + (p.score ? " sc" : p.turnover ? " to" : "") + '"><small>'
    + esc((p.q ? "Q" + p.q + " " : "") + p.clock + " · " + (p.abbr || "") + (p.dd ? " · " + p.dd : "") + (p.type ? " · " + p.type : "")) + '</small>' + esc(p.text) + '</div>').join("");
  const st = L.stats || [];
  if (!st.length) { el("lvstats").innerHTML = '<h3>Player stats</h3><div class="dim">No stats yet.</div>'; return; }
  const side = st.find((t) => t.id === liveSide) || st[0];
  const NAMES = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense" };
  el("lvstats").innerHTML = '<div class="lvtabs">' + st.slice().sort((a) => a.id === "14" ? -1 : 1).map((t) => '<button data-side="' + t.id + '" class="' + (t === side ? "on" : "") + '">' + esc(t.abbr) + '</button>').join("") + '</div>'
    + side.cats.map((c) => '<table class="lvst"><tr><th>' + NAMES[c.name] + '</th>' + c.cols.map((h) => '<th>' + esc(h) + '</th>').join("") + '</tr>'
      + c.rows.map((r) => '<tr><td>' + (r.num ? '<small>#' + esc(r.num) + '</small>' : '<small></small>') + esc(r.name) + '</td>' + r.stats.map((v) => '<td>' + esc(v) + '</td>').join("") + '</tr>').join("") + '</table>').join("");
  el("lvstats").querySelectorAll("[data-side]").forEach((b) => b.onclick = () => { liveSide = b.dataset.side; drawLive(); });
}
// a fresh big play on the real field sets the herd off
function liveReact(plays) {
  const ids = new Set(plays.map((p) => p.id));
  if (liveSeen && herdHandler) {
    const fresh = plays.filter((p) => !liveSeen.has(p.id));
    for (const p of fresh) {
      const ramsBall = p.team === "14", t = p.type.toLowerCase();
      let cmd = null;
      if (p.score && ramsBall && /field goal/.test(t)) cmd = "itsgood";
      else if (p.score && ramsBall && /touchdown/.test(t)) cmd = "td";
      else if (p.turnover && !ramsBall) cmd = /fumble/.test(t + " " + p.text.toLowerCase()) ? "fumble" : "int";
      if (cmd) { herdHandler({ t: "fx", cmd }); break; }
    }
  }
  liveSeen = ids;
}
function pollLive() {
  if (tab !== "herd" || document.hidden) return;
  fetch("/api/live").then((r) => r.json()).then((d) => { if (d.error) return; live = d; if (d.plays) liveReact(d.plays); drawLive(); }).catch(() => {});
}
setInterval(pollLive, 10000);
function pasture() {
  if (!herd) { view.innerHTML = '<div class="empty">Rounding up the herd...</div>'; return; }
  const me = myId(), mine = herd.rams.some((r) => r.id === me);
  sub.textContent = herd.rams.length + " rams on the field";
  if (!herd.rams.length) { view.innerHTML = '<div class="empty">No rams yet. Open your first crate with /crate in Discord.</div>'; return; }
  const note = mine ? "<b>Your ram has the gold tag.</b> Click anywhere on the field to walk there, or use the arrow keys / WASD. Everyone watching sees you move."
    : "Click a ram to see its gear. Want to drive your own? Run <b>/locker</b> in Discord, open the link once, then come back here.";
  view.innerHTML = '<p class="note">' + note + '</p><div class="lvbug" id="lvbug"></div><div class="pasture field" id="pa">' + document.getElementById("fieldtpl").innerHTML
    + '<div class="lvchart" id="lvchart"></div><div class="lv-los" id="lvlos" hidden></div><div class="lv-fd" id="lvfd" hidden></div><div class="lv-ball" id="lvball" hidden><i></i><b></b></div>'
    + '</div><div class="lvgrid" id="lvgrid" hidden><div class="lvplays" id="lvplays"></div><div class="lvstats" id="lvstats"></div></div>';
  drawLive();
  // Windows/Mac "reduce motion" settings only tone this down (no trotting bounce, no sprints); the rams still roam.
  const pa = document.getElementById("pa"), calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clampX = (x) => Math.max(12, Math.min(88, x)), clampY = (y) => Math.max(24, Math.min(96, y));
  let you = null;
  const sheep = herd.rams.map((r) => {
    const isMe = r.id === me;
    const el = document.createElement(isMe ? "div" : "a");
    el.className = "rw" + (isMe ? " me" : ""); if (!isMe) el.href = "/ram/" + r.id;
    el.innerHTML = '<img src="/ram/' + r.id + '.svg?bare" alt=""><span>' + (isMe ? "YOU · " : "") + esc(r.name) + (r.points ? '<b>' + r.points + ' RUTS</b>' : "") + '</span>';
    pa.appendChild(el);
    const s = { el, img: el.firstChild, me: isMe, x: rnd(14, 86), y: rnd(24, 96), tx: 0, ty: 0, wait: rnd(0, 0.8), speed: rnd(2.5, 4), t: rnd(0, 6) };
    if (isMe) { you = s; s.x = 50; s.y = 70; s.wait = 0; s.speed = 9; }
    return s;
  });
  sheep.forEach((s) => { s.tx = s.x; s.ty = s.y; });
  const byId = Object.fromEntries(sheep.map((s, i) => [herd.rams[i].id, s]));
  // Live: other players' moves arrive over a websocket; their rams walk where they clicked.
  const drive = (id, x, y, snap) => { const s = byId[id]; if (!s || s.me) return; s.remote = Date.now(); s.tx = x; s.ty = y; s.speed = 9; s.wait = 0; if (snap) { s.x = x; s.y = y; } };
  herdHandler = (m) => {
    if (m.t === "snap") for (const [id, p] of Object.entries(m.pos)) { if (byId[id]?.me) { you.x = you.tx = p.x; you.y = you.ty = p.y; } else drive(id, p.x, p.y, true); }
    if (m.t === "go") drive(m.id, m.x, m.y);
    if (m.t === "fx") fieldFx(m.cmd);
  };
  if (lastSnap) herdHandler(lastSnap);
  // !TD: the whole herd celebrates. !flag: a penalty flag lands on the field and everyone points.
  // Field shows. !TD: the whole herd sprints to one end zone, fans out and celebrates under confetti.
  // !flag / !refsplan: a ref jogs out, throws 9 yellow flags, and every ram points and fumes.
  let showOn = false;
  const PFLAG = '<svg viewBox="-34 -34 68 68" width="100%" height="100%"><path d="M -26 -18 C -14 -30, 10 -26, 24 -20 C 30 -4, 26 12, 18 22 C 0 28, -18 24, -28 14 C -32 2, -30 -8, -26 -18 Z" fill="#ffd400" stroke="#15172b" stroke-width="5"/><path d="M -12 -12 C -2 -2, 6 4, 14 8 M -18 6 C -8 8, 0 2, 4 -6" stroke="#0003" stroke-width="4" fill="none"/><circle cx="20" cy="18" r="8" fill="#ffd400" stroke="#15172b" stroke-width="4"/></svg>';
  const pose = (i, p) => { sheep[i].img.src = "/ram/" + herd.rams[i].id + ".svg?bare" + (p ? "&pose=" + p : ""); };
  const goTo = (s, x, y, speed) => { s.fx = { tx: x, ty: y, speed }; };
  function endShow(ms, extra) {
    setTimeout(() => {
      sheep.forEach((s, i) => { s.fx = null; s.wait = rnd(0.2, 1.5); s.img.classList.remove("mad"); pose(i); });
      pa.querySelectorAll(".fxbit").forEach((e) => e.remove());
      if (extra) extra();
      showOn = false;
    }, ms);
  }
  const BALL = '<svg viewBox="-20 -12 40 24" width="100%" height="100%"><ellipse rx="18" ry="10" fill="#8b4a22" stroke="#15172b" stroke-width="3"/><path d="M -7 0 L 7 0 M -4 -3 l 0 6 M 0 -3 l 0 6 M 4 -3 l 0 6" stroke="#fff" stroke-width="2"/></svg>';
  const word = (text, x) => { const w = document.createElement("div"); w.className = "tdword fxbit"; w.textContent = text; w.style.left = x + "%"; pa.appendChild(w); };
  const confetti = (x0, x1, n = 60) => { for (let k = 0; k < n; k++) { const c = document.createElement("i"); c.className = "confetti fxbit";
    c.style.left = rnd(x0, x1) + "%"; c.style.background = ["#ffc82c", "#1f55d6", "#fff", "#ff5ec4", "#5ee08f"][k % 5];
    c.style.animationDelay = rnd(0, 2) + "s"; c.style.animationDuration = rnd(2.2, 4) + "s"; pa.appendChild(c); } };
  // a football flying from a to b (percent coords) in a lob; resolves when it lands
  function throwBall(a, b, ms, lift = 22, cls = "") {
    const f = document.createElement("div"); f.className = "fball fxbit " + cls; f.innerHTML = BALL; pa.appendChild(f);
    f.style.left = b.x + "%"; f.style.top = b.y + "%";
    return f.animate([{ left: a.x + "%", top: a.y + "%", transform: "rotate(0) scale(1)" },
      { left: (a.x + b.x) / 2 + "%", top: Math.min(a.y, b.y) - lift + "%", transform: "rotate(540deg) scale(1.25)", offset: 0.5 },
      { left: b.x + "%", top: b.y + "%", transform: "rotate(1080deg) scale(1)" }], { duration: ms, easing: "linear" }).finished.then(() => f);
  }
  const handOf = (s) => ({ x: s.x + 2, y: s.y - 9 });
  // Before every show the herd clears out and gets set: everyone jogs to a spot,
  // arriving together, then holds a beat before the play starts.
  const LINEUP = 2600, HOLD = 700;
  const setAt = (s, x, y) => { s.fx = { tx: x, ty: y, speed: Math.max(4, Math.hypot(x - s.x, y - s.y) / (LINEUP / 1000 - 0.3)) }; };
  const spread = (n, k, a, b) => n <= 1 ? (a + b) / 2 : a + k * (b - a) / (n - 1);
  // a column of rams; a big herd stacks extra rows behind it (dx) instead of piling on top of each other
  const col = (ids, x, y0 = 30, y1 = 92, dx = -6) => { const per = 8;
    for (let c = 0; c * per < ids.length; c++) { const part = ids.slice(c * per, c * per + per);
      part.forEach((i, k) => setAt(sheep[i], x + c * dx, spread(part.length, k, y0, y1) + (c % 2) * 3)); } };
  const row = (ids, y, x0 = 18, x1 = 82) => ids.forEach((i, k) => setAt(sheep[i], spread(ids.length, k, x0, x1), y));
  const sidelines = (ids) => { row(ids.filter((_, k) => k % 2 === 0), 26); row(ids.filter((_, k) => k % 2 === 1), 95); };
  const shuffled = () => sheep.map((_, i) => i).sort(() => Math.random() - 0.5);
  function fieldFx(cmd) {
    if (showOn || !sheep.length) return;
    const play = SHOWS[cmd === "touchdown" ? "td" : cmd === "refsplan" ? "flag" : cmd];
    if (!play) return;
    showOn = true;
    sheep.forEach((s, i) => { s.img.classList.remove("mad"); pose(i); });
    const go = play();   // positions the herd and returns the play itself
    setTimeout(go, LINEUP + HOLD);
  }
  const SHOWS = {
    int() {   // offense lines up on the ball, QB in the pocket; defense across with a safety deep
      const order = shuffled();
      const off = order.filter((_, k) => k % 2 === 0), def = order.filter((_, k) => k % 2 === 1);
      if (!def.length) def.push(off.pop());
      const qbI = off[0], pickI = def[0], line = off.slice(1), dline = def.slice(1);
      setAt(sheep[qbI], 33, 62); setAt(sheep[pickI], 74, 62);
      col(line, 44, 34, 90, -6); col(dline, 56, 34, 90, 6);
      word("OFFENSE", 30); word("DEFENSE", 70);
      return () => SHOWS.intPlay(off, def, line, dline);
    },
    intPlay(off, def, line, dline) {
      const qb = sheep[off[0]], pick = sheep[def[0]];
      line.forEach((i) => goTo(sheep[i], 48, sheep[i].y, 3));    // the line pushes at the snap
      dline.forEach((i) => goTo(sheep[i], 52, sheep[i].y, 3));
      setTimeout(() => {
        pose(off[0], "pose_wave");
        throwBall(handOf(qb), handOf(pick), 1300, 24).then((ball) => {
          ball.remove(); pose(def[0], "pose_fist");
          pa.querySelectorAll(".tdword").forEach((e) => e.remove()); word("PICKED OFF!", 50);
          // the picker runs it back; the rest of the defense escorts, the offense hangs their heads
          goTo(pick, 6, pick.y, 16);
          def.slice(1).forEach((i) => goTo(sheep[i], rnd(8, 26), sheep[i].y, rnd(12, 15)));
          off.forEach((i) => pose(i, "pose_shrug"));
          setTimeout(() => { def.forEach((i, k) => pose(i, k % 2 ? "pose_roof" : "pose_td")); confetti(0, 35, 50); }, 2800);
        });
      }, 600);
      endShow(9000);
    },
    fumble() {   // everyone clears to the sidelines; carrier and hitter square up in the middle
      const [ci, hi, ...rest] = shuffled();
      if (hi === undefined) return () => { showOn = false; sheep.forEach((s) => { s.fx = null; }); };
      sidelines(rest);
      setAt(sheep[ci], 26, 62); setAt(sheep[hi], 74, 62);
      const ball = document.createElement("div"); ball.className = "fball held fxbit"; ball.innerHTML = BALL; pa.appendChild(ball);
      const follow = setInterval(() => { const h = handOf(sheep[ci]); ball.style.left = h.x + "%"; ball.style.top = h.y + "%"; }, 30);
      return () => SHOWS.fumblePlay(ci, hi, ball, follow);
    },
    fumblePlay(ci, hi, ball, follow) {
      const carrier = sheep[ci], hitter = sheep[hi];
      goTo(carrier, 47, 62, 26); goTo(hitter, 53, 62, 26);   // charge
      setTimeout(() => {
        clearInterval(follow); ball.remove();
        const boom = document.createElement("div"); boom.className = "boomfx fxbit"; boom.textContent = "💥"; boom.style.left = "50%"; boom.style.top = "52%"; pa.appendChild(boom);
        word("FUMBLE!", 50);
        goTo(carrier, 40, 64, 20); goTo(hitter, 60, 64, 20);
        carrier.img.classList.add("mad");
        const spot = { x: rnd(20, 80), y: rnd(32, 88) };
        throwBall({ x: 50, y: 50 }, spot, 900, 30).then((b) => {
          b.animate([{ transform: "translateY(0) rotate(0)" }, { transform: "translateY(-18px) rotate(160deg)" }, { transform: "translateY(0) rotate(300deg)" }, { transform: "translateY(-6px) rotate(380deg)" }, { transform: "translateY(0) rotate(420deg)" }], { duration: 900 });
          sheep.forEach((s) => goTo(s, spot.x + rnd(-6, 6), spot.y + rnd(-4, 4), rnd(14, 24)));   // pile on
          const winner = Math.floor(Math.random() * sheep.length);
          setTimeout(() => { goTo(sheep[winner], spot.x, spot.y, 30); b.remove(); pose(winner, "pose_td"); word("RECOVERED!", spot.x); }, 2600);
        });
      }, 900);
      endShow(8000);
    },
    itsgood() {   // kicker sets up behind the ball, a wall of blockers in front, everyone else on the sidelines
      const post = document.createElement("div"); post.className = "goalpost fxbit";
      post.innerHTML = '<svg viewBox="0 0 120 200" width="100%" height="100%"><path d="M 60 200 L 60 110" stroke="#15172b" stroke-width="14"/><path d="M 60 200 L 60 110" stroke="#ffd400" stroke-width="8"/><path d="M 14 110 L 106 110 M 14 110 L 14 6 M 106 110 L 106 6" stroke="#15172b" stroke-width="14" stroke-linecap="round"/><path d="M 14 110 L 106 110 M 14 110 L 14 6 M 106 110 L 106 6" stroke="#ffd400" stroke-width="8" stroke-linecap="round"/></svg>';
      pa.appendChild(post);
      const [ki, ...rest] = shuffled(), kicker = sheep[ki];
      const wall = rest.slice(0, 7), side = rest.slice(7);
      col(wall, 54, 44, 80, 5); sidelines(side);
      setAt(kicker, 38, 62);
      const tee = document.createElement("div"); tee.className = "fball fxbit"; tee.innerHTML = BALL; tee.style.left = "46%"; tee.style.top = "62%"; pa.appendChild(tee);
      return () => SHOWS.kick(kicker, tee);
    },
    kick(kicker, tee) {
      goTo(kicker, 45, 62, 14);
      setTimeout(() => {
        tee.remove();
        // through the middle: the uprights sit at x 86-96%, crossbar at ~44% from the top
        throwBall({ x: 46, y: 62 }, { x: 91, y: 30 }, 1500, 26, "kicked").then((b) => {
          b.animate([{ left: "91%", top: "30%" }, { left: "99%", top: "34%" }], { duration: 300, fill: "forwards" });
          word("IT'S GOOD!", 50); confetti(30, 100, 40);
          sheep.forEach((s, i) => pose(i, i % 2 ? "pose_td" : "pose_victory"));
          setTimeout(() => b.remove(), 320);
        });
      }, 500);
      endShow(7000);
    },
    td() {   // the herd lines up across the field, facing the end zone they're about to score in
      const left = Math.random() < 0.5;
      col(shuffled(), left ? 70 : 30, 30, 92, left ? 6 : -6);
      return () => SHOWS.tdPlay(left);
    },
    tdPlay(left) {
      const ez = (a, b) => left ? rnd(a, b) : 100 - rnd(a, b);
      sheep.forEach((s, i) => goTo(s, ez(4, 12), rnd(28, 94), rnd(20, 28)));   // sprint to the end zone
      setTimeout(() => {   // fan out and celebrate
        sheep.forEach((s, i) => { goTo(s, ez(4, 30), 28 + (i + 0.5) * (66 / sheep.length) + rnd(-3, 3), 7); pose(i, i % 3 === 0 ? "pose_roof" : i % 3 === 1 ? "pose_td" : "pose_hype"); });
        for (let k = 0; k < 90; k++) {
          const c = document.createElement("i"); c.className = "confetti fxbit";
          c.style.left = (left ? rnd(0, 45) : rnd(55, 100)) + "%"; c.style.background = ["#ffc82c", "#1f55d6", "#fff", "#ff5ec4", "#5ee08f"][k % 5];
          c.style.animationDelay = rnd(0, 2.5) + "s"; c.style.animationDuration = rnd(2.2, 4) + "s"; pa.appendChild(c);
        }
        const tdw = document.createElement("div"); tdw.className = "tdword fxbit"; tdw.textContent = "TOUCHDOWN!"; tdw.style.left = left ? "22%" : "78%"; pa.appendChild(tdw);
      }, 2600);
      endShow(11000);
    },
    tutu() {   // backed up on our own 1: everyone sets on the left goal line, QB in the end zone
      const [qbI, wrI, ...line] = shuffled();
      if (wrI === undefined) return () => { showOn = false; sheep.forEach((s) => { s.fx = null; }); };
      setAt(sheep[qbI], 8, 62); setAt(sheep[wrI], 15, 27);
      col(line, 15, 40, 92, 5);
      word("OWN 1", 20);
      return () => SHOWS.tutuPlay(qbI, wrI, line);
    },
    tutuPlay(qbI, wrI, line) {
      const qb = sheep[qbI], wr = sheep[wrI];
      pa.querySelectorAll(".tdword").forEach((e) => e.remove());
      goTo(wr, 94, 27, 19.6);                                     // the top receiver breaks away up the sideline, timed to meet the ball
      line.forEach((i) => goTo(sheep[i], 19, sheep[i].y, 3));    // the line holds
      setTimeout(() => {
        pose(qbI, "pose_wave");
        throwBall(handOf(qb), { x: 68, y: 18 }, 1500, 30).then((ball) => {   // deep ball, he runs under it
          ball.remove();
          const carry = document.createElement("div"); carry.className = "fball held fxbit"; carry.innerHTML = BALL; pa.appendChild(carry);
          const follow = setInterval(() => { const h = handOf(wr); carry.style.left = h.x + "%"; carry.style.top = h.y + "%"; }, 30);
          goTo(wr, 94, 27, 22);                                     // to the house
          setTimeout(() => {
            clearInterval(follow); carry.remove();
            pose(wrI, "pose_td"); word("TOUCHDOWN!", 72); confetti(55, 100, 90);
            [qbI, ...line].forEach((i, k) => {                      // the offense floods down to celebrate
              goTo(sheep[i], 100 - rnd(4, 26), 30 + (k + 0.5) * (62 / (line.length + 1)), rnd(20, 28));
              setTimeout(() => pose(i, k % 3 === 0 ? "pose_roof" : k % 3 === 1 ? "pose_hype" : "pose_victory"), 3000);
            });
          }, 1300);
        });
      }, 1100);
      endShow(11500);
    },
    flag() {   // both sides set on the line of scrimmage, then the ref comes out
      const order = shuffled();
      col(order.filter((_, k) => k % 2 === 0), 43, 30, 92, -6); col(order.filter((_, k) => k % 2 === 1), 57, 30, 92, 6);
      return () => SHOWS.flagPlay();
    },
    flagPlay() {
      const ref = { el: document.createElement("div") };
      ref.el.className = "rw fxbit"; ref.el.innerHTML = '<img alt="" src="/npc/ref.svg"><span>REF</span>';
      ref.el.style.left = "-6%"; ref.el.style.top = "60%"; ref.el.style.zIndex = 990; pa.appendChild(ref.el);
      const refIn = ref.el.animate([{ left: "-6%" }, { left: "50%" }], { duration: 1800, easing: "ease-out", fill: "forwards" });
      sheep.forEach((s) => { s.fx = { tx: s.x, ty: s.y, speed: 0 }; });   // everyone freezes
      refIn.finished.then(() => {
        for (let k = 0; k < 9; k++) setTimeout(() => {   // nine flags, one after another
          const f = document.createElement("div"); f.className = "pflag fxbit";
          f.innerHTML = PFLAG; pa.appendChild(f);
          const tx = rnd(14, 86), ty = rnd(30, 92);
          f.style.left = tx + "%"; f.style.top = ty + "%";
          f.animate([{ transform: "translate(" + (50 - tx) * 9 + "px, " + (52 - ty) * 5 + "px) rotate(0) scale(.6)" },
            { transform: "translate(" + (50 - tx) * 4.5 + "px, " + ((52 - ty) * 2.5 - 120) + "px) rotate(400deg) scale(1)", offset: 0.5 },
            { transform: "translate(0,0) rotate(720deg) scale(1)" }], { duration: 700, easing: "ease-out" });
          ref.el.firstChild.animate([{ transform: "rotate(0)" }, { transform: "rotate(-12deg)" }, { transform: "rotate(0)" }], { duration: 250 });
        }, k * 260);
        setTimeout(() => sheep.forEach((s, i) => {   // the herd loses it
          pose(i, "pose_point"); s.img.classList.add("mad");
          const m = document.createElement("b"); m.className = "madbub fxbit"; m.textContent = ["😠", "🤬", "😤", "‼️"][i % 4];
          s.el.appendChild(m);
        }), 900);
      });
      endShow(10500, () => {});
      setTimeout(() => ref.el.animate([{ left: "50%" }, { left: "112%" }], { duration: 1500, easing: "ease-in", fill: "forwards" }), 8600);
    },
  };

  let lastSent = 0;
  const send = (x, y) => { if (sock && sock.readyState === 1 && you) sock.send(JSON.stringify({ t: "go", x: +x.toFixed(2), y: +y.toFixed(2) })); };
  if (you) pa.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;                    // clicking another ram opens its page
    const b = pa.getBoundingClientRect();
    you.tx = clampX((e.clientX - b.left) / b.width * 100);
    you.ty = clampY((e.clientY - b.top) / b.height * 100 + 6);   // feet land where you click
    you.wait = 0; send(you.tx, you.ty);
  });
  let last = performance.now();
  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const s of sheep) {
      let moving = false;
      if (s.fx) {   // field show in progress: go where the show says
        const dx = s.fx.tx - s.x, dy = s.fx.ty - s.y, d = Math.hypot(dx, dy);
        if (d > 0.3 && s.fx.speed) { const v = Math.min(1, s.fx.speed * dt / d); s.x += dx * v; s.y += dy * v; s.t += dt * 12; moving = true; }
      } else if (s.me) {
        const kx = (keys.arrowright || keys.d ? 1 : 0) - (keys.arrowleft || keys.a ? 1 : 0);
        const ky = (keys.arrowdown || keys.s ? 1 : 0) - (keys.arrowup || keys.w ? 1 : 0);
        if (kx || ky) { s.x = clampX(s.x + kx * 14 * dt); s.y = clampY(s.y + ky * 14 * dt); s.tx = s.x; s.ty = s.y; moving = true;
          if (now - lastSent > 150) { lastSent = now; send(s.x, s.y); } }
        else {
          const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
          if (d > 0.3) { const v = Math.min(1, s.speed * dt / d); s.x += dx * v; s.y += dy * v; moving = true; }
        }
        if (moving) s.t += dt * 10;
      } else if (s.remote && Date.now() - s.remote < 120000) {
        const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
        if (d > 0.3) { const v = Math.min(1, s.speed * dt / d); s.x += dx * v; s.y += dy * v; s.t += dt * 10; moving = true; }
      } else if (s.wait > 0) s.wait -= dt;
      else {
        const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
        if (d < 0.5) {   // arrived: short breather, then a new spot anywhere on the field (sometimes a jog)
          s.wait = Math.random() < .3 ? rnd(2, 4) : rnd(0.5, 1.5);
          s.tx = rnd(14, 86); s.ty = rnd(24, 96); s.speed = !calm && Math.random() < .15 ? rnd(6, 8) : rnd(2.5, 4);
        } else { const v = Math.min(1, s.speed * dt / d); s.x += dx * v; s.y += dy * v; s.t += dt * (4 + s.speed * 0.8); moving = true; }
      }
      const k = 0.62;   // flat field: every ram the same size wherever it stands
      s.el.style.left = s.x + "%"; s.el.style.top = s.y + "%";
      const hop = !moving || calm ? 0 : -Math.abs(Math.sin(s.t)) * 6;   // trotting bounce while moving
      s.el.style.transform = "translateY(" + hop.toFixed(1) + "px) scale(" + k.toFixed(3) + ")"; s.el.style.transformOrigin = "50% 100%";
      s.el.style.zIndex = Math.round(s.y * 10);
    }
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
}

// Bets: every open prop bet, who's in, and how the last week's bets went.
function betsView() {
  if (!bets) { view.innerHTML = '<div class="empty">Loading bets...</div>'; return; }
  const open = bets.filter((b) => b.status === "open");
  sub.textContent = open.length + " open bet" + (open.length === 1 ? "" : "s") + " · 20 RUTS to pick a side, the right side wins a crate";
  if (!bets.length && !fights.length) { view.innerHTML = '<div class="empty">No bets yet. Post one in Discord with /prop random or /prop auto.</div>'; return; }
  const sideRow = (label, us, won) => '<div class="srow"><div class="count">' + label + " · " + us.length + (won && us.length ? " · each won a crate" : "") + "</div>" + (us.length ? faces(us) : "") + "</div>";
  const left = (t) => { const m = Math.round((t - Date.now()) / 60000); return m <= 0 ? "closed" : m < 60 ? m + "m left" : m < 1440 ? Math.round(m / 60) + "h left" : Math.round(m / 1440) + "d left"; };
  const card = (b) => {
    const st = b.status === "open" ? (b.closes > Date.now() ? '<span class="lock">Closes ' + when(new Date(b.closes)) + " · " + left(b.closes) + "</span>" : "Live · entries closed")
      : b.status === "hit" ? '<span class="rhit">HIT · ' + b.value + " " + esc(b.label) + "</span>" : b.status === "miss" ? '<span class="rmiss">Missed · ' + b.value + "</span>" : "Cancelled";
    return '<div class="game bet ' + b.status + '"><div class="meta"><span>Bet #' + b.id + " · " + esc(b.game) + "</span><span>" + st + "</span></div>"
      + '<div class="bt">' + esc(b.player) + " gets <b>" + b.line + "+</b> " + esc(b.label) + "</div>"
      + sideRow("✅ Hits", b.users.filter((u) => u.side !== "no"), b.status === "hit") + sideRow("❌ Misses", b.users.filter((u) => u.side === "no"), b.status === "miss") + "</div>";
  };
  const done = bets.filter((b) => b.status !== "open");
  const fightRow = (f) => {
    const wn = f.winner === f.a ? f.a_name : f.b_name;
    const res = f.status === "done" ? "<b>" + esc(wn) + "</b> won " + f.stake * 2 + " RUTS · " + f.rounds + " headbutts"
      : f.status === "pending" ? "Waiting for " + esc(f.b_name) + " to accept" : f.status === "declined" ? "Declined" : f.status === "expired" ? "Nobody showed up" : "Cancelled";
    return '<a class="fight ' + f.status + '" href="/fight/' + f.id + '"><span>🐏💥🐏 ' + esc(f.a_name) + " vs " + esc(f.b_name) + "</span><span>" + res
      + (f.status === "done" ? ' · <u>Watch</u>' : "") + "</span></a>";
  };
  const fightsHtml = fights.length ? '<h3 class="past">Ram fights</h3><div class="fights">' + fights.map(fightRow).join("") + "</div>" : "";
  view.innerHTML = (open.length ? '<p class="note">Take a bet with its button in Discord. Results settle live from the box score.</p><div class="grid">' + open.map(card).join("") + "</div>" : '<div class="empty">No open bets right now.</div>')
    + (done.length ? '<h3 class="past">Last 7 days</h3><div class="grid">' + done.map(card).join("") + "</div>" : "") + fightsHtml;
}

// ---------- Rams Bingo ----------
let bingo = null, bingoBusy = false;
function loadBingo(op) {
  const key = myKey();
  bingoBusy = true;
  return fetch("/api/bingo", { method: key ? "POST" : "GET", headers: key ? { "Content-Type": "application/json" } : {}, body: key ? JSON.stringify({ t: key, op }) : undefined })
    .then((r) => r.json()).then((d) => { bingo = d; bingoBusy = false; if (tab === "bingo") bingoView(); })
    .catch(() => { bingoBusy = false; if (!bingo) bingo = { error: "Couldn't load Bingo. Refresh to try again." }; if (tab === "bingo") bingoView(); });
}
setInterval(() => { if (tab === "bingo" && !document.hidden && bingo && bingo.locked) loadBingo(); }, 30000);
const BLINES = [[0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],[0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],[0,6,12,18,24],[4,8,12,16,20]];
function bingoView() {
  sub.textContent = "Rams Bingo";
  if (!bingo) { view.innerHTML = '<div class="empty">Shuffling cards...</div>'; loadBingo(); return; }
  if (bingo.error) { view.innerHTML = '<div class="empty">' + esc(bingo.error) + '</div>'; return; }
  const B = bingo, g = B.game, hits = B.hits || {};
  const kick = new Date(g.kick), when = kick.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  sub.textContent = "Rams Bingo · " + g.name;
  let html = '';
  if (B.card) {
    const on = (i) => B.card[i].id === "free" || !!hits[B.card[i].id];
    const win = new Set(); let n = 0;
    BLINES.forEach((l) => { if (l.every(on)) { n++; l.forEach((i) => win.add(i)); } });
    const marked = B.card.filter((c, i) => i !== 12 && on(i)).length;
    html += '<div class="bgwrap"><div class="bgcard"><div class="bghead">' + ["B", "I", "N", "G", "O"].map((c) => '<b>' + c + '</b>').join("") + '</div><div class="bggrid">'
      + B.card.map((c, i) => '<div class="bgsq' + (c.id === "free" ? " free" : "") + (on(i) ? " hit" : "") + (win.has(i) ? " win" : "") + '"><span>' + esc(c.label) + '</span>' + (on(i) && c.id !== "free" ? '<i></i>' : "") + '</div>').join("")
      + '</div></div><div class="bgside">'
      + '<div class="bgstat"><b>' + marked + '<small>/24</small></b><span>marked</span></div><div class="bgstat' + (n ? " gold" : "") + '"><b>' + n + '</b><span>' + (n === 1 ? "BINGO!" : n ? "BINGOS!" : "bingos") + '</span></div>'
      + '<div class="bgstat' + (n ? " gold" : "") + '"><b>\u{1F381}</b><span>' + (n ? (B.crates || 5) + " crates are yours" : "Any bingo pays " + (B.crates || 5) + " crates") + '</span></div>'
      + (B.locked ? '<p class="note">🔒 Locked at kickoff. Squares mark themselves from the live game every minute.</p>'
        : '<button class="bgroll" id="bgroll"' + (bingoBusy ? " disabled" : "") + '>🎲 Re-roll my card</button><p class="note">Re-roll as often as you want until kickoff (' + esc(when) + '). Then it locks.</p>')
      + '<p class="note">This card runs for the game week, until Tuesday 6 AM.</p>'
      + '</div></div>';
  } else {
    html += '<div class="empty">' + (B.expired ? "Your key expired. " : "") + 'Type <b>/bingo</b> in Discord and open the link to get your card for ' + esc(g.name) + '.</div>';
  }
  const board = B.board || [];
  html += '<h3 class="past">Cards in play (' + board.length + ')</h3>' + (board.length ? '<table><thead><tr><th>#</th><th>Player</th><th>Marked</th><th>Bingos</th></tr></thead><tbody>'
    + board.map((r, i) => '<tr' + (r.id === B.me ? ' class="mine"' : "") + '><td class="n">' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td class="n">' + r.marked + '/24</td><td class="n">' + (r.bingos ? "\u{1F3B1} " + r.bingos + (r.paid ? " \u00b7 \u{1F381}" : ""): "0") + '</td></tr>').join("")
    + '</tbody></table>' : '<div class="empty">Nobody has a card yet.</div>');
  view.innerHTML = html;
  const rb = document.getElementById("bgroll");
  if (rb) rb.onclick = () => { rb.disabled = true; loadBingo("reroll"); };
}

function render() {
  cancelAnimationFrame(raf);
  if (tab !== "herd") herdHandler = null;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
  { const on = document.querySelector("nav button.on"); if (on) on.parentNode.scrollLeft = Math.max(0, on.offsetLeft - 40); }
  if (tab === "herd") { pasture(); if (!live) pollLive(); return; }
  if (tab === "bets") { betsView(); return; }
  if (tab === "bingo") { bingoView(); return; }
  if (tab === "week") {
    if (!week) return;
    if (week.error) { view.innerHTML = '<div class="empty">Couldn\\'t load this week: ' + esc(week.error) + '</div>'; return; }
    sub.textContent = (week.label || "This week") + " · live picks from Discord";
    view.innerHTML = week.games.length
      ? '<p class="note">Hover a face to see who picked it. Updates every couple of minutes.</p><div class="grid">'
        + week.games.map((g) => card(g)).join("") + '</div>'
      : '<div class="empty">New polls go up Tuesday at 6 AM. Check Last Week and Standings in the meantime.</div>';
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
{ // links like #bingo&t=KEY carry a personal key: keep it in this browser, then drop it from the address bar
  const hp = new URLSearchParams(location.hash.slice(1)), k = hp.get("t");
  if (k) { try { localStorage.setItem("lr_t", k); } catch {} hp.delete("t"); history.replaceState(null, "", "#" + [...hp.keys()][0]); }
}
if (["week", "last", "table", "herd", "bets", "bingo"].includes(location.hash.slice(1))) tab = location.hash.slice(1);
fetch("/api/week").then((r) => r.json()).then((d) => { week = d; if (tab === "week") render(); }).catch((e) => { week = {error: e.message}; render(); });
render();
fetch("/api/history").then((r) => r.json()).then((d) => { hist = d; if (tab === "last" || tab === "table") render(); }).catch(() => {});
connect();
fetch("/api/bets").then((r) => r.json()).then((d) => { bets = d.bets; fights = d.fights || []; if (tab === "bets") render(); }).catch(() => { bets = []; });
fetch("/api/herd").then((r) => r.json()).then((d) => { herd = d; if (tab === "herd") render(); }).catch(() => { herd = { rams: [] }; });
</script>
</body>
</html>`;
