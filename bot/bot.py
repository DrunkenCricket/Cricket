#!/usr/bin/env python3
"""Always-on Rams bot: chat triggers (Carl-bot style auto-responses).

Triggers live in triggers.json at the repo root. The bot re-reads them from GitHub
every 5 minutes, so editing that file on GitHub is all it takes to change them.

Runs on the Raspberry Pi under systemd (see bot/install.sh). Slash commands are
handled separately by the Cloudflare Worker.
"""
import asyncio
import json
import logging
import os
import re
import time
from datetime import timedelta
from pathlib import Path

import aiohttp
import discord

TOKEN = os.environ["DISCORD_BOT_TOKEN"].strip()
TRIGGERS_URL = "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/triggers.json"
LOCAL_TRIGGERS = Path(__file__).resolve().parent.parent / "triggers.json"
RELOAD_SECONDS = 300

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rams-bot")


def words(text):
    """Lowercase, punctuation turned into single spaces: 'Whose HOUSE?!' -> 'whose house'."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def squashed(text):
    """Letters and numbers only, so 'w.i.t.h.e.r spoon' still matches 'witherspoon'."""
    return re.sub(r"[^a-z0-9]+", "", text.lower())


class Trigger:
    def __init__(self, raw):
        self.name = raw.get("name") or raw["match"][0]
        self.match = [m for m in raw["match"] if m.strip()]
        self.strict = bool(raw.get("strict"))          # match even with spaces/punctuation stuffed in
        self.reply = raw.get("reply")
        self.react = raw.get("react")
        self.delete = bool(raw.get("delete"))
        self.timeout = int(raw.get("timeout_seconds") or 0)
        self.cooldown = int(raw.get("cooldown_seconds", 0 if self.delete else 30))
        self.channels = set(str(c) for c in raw.get("channels", []))  # empty = everywhere
        self.last = {}  # channel id -> last time it fired

    def hits(self, text):
        if self.strict:
            s = squashed(text)
            return any(squashed(m) in s for m in self.match)
        w = f" {words(text)} "
        return any(f" {words(m)} " in w for m in self.match)

    def ready(self, channel_id):
        return time.monotonic() - self.last.get(channel_id, -1e9) >= self.cooldown


def parse(data):
    out = []
    for raw in data:
        try:
            out.append(Trigger(raw))
        except (KeyError, IndexError, TypeError, ValueError) as e:
            log.warning("Skipping bad trigger %r: %s", raw, e)
    return out


intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents, allowed_mentions=discord.AllowedMentions(everyone=False, roles=False))
triggers = parse(json.loads(LOCAL_TRIGGERS.read_text())) if LOCAL_TRIGGERS.exists() else []


async def reload_loop():
    global triggers
    async with aiohttp.ClientSession() as http:
        while True:
            try:
                async with http.get(TRIGGERS_URL, params={"t": int(time.time())}, timeout=20) as r:
                    if r.status == 200:
                        new = parse(json.loads(await r.text()))
                        if [t.name for t in new] != [t.name for t in triggers]:
                            log.info("Loaded %d triggers: %s", len(new), ", ".join(t.name for t in new))
                        # keep cooldown timers across reloads
                        old = {t.name: t.last for t in triggers}
                        for t in new:
                            t.last = old.get(t.name, {})
                        triggers = new
            except Exception as e:  # network blip or bad JSON: keep the last good set
                log.warning("Trigger reload failed: %s", e)
            await asyncio.sleep(RELOAD_SECONDS)


@client.event
async def on_ready():
    log.info("Logged in as %s with %d triggers", client.user, len(triggers))
    if not getattr(client, "_reloader", None):
        client._reloader = asyncio.create_task(reload_loop())


@client.event
async def on_message(msg: discord.Message):
    if msg.author.bot or not msg.guild or not msg.content:
        return
    for t in triggers:
        if t.channels and str(msg.channel.id) not in t.channels:
            continue
        if not t.hits(msg.content) or not t.ready(msg.channel.id):
            continue
        t.last[msg.channel.id] = time.monotonic()
        log.info("Trigger %s fired for %s in #%s", t.name, msg.author, msg.channel)
        await act(t, msg)
        if t.delete:
            break  # message is gone; don't run other triggers on it


async def act(t, msg):
    try:
        if t.react and not t.delete:
            await msg.add_reaction(t.react)
        if t.delete:
            await msg.delete()
        if t.timeout and isinstance(msg.author, discord.Member):
            await msg.author.timeout(timedelta(seconds=t.timeout), reason=f"Trigger: {t.name}")
        if t.reply:
            text = t.reply.replace("{user}", msg.author.mention)
            if t.delete:
                await msg.channel.send(text)
            else:
                await msg.reply(text, mention_author=False)
    except discord.Forbidden:
        # Usually: the member's role is above the bot's, or a permission is missing.
        log.warning("Missing permission for trigger %s on %s", t.name, msg.author)
        if t.reply and t.delete:
            await msg.channel.send(t.reply.replace("{user}", msg.author.mention))
    except discord.HTTPException as e:
        log.warning("Trigger %s failed: %s", t.name, e)


client.run(TOKEN, log_handler=None)
