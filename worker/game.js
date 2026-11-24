// Ram game: points, crates, inventory, looks and prop bets, stored in one Durable Object (SQLite).
//
// Points:  +10 per correct pick'em pick (from data/picks.csv, Week 12 of 2026 onward).
// Crates:  60 points each. Everyone starts with one free crate, and their first crate is always the Girl Ram.
//          Duplicates refund points by rarity.
// Props:   admins post "PLAYER gets N+ STAT". Entry costs 20 points; a hit wins a crate.
//          Results come from ESPN's live box score, so a prop can pay out mid-game the moment it hits.
// Fights:  challenge someone for 50 RUTS each, winner takes 100. The fight plays out on the website.
// The currency is called RUTS. It's earned only. Nothing here can be bought with money.

import { DurableObject } from "cloudflare:workers";
import { ITEMS, RARITY, FIRST_CRATE, SLOTS, SLOT_NAMES, BODY_TYPES } from "./ram.js";
import { lockerUser } from "./auth.js";

export const PICK_POINTS = 10, CRATE_COST = 60, PROP_COST = 20, FIGHT_STAKE = 50;
const FIGHT_TTL = 10 * 60_000;   // challenges expire after 10 minutes
const CSV_URL = "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/data/picks.csv";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const APP_ID = "1574684181361852416";
const SITE = "https://rams-bot.ramsherd.workers.dev";
const UNCANNY_ODDS = 500;   // 1 in 500 crates, on top of the normal roll
const GOLD = 0xffa300;

// Picks count from Week 12 of 2026 (fresh start), plus every playoff round after.
const counts = (r) => Number(r.season) > 2026 || (Number(r.season) === 2026 && (Number(r.week) >= 12 || !/^Week /.test(r.label)));

export const STATS = {
  pass_yds: ["passing", "passingYards", "passing yards"],
  pass_td: ["passing", "passingTouchdowns", "passing TDs"],
  rush_yds: ["rushing", "rushingYards", "rushing yards"],
  rush_td: ["rushing", "rushingTouchdowns", "rushing TDs"],
  rec_yds: ["receiving", "receivingYards", "receiving yards"],
  receptions: ["receiving", "receptions", "catches"],
  rec_td: ["receiving", "receivingTouchdowns", "receiving TDs"],
  tackles: ["defensive", "totalTackles", "tackles"],
  sacks: ["defensive", "sacks", "sacks"],
  any_td: ["multi", [["rushing", "rushingTouchdowns"], ["receiving", "receivingTouchdowns"]], "touchdowns"],
};

// Konata Mumpfield never appears by name.
const K_WORDS = ["Kumquat", "Kombucha", "Kettlebell", "Karaoke", "Kazoo", "Kiwi", "Ketchup", "Kangaroo", "Kale", "Kebab", "Koala", "Kickflip", "Karate", "Kayak", "Keyboard", "Kimchi", "Knuckles", "Kilowatt", "Kettlecorn", "Kitten"];
const M_WORDS = ["Muffin", "Mongoose", "Meatball", "Moonpie", "Mustache", "Marmalade", "Mudslide", "Mixtape", "Minivan", "Moose", "Macaroni", "Mayhem", "Marshmallow", "Mothership", "Mango", "Mullet", "Monsoon", "Meerkat", "Microwave", "Meatloaf"];
const shown = (name) => /konata|mumpfield|mumfield/i.test(name || "")
  ? `${K_WORDS[Math.floor(Math.random() * K_WORDS.length)]} ${M_WORDS[Math.floor(Math.random() * M_WORDS.length)]}` : name;

