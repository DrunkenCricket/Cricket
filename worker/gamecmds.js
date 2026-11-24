// Discord side of the ram game: slash commands, buttons and autocomplete. State lives in the Game Durable Object.
import { ITEMS, RARITY, SLOT_NAMES, BODY_TYPES } from "./ram.js";
import { lockerToken, lockerUser } from "./auth.js";
export { lockerToken, lockerUser };
import { CRATE_COST, PICK_POINTS, PROP_COST, FIGHT_STAKE, STATS, propMessage, shown } from "./game.js";

const SITE = "https://rams-bot.ramsherd.workers.dev";
const GOLD = 0xffa300;
export const GAME_COMMANDS = new Set(["points", "crate", "inventory", "equip", "unequip", "body", "ram", "prop", "ruts", "fight", "locker", "lockeroom", "giveruts", "moments"]);

const game = (env) => env.GAME.get(env.GAME.idFromName("main"));
const who = (i) => i.member?.user || i.user;
const nameOf = (u) => u.global_name || u.username;
const opt = (i, n) => (i.data.options || []).find((o) => o.name === n)?.value;
const msg = (data, ephemeral = false) => ({ type: 4, data: { ...data, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } } });
// Discord can't show SVG, so a free image proxy (wsrv.nl) turns the ram into a PNG.
export const png = (svgUrl, w = 512) => `https://wsrv.nl/?url=${encodeURIComponent(svgUrl)}&output=png&w=${w}`;
const err = (text) => msg({ content: text }, true);
const color = (it) => RARITY[it.rarity]?.color ?? 0xff4fd8;
const rarityName = (it) => RARITY[it.rarity]?.label || "SECRET";

