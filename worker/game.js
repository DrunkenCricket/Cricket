// Ram game: points, crates, inventory, looks and prop bets, stored in one Durable Object (SQLite).
//
// Points:  +5 for every pick'em vote, +10 more when it's right (from data/picks.csv, Week 12 of 2026 onward).
//          Each finished week: most correct picks wins a crate; 2nd and 3rd place get 20 RUTS. Ties share.
// Crates:  every 10th crate a player opens is guaranteed Rare or better.
//          60 points each. Everyone starts with one free crate, and their first crate is always the Girl Ram.
//          Duplicates refund points by rarity.
// Props:   admins post "PLAYER gets N+ STAT". Entry costs 20 points; a hit wins a crate.
//          Results come from ESPN's live box score, so a prop can pay out mid-game the moment it hits.
// Fights:  challenge someone for 50 RUTS each, winner takes 100. The fight plays out on the website.
// The currency is called RUTS. It's earned only. Nothing here can be bought with money.

import { DurableObject } from "cloudflare:workers";
import { ITEMS, RARITY, FIRST_CRATE, SLOTS, SLOT_NAMES, BODY_TYPES } from "./ram.js";
import { lockerUser } from "./auth.js";

export const PICK_POINTS = 10, VOTE_POINTS = 5, CRATE_COST = 60, PROP_COST = 20, FIGHT_STAKE = 50;
// Weekly accuracy bonus (dense ranking, so ties share a place): 1st place gets a crate, 2nd and 3rd get 20 RUTS.
export const PODIUM_RUTS = 20;
const STATE_URL = "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/state/pickem.json";
const FIGHT_TTL = 12 * 3600_000;   // challenges stay open 12 hours
const CSV_URL = "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/data/picks.csv";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const APP_ID = "1574684181361852416";
const SITE = "https://rams-bot.ramsherd.workers.dev";
const UNCANNY_ODDS = 500;   // 1 in 500 crates, on top of the normal roll
const GOLD = 0xffa300;

