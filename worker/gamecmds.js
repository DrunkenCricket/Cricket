// Discord side of the ram game: slash commands, buttons and autocomplete. State lives in the Game Durable Object.
import { ITEMS, RARITY, SLOT_NAMES, BODY_TYPES } from "./ram.js";
import { CRATE_COST, PICK_POINTS, PROP_COST, STATS, propMessage } from "./game.js";

const SITE = "https://rams-bot.kantouth.workers.dev";
const GOLD = 0xffa300;
export const GAME_COMMANDS = new Set(["points", "crate", "inventory", "equip", "unequip", "body", "ram", "prop"]);

const game = (env) => env.GAME.get(env.GAME.idFromName("main"));
const who = (i) => i.member?.user || i.user;
const nameOf = (u) => u.global_name || u.username;
const opt = (i, n) => (i.data.options || []).find((o) => o.name === n)?.value;
const msg = (data, ephemeral = false) => ({ type: 4, data: { ...data, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } } });
const err = (text) => msg({ content: text }, true);
const color = (it) => RARITY[it.rarity]?.color ?? 0xff4fd8;
const rarityName = (it) => RARITY[it.rarity]?.label || "SECRET";

export async function gameCommand(i, env, ctx) {
  const g = game(env), me = who(i), uid = me.id, name = nameOf(me);
  switch (i.data.name) {
    case "points": {
      await g.syncPicks();
      const target = opt(i, "user") || uid;
      const w = await g.wallet(target, target === uid ? name : undefined);
      const top = await g.leaders();
      return msg({ embeds: [{
        title: `💰 ${w.user.name || "Points"}`,
        description: `<@${target}>  **${w.user.points} points**  •  #${w.rank}\n📦 Crates waiting: **${w.user.crates}**  •  Items: **${w.items}**`,
        color: GOLD,
        fields: [
          { name: "Recent", value: w.recent.map((r) => `\`${r.delta >= 0 ? "+" : ""}${r.delta}\` ${r.reason}`).join("\n") || "Nothing yet. Correct picks pay 10.", inline: true },
          { name: "Top 10", value: top.map((u, n) => `\`${n + 1}.\` <@${u.id}> ${u.points}`).join("\n") || "-", inline: true },
        ],
        footer: { text: `+${PICK_POINTS} per correct pick  •  crate ${CRATE_COST}  •  bets ${PROP_COST}` },
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
        embeds: [{ title: `🐏 ${r.name}'s ram`, url: `${SITE}/ram/${target}`, color: GOLD,
          description: (worn.join("\n") || "Fresh off the farm.") + `\n\n[See it move](${SITE}/ram/${target})` }],
      });
    }

    case "prop": {
      const sub = i.data.options[0];
      const o = Object.fromEntries((sub.options || []).map((x) => [x.name, x.value]));
      if (sub.name === "create") {
        const r = await g.createProp({ player: o.player, stat: o.stat, line: o.amount, minutes: o.minutes, channel_id: i.channel_id || i.channel?.id, token: i.token });
        if (r.error) return err(r.error);
        // grab the posted message's id so results can be edited in later
        ctx.waitUntil((async () => {
          await new Promise((s) => setTimeout(s, 1500));
          const res = await fetch(`https://discord.com/api/v10/webhooks/${i.application_id}/${i.token}/messages/@original`);
          if (res.ok) { const m = await res.json(); await g.saveMessage(r.prop.id, m.channel_id, m.id); }
        })());
        return { type: 4, data: propMessage(r.prop, 0) };
      }
      if (sub.name === "cancel") {
        const r = await g.cancel(o.id);
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
    r.guaranteed ? "Your first crate always has a new look in it:" : r.bought ? `Bought for ${CRATE_COST} points.` : "",
    `# ${it.name}`,
    `**${rarityName(it)}** ${SLOT_NAMES[it.slot] || it.slot}`,
    r.dupe ? `Already had it, so you got **+${r.refund} points** back.` : "",
    `\n💰 ${r.user.points} points  •  📦 ${r.user.crates} crate${r.user.crates === 1 ? "" : "s"} left`,
  ].filter(Boolean);
  const buttons = [];
  if (!r.dupe) buttons.push({ type: 2, style: 1, custom_id: `equip:${it.id}`, label: "Equip it" });
  buttons.push({ type: 2, style: 2, custom_id: "crate", label: r.user.crates > 0 ? "Open another" : `Buy another (${CRATE_COST})`, emoji: { name: "📦" } });
  buttons.push({ type: 2, style: 5, url: `${SITE}/ram/${uid}`, label: "See my ram" });
  return msg({
    embeds: [{ title: "📦 Crate opened", description: lines.join("\n"), color: color(it) }],
    components: [{ type: 1, components: buttons }],
  }, true);
}

export async function gameButton(i, env, ctx) {
  const g = game(env), me = who(i), uid = me.id, id = i.data.custom_id;
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
    return err(`You're in on bet #${propId} (-${PROP_COST}). If **${r.prop.player}** gets ${r.prop.line}+ ${STATS[r.prop.stat][2]}, you win a crate. Points left: **${r.user.points}**.`);
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
