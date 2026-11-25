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
    {"name": "herdcommands", "description": "Every command for the pick'em, RUTS, rams, bets and fights", "type": 1, "contexts": [0]},
    # ram game
    {"name": "ruts", "description": "Your RUTS, crates and the RUTS leaderboard", "type": 1, "contexts": [0],
     "options": [{"type": 6, "name": "user", "description": "Whose RUTS to show", "required": False}]},
    {"name": "bingo", "description": "Your Rams Bingo card: re-roll until kickoff, it marks itself live, any bingo pays 5 crates", "type": 1, "contexts": [0]},
    {"name": "locker", "description": "The Locker Room: unbox crates, shop with RUTS and dress your ram on the website", "type": 1, "contexts": [0]},
    {"name": "moments", "description": "Mods: show !flag / !TD GIFs on the website", "type": 1, "contexts": [0], "default_member_permissions": "32",
     "options": [
         {"type": 1, "name": "here", "description": "Start (or stop) watching this channel for tracked triggers"},
         {"type": 1, "name": "trigger", "description": "Track (or stop tracking) a ! command, like flag or td", "options": [
             {"type": 3, "name": "name", "description": "The command without the !", "required": True, "max_length": 32}]},
         {"type": 1, "name": "list", "description": "What's being watched"}]},
    {"name": "giveruts", "description": "Mods: give RUTS to one person or everyone (negative takes them away)", "type": 1, "contexts": [0],
     "default_member_permissions": str(1 << 40),   # Timeout Members: mods have it; server settings can change who sees this
     "options": [
         {"type": 1, "name": "user", "description": "Give RUTS to one person", "options": [
             {"type": 6, "name": "user", "description": "Who gets them", "required": True},
             {"type": 4, "name": "amount", "description": "How many (negative takes RUTS away)", "required": True, "min_value": -10000, "max_value": 10000},
             {"type": 3, "name": "reason", "description": "Shown in the message and their history", "required": False, "max_length": 100}]},
         {"type": 1, "name": "everyone", "description": "Give RUTS to every player", "options": [
             {"type": 4, "name": "amount", "description": "How many each (negative takes RUTS away)", "required": True, "min_value": -1000, "max_value": 1000},
             {"type": 3, "name": "reason", "description": "Shown in the message and everyone's history", "required": False, "max_length": 100}]}]},
    {"name": "fight", "description": "Challenge someone's ram: 50 RUTS each, winner takes all", "type": 1, "contexts": [0],
     "options": [{"type": 6, "name": "opponent", "description": "Who to fight", "required": True}]},
    {"name": "crate", "description": "Open a crate (your first one is free, then 60 RUTS)", "type": 1, "contexts": [0]},
    {"name": "inventory", "description": "Everything you've unlocked for your ram", "type": 1, "contexts": [0]},
    {"name": "equip", "description": "Put an item on your ram", "type": 1, "contexts": [0],
     "options": [{"type": 3, "name": "item", "description": "Start typing an item name", "required": True, "autocomplete": True}]},
    {"name": "unequip", "description": "Take an item off your ram", "type": 1, "contexts": [0],
     "options": [{"type": 3, "name": "slot", "description": "Which slot", "required": True, "choices": [
         {"name": n, "value": v} for v, n in [("pose", "Pose"), ("bg", "Background"), ("fleece", "Fleece"), ("horns", "Horns"),
         ("shirt", "Shirt"), ("head", "Head"), ("eyes", "Eyes"), ("nose", "Nose"), ("mouth", "Mouth"), ("neck", "Neck"), ("arms", "Arms"), ("hand", "Hand"),
         ("feet", "Feet"), ("gear", "Gear"), ("tattoo", "Tattoo"), ("marks", "Marks"), ("finish", "Finish")]]}]},
    {"name": "body", "description": "Pick your ram's body type", "type": 1, "contexts": [0],
     "options": [{"type": 3, "name": "type", "description": "Body type", "required": True, "choices": [
         {"name": "Thin", "value": "thin"}, {"name": "Medium", "value": "med"}, {"name": "Large", "value": "large"}]}]},
    {"name": "skin", "description": "Pick your ram's skin tone (free, change it any time)", "type": 1, "contexts": [0],
     "options": [{"type": 3, "name": "tone", "description": "Skin tone", "required": True, "choices": [
         {"name": n, "value": v} for v, n in [("light", "Light"), ("tan", "Tan"), ("golden", "Golden"), ("brown", "Brown"), ("dark", "Dark"), ("deep", "Deep"), ("gray", "Gray")]]}]},
    {"name": "ram", "description": "Show a ram", "type": 1, "contexts": [0],
     "options": [{"type": 6, "name": "user", "description": "Whose ram", "required": False}]},
    {"name": "bet", "description": "Post a random prop bet. 20 RUTS to pick hits or misses; the right side wins a crate.", "type": 1, "contexts": [0]},
    {"name": "prop", "description": "Prop bets: post a random one, cancel yours, or check results", "type": 1, "contexts": [0],
     "options": [
         {"type": 1, "name": "random", "description": "Post a totally random bet: any team, any player, any stat"},
         {"type": 1, "name": "cancel", "description": "Cancel a bet you posted (mods: any bet) and refund everyone", "options": [
             {"type": 4, "name": "id", "description": "Bet number", "required": True}]},
         {"type": 1, "name": "check", "description": "Check ESPN now and settle any finished bets"}]},
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
        for c in json.load(r):
            subs = [o["name"] for o in c.get("options", []) if o.get("type") == 1]
            print(f"/{c['name']:<10} who: {'everyone' if not c.get('default_member_permissions') else 'perm ' + c['default_member_permissions']}"
                  f"  v{c.get('version')}" + (f"  subs: {', '.join(subs)}" if subs else ""))
except urllib.error.HTTPError as e:
    sys.exit(f"Discord {e.code}: {e.read().decode(errors='replace')}")