// Sleeper's free projections set the lines; ESPN's box score settles them.
const SLEEPER = "https://api.sleeper.app";
const ESPN_TEAM = { WAS: "WSH" };   // Sleeper code -> ESPN code where they differ
const SLEEPER_KEY = { pass_yds: "pass_yd", rush_yds: "rush_yd", rec_yds: "rec_yd", receptions: "rec" };
const round5 = (v) => Math.max(10, Math.round(v / 5) * 5);
function lineFor(stat, st) {
  if (stat === "any_td") return 1;
  const v = st[SLEEPER_KEY[stat]] || 0;
  return stat === "receptions" ? Math.max(2, Math.round(v)) : round5(v);
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const pub = (it) => it && { id: it.id, name: it.name, slot: it.slot, rarity: it.rarity, starter: !!it.starter };
const rarityLine = (it) => `${RARITY[it.rarity]?.label || "Secret"} ${SLOT_NAMES[it.slot] || it.slot}`;

// Crate pool: everything except base looks (the girl base comes from the first crate) and the secret finish.
const POOL = {};
for (const it of Object.values(ITEMS)) {
  if (it.slot === "base" || it.rarity === "secret" || it.starter) continue;
  (POOL[it.rarity] ||= []).push(it.id);
}

export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, points INTEGER DEFAULT 0, crates INTEGER DEFAULT 1,
        opened INTEGER DEFAULT 0, look TEXT DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS ledger (key TEXT PRIMARY KEY, user_id TEXT, delta INTEGER, reason TEXT, ts INTEGER);
      CREATE TABLE IF NOT EXISTS items (user_id TEXT, item_id TEXT, ts INTEGER, PRIMARY KEY (user_id, item_id));
      CREATE TABLE IF NOT EXISTS props (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, game TEXT, player TEXT, stat TEXT,
        line REAL, closes INTEGER, status TEXT DEFAULT 'open', value REAL, channel_id TEXT, message_id TEXT, token TEXT, created INTEGER);
      CREATE TABLE IF NOT EXISTS entries (prop_id INTEGER, user_id TEXT, ts INTEGER, PRIMARY KEY (prop_id, user_id));
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS fights (id INTEGER PRIMARY KEY AUTOINCREMENT, a TEXT, b TEXT, a_name TEXT, b_name TEXT, stake INTEGER,
        status TEXT DEFAULT 'pending', winner TEXT, rounds INTEGER, seed INTEGER, a_look TEXT, b_look TEXT, channel_id TEXT, created INTEGER);`);
  }

  // ---------- live Herd: everyone sees where everyone drives their ram ----------
  // Sockets use the hibernation API, so an idle field costs nothing. Positions live in the meta table.
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ t: "snap", pos: this.herdPos() }));
    return new Response(null, { status: 101, webSocket: client });
  }
  herdPos() {
    const all = JSON.parse(this.meta("herdpos") || "{}"), cutoff = Date.now() - 15 * 60_000, out = {};
    for (const [id, p] of Object.entries(all)) if (p.ts > cutoff) out[id] = p;
    return out;
  }
  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === "hello") {
      const uid = await lockerUser(this.env, m.k);
      ws.serializeAttachment({ uid });
      ws.send(JSON.stringify({ t: "you", id: uid }));
      return;
    }
    const uid = ws.deserializeAttachment()?.uid;
    if (m.t !== "go" || !uid) return;   // only signed-in players can drive, and only their own ram
    const x = Math.max(12, Math.min(88, Number(m.x) || 50)), y = Math.max(24, Math.min(96, Number(m.y) || 70));
    const pos = this.herdPos();
    pos[uid] = { x, y, ts: Date.now() };
    this.meta("herdpos", JSON.stringify(pos));
    const msg = JSON.stringify({ t: "go", id: uid, x, y });
    for (const other of this.ctx.getWebSockets()) if (other !== ws) { try { other.send(msg); } catch {} }
  }
  webSocketClose(ws, code) { try { ws.close(code, "bye"); } catch {} }

  // ---------- helpers ----------
  one(q, ...a) { return this.sql.exec(q, ...a).toArray()[0]; }
  all(q, ...a) { return this.sql.exec(q, ...a).toArray(); }
  meta(k, v) {
    if (v === undefined) return this.one("SELECT v FROM meta WHERE k=?", k)?.v;
    this.sql.exec("INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, String(v));
  }
  user(id, name) {
    this.sql.exec("INSERT INTO users (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name=COALESCE(excluded.name, users.name)", id, name || null);
    return this.one("SELECT * FROM users WHERE id=?", id);
  }
  /** Add points once per key. Returns false if this key was already paid. */
  pay(key, uid, delta, reason) {
    const done = this.one("SELECT 1 AS x FROM ledger WHERE key=?", key);
    if (done) return false;
    this.sql.exec("INSERT INTO ledger (key,user_id,delta,reason,ts) VALUES (?,?,?,?,?)", key, uid, delta, reason, Date.now());
    this.sql.exec("UPDATE users SET points = points + ? WHERE id=?", delta, uid);
    return true;
  }
  owned(uid) { return new Set(this.all("SELECT item_id FROM items WHERE user_id=?", uid).map((r) => r.item_id)); }

  // ---------- pick'em points ----------
  async syncPicks(force = false) {
    const last = Number(this.meta("synced") || 0);
    if (!force && Date.now() - last < 5 * 60_000) return 0;
    this.meta("synced", Date.now());
    const res = await fetch(CSV_URL, { cf: { cacheTtl: 120 } });
    if (!res.ok) return 0;
    const [head, ...rows] = (await res.text()).trim().split(/\r?\n/).map(splitCSV);
    let n = 0;
    for (const vals of rows) {
      const r = Object.fromEntries(head.map((h, i) => [h, vals[i]]));
      if (r.correct !== "1" || !counts(r)) continue;
      this.user(r.user_id, r.user_name);
      if (this.pay(`pick:${r.event_id}:${r.user_id}`, r.user_id, PICK_POINTS, `${r.label}: ${r.game}`)) n++;
    }
    return n;
  }

  // ---------- crates ----------
  roll(uid, u) {
    if (u.opened === 0) return { id: FIRST_CRATE[0], guaranteed: true };
    if (rand(UNCANNY_ODDS) === 0) return { id: "finish_uncanny" };
    const tiers = Object.entries(RARITY).filter(([k]) => POOL[k]?.length);
    let r = rand(tiers.reduce((s, [, v]) => s + v.weight, 0));
    for (const [k, v] of tiers) {
      if ((r -= v.weight) < 0) return { id: POOL[k][rand(POOL[k].length)] };
    }
  }

  openCrate(uid, name) {
    let u = this.user(uid, name);
    let bought = false;
    if (u.crates < 1) {
      if (u.points < CRATE_COST) return { error: `A crate costs **${CRATE_COST} RUTS**. You have **${u.points}**. Correct picks pay ${PICK_POINTS} each.` };
      this.sql.exec("UPDATE users SET points = points - ?, crates = crates + 1 WHERE id=?", CRATE_COST, uid);
      this.sql.exec("INSERT INTO ledger (key,user_id,delta,reason,ts) VALUES (?,?,?,?,?)", `crate:${crypto.randomUUID()}`, uid, -CRATE_COST, "Bought a crate", Date.now());
      bought = true;
      u = this.one("SELECT * FROM users WHERE id=?", uid);
    }
    const { id, guaranteed } = this.roll(uid, u);
    const it = ITEMS[id];
    const dupe = this.owned(uid).has(id);
    this.sql.exec("UPDATE users SET crates = crates - 1, opened = opened + 1 WHERE id=?", uid);
    let refund = 0;
    if (dupe) {
      refund = RARITY[it.rarity]?.refund || 10;
      this.pay(`dupe:${crypto.randomUUID()}`, uid, refund, `Duplicate ${it.name}`);
    } else {
      this.sql.exec("INSERT INTO items (user_id,item_id,ts) VALUES (?,?,?)", uid, id, Date.now());
    }
    return { item: pub(it), dupe, refund, guaranteed, bought, user: this.one("SELECT * FROM users WHERE id=?", uid) };
  }

  equip(uid, itemId) {
    const it = ITEMS[itemId];
    if (!it) return { error: "Unknown item." };
    const free = it.starter;
    if (!free && !this.owned(uid).has(itemId)) return { error: `You don't own **${it.name}** yet.` };
    const u = this.user(uid);
    const look = JSON.parse(u.look);
    look[it.slot === "body" ? "body" : it.slot] = itemId;
    this.sql.exec("UPDATE users SET look=? WHERE id=?", JSON.stringify(look), uid);
    return { item: pub(it), look };
  }

  setLook(uid, key, value) {
    const u = this.user(uid);
    const look = JSON.parse(u.look);
    if (value == null) delete look[key]; else look[key] = value;
    this.sql.exec("UPDATE users SET look=? WHERE id=?", JSON.stringify(look), uid);
    return look;
  }

  look(uid) {
    const u = this.one("SELECT name, look FROM users WHERE id=?", uid);
    return u ? { name: u.name, look: JSON.parse(u.look) } : null;
  }

  // ---------- props ----------
  async ramsGame() {
    const res = await fetch(`${ESPN}/teams/14`, { cf: { cacheTtl: 300 } });
    const ev = (await res.json()).team?.nextEvent?.[0];
    if (!ev) return null;
    const c = ev.competitions[0];
    return { id: ev.id, name: ev.shortName || ev.name, kick: Date.parse(ev.date), state: c.status?.type?.state };
  }

  async box(eventId) {
    const res = await fetch(`${ESPN}/summary?event=${eventId}`, { cf: { cacheTtl: 45 } });
    if (!res.ok) return null;
    const d = await res.json();
    return { state: d.header?.competitions?.[0]?.status?.type?.state, players: d.boxscore?.players || [] };
  }

  statFor(box, player, stat) {
    if (STATS[stat][0] === "multi") {   // e.g. anytime TD = rushing + receiving
      const parts = STATS[stat][1].map(([cat, key]) => this.statLine(box, player, cat, key));
      return parts.every((v) => v === null) ? null : parts.reduce((a, v) => a + (v || 0), 0);
    }
    return this.statLine(box, player, ...STATS[stat]);
  }
  statLine(box, player, cat, key) {
    const want = norm(player);
    let found = null;
    for (const team of box.players) {
      const c = team.statistics?.find((s) => s.name === cat);
      if (!c) continue;
      const i = c.keys.indexOf(key);
      for (const a of c.athletes || []) {
        const n = norm(a.athlete?.displayName);
        if (n === want || n.endsWith(" " + want) || (want.includes(" ") && n.includes(want))) found = Number(String(a.stats[i]).split("/")[0]) || 0;
      }
    }
    return found;   // null = no line for this player yet (didn't record a stat in this category)
  }

  async createProp({ player, stat, line, minutes, channel_id, token, event }) {
    const g = event || await this.ramsGame();
    if (!g) return { error: "Couldn't find the Rams' next game on ESPN." };
    const now = Date.now();
    const closes = minutes ? now + minutes * 60_000 : g.kick > now ? g.kick : now + 10 * 60_000;
    this.sql.exec("INSERT INTO props (event_id, game, player, stat, line, closes, channel_id, token, created) VALUES (?,?,?,?,?,?,?,?,?)",
      g.id, g.name, player, stat, line, closes, channel_id ?? null, token ?? null, now);
    return { prop: this.one("SELECT * FROM props WHERE id = last_insert_rowid()") };
  }

  // ---------- generated props ----------
  async sleeper() {
    const st = await (await fetch(`${SLEEPER}/v1/state/nfl`, { cf: { cacheTtl: 900 } })).json();
    const type = st.season_type === "post" ? "post" : "regular";
    const url = `${SLEEPER}/projections/nfl/${st.season}/${st.week}?season_type=${type}&position[]=QB&position[]=RB&position[]=WR&position[]=TE`;
    const proj = (await (await fetch(url, { cf: { cacheTtl: 1800 } })).json()).filter((p) => p.stats && p.team && p.player);
    const games = await (await fetch(`${ESPN}/scoreboard?week=${st.week}&seasontype=${type === "post" ? 3 : 2}`, { cf: { cacheTtl: 300 } })).json();
    const byTeam = {};
    for (const ev of games.events || []) {
      const c = ev.competitions[0];
      const g = { id: ev.id, name: ev.shortName, kick: Date.parse(ev.date), state: c.status?.type?.state };
      for (const t of c.competitors) byTeam[t.team.abbreviation] = g;
    }
    const gameOf = (team) => byTeam[ESPN_TEAM[team] || team];
    return { proj, gameOf };
  }
  name(p) { return `${p.player.first_name} ${p.player.last_name}`; }

  /**
   * Hand-made bet (/prop create). The line defaults to Sleeper's projection, and a line set too far
   * below the projection (or below a sane floor) gets refused, so nobody posts "Stafford 1+ passing yard".
   */
  async manualProp({ player, stat, line, ...opts }) {
    const FLOOR = { pass_yds: 150, rush_yds: 30, rec_yds: 30, receptions: 2, tackles: 3, sacks: 1, pass_td: 1, rush_td: 1, rec_td: 1, any_td: 1 };
    let p = null, event = null;
    if (SLEEPER_KEY[stat] || stat === "any_td") {
      const { proj, gameOf } = await this.sleeper();
      const want = norm(player);
      p = proj.find((x) => norm(this.name(x)) === want) || proj.find((x) => norm(this.name(x)).endsWith(" " + want));
      if (p) { player = this.name(p); event = gameOf(p.team); }
    }
    const fair = p ? lineFor(stat, p.stats) : null;
    if (line == null) {
      if (fair == null) return { error: `Couldn't find a projection for ${player}. Add an amount.` };
      line = fair;
    }
    if (line < FLOOR[stat]) return { error: `${line} is too easy. The lowest allowed for this stat is ${FLOOR[stat]}.` };
    if (fair && stat !== "any_td" && line < fair * 0.75) return { error: `${line} is too easy. Sleeper projects about ${fair}, so go ${Math.ceil(fair * 0.75)} or higher (or leave the amount blank).` };
    if (event && event.state !== "pre") return { error: `${player}'s game already started.` };
    return this.createProp({ ...opts, player, stat, line, event: event || undefined });
  }

  /** A completely random bet: any team still to play, any notable player, any stat that fits them. */
  async randomProp(opts = {}) {
    const { proj, gameOf } = await this.sleeper();
    const soon = Date.now() + 15 * 60_000;
    const pool = proj.filter((p) => (p.stats.pts_ppr || 0) >= 6 && gameOf(p.team)?.state === "pre" && gameOf(p.team).kick > soon);
    if (!pool.length) return { error: "No games left to bet on this week." };
    const p = pool[rand(pool.length)], pos = p.player.position, st = p.stats;
    const options = (pos === "QB" ? ["pass_yds", st.rush_yd >= 15 && "rush_yds", (st.rush_td || 0) >= 0.25 && "any_td"]
      : pos === "RB" ? ["rush_yds", st.rec >= 2 && "receptions", "any_td"]
      : ["rec_yds", "receptions", (st.rec_td || 0) >= 0.3 && "any_td"]).filter(Boolean);
    const stat = options[rand(options.length)];
    return this.createProp({ ...opts, player: this.name(p), stat, line: lineFor(stat, st), event: gameOf(p.team) });
  }

  /** The Rams set: Stafford's yards, the top back, top two pass catchers, an anytime TD, and the other team's top receiver. */
  async ramsProps(opts = {}) {
    const { proj, gameOf } = await this.sleeper();
    const rams = proj.filter((p) => p.team === "LAR");
    if (!rams.length) return { error: "No Rams projections this week (bye week?)." };
    const g = gameOf("LAR");
    if (!g || g.state !== "pre") return { error: "The Rams game already started." };
    if (this.meta(`autoprops:${g.id}`)) return { error: "This game's bets are already posted." };
    const top = (list, key) => list.slice().sort((a, b) => (b.stats[key] || 0) - (a.stats[key] || 0));
    const opp = proj.filter((p) => p.team === rams[0].opponent);
    const picks = [], used = new Set();
    const add = (p, stat) => { if (p && !used.has(p.player_id + stat)) { used.add(p.player_id + stat); picks.push([p, stat]); } };
    add(top(rams.filter((p) => p.player.position === "QB"), "pass_yd")[0], "pass_yds");
    add(top(rams.filter((p) => p.player.position === "RB"), "rush_yd")[0], "rush_yds");
    for (const p of top(rams.filter((p) => ["WR", "TE"].includes(p.player.position)), "rec_yd").slice(0, 2)) add(p, "rec_yds");
    add(top(rams.filter((p) => p.player.position !== "QB"), "rec_td").sort((a, b) => ((b.stats.rec_td || 0) + (b.stats.rush_td || 0)) - ((a.stats.rec_td || 0) + (a.stats.rush_td || 0)))[0], "any_td");
    add(top(opp.filter((p) => ["WR", "TE"].includes(p.player.position)), "rec_yd")[0], "rec_yds");
    const props = [];
    for (const [p, stat] of picks) {
      const r = await this.createProp({ ...opts, player: this.name(p), stat, line: lineFor(stat, p.stats), event: g });
      if (r.prop) props.push(r.prop);
    }
    this.meta(`autoprops:${g.id}`, Date.now());
    return { props };
  }

  /** Bot posts a bet in a channel (needs Send Messages there). */
  async postProp(p, channelId) {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }, body: JSON.stringify(propMessage(p, 0)) });
    if (!res.ok) { console.log("postProp", res.status, await res.text()); return false; }
    const m = await res.json();
    this.sql.exec("UPDATE props SET channel_id=?, message_id=? WHERE id=?", channelId, m.id, p.id);
    return true;
  }

  /** Game day: post the Rams set (plus one random wildcard) a day before kickoff, in the channel /prop auto was last run in. */
  async autoPost() {
    const ch = this.meta("propsChannel");
    if (!ch) return;
    const g = await this.ramsGame().catch(() => null);
    if (!g || this.meta(`autoprops:${g.id}`)) return;
    const left = g.kick - Date.now();
    if (left > 24 * 3600_000 || left < 30 * 60_000) return;
    const r = await this.ramsProps({ channel_id: ch });
    const wild = await this.randomProp({ channel_id: ch });
    for (const p of [...(r.props || []), ...(wild.prop ? [wild.prop] : [])]) await this.postProp(p, ch);
  }

  enter(propId, uid, name) {
    const p = this.one("SELECT * FROM props WHERE id=?", propId);
    if (!p) return { error: "That bet is gone." };
    if (p.status !== "open" || Date.now() > p.closes) return { error: "This bet is closed." };
    if (this.one("SELECT 1 AS x FROM entries WHERE prop_id=? AND user_id=?", propId, uid)) return { error: "You're already in on this one." };
    const u = this.user(uid, name);
    if (u.points < PROP_COST) return { error: `Entry is **${PROP_COST} RUTS**. You have **${u.points}**.` };
    this.sql.exec("INSERT INTO entries (prop_id,user_id,ts) VALUES (?,?,?)", propId, uid, Date.now());
    this.pay(`prop:${propId}:${uid}`, uid, -PROP_COST, `Bet #${propId}`);
    return { prop: p, count: this.count(propId), user: this.one("SELECT * FROM users WHERE id=?", uid) };
  }

  count(propId) { return this.one("SELECT COUNT(*) AS n FROM entries WHERE prop_id=?", propId).n; }

  settle(p, hit, value) {
    this.sql.exec("UPDATE props SET status=?, value=? WHERE id=?", hit ? "hit" : "miss", value, p.id);
    const players = this.all("SELECT user_id FROM entries WHERE prop_id=?", p.id).map((r) => r.user_id);
    if (hit) for (const uid of players) {
      if (this.pay(`propwin:${p.id}:${uid}`, uid, 0, `Won bet #${p.id}: a crate`)) this.sql.exec("UPDATE users SET crates = crates + 1 WHERE id=?", uid);
    }
    return players;
  }

  cancel(propId) {
    const p = this.one("SELECT * FROM props WHERE id=?", propId);
    if (!p || p.status === "hit" || p.status === "miss") return { error: "Can't cancel that one." };
    this.sql.exec("UPDATE props SET status='cancelled' WHERE id=?", propId);
    const players = this.all("SELECT user_id FROM entries WHERE prop_id=?", propId).map((r) => r.user_id);
    for (const uid of players) this.pay(`refund:${propId}:${uid}`, uid, PROP_COST, `Bet #${propId} cancelled`);
    return { prop: { ...p, status: "cancelled" }, players };
  }

  async resolveProps() {
    const open = this.all("SELECT * FROM props WHERE status='open'");
    const done = [];
    const boxes = {};
    for (const p of open) {
      const box = (boxes[p.event_id] ||= await this.box(p.event_id));
      if (!box || box.state === "pre") continue;
      const v = this.statFor(box, p.player, p.stat) ?? 0;
      if (v >= p.line) done.push({ p, hit: true, v, players: this.settle(p, true, v) });
      else if (box.state === "post") done.push({ p, hit: false, v, players: this.settle(p, false, v) });
    }
    for (const d of done) await this.announce({ ...d.p, status: d.hit ? "hit" : "miss", value: d.v }, d.players);
    return done.length;
  }

  // Edit the bet's message with the result. Interaction-response messages belong to the app, so the
  // bot can edit them by channel/message id; the webhook token works too for the first 15 minutes.
  async announce(p, players) {
    const msg = propMessage(p, players.length, players);
    const tries = [];
    if (p.channel_id && p.message_id) tries.push([`https://discord.com/api/v10/channels/${p.channel_id}/messages/${p.message_id}`, `Bot ${this.env.DISCORD_BOT_TOKEN}`]);
    if (p.token) tries.push([`https://discord.com/api/v10/webhooks/${APP_ID}/${p.token}/messages/@original`, null]);
    for (const [url, auth] of tries) {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(msg) });
      if (res.ok) break;
    }
    if (p.status === "hit" && players.length && p.channel_id) {
      await fetch(`https://discord.com/api/v10/channels/${p.channel_id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` },
        body: JSON.stringify({ content: `🎉 **${shown(p.player)}** hit ${p.line}+ ${STATS[p.stat][2]}! ${players.map((u) => `<@${u}>`).join(" ")} each won a crate. Open it with **/crate**.`,
          allowed_mentions: { users: players.slice(0, 100) } }),
      });
    }
  }

  setPropsChannel(ch) { this.meta("propsChannel", ch); }
  async saveMessage(propId, channelId, messageId) {
    this.sql.exec("UPDATE props SET channel_id=?, message_id=? WHERE id=? AND message_id IS NULL", channelId, messageId, propId);
  }

  // ---------- fights ----------
  challenge(a, aName, b, bName, channelId) {
    if (a === b) return { error: "You can't fight yourself." };
    const u = this.user(a, aName);
    this.user(b, bName);
    if (u.points < FIGHT_STAKE) return { error: `A fight costs **${FIGHT_STAKE} RUTS**. You have **${u.points}**.` };
    if (this.one("SELECT 1 AS x FROM fights WHERE status='pending' AND ((a=? AND b=?) OR (a=? AND b=?))", a, b, b, a))
      return { error: "There's already a fight waiting between you two." };
    this.sql.exec("INSERT INTO fights (a,b,a_name,b_name,stake,channel_id,created) VALUES (?,?,?,?,?,?,?)", a, b, aName, bName, FIGHT_STAKE, channelId, Date.now());
    const f = this.one("SELECT * FROM fights WHERE id = last_insert_rowid()");
    this.pay(`fight:${f.id}:${a}`, a, -FIGHT_STAKE, `Fight #${f.id} vs ${bName}`);
    return { fight: f };
  }

  accept(id, uid, name) {
    const f = this.one("SELECT * FROM fights WHERE id=?", id);
    if (!f || f.status !== "pending") return { error: "This fight is over." };
    if (uid !== f.b) return { error: "Only the challenged ram can accept." };
    if (Date.now() - f.created > FIGHT_TTL) { this.endFight(f, "expired"); return { error: "This challenge expired. Their RUTS went back." }; }
    const u = this.user(uid, name);
    if (u.points < f.stake) return { error: `You need **${f.stake} RUTS** to fight. You have **${u.points}**.` };
    this.pay(`fight:${f.id}:${uid}`, uid, -f.stake, `Fight #${f.id} vs ${f.a_name}`);
    const winner = rand(2) ? f.a : f.b, rounds = 2 + rand(2), seed = rand(1e9);
    const look = (x) => this.one("SELECT look FROM users WHERE id=?", x)?.look || "{}";
    this.sql.exec("UPDATE fights SET status='done', winner=?, rounds=?, seed=?, a_look=?, b_look=? WHERE id=?", winner, rounds, seed, look(f.a), look(f.b), id);
    this.pay(`fightwin:${f.id}`, winner, f.stake * 2, `Won fight #${f.id}`);
    return { fight: this.one("SELECT * FROM fights WHERE id=?", id) };
  }

  /** Decline (by the challenged ram), cancel (by the challenger), or expire: the challenger gets their RUTS back. */
  endFight(f, status) {
    this.sql.exec("UPDATE fights SET status=? WHERE id=? AND status='pending'", status, f.id);
    this.pay(`fightrefund:${f.id}`, f.a, f.stake, `Fight #${f.id} ${status}`);
  }
  decline(id, uid) {
    const f = this.one("SELECT * FROM fights WHERE id=?", id);
    if (!f || f.status !== "pending") return { error: "This fight is over." };
    if (uid !== f.a && uid !== f.b) return { error: "This isn't your fight." };
    this.endFight(f, uid === f.b ? "declined" : "cancelled");
    return { fight: this.one("SELECT * FROM fights WHERE id=?", id) };
  }
  fight(id) { return this.one("SELECT * FROM fights WHERE id=?", id); }

  /** One-time gift to every ram owner and everyone who has ever made a pick. Each key pays once. */
  async grantOnce(tag, amount, reason) {
    if (this.meta(`grant:${tag}`)) return 0;
    const res = await fetch(CSV_URL, { cf: { cacheTtl: 60 } });
    if (!res.ok) return 0;
    const [head, ...rows] = (await res.text()).trim().split(/\r?\n/).map(splitCSV);
    const iu = head.indexOf("user_id"), inm = head.indexOf("user_name");
    for (const r of rows) if (r[iu]) this.user(r[iu], r[inm]);
    let n = 0;
    for (const { id } of this.all("SELECT id FROM users")) if (this.pay(`grant:${tag}:${id}`, id, amount, reason)) n++;
    this.meta(`grant:${tag}`, Date.now());
    return n;
  }

  async tick() {
    await this.grantOnce("launch50", 50, "Welcome gift");
    try { await this.autoPost(); } catch (e) { console.log("autoPost", e); }
    for (const f of this.all("SELECT * FROM fights WHERE status='pending' AND created < ?", Date.now() - FIGHT_TTL)) this.endFight(f, "expired");
    await this.syncPicks();
    const n = await this.resolveProps();
    return n;
  }

  // ---------- read models ----------
  wallet(uid, name) {
    const u = this.user(uid, name);
    const recent = this.all("SELECT delta, reason FROM ledger WHERE user_id=? ORDER BY ts DESC LIMIT 6", uid);
    const rank = this.one("SELECT COUNT(*) AS n FROM users WHERE points > ?", u.points).n + 1;
    return { user: u, recent, rank, items: this.owned(uid).size };
  }
  locker(uid) {
    const u = this.one("SELECT * FROM users WHERE id=?", uid) || this.user(uid);
    return { name: u.name, points: u.points, crates: u.crates, opened: u.opened, look: JSON.parse(u.look), items: this.inventory(uid) };
  }
  herd() { return this.all("SELECT id, name, points FROM users"); }
  leaders() { return this.all("SELECT id, name, points FROM users ORDER BY points DESC LIMIT 10"); }
  inventory(uid) {
    return this.all("SELECT item_id FROM items WHERE user_id=? ORDER BY ts", uid).map((r) => pub(ITEMS[r.item_id])).filter(Boolean);
  }
  propById(id) { return this.one("SELECT * FROM props WHERE id=?", id); }
  openProps() { return this.all("SELECT * FROM props WHERE status='open' ORDER BY id DESC LIMIT 10"); }
}

