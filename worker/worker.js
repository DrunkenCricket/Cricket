// Rams bot on a Cloudflare Worker: slash commands, the website (site.js), and the
// minute timer that starts GitHub jobs on time (timer.js).
//   /standings          season pick'em leaderboard
//   /mypicks [user]     your record (or someone else's): rank, weekly results, last week's picks
//
// Discord sends each command here; the Worker reads data/picks.csv from GitHub and replies.
// The public key below isn't secret: Discord publishes it so apps can verify requests.

const PUBLIC_KEY = "56a77673f25f8967998c9a36d26711193da0a6f3bf27fde7359c53d0bd234367";
const CSV_URL = "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/data/picks.csv";
const SHEET = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRJTclMQ4N5VbwYx0yNH-_wVEpyX0h5XAokNwwcSJr8AABTSxNiSjEv6jMmFv2c_SNCN34NACTSqOx5/pubhtml";
const GOLD = 0xffa300;
const MEDALS = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];

import { handleSite } from "./site.js";
import { runTimer } from "./timer.js";
import { GAME_COMMANDS, gameCommand, gameButton, gameAutocomplete } from "./gamecmds.js";
export { Game } from "./game.js";

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === "/ws/herd") return env.GAME.get(env.GAME.idFromName("main")).fetch(request);
    if (request.method === "GET" || /^\/api\/(locker|bingo)/.test(new URL(request.url).pathname)) return handleSite(request, env, ctx);
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const body = await request.text();
    if (!(await verify(request, body))) return new Response("Bad signature", { status: 401 });

    const interaction = JSON.parse(body);
    if (interaction.type === 1) return json({ type: 1 }); // Discord's ping when you save the URL

    try {
      if (interaction.type === 2 && GAME_COMMANDS.has(interaction.data.name)) return json(await gameCommand(interaction, env, ctx));
      if (interaction.type === 3) return json(await gameButton(interaction, env, ctx));
      if (interaction.type === 4) return json(await gameAutocomplete(interaction, env));
    } catch (err) {
      console.log("game error", err.stack || err);
      return reply({ content: "Something went wrong. Try again in a minute." }, true);
    }

    if (interaction.type === 2) {
      const name = interaction.data.name;
      try {
        if (name === "standings") return reply(await standings());
        if (name === "mypicks") return reply(await myPicks(interaction), true);
      } catch (err) {
        return reply({ content: "Couldn't load the picks log right now. Try again in a minute." }, true);
      }
      return reply({ content: "Unknown command." }, true);
    }
    return new Response("Unhandled", { status: 400 });
  },

  // Cloudflare runs this every minute (see wrangler.toml) for exact-time posts.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTimer(new Date(event.scheduledTime), env));
  },
};

// ---------- Discord plumbing ----------

function hex(h) {
  return new Uint8Array(h.match(/.{2}/g).map((b) => parseInt(b, 16)));
}

async function verify(request, body) {
  const sig = request.headers.get("X-Signature-Ed25519");
  const ts = request.headers.get("X-Signature-Timestamp");
  if (!sig || !ts) return false;
  const key = await crypto.subtle.importKey("raw", hex(PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, hex(sig), new TextEncoder().encode(ts + body));
}

function json(obj) {
  return new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });
}

function reply(data, ephemeral = false) {
  // allowed_mentions: none, so leaderboards show names without pinging anyone
  return json({ type: 4, data: { ...data, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } } });
}

// ---------- data ----------

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); if (row.length > 1) rows.push(row); }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function seasonPicks() {
  const res = await fetch(CSV_URL, { cf: { cacheTtl: 120 } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const all = parseCSV(await res.text());
  const season = Math.max(...all.map((r) => Number(r.season)));
  return { season, rows: all.filter((r) => Number(r.season) === season) };
}

function tally(rows) {
  const t = new Map();
  for (const r of rows) {
    const rec = t.get(r.user_id) || { uid: r.user_id, name: r.user_name, w: 0, l: 0 };
    r.correct === "1" ? rec.w++ : rec.l++;
    t.set(r.user_id, rec);
  }
  return [...t.values()].sort((a, b) => b.w - a.w || a.l - b.l);
}

const pct = (w, l) => (w + l ? Math.round((100 * w) / (w + l)) + "%" : "-");
const place = (i) => MEDALS[i] || `\`${String(i + 1).padStart(2)}.\``;
const weekOrder = (a, b) => (parseInt(a.replace(/\D/g, "")) || 99) - (parseInt(b.replace(/\D/g, "")) || 99);

// ---------- commands ----------

async function standings() {
  const { season, rows } = await seasonPicks();
  const ranked = tally(rows);
  const weeks = [...new Set(rows.map((r) => r.label))].sort(weekOrder);
  const lines = ranked.slice(0, 25).map((p, i) => `${place(i)} <@${p.uid}>  **${p.w}-${p.l}**  (${pct(p.w, p.l)})`);
  return {
    embeds: [{
      title: `\u{1F4C8}  ${season} Season Standings`,
      description: (lines.join("\n") || "No picks graded yet.") + `\n\n[Week-by-week sheet](${SHEET})`,
      color: GOLD,
      footer: { text: `Graded: ${weeks.join(", ") || "nothing yet"}` },
    }],
  };
}

async function myPicks(interaction) {
  const opt = (interaction.data.options || []).find((o) => o.name === "user");
  const me = interaction.member?.user || interaction.user;
  const uid = opt ? opt.value : me.id;

  const { season, rows } = await seasonPicks();
  const ranked = tally(rows);
  const rank = ranked.findIndex((p) => p.uid === uid);
  const mine = rows.filter((r) => r.user_id === uid);
  if (!mine.length) {
    return { content: `<@${uid}> doesn't have any graded picks yet this season.` };
  }
  const rec = ranked[rank];

  const byWeek = new Map();
  for (const r of mine) {
    const wk = byWeek.get(r.label) || { w: 0, l: 0 };
    r.correct === "1" ? wk.w++ : wk.l++;
    byWeek.set(r.label, wk);
  }
  const weeks = [...byWeek.keys()].sort(weekOrder);
  const last = weeks[weeks.length - 1];
  const rec2 = (wk) => `${wk}: **${byWeek.get(wk).w}-${byWeek.get(wk).l}**`;
  const best = weeks.reduce((a, b) => (byWeek.get(b).w > byWeek.get(a).w ? b : a));
  // Keeps this column short all season: last week, plus best week once there's more than one.
  const weekLines = [rec2(last)];
  if (weeks.length > 1) weekLines.push("", "**Best week**", rec2(best));
  const lastPicks = mine.filter((r) => r.label === last)
    .map((r) => `${r.correct === "1" ? "✅" : "❌"} ${r.game}: took **${r.pick}**`);

  return {
    embeds: [{
      title: `\u{1F3C8}  ${rec.name}'s Pick'em`,
      description: `<@${uid}>  **${rec.w}-${rec.l}**  (${pct(rec.w, rec.l)})  •  #${rank + 1} of ${ranked.length}`,
      color: GOLD,
      fields: [
        { name: "Last Week", value: weekLines.join("\n").slice(0, 1024), inline: true },
        { name: `${last} Picks`, value: lastPicks.join("\n").slice(0, 1024), inline: true },
      ],
      footer: { text: `${season} season` },
    }],
  };
}
