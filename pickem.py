#!/usr/bin/env python3
"""Post a Discord poll for every NFL game this week (Tue-Mon). Rams game first.
Each poll closes at (or just before) kickoff.

Every Tuesday at 6 AM PT it fetches the new week, and only if games come back does it
delete last week's polls and post the new ones. Failed runs retry hourly until 11 AM PT.
Message ids are kept in state/pickem.json (committed back by the workflow).

Before clearing last week's polls, it grades them (needs the DISCORD_BOT_TOKEN secret),
logs every pick to data/picks.csv, and posts a results + leaderboard card.

  DISCORD_PICKEM_WEBHOOK=https://discord.com/api/webhooks/... python pickem.py
  python pickem.py      # no webhook = dry run
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

import grading
import weather
import nfl_week as nw

WEBHOOK = os.environ.get("DISCORD_PICKEM_WEBHOOK", "").strip()
SCHEDULED = os.environ.get("SCHEDULED", "").lower() == "true"
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state", "pickem.json")
RAMS = "LAR"
RAMS_BLUE = 0x003594


def discord(method, suffix="", payload=None, query=""):
    base, _, q = WEBHOOK.partition("?")
    qs = "&".join(x for x in (q, query) if x)
    url = base + suffix + ("?" + qs if qs else "")
    body = json.dumps(payload).encode() if payload is not None else None
    for _ in range(6):
        req = urllib.request.Request(url, data=body, method=method,
                                     headers={**nw.UA, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read()
            if e.code == 429:
                time.sleep(float(json.loads(raw or b"{}").get("retry_after", 2)) + 0.5)
                continue
            raise
    sys.exit("Discord rate limit, gave up")


def post(payload):
    try:
        return discord("POST", payload=payload, query="wait=true")
    except urllib.error.HTTPError as e:
        sys.exit(f"Discord {e.code}: {e.read().decode(errors='replace')}")


# ---------- posting as the bot (needed for the team-logo emojis) ----------

APP_ID = "1574684181361852416"
API = "https://discord.com/api/v10"
_bot = {"ok": None, "channel": None, "emojis": None}


class BotError(Exception):
    def __init__(self, code, text):
        super().__init__(f"Discord {code}: {text}")
        self.code = code


def bot_call(method, path, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    for _ in range(6):
        req = urllib.request.Request(API + path, data=body, method=method, headers={
            "Authorization": f"Bot {grading.TOKEN}", "Content-Type": "application/json",
            "User-Agent": "DiscordBot (https://github.com/DrunkenCricket/Cricket, 1.0)"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raw = e.read()
            if e.code == 429:
                time.sleep(float(json.loads(raw or b"{}").get("retry_after", 2)) + 0.5)
                continue
            raise BotError(e.code, raw.decode(errors="replace")[:200])
    raise BotError(429, "rate limited")


def pickem_channel():
    if not _bot["channel"]:
        _bot["channel"] = discord("GET").get("channel_id")  # the webhook knows its channel
    return _bot["channel"]


def team_emojis():
    """Team code -> app emoji id (uploaded to the bot's Emojis tab as LAR, SEA, ...)."""
    if _bot["emojis"] is None:
        _bot["emojis"] = {}
        if grading.TOKEN:
            try:
                items = bot_call("GET", f"/applications/{APP_ID}/emojis").get("items", [])
                _bot["emojis"] = {e["name"].upper(): e["id"] for e in items}
            except BotError as e:
                print(f"Couldn't load team emojis ({e}); posting without logos.")
    return _bot["emojis"]


def post_as_bot(payload):
    """Post through the bot so polls can use its logo emojis. Falls back to the webhook
    (without logos) if the bot can't post in the channel. Returns (message, 'bot'|'webhook')."""
    if grading.TOKEN and _bot["ok"] is not False:
        body = {k: v for k, v in payload.items() if k != "username"}
        try:
            msg = bot_call("POST", f"/channels/{pickem_channel()}/messages", body)
            _bot["ok"] = True
            return msg, "bot"
        except BotError as e:
            print(f"Bot couldn't post ({e}). Falling back to the webhook without logos.")
            _bot["ok"] = False
    if payload.get("poll"):
        for a in payload["poll"]["answers"]:
            emoji = a["poll_media"].get("emoji") or {}
            if emoji.get("id"):  # webhooks can't use the bot's own emojis
                a["poll_media"].pop("emoji")
    return post(payload), "webhook"


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f:
        json.dump(state, f, indent=2)
        f.write("\n")


def delete_previous():
    state = load_state()
    ids = state.get("message_ids", [])
    bot_ids = state.get("bot_message_ids", [])
    gone = 0
    for mid in ids:
        try:
            discord("DELETE", f"/messages/{mid}")
            gone += 1
        except urllib.error.HTTPError as e:
            if e.code != 404:  # 404 = already deleted by hand
                print(f"Could not delete {mid} ({e.code}).")
        time.sleep(0.6)
    for mid in bot_ids:
        try:
            bot_call("DELETE", f"/channels/{state.get('channel_id')}/messages/{mid}")
            gone += 1
        except BotError as e:
            if e.code != 404:
                print(f"Could not delete {mid} ({e}).")
        time.sleep(0.6)
    ids = ids + bot_ids
    if ids:
        print(f"Deleted {gone} of {len(ids)} old pick'em posts.")


PLAYOFF_ROUNDS = {1: "Wild Card", 2: "Divisional Round", 3: "Conference Championship",
                  4: "Pro Bowl", 5: "Super Bowl"}


def week_label(season_type, week_no):
    if season_type == 3:
        return PLAYOFF_ROUNDS.get(week_no, f"Playoff Week {week_no}")
    return f"Week {week_no or '?'}"


def games(now):
    """Returns ([(kick, away, home, event_id)], label, season, week number)."""
    start, end = nw.week_range(now)
    events, week_no = nw.fetch_events(start, end)
    out, stype, season = [], None, None
    for ev in sorted(events, key=lambda e: e["date"]):
        comp = ev["competitions"][0]
        t = {c["homeAway"]: c["team"] for c in comp["competitors"]}
        kick = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(nw.PT)
        if start <= kick.date() <= end:
            out.append((kick, t["away"], t["home"], ev["id"]))
            venue = comp.get("venue") or {}
            weather.VENUES[ev["id"]] = {"indoor": venue.get("indoor"), "city": (venue.get("address") or {}).get("city"),
                                        "state": (venue.get("address") or {}).get("state"),
                                        "espn": (ev.get("weather") or comp.get("weather") or {}).get("displayValue")}
            stype = stype or (ev.get("season") or {}).get("type")
            season = season or (ev.get("season") or {}).get("year")
            week_no = (ev.get("week") or {}).get("number") or week_no
    if season is None:
        season = now.year if now.month >= 3 else now.year - 1
    return out, week_label(stype, week_no), season, week_no


def is_rams(g):
    return RAMS in (g[1].get("abbreviation"), g[2].get("abbreviation"))


def poll_payload(kick, away, home, now, emojis=None, wx=None):
    rams = RAMS in (away.get("abbreviation"), home.get("abbreviation"))
    hours = int((kick - now).total_seconds() // 3600)  # rounds down, so it closes by kickoff
    q = f"{away['shortDisplayName']} @ {home['shortDisplayName']}  |  {kick:%a} {nw.fmt_time(kick)}"
    if wx:
        q += f"  |  {wx}"
    if rams:
        q = "\U0001F40F RAMS GAME: " + q

    def answer(team):
        media = {"text": team["displayName"][:55]}
        logo = (emojis or {}).get(team.get("abbreviation", "").upper())
        if logo:
            media["emoji"] = {"id": logo}
        elif team.get("abbreviation") == RAMS:
            media["emoji"] = {"name": "\U0001F40F"}
        return {"poll_media": media}

    return {
        "username": "Rams Pick'em",
        "poll": {
            "question": {"text": q[:300]},
            "answers": [answer(away), answer(home)],
            "duration": max(1, min(hours, 768)),
            "allow_multiselect": False,
            "layout_type": 1,
        },
    }


def main():
    now = datetime.now(nw.PT)
    week_start = nw.week_range(now)[0].isoformat()
    # Monday 11 PM PT run (06:00/07:00 UTC Tuesday, covering PDT and PST): log last
    # week's picks only. Tuesday 6 AM then posts the scorecard and the new week.
    if SCHEDULED and ((now.weekday() == 0 and now.hour >= 23) or (now.weekday() == 1 and now.hour < 6)):
        grading.grade_week(load_state())
        return
    if SCHEDULED and now.weekday() == 0:
        print(f"{now:%a %H:%M} PT, before 11 PM. Skipping.")
        return
    # Cron fires hourly 13:00-18:00 UTC on Tuesdays. The first run at or after 6 AM PT
    # posts; later runs retry only if that one failed.
    if SCHEDULED:
        if now.hour < 6:
            print(f"{now:%H:%M} PT, before 6 AM. Skipping.")
            return
        if load_state().get("week_start") == week_start:
            print(f"Already posted for the week of {week_start}.")
            return
    gs, label, season, week_no = games(now)
    # Skip anything kicking off within the hour (Discord's minimum poll length is 1 hour)
    gs = [g for g in gs if (g[0] - now).total_seconds() >= 3600]
    gs.sort(key=lambda g: (not is_rams(g), g[0]))

    tz = now.strftime("%Z")
    header = {
        "username": "Rams Pick'em",
        "embeds": [{
            "title": f"\U0001F3C8  {label} Pick'em",
            "description": (f"**{len(gs)} games.** Pick a winner in each poll below.\n"
                            f"Each poll locks at kickoff. Times in {tz}.\n\n"
                            "\U0001F40F Rams game is up top."),
            "color": RAMS_BLUE,
        }],
    }
    wx = {eid: weather.line(eid, k) for k, _, _, eid in gs}
    polls = [poll_payload(k, a, h, now, team_emojis() if WEBHOOK else None, wx.get(eid)) for k, a, h, eid in gs]

    if not WEBHOOK:
        print(header["embeds"][0]["title"])
        for p in polls:
            pl = p["poll"]
            print(f"  {pl['question']['text']}  ({pl['duration']}h)  "
                  + " vs ".join(a["poll_media"]["text"] for a in pl["answers"]))
        return

    if not polls:
        if 3 <= now.month <= 8:
            print("Offseason, no games. Nothing to post.")
            return
        # Don't touch last week's polls. Exit with an error so the run shows red in
        # GitHub (and GitHub emails you), and the next hourly run retries.
        sys.exit(f"ESPN returned no upcoming games for the week of {week_start}. "
                 "Left last week's polls up; will retry next run.")

    # Order: grade last week (votes have to be read before its polls are deleted),
    # clear the old polls, post the scorecard, then the new week a minute later.
    grading.grade_week(load_state())  # picks up anything Monday night missed
    results = grading.week_results(load_state())
    delete_previous()
    if results:
        post(results)  # permanent record, not deleted next week
        import standings  # here, not at the top: standings imports this module
        standings.update(now)
        print("Scorecard posted. Waiting 1 minute before the new week.")
        time.sleep(60)

    first, how = post_as_bot(header)
    msgs, sent = [first], {"bot": [], "webhook": []}
    sent[how].append(first.get("id"))
    meta = []
    for (kick, away, home, eid), p in zip(gs, polls):
        time.sleep(1.2)
        msg, how = post_as_bot(p)
        msgs.append(msg)
        sent[how].append(msg.get("id"))
        teams = [away["abbreviation"], home["abbreviation"]]
        meta.append({"message_id": msg.get("id"), "event_id": eid, "kick": kick.isoformat(),
                     "game": f"{teams[0]} @ {teams[1]}", "rams": RAMS in teams, "weather": wx.get(eid),
                     "answers": grading.answer_map(msg, teams)})
    save_state({"message_ids": [i for i in sent["webhook"] if i],
                "bot_message_ids": [i for i in sent["bot"] if i],
                "channel_id": msgs[0].get("channel_id"), "polls": meta,
                "week": week_no, "label": label, "season": season, "week_start": week_start,
                "posted": now.isoformat(timespec="minutes")})
    print(f"Posted {len(polls)} polls.")


if __name__ == "__main__":
    main()