function splitCSV(line) {
  const out = []; let f = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(f); f = ""; } else f += c;
  }
  out.push(f);
  return out;
}

export function propMessage(p, count, winners = []) {
  const stat = STATS[p.stat][2];
  p = { ...p, player: shown(p.player) };
  const ts = Math.floor(p.closes / 1000);
  const result = p.status === "hit" ? `\n\n✅ **HIT** - ${p.value} ${stat}. ${count} winner${count === 1 ? "" : "s"} got a crate.`
    : p.status === "miss" ? `\n\n❌ **MISSED** - finished with ${p.value} ${stat}.`
    : p.status === "cancelled" ? "\n\n🚫 **Cancelled** - entries refunded." : "";
  const open = p.status === "open";
  return {
    embeds: [{
      title: `🎲 Bet #${p.id}: ${p.player} gets ${p.line}+ ${stat}`,
      description: `${p.game}\nEntry: **${PROP_COST} RUTS**  •  Prize: **a crate**\n${open ? `Closes <t:${ts}:R>` : ""}${result}`,
      color: p.status === "hit" ? 0x22c55e : p.status === "miss" ? 0xef4444 : GOLD,
      footer: { text: `${count} in` },
    }],
    components: open ? [{ type: 1, components: [{ type: 2, style: 3, custom_id: `prop:${p.id}`, label: `Take the bet (${PROP_COST} RUTS)`, emoji: { name: "🎲" } }] }] : [],
    allowed_mentions: { parse: [] },
  };
}

export { shown };
export { SITE, rarityLine, SLOTS, SLOT_NAMES, BODY_TYPES };