// Picks count from Week 9 of 2026 (the first logged week), plus every playoff round after.
const counts = (r) => Number(r.season) > 2026 || (Number(r.season) === 2026 && (Number(r.week) >= 9 || !/^Week /.test(r.label)));

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
    try { this.sql.exec("ALTER TABLE props ADD COLUMN created_by TEXT"); } catch {}
    try { this.sql.exec("ALTER TABLE entries ADD COLUMN side TEXT DEFAULT 'yes'"); } catch {}   // yes = it hits, no = it misses
    try { this.sql.exec("ALTER TABLE fights ADD COLUMN token TEXT"); } catch {}       // to close the challenge message when it expires
    try { this.sql.exec("ALTER TABLE fights ADD COLUMN msg_id TEXT"); } catch {}   // who posted each bet (older bets: null)
  }

  // ---------- live Herd: everyone sees where everyone drives their ram ----------
  // Sockets use the hibernation API, so an idle field costs nothing. Positions live in the meta table.
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ t: "snap", pos: this.herdPos() }));
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 1000);   // someone's watching: poll fast
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
  broadcast(obj) { const msg = JSON.stringify(obj); for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch {} } }

  // ---------- moments: !flag, !TD and friends show up on the website ----------
  // The bot reads the watched channels (Message Content intent is on). When someone types a tracked
  // trigger and a bot (Carl-bot) answers with a GIF within 20 seconds, that GIF goes to every open site tab.
  // Every 15 seconds while anyone has the site open, otherwise once a minute from the cron.
  async alarm() {
    try { await this.pollMoments(); } catch (e) { console.log("moments", e); }
    if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + 15_000);
  }
  momentConfig() {
    return { channels: JSON.parse(this.meta("momentChannels") || "{}"), triggers: [...new Set(["flag", "td", "touchdown", "refsplan", "int", "fumble", "itsgood", "tutu", ...JSON.parse(this.meta("momentTriggers") || "[]")])].filter((t) => !JSON.parse(this.meta("momentOff") || "[]").includes(t)) };
  }
  toggleMomentChannel(id) {
    const c = this.momentConfig().channels;
    if (c[id] !== undefined) delete c[id]; else c[id] = "";
    this.meta("momentChannels", JSON.stringify(c));
    return c[id] !== undefined;
  }
  toggleTrigger(name) {
    const n = name.toLowerCase().replace(/^!/, "");
    const on = !this.momentConfig().triggers.includes(n);
    const extra = JSON.parse(this.meta("momentTriggers") || "[]"), off = JSON.parse(this.meta("momentOff") || "[]");
    this.meta("momentTriggers", JSON.stringify(on ? [...new Set([...extra, n])] : extra.filter((x) => x !== n)));
    this.meta("momentOff", JSON.stringify(on ? off.filter((x) => x !== n) : [...new Set([...off, n])]));
    return { on, triggers: this.momentConfig().triggers };
  }
  static media(m) {
    for (const e of m.embeds || []) {
      if (e.video?.url) return { url: e.video.url, kind: "video", still: e.thumbnail?.url };
      if (e.image?.url) return { url: e.image.url, kind: "image" };
      if (e.thumbnail?.url && /gif|tenor|giphy/i.test(e.url || e.thumbnail.url)) return { url: e.thumbnail.url, kind: "image" };
    }
    for (const a of m.attachments || []) {
      if (/^video\//.test(a.content_type || "")) return { url: a.url, kind: "video" };
      if (/^image\//.test(a.content_type || "")) return { url: a.url, kind: "image" };
    }
    const link = (m.content || "").match(/https?:\/\/\S+\.(gif|png|jpe?g|webp|mp4)(\?\S*)?/i);
    return link ? { url: link[0], kind: /mp4/i.test(link[1]) ? "video" : "image" } : null;
  }
  async pollMoments() {
    const { channels, triggers } = this.momentConfig();
    const ids = Object.keys(channels);
    if (!ids.length) return 0;
    let found = 0;
    for (const ch of ids) {
      const after = channels[ch];
      const res = await fetch(`https://discord.com/api/v10/channels/${ch}/messages?limit=50${after ? `&after=${after}` : ""}`,
        { headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` } });
      if (!res.ok) { console.log("moments read", ch, res.status); continue; }
      const msgs = (await res.json()).reverse();
      if (!msgs.length) continue;
      channels[ch] = msgs[msgs.length - 1].id;
      if (!after) continue;                         // first look at a channel: just mark the spot
      // a trigger plays the field animation right away; the GIF reply (if any) follows as a popup, even in a later poll
      let pending = JSON.parse(this.meta(`momentPending:${ch}`) || "null");
      for (const m of msgs) {
        const ts = Date.parse(m.timestamp);
        const cmd = !m.author?.bot && (m.content || "").trim().match(/^!(\w+)/)?.[1]?.toLowerCase();
        if (cmd && triggers.includes(cmd)) {
          pending = { cmd, by: m.member?.nick || m.author.global_name || m.author.username, ts };
          // one field show per type every 30 seconds, so spamming !TD doesn't stack shows
          const group = ["flag", "refsplan"].includes(cmd) ? "flag" : cmd === "touchdown" ? "td" : cmd;
          if (Date.now() - ts < 5 * 60_000 && Date.now() - Number(this.meta(`fxLast:${group}`) || 0) > 30_000) {
            this.meta(`fxLast:${group}`, Date.now());
            this.broadcast({ t: "moment", cmd, by: pending.by, at: ts, fx: true });
          }
          continue;
        }
        if (pending && m.author?.bot && ts - pending.ts < 20_000) {
          const media = Game.media(m);
          if (media) {
            const moment = { t: "moment", cmd: pending.cmd, by: pending.by, ...media, at: ts, fx: false };
            const pg = `gifLast:${pending.cmd}`;
            if (Date.now() - Number(this.meta(pg) || 0) < 30_000) { pending = null; continue; }
            this.meta(pg, Date.now());
            const recent = JSON.parse(this.meta("moments") || "[]");
            this.meta("moments", JSON.stringify([moment, ...recent].slice(0, 20)));
            this.broadcast(moment);
            found++; pending = null;
          }
        }
      }
      this.meta(`momentPending:${ch}`, JSON.stringify(pending && Date.now() - pending.ts < 60_000 ? pending : null));
    }
    this.meta("momentChannels", JSON.stringify(channels));
    return found;
  }
  recentMoments() { return JSON.parse(this.meta("moments") || "[]"); }

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
    const weeks = {};
    for (const vals of rows) {
      const r = Object.fromEntries(head.map((h, i) => [h, vals[i]]));
      if (!counts(r)) continue;
      this.user(r.user_id, r.user_name);
      if (this.pay(`vote:${r.event_id}:${r.user_id}`, r.user_id, VOTE_POINTS, `${r.label}: voted ${r.game}`)) n++;
      if (r.correct === "1" && this.pay(`pick:${r.event_id}:${r.user_id}`, r.user_id, PICK_POINTS, `${r.label}: ${r.game}`)) n++;
      const wk = (weeks[`${r.season}|${r.label}`] ||= {});
      wk[r.user_id] = (wk[r.user_id] || 0) + (r.correct === "1" ? 1 : 0);
    }
    await this.weeklyBonus(weeks);
    return n;
  }

  /** +5 the moment someone votes in a live poll (same key as the graded log, so it never pays twice). */
  async syncVotes() {
    const last = Number(this.meta("votesSynced") || 0);
    if (Date.now() - last < 5 * 60_000) return 0;
    this.meta("votesSynced", Date.now());
    let st;
    try { st = await (await fetch(STATE_URL, { cf: { cacheTtl: 120 } })).json(); } catch { return 0; }
    if (!st.channel_id || !st.polls?.length) return 0;
    let n = 0;
    for (const p of st.polls) {
      for (const aid of Object.keys(p.answers || {})) {
        let after = "";
        for (let page = 0; page < 5; page++) {
          const res = await fetch(`https://discord.com/api/v10/channels/${st.channel_id}/polls/${p.message_id}/answers/${aid}?limit=100${after}`,
            { headers: { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` } });
          if (!res.ok) break;
          const users = (await res.json()).users || [];
          for (const u of users) {
            if (u.bot) continue;
            this.user(u.id, u.global_name || u.username);
            if (this.pay(`vote:${p.event_id}:${u.id}`, u.id, VOTE_POINTS, `${st.label}: voted ${p.game}`)) n++;
          }
          if (users.length < 100) break;
          after = `&after=${users[users.length - 1].id}`;
        }
      }
    }
    return n;
  }

  /** Podium bonus for each week that's finished (the pick'em has moved on to a newer week). */
  async weeklyBonus(weeks) {
    let current = null;
    try { current = (await (await fetch(STATE_URL, { cf: { cacheTtl: 120 } })).json()).label; } catch { return; }
    for (const [key, scores] of Object.entries(weeks)) {
      const [season, label] = key.split("|");
      if (label === current || this.meta(`podium:${key}`)) continue;
      const places = [...new Set(Object.values(scores))].sort((a, b) => b - a);   // dense: 14,14,13,12 -> 1st,1st,2nd,3rd
      for (const [uid, c] of Object.entries(scores)) {
        const place = places.indexOf(c) + 1;
        if (place === 1 && this.pay(`podium:${key}:${uid}`, uid, 0, `${label}: most correct (${c}) - bonus crate`)) this.sql.exec("UPDATE users SET crates = crates + 1 WHERE id=?", uid);
        if (place === 2 || place === 3) this.pay(`podium:${key}:${uid}`, uid, PODIUM_RUTS, `${label}: ${place === 2 ? "2nd" : "3rd"} most correct (${c})`);
      }
      this.meta(`podium:${key}`, Date.now());
    }
  }

  // ---------- crates ----------
  roll(uid, u) {
    const owned = this.owned(uid);
    const next = FIRST_CRATE.find((id) => !owned.has(id));   // girl ram first, then the nose ring, for everyone
    if (next) return { id: next, guaranteed: true };
    if (rand(UNCANNY_ODDS) === 0) return { id: "finish_uncanny" };
    // Every 10th crate a player opens is Rare or better (same odds between the rare+ tiers).
    const pity = (u.opened + 1) % 10 === 0;
    const tiers = Object.entries(RARITY).filter(([k]) => POOL[k]?.length && !(pity && k === "common"));
    let r = rand(tiers.reduce((s, [, v]) => s + v.weight, 0));
    for (const [k, v] of tiers) {
      if ((r -= v.weight) < 0) return { id: POOL[k][rand(POOL[k].length)], pity };
    }
  }

  openCrate(uid, name, freeOnly = false) {
    let u = this.user(uid, name);
    let bought = false;
    if (u.crates < 1 && freeOnly) return { error: "You don't have a crate waiting. Win bets, top the weekly pick'em, or buy one with **/crate**." };
    if (u.crates < 1) {
      if (u.points < CRATE_COST) return { error: `A crate costs **${CRATE_COST} RUTS**. You have **${u.points}**. Every pick'em vote pays ${VOTE_POINTS}, and right ones pay ${PICK_POINTS} more.` };
      this.sql.exec("UPDATE users SET points = points - ?, crates = crates + 1 WHERE id=?", CRATE_COST, uid);
      this.sql.exec("INSERT INTO ledger (key,user_id,delta,reason,ts) VALUES (?,?,?,?,?)", `crate:${crypto.randomUUID()}`, uid, -CRATE_COST, "Bought a crate", Date.now());
      bought = true;
      u = this.one("SELECT * FROM users WHERE id=?", uid);
    }
    const { id, guaranteed, pity } = this.roll(uid, u);
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
    return { item: pub(it), dupe, refund, guaranteed, pity, bought, user: this.one("SELECT * FROM users WHERE id=?", uid) };
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

  async createProp({ player, stat, line, minutes, channel_id, token, event, by }) {
    const g = event || await this.ramsGame();
    if (!g) return { error: "Couldn't find the Rams' next game on ESPN." };
    const now = Date.now();
    const closes = minutes ? now + minutes * 60_000 : g.kick > now ? g.kick : now + 10 * 60_000;
    this.sql.exec("INSERT INTO props (event_id, game, player, stat, line, closes, channel_id, token, created, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
      g.id, g.name, player, stat, line, closes, channel_id ?? null, token ?? null, now, by ?? null);
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

  /** Take a side: "yes" = they hit the line, "no" = they don't. 20 RUTS either way; the right side wins a crate. */
  enter(propId, uid, name, side = "yes") {
    const p = this.one("SELECT * FROM props WHERE id=?", propId);
    if (!p) return { error: "That bet is gone." };
    if (p.status !== "open" || Date.now() > p.closes) return { error: "This bet is closed." };
    const mine = this.one("SELECT side FROM entries WHERE prop_id=? AND user_id=?", propId, uid);
    if (mine) return { error: `You're already in on this one (${mine.side === "no" ? "against" : "for"} it).` };
    const u = this.user(uid, name);
    if (u.points < PROP_COST) return { error: `Entry is **${PROP_COST} RUTS**. You have **${u.points}**.` };
    this.sql.exec("INSERT INTO entries (prop_id,user_id,ts,side) VALUES (?,?,?,?)", propId, uid, Date.now(), side);
    this.pay(`prop:${propId}:${uid}`, uid, -PROP_COST, `Bet #${propId} (${side === "no" ? "against" : "for"})`);
    return { prop: p, count: this.count(propId), user: this.one("SELECT * FROM users WHERE id=?", uid) };
  }

  count(propId) {
    const rows = this.all("SELECT COALESCE(side,'yes') AS side, COUNT(*) AS n FROM entries WHERE prop_id=? GROUP BY 1", propId);
    return { yes: rows.find((r) => r.side === "yes")?.n || 0, no: rows.find((r) => r.side === "no")?.n || 0 };
  }

  /** Returns the winners: the "yes" side on a hit, the "no" side on a miss. */
  settle(p, hit, value) {
    this.sql.exec("UPDATE props SET status=?, value=? WHERE id=?", hit ? "hit" : "miss", value, p.id);
    const winners = this.all("SELECT user_id FROM entries WHERE prop_id=? AND COALESCE(side,'yes')=?", p.id, hit ? "yes" : "no").map((r) => r.user_id);
    for (const uid of winners) {
      if (this.pay(`propwin:${p.id}:${uid}`, uid, 0, `Won bet #${p.id} (${hit ? "for" : "against"}): a crate`)) this.sql.exec("UPDATE users SET crates = crates + 1 WHERE id=?", uid);
    }
    return winners;
  }

  /** Anyone can post bets, one per minute each, so the channel doesn't flood. */
  propCooldown(uid) {
    const last = Number(this.meta(`propcd:${uid}`) || 0), wait = 60_000 - (Date.now() - last);
    if (wait > 0) return Math.ceil(wait / 1000);
    this.meta(`propcd:${uid}`, Date.now());
    return 0;
  }
  /** The person who posted a bet can cancel it; mods can cancel any. */
  cancel(propId, uid, isMod) {
    const p = this.one("SELECT * FROM props WHERE id=?", propId);
    if (!p || p.status === "hit" || p.status === "miss") return { error: "Can't cancel that one." };
    if (!isMod && p.created_by !== uid) return { error: "Only whoever posted this bet (or a mod) can cancel it." };
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
    for (const d of done) await this.announce({ ...d.p, status: d.hit ? "hit" : "miss", value: d.v }, d.players, this.count(d.p.id));
    return done.length;
  }

  // Edit the bet's message with the result. Interaction-response messages belong to the app, so the
  // bot can edit them by channel/message id; the webhook token works too for the first 15 minutes.
  async announce(p, players, counts) {
    const msg = propMessage(p, counts || this.count(p.id));
    const tries = [];
    if (p.channel_id && p.message_id) tries.push([`https://discord.com/api/v10/channels/${p.channel_id}/messages/${p.message_id}`, `Bot ${this.env.DISCORD_BOT_TOKEN}`]);
    if (p.token) tries.push([`https://discord.com/api/v10/webhooks/${APP_ID}/${p.token}/messages/@original`, null]);
    for (const [url, auth] of tries) {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(msg) });
      if (res.ok) break;
    }
    if ((p.status === "hit" || p.status === "miss") && players.length && p.channel_id) {
      const what = p.status === "hit" ? `**${shown(p.player)}** hit ${p.line}+ ${STATS[p.stat][2]}!` : `**${shown(p.player)}** fell short with ${p.value} ${STATS[p.stat][2]}. The faders win!`;
      await fetch(`https://discord.com/api/v10/channels/${p.channel_id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` },
        body: JSON.stringify({ content: `🎉 ${what} ${players.map((u) => `<@${u}>`).join(" ")} each won a crate!`,
          components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: "opencrate", label: "Open my crate", emoji: { name: "📦" } }] }],
          allowed_mentions: { users: players.slice(0, 100) } }),
      });
    }
  }

  /** Mod gift or fine. A fine can't take anyone below zero. */
  give(uid, name, amount, reason) {
    const u = this.user(uid, name);
    const delta = Math.max(-u.points, Math.trunc(amount));
    this.pay(`give:${crypto.randomUUID()}`, uid, delta, reason || (delta >= 0 ? "Gift from a mod" : "Fined by a mod"));
    return { delta, points: u.points + delta };
  }
  /** Mod gift to everyone: every ram owner and everyone who has ever made a pick. */
  async giveAll(amount, reason) {
    const res = await fetch(CSV_URL, { cf: { cacheTtl: 60 } });
    if (res.ok) {
      const [head, ...rows] = (await res.text()).trim().split(/\r?\n/).map(splitCSV);
      const iu = head.indexOf("user_id"), inm = head.indexOf("user_name");
      for (const r of rows) if (r[iu]) this.user(r[iu], r[inm]);
    }
    const tag = crypto.randomUUID();
    let n = 0;
    for (const u of this.all("SELECT id, points FROM users")) {
      const delta = Math.max(-u.points, Math.trunc(amount));
      if (delta && this.pay(`giveall:${tag}:${u.id}`, u.id, delta, reason)) n++;
    }
    return n;
  }
  setPropsChannel(ch) { this.meta("propsChannel", ch); }
  async saveMessage(propId, channelId, messageId) {
    this.sql.exec("UPDATE props SET channel_id=?, message_id=? WHERE id=? AND message_id IS NULL", channelId, messageId, propId);
  }

  // ---------- fights ----------
  saveFightToken(id, token) { this.sql.exec("UPDATE fights SET token=? WHERE id=?", token, id); }
  saveFightMessage(id, channelId, msgId) { this.sql.exec("UPDATE fights SET channel_id=?, msg_id=? WHERE id=?", channelId, msgId, id); }
  recentFights() {
    return this.all("SELECT id, a, b, a_name, b_name, stake, status, winner, rounds, created FROM fights ORDER BY id DESC LIMIT 12");
  }
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
    if (!f || f.status !== "pending") return { error: "This fight is over.", fight: f };
    if (uid !== f.b) return { error: "Only the challenged ram can accept." };
    if (Date.now() - f.created > FIGHT_TTL) { this.endFight(f, "expired"); return { error: "This challenge expired. Their RUTS went back.", fight: this.fight(id) }; }
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
    if (!f || f.status !== "pending") return { error: "This fight is over.", fight: f };
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
    if (!this.ctx.getWebSockets().length) { try { await this.pollMoments(); } catch (e) { console.log("moments", e); } }
    await this.grantOnce("launch50", 50, "Welcome gift");
    for (const f of this.all("SELECT * FROM fights WHERE status='pending' AND created < ?", Date.now() - FIGHT_TTL)) {
      this.endFight(f, "expired");
      // Swap the Accept/Decline buttons for "Nobody showed up". The bot edits its own message; if Discord refuses,
      // the buttons still fix the message themselves the next time anyone clicks one.
      const body = JSON.stringify(expiredFight(this.fight(f.id)));
      const r = f.channel_id && f.msg_id ? await fetch(`https://discord.com/api/v10/channels/${f.channel_id}/messages/${f.msg_id}`, { method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` }, body }).catch(() => null) : null;
      if (!r?.ok && f.token) await fetch(`https://discord.com/api/v10/webhooks/${APP_ID}/${f.token}/messages/@original`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body }).catch(() => {});
    }
    await this.syncPicks();
    try { await this.syncVotes(); } catch (e) { console.log("votes", e); }
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
    const history = this.all("SELECT delta, reason, ts FROM ledger WHERE user_id=? ORDER BY ts DESC LIMIT 25", uid);
    const got = this.all("SELECT item_id, ts FROM items WHERE user_id=? ORDER BY ts", uid).map((r) => ({ id: r.item_id, ts: r.ts }));
    return { name: u.name, points: u.points, crates: u.crates, opened: u.opened, look: JSON.parse(u.look), items: this.inventory(uid), history, got };
  }
  /** Open bets, plus anything settled in the last week, with who's in. */
  bets() {
    const rows = this.all("SELECT * FROM props WHERE status='open' OR created > ? ORDER BY (status='open') DESC, closes ASC LIMIT 40", Date.now() - 7 * 86400_000);
    return rows.map((p) => ({ id: p.id, player: shown(p.player), stat: p.stat, label: STATS[p.stat]?.[2] || p.stat, line: p.line, game: p.game,
      closes: p.closes, status: p.status, value: p.value,
      users: this.all("SELECT e.user_id AS id, u.name, COALESCE(e.side,'yes') AS side FROM entries e LEFT JOIN users u ON u.id = e.user_id WHERE e.prop_id=? ORDER BY e.ts", p.id) }));
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

function expiredFight(f) {
  return { content: "", embeds: [{ title: "🐏  Fight called off", color: 0x6b7280, description: `<@${f.a}> vs <@${f.b}>\nNobody showed up. RUTS returned.` }],
    components: [], allowed_mentions: { parse: [] } };
}

export function propMessage(p, count = {}) {
  const stat = STATS[p.stat][2];
  const c = typeof count === "number" ? { yes: count, no: 0 } : { yes: count.yes || 0, no: count.no || 0 };
  p = { ...p, player: shown(p.player) };
  const ts = Math.floor(p.closes / 1000);
  const plural = (n) => `${n} winner${n === 1 ? "" : "s"}`;
  const result = p.status === "hit" ? `\n\n✅ **HIT** - ${p.value} ${stat}. ${plural(c.yes)} on the FOR side got a crate.`
    : p.status === "miss" ? `\n\n❌ **MISSED** - finished with ${p.value} ${stat}. ${plural(c.no)} on the AGAINST side got a crate.`
    : p.status === "cancelled" ? "\n\n🚫 **Cancelled** - entries refunded." : "";
  const open = p.status === "open";
  return {
    embeds: [{
      title: `🎲 Bet #${p.id}: ${p.player} gets ${p.line}+ ${stat}`,
      description: `${p.game}\nPick a side: **${PROP_COST} RUTS**  •  Right side wins **a crate**\n${open ? `Closes <t:${ts}:R>` : ""}${result}`,
      color: p.status === "hit" ? 0x22c55e : p.status === "miss" ? 0xef4444 : GOLD,
      footer: { text: `${c.yes} for  •  ${c.no} against` },
    }],
    components: open ? [{ type: 1, components: [
      { type: 2, style: 3, custom_id: `prop:${p.id}`, label: `It hits (${PROP_COST})`, emoji: { name: "✅" } },
      { type: 2, style: 4, custom_id: `propno:${p.id}`, label: `It misses (${PROP_COST})`, emoji: { name: "❌" } }] }] : [],
    allowed_mentions: { parse: [] },
  };
}

export { shown };
export { SITE, rarityLine, SLOTS, SLOT_NAMES, BODY_TYPES };
