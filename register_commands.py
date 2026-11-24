#!/usr/bin/env python3
"""Register (or update) the bot's slash commands with Discord. Run once after changes:
Actions > Register Discord Commands > Run workflow."""
import json
import os
import sys
import urllib.error
import urllib.request

APP_ID = "1574684181361852416"
TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()

COMMANDS = [
    {"name": "standings", "description": "Season pick'em leaderboard", "type": 1, "contexts": [0]},
    {"name": "mypicks", "description": "Your pick'em record, or someone else's", "type": 1, "contexts": [0],
     "options": [{"type": 6, "name": "user", "description": "Whose record to show", "required": False}]},
]

if not TOKEN:
    sys.exit("Needs the DISCORD_BOT_TOKEN secret.")
req = urllib.request.Request(
    f"https://discord.com/api/v10/applications/{APP_ID}/commands",
    data=json.dumps(COMMANDS).encode(), method="PUT",
    headers={"Authorization": f"Bot {TOKEN}", "Content-Type": "application/json",
             "User-Agent": "DiscordBot (https://github.com/DrunkenCricket/Cricket, 1.0)"})
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        print("Registered:", ", ".join("/" + c["name"] for c in json.load(r)))
except urllib.error.HTTPError as e:
    sys.exit(f"Discord {e.code}: {e.read().decode(errors='replace')}")
