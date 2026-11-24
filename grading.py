"""Read poll votes with the Discord bot account, grade them, and keep a running log.

Webhooks can post polls but can't see who voted. The bot token can, through Discord's
REST API, so nothing has to stay online: GitHub Actions makes the calls.

Logs (committed back to the repo by the workflows):
  data/picks.csv     one row per person per game (weekly pick'em)
  data/contests.csv  one row per person per contest (Super Bowl, seeding, etc.)
"""
import csv
import json
import os
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

import nfl_week as nw

TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
API = "https://discord.com/api/v10"
ROOT = os.path.dirname(os.path.abspath(__file__))
PICKS_CSV = os.path.join(ROOT, "data", "picks.csv")
CONTESTS_CSV = os.path.join(ROOT, "data", "contests.csv")
PICK_FIELDS = ["season", "week", "label", "event_id", "game", "user_id", "user_name",
               "pick", "winner", "correct"]
CONTEST_FIELDS = ["season", "contest_id", "title", "user_id", "user_name", "pick", "answer", "correct"]
GOLD = 0xFFA300
MEDALS = ["\U0001F947", "\U0001F948", "\U0001F949"]


# ---------- Discord (bot token) ----------

def bot_get(path):
    for _ in range(6):
        req = urllib.request.Request(API + path, headers={
            "Authorization": f"Bot {TOKEN}",
            "User-Agent": "DiscordBot (https://github.com/DrunkenCricket/Cricket, 1.0)",
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            raw = e.read()
            if e.code == 429:
                time.sleep(float(json.loads(raw or b"{}").get("retry_after", 2)) + 0.5)
                continue
            raise RuntimeError(f"Discord {e.code} on {path}: {raw.decode(errors='replace')[:200]}")
    raise RuntimeError("Discord rate limit, gave up")


def voters(channel_id, message_id, answer_id):
    out, after = [], None
    while True:
        q = "?limit=100" + (f"&after={after}" if after else "")
        users = bot_get(f"/channels/{channel_id}/polls/{message_id}/answers/{answer_id}{q}").get("users", [])
        out += users
        if len(users) < 100:
            return out
        after = users[-1]["id"]


def user_name(u):
    return u.get("global_name") or u.get("username") or u.get("id")


def answer_map(msg, labels):
    """answer_id -> our label, from the message Discord returned when the poll posted."""
    answers = (msg.get("poll") or {}).get("answers") or []
    if len(answers) == len(labels):
        return {str(a["answer_id"]): lab for a, lab in zip(answers, labels)}
    return {str(i + 1): lab for i, lab in enumerate(labels)}  # Discord numbers answers from 1


# ---------- ESPN ----------

def espn(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=nw.UA), timeout=20) as r:
        return json.load(r)


def final_winner(event_id, kick_iso):
    """Winning team abbreviation, 'TIE', or None if the game isn't final."""
    kick = datetime.fromisoformat(kick_iso)
    for d in (kick.date(), kick.date() + timedelta(days=1)):
        for ev in espn(nw.API.format(d.strftime("%Y%m%d"))).get("events", []):
            if ev["id"] != event_id:
                continue
            comp = ev["competitions"][0]
            if not comp.get("status", {}).get("type", {}).get("completed"):
                return None
            for c in comp["competitors"]:
                if c.get("winner"):
                    return c["team"]["abbreviation"]
            return "TIE"
    return None


# ---------- CSV log ----------

def read_csv(path):
    try:
        with open(path, newline="") as f:
            return list(csv.DictReader(f))
    except OSError:
        return []


def append_csv(path, fields, rows):
    if not rows:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if new:
            w.writeheader()
        w.writerows(rows)


# ---------- weekly pick'em ----------

def grade_week(state):
    """Grade last week's polls. Returns a Discord payload with results, or None."""
    polls, channel = state.get("polls") or [], state.get("channel_id")
    if not polls or not channel:
        return None
    if not TOKEN:
        print("No DISCORD_BOT_TOKEN secret, so last week's picks can't be graded.")
        return None

    done = {r["event_id"] for r in read_csv(PICKS_CSV)}
    rows, games = [], []
    for p in polls:
        if p["event_id"] in done:
            continue
        winner = final_winner(p["event_id"], p["kick"])
        if winner is None:
            print(f"{p['game']}: not final, skipping.")
            continue
        votes = defaultdict(int)
        for aid, team in p["answers"].items():
            for u in voters(channel, p["message_id"], aid):
                votes[team] += 1
                rows.append({"season": state.get("season"), "week": state.get("week"),
                             "label": state.get("label"), "event_id": p["event_id"], "game": p["game"],
                             "user_id": u["id"], "user_name": user_name(u), "pick": team,
                             "winner": winner, "correct": int(team == winner)})
            time.sleep(0.3)
        games.append({"game": p["game"], "winner": winner, "votes": dict(votes), "rams": p.get("rams")})

    append_csv(PICKS_CSV, PICK_FIELDS, rows)
    print(f"Graded {len(games)} games, {len(rows)} picks.")
    if not rows:
        return None
    return results_payload(state, rows, games)


def tally(rows):
    t = defaultdict(lambda: [0, 0])
    for r in rows:
        t[r["user_id"]][0 if str(r["correct"]) == "1" else 1] += 1
    return sorted(t.items(), key=lambda kv: (-kv[1][0], kv[1][1]))


def board(ranked, limit=10, pct=False):
    lines = []
    for i, (uid, (w, l)) in enumerate(ranked[:limit]):
        place = MEDALS[i] if i < 3 else f"`{i + 1:>2}.`"
        extra = f"  ({w / (w + l):.0%})" if pct and w + l else ""
        lines.append(f"{place} <@{uid}>  **{w}-{l}**{extra}")
    return "\n".join(lines) or "No picks yet."


def results_payload(state, rows, games):
    season_rows = [r for r in read_csv(PICKS_CSV) if str(r["season"]) == str(state.get("season"))]
    pickers = len({r["user_id"] for r in rows})

    upsets = []
    for g in games:
        if g["votes"] and g["winner"] != "TIE":
            fav = max(g["votes"], key=g["votes"].get)
            if fav != g["winner"]:
                total = sum(g["votes"].values())
                upsets.append(f"{g['game']}: {g['votes'][fav]}/{total} took **{fav}**, **{g['winner']}** won")

    fields = [
        {"name": "\U0001F3C6  This Week", "value": board(tally(rows))[:1024], "inline": True},
        {"name": "\U0001F4C8  Season", "value": board(tally(season_rows), pct=True)[:1024], "inline": True},
    ]
    rams = next((g for g in games if g.get("rams")), None)
    if rams and rams["votes"]:
        split = "  •  ".join(f"{t} {n}" for t, n in sorted(rams["votes"].items(), key=lambda kv: -kv[1]))
        fields.append({"name": "\U0001F40F  Rams Game", "value": f"{rams['game']}: **{rams['winner']}** won\nPicks: {split}",
                       "inline": False})
    if upsets:
        fields.append({"name": "\U0001F62C  Server Got Burned", "value": "\n".join(upsets)[:1024], "inline": False})

    return {
        "username": "Rams Pick'em",
        "embeds": [{
            "title": f"\U0001F4CA  {state.get('label') or 'Week'} Results",
            "description": f"{pickers} pickers  •  {len(games)} games graded",
            "color": GOLD,
            "fields": fields,
            "image": {"url": "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/assets/spacer.png"},
        }],
    }
