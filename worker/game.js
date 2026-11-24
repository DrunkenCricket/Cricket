// Ram game: points, crates, inventory, looks and prop bets, stored in one Durable Object (SQLite).
//
// Points:  +10 per correct pick'em pick (from data/picks.csv, Week 12 of 2026 onward).
// Crates:  60 points each. Everyone starts with one free crate, and their first crate is always the Girl Ram.
//          Duplicates refund points by rarity.
// Props:   admins post "PLAYER gets N+ STAT". Entry costs 20 points; a hit wins a crate.
//          Results come from ESPN's live box score, so a prop can pay out mid-game the moment it hits.
// Points are earned only. Nothing here can be bought with money.

import { DurableObject } from "cloudflare:workers";
import { ITEMS, RARITY, FIRST_CRATE, SLOTS, SLOT_NAMES, BODY_TYPES } from "./ram.js";

export const PICK_POINTS = 10, CRATE_COST = 60, PROP_COST = 20;
const CSV_URL = "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/data/picks.csv";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const APP_ID = "1574684181361852416";
const SITE = "https://rams-bot.kantouth.workers.dev";
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
};

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const pub = (it) => it && { id: it.id, name: it.name, slot: it.slot, rarity: it.rarity, starter: !!it.starter };
const rarityLine = (it) => `${RARITY[it.rarity]?.label || "Secret"} ${SLOT_NAMES[it.slot] || it.slot}`;

// Crate pool: everything except base looks (the girl base comes from the first crate) and the secret finish.
const POOL = {};
for (const it of Object.values(ITEMS)) {
  if (it.slot === "base" || it.rarity === "secret") continue;
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
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);`);
  }

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
      if (u.points < CRATE_COST) return { error: `A crate costs **${CRATE_COST}** points. You have **${u.points}**. Correct picks pay ${PICK_POINTS} each.` };
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
    const [cat, key] = STATS[stat];
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

  async createProp({ player, stat, line, minutes, channel_id, token }) {
    const g = await this.ramsGame();
    if (!g) return { error: "Couldn't find the Rams' next game on ESPN." };
    const now = Date.now();
    const closes = minutes ? now + minutes * 60_000 : g.kick > now ? g.kick : now + 10 * 60_000;
    this.sql.exec("INSERT INTO props (event_id, game, player, stat, line, closes, channel_id, token, created) VALUES (?,?,?,?,?,?,?,?,?)",
      g.id, g.name, player, stat, line, closes, channel_id, token, now);
    return { prop: this.one("SELECT * FROM props WHERE id = last_insert_rowid()") };
  }

  enter(propId, uid, name) {
    const p = this.one("SELECT * FROM props WHERE id=?", propId);
    if (!p) return { error: "That bet is gone." };
    if (p.status !== "open" || Date.now() > p.closes) return { error: "This bet is closed." };
    if (this.one("SELECT 1 AS x FROM entries WHERE prop_id=? AND user_id=?", propId, uid)) return { error: "You're already in on this one." };
    const u = this.user(uid, name);
    if (u.points < PROP_COST) return { error: `Entry is **${PROP_COST}** points. You have **${u.points}**.` };
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
        body: JSON.stringify({ content: `🎉 **${p.player}** hit ${p.line}+ ${STATS[p.stat][2]}! ${players.map((u) => `<@${u}>`).join(" ")} each won a crate. Open it with **/crate**.`,
          allowed_mentions: { users: players.slice(0, 100) } }),
      });
    }
  }

  async saveMessage(propId, channelId, messageId) {
    this.sql.exec("UPDATE props SET channel_id=?, message_id=? WHERE id=? AND message_id IS NULL", channelId, messageId, propId);
  }

  async tick() {
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
  const ts = Math.floor(p.closes / 1000);
  const result = p.status === "hit" ? `\n\n✅ **HIT** - ${p.value} ${stat}. ${count} winner${count === 1 ? "" : "s"} got a crate.`
    : p.status === "miss" ? `\n\n❌ **MISSED** - finished with ${p.value} ${stat}.`
    : p.status === "cancelled" ? "\n\n🚫 **Cancelled** - entries refunded." : "";
  const open = p.status === "open";
  return {
    embeds: [{
      title: `🎲 Bet #${p.id}: ${p.player} gets ${p.line}+ ${stat}`,
      description: `${p.game}\nEntry: **${PROP_COST} points**  •  Prize: **a crate**\n${open ? `Closes <t:${ts}:R>` : ""}${result}`,
      color: p.status === "hit" ? 0x22c55e : p.status === "miss" ? 0xef4444 : GOLD,
      footer: { text: `${count} in` },
    }],
    components: open ? [{ type: 1, components: [{ type: 2, style: 3, custom_id: `prop:${p.id}`, label: `Take the bet (${PROP_COST} pts)`, emoji: { name: "🎲" } }] }] : [],
    allowed_mentions: { parse: [] },
  };
}

export { SITE, rarityLine, SLOTS, SLOT_NAMES, BODY_TYPES };