export async function gameCommand(i, env, ctx) {
  const g = game(env), me = who(i), uid = me.id, name = nameOf(me);
  switch (i.data.name) {
    case "points": case "ruts": {
      await g.syncPicks();
      const target = opt(i, "user") || uid;
      const w = await g.wallet(target, target === uid ? name : undefined);
      const top = await g.leaders();
      return msg({ embeds: [{
        title: `💰 ${w.user.name || "RUTS"}`,
        description: `<@${target}>  **${w.user.points} RUTS**  •  #${w.rank}\n📦 Crates waiting: **${w.user.crates}**  •  Items: **${w.items}**`,
        color: GOLD,
        fields: [
          { name: "Recent", value: w.recent.map((r) => `\`${r.delta >= 0 ? "+" : ""}${r.delta}\` ${r.reason}`).join("\n") || "Nothing yet. Correct picks pay 10 RUTS.", inline: true },
          { name: "Top 10", value: top.map((u, n) => `\`${n + 1}.\` <@${u.id}> ${u.points}`).join("\n") || "-", inline: true },
        ],
        footer: { text: `+${PICK_POINTS} RUTS per correct pick  •  crate ${CRATE_COST}  •  bets ${PROP_COST}  •  fights ${FIGHT_STAKE}` },
      }] });
    }

    case "crate": return crateReply(await g.openCrate(uid, name), uid);

    case "inventory": {
      const items = await g.inventory(uid);
      if (!items.length) return err("No items yet. Open your free crate with **/crate**.");
      const bySlot = {};
      for (const it of items) (bySlot[it.slot] ||= []).push(it);
      return msg({ embeds: [{
        title: `🎒 Your items (${items.length})`, color: GOLD,
        fields: Object.entries(bySlot).map(([s, list]) => ({ name: SLOT_NAMES[s] || s, value: list.map((it) => `${it.name} *(${rarityName(it)})*`).join("\n").slice(0, 1024), inline: true })),
        footer: { text: "Wear something with /equip" },
      }] }, true);
    }

    case "equip": {
      const r = await g.equip(uid, opt(i, "item"));
      if (r.error) return err(r.error);
      return msg({ content: `Equipped **${r.item.name}**. [See your ram](${SITE}/ram/${uid})` }, true);
    }

    case "unequip": {
      await g.setLook(uid, opt(i, "slot"), null);
      return msg({ content: `Took off your ${SLOT_NAMES[opt(i, "slot")] || "item"}.` }, true);
    }

    case "body": {
      await g.setLook(uid, "body", opt(i, "type"));
      return msg({ content: `Body set to **${BODY_TYPES[opt(i, "type")]}**. [See your ram](${SITE}/ram/${uid})` }, true);
    }

    case "ram": {
      const target = opt(i, "user") || uid;
      const r = await g.look(target);
      if (!r) return err(`<@${target}> doesn't have a ram yet.`);
      const worn = Object.entries(r.look).filter(([, v]) => ITEMS[v]).map(([s, v]) => `**${SLOT_NAMES[s] || s}:** ${ITEMS[v].name}`);
      return msg({
        embeds: [{ title: `🐏 ${r.name}'s ram`, url: `${SITE}/ram/${target}`, color: GOLD, image: { url: png(`${SITE}/ram/${target}/now~${Date.now()}.svg`) },
          description: (worn.join("\n") || "Fresh off the farm.") + `\n\n[See it move](${SITE}/ram/${target})` }],
      });
    }

    case "locker": case "lockeroom": {
      const link = `${SITE}/lockeroom#t=${await lockerToken(env, uid)}`;
      return msg({ content: "🎒 **The Lockeroom**: unbox crates, buy more with RUTS, and dress your ram. This link is just for you and works for 2 hours.",
        components: [{ type: 1, components: [{ type: 2, style: 5, url: link, label: "Enter the Lockeroom", emoji: { name: "🎒" } }] }] }, true);
    }

    case "moments": {
      const sub = i.data.options[0];
      if (sub.name === "here") {
        const on = await g.toggleMomentChannel(i.channel_id || i.channel?.id);
        return err(on ? "Watching this channel. Tracked triggers with a GIF reply will pop up on the website." : "Stopped watching this channel.");
      }
      if (sub.name === "trigger") {
        const r = await g.toggleTrigger(sub.options[0].value);
        return err(`${r.on ? "Now" : "No longer"} tracking that. Tracked: ${r.triggers.map((t) => "!" + t).join(", ")}`);
      }
      const c = await g.momentConfig();
      return err(`Channels: ${Object.keys(c.channels).map((id) => `<#${id}>`).join(", ") || "none yet (run /moments here)"}\nTriggers: ${c.triggers.map((t) => "!" + t).join(", ")}`);
    }

    case "giveruts": {
      // Discord hides this command from non-mods; double-check here too (Administrator, Manage Server or Timeout Members).
      const perms = BigInt(i.member?.permissions || 0);
      if (!(perms & 8n) && !(perms & 32n) && !(perms & (1n << 40n))) return err("Only mods can give RUTS.");
      const sub = i.data.options[0], o = Object.fromEntries((sub.options || []).map((x) => [x.name, x.value]));
      const reason = o.reason, note = reason ? `${reason} (from ${name})` : `From ${name}`;
      if (sub.name === "everyone") {
        const n = await g.giveAll(o.amount, note);
        const verb = o.amount >= 0 ? `gave **everyone ${o.amount} RUTS**` : `took **${-o.amount} RUTS** from everyone`;
        return { type: 4, data: { content: `🎁 <@${uid}> ${verb}${reason ? `: ${reason}` : ""}. ${n} rams got it.`, allowed_mentions: { parse: [] } } };
      }
      const to = o.user, u = i.data.resolved?.users?.[to];
      if (u?.bot) return err("Bots don't have rams.");
      const r = await g.give(to, u ? nameOf(u) : undefined, o.amount, note);
      const verb = r.delta >= 0 ? `gave <@${to}> **${r.delta} RUTS**` : `took **${-r.delta} RUTS** from <@${to}>`;
      return { type: 4, data: { content: `🎁 <@${uid}> ${verb}${reason ? `: ${reason}` : ""}. They have **${r.points}** now.`, allowed_mentions: { users: [to] } } };
    }

    case "fight": {
      const opp = opt(i, "opponent");
      const u = i.data.resolved?.users?.[opp];
      if (u?.bot) return err("Bots don't have rams.");
      const r = await g.challenge(uid, name, opp, u ? nameOf(u) : "Ram", i.channel_id || i.channel?.id);
      if (r.error) return err(r.error);
      await g.saveFightToken(r.fight.id, i.token);
      ctx.waitUntil((async () => {   // remember the message so it can be closed out later
        await new Promise((res) => setTimeout(res, 1500));
        const m = await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`);
        if (m.ok) { const j = await m.json(); await g.saveFightMessage(r.fight.id, j.channel_id, j.id); }
      })());
      return { type: 4, data: fightMessage(r.fight) };
    }

    case "prop": {
      const sub = i.data.options[0];
      const o = Object.fromEntries((sub.options || []).map((x) => [x.name, x.value]));
      const perms = BigInt(i.member?.permissions || 0), isMod = !!((perms & 8n) || (perms & 32n) || (perms & (1n << 40n)));
      if (sub.name === "random") {
        const wait = await g.propCooldown(uid);
        if (wait) return err(`Slow down: you can post another bet in ${wait}s.`);
      }
      if (sub.name === "random") {
        const ch = i.channel_id || i.channel?.id;
        const r = await g.randomProp({ channel_id: ch, token: i.token, by: uid });
        if (r.error) return err(r.error);
        const props = r.props || [r.prop];
        // first bet is the reply; the rest go out as follow-ups (no extra bot permissions needed)
        ctx.waitUntil((async () => {
          await new Promise((s) => setTimeout(s, 1200));
          const first = await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`);
          if (first.ok) { const m = await first.json(); await g.saveMessage(props[0].id, m.channel_id, m.id); }
          for (const p of props.slice(1)) {
            const res = await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}?wait=true`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(propMessage(p, 0)) });
            if (res.ok) { const m = await res.json(); await g.saveMessage(p.id, m.channel_id, m.id); }
          }
        })());
        return { type: 4, data: propMessage(props[0], 0) };
      }
      if (sub.name === "cancel") {
        const r = await g.cancel(o.id, uid, isMod);
        if (r.error) return err(r.error);
        ctx.waitUntil(g.announce(r.prop, r.players));
        return err(`Bet #${o.id} cancelled. ${r.players.length} entr${r.players.length === 1 ? "y" : "ies"} refunded.`);
      }
      if (sub.name === "check") {
        const n = await g.resolveProps();
        return err(n ? `Settled ${n} bet${n === 1 ? "" : "s"}.` : "Nothing to settle yet.");
      }
    }
  }
  return err("Unknown command.");
}

function crateReply(r, uid) {
  if (r.error) return err(r.error);
  const it = r.item;
  const lines = [
    r.guaranteed ? "Your first crate always has a new look in it:" : r.bought ? `Bought for ${CRATE_COST} RUTS.` : "",
    `# ${it.name}`,
    `**${rarityName(it)}** ${SLOT_NAMES[it.slot] || it.slot}`,
    r.dupe ? `Already had it, so you got **+${r.refund} RUTS** back.` : "",
    `\n💰 ${r.user.points} RUTS  •  📦 ${r.user.crates} crate${r.user.crates === 1 ? "" : "s"} left`,
  ].filter(Boolean);
  const buttons = [];
  if (!r.dupe) buttons.push({ type: 2, style: 1, custom_id: `equip:${it.id}`, label: "Equip it" });
  buttons.push({ type: 2, style: 2, custom_id: "crate", label: r.user.crates > 0 ? "Open another" : `Buy another (${CRATE_COST})`, emoji: { name: "📦" } });
  buttons.push({ type: 2, style: 5, url: `${SITE}/ram/${uid}`, label: "See my ram" });
  return msg({
    embeds: [{ title: "📦 Crate opened", description: lines.join("\n"), color: color(it), image: { url: png(`${SITE}/ram/${uid}/${it.id}~${Date.now()}.svg`) } }],
    components: [{ type: 1, components: buttons }],
  }, true);
}

export function fightMessage(f) {
  const pot = f.stake * 2;
  const vs = `<@${f.a}> vs <@${f.b}>`;
  if (f.status === "pending") return {
    content: `<@${f.b}>`,
    embeds: [{ title: "🐏💥🐏  Ram fight!", color: GOLD,
      description: `<@${f.a}> challenges <@${f.b}> to butt heads.\n**${f.stake} RUTS** each, winner takes **${pot}**.\nChallenge expires <t:${Math.floor((f.created + 12 * 3600_000) / 1000)}:R>.` }],
    components: [{ type: 1, components: [
      { type: 2, style: 3, custom_id: `fight:yes:${f.id}`, label: `Accept (${f.stake} RUTS)`, emoji: { name: "🐏" } },
      { type: 2, style: 4, custom_id: `fight:no:${f.id}`, label: "Decline" }] }],
    allowed_mentions: { users: [f.b] },
  };
  if (f.status === "done") return {
    content: "",
    embeds: [{ title: `🐏💥🐏  Fight #${f.id}`, color: GOLD, url: `${SITE}/fight/${f.id}`,
      description: `${vs}\n\n**[Watch the fight](${SITE}/fight/${f.id})**\n\nWinner: ||<@${f.winner}> takes ${pot} RUTS||` }],
    components: [{ type: 1, components: [{ type: 2, style: 5, url: `${SITE}/fight/${f.id}`, label: "Watch it", emoji: { name: "🥊" } }] }],
    allowed_mentions: { parse: [] },
  };
  return { content: "", embeds: [{ title: "🐏  Fight called off", color: 0x6b7280,
    description: `${vs}\n${f.status === "declined" ? "Declined" : f.status === "expired" ? "Nobody showed up" : "Cancelled"}. RUTS returned.` }], components: [], allowed_mentions: { parse: [] } };
}

export async function gameButton(i, env, ctx) {
  const g = game(env), me = who(i), uid = me.id, id = i.data.custom_id;
  if (id.startsWith("fight:")) {
    const [, act, fid] = id.split(":");
    const r = act === "yes" ? await g.accept(Number(fid), uid, nameOf(me)) : await g.decline(Number(fid), uid);
    if (r.error && r.fight && r.fight.status !== "pending") return { type: 7, data: fightMessage(r.fight) };   // stale buttons: show how it ended
    if (r.error) return err(r.error);
    return { type: 7, data: fightMessage(r.fight) };   // update the challenge message in place
  }
  if (id === "crate") return crateReply(await g.openCrate(uid, nameOf(me)), uid);
  if (id.startsWith("equip:")) {
    const r = await g.equip(uid, id.slice(6));
    return r.error ? err(r.error) : msg({ content: `Equipped **${r.item.name}**. [See your ram](${SITE}/ram/${uid})` }, true);
  }
  if (id.startsWith("prop:")) {
    const propId = Number(id.slice(5));
    const r = await g.enter(propId, uid, nameOf(me));
    if (r.error) return err(r.error);
    ctx.waitUntil((async () => {
      await g.saveMessage(propId, i.channel_id, i.message.id);
      const body = JSON.stringify(propMessage(r.prop, r.count));
      const res = await fetch(`https://discord.com/api/v10/channels/${i.channel_id}/messages/${i.message.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, body });
      if (!res.ok) await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body });
    })());
    return err(`You're in on bet #${propId} (-${PROP_COST}). If **${shown(r.prop.player)}** gets ${r.prop.line}+ ${STATS[r.prop.stat][2]}, you win a crate. RUTS left: **${r.user.points}**.`);
  }
  return err("That button expired.");
}

export async function gameAutocomplete(i, env) {
  const g = game(env), uid = who(i).id;
  const focus = (i.data.options || []).find((o) => o.focused)?.value?.toLowerCase() || "";
  const mine = await g.inventory(uid);
  const starters = Object.values(ITEMS).filter((it) => it.starter);
  const choices = [...starters, ...mine].filter((it) => it.name.toLowerCase().includes(focus)).slice(0, 25)
    .map((it) => ({ name: `${it.name} (${SLOT_NAMES[it.slot] || it.slot}, ${rarityName(it)})`.slice(0, 100), value: it.id }));
  return { type: 8, data: { choices } };
}
