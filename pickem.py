#!/usr/bin/env python3
"""Post a Discord poll for every NFL game this week (Tue-Mon). Rams game first.
Each poll closes at (or just before) kickoff.

Every Tuesday at noon PT it deletes last week's polls, then posts the new week.
Message ids are kept in state/pickem.json (committed back by the workflow).

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
        return discord("POST", payload=payload, query="wait=true").get("id")
    except urllib.error.HTTPError as e:
        sys.exit(f"Discord {e.code}: {e.read().decode(errors='replace')}")


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
    ids = load_state().get("message_ids", [])
    gone = 0
    for mid in ids:
        try:
            discord("DELETE", f"/messages/{mid}")
            gone += 1
        except urllib.error.HTTPError as e:
            if e.code != 404:  # 404 = already deleted by hand
                print(f"Could not delete {mid} ({e.code}).")
        time.sleep(0.6)
    if ids:
        print(f"Deleted {gone} of {len(ids)} old pick'em posts.")


def games(now):
    start, end = nw.week_range(now)
    events, week_no = nw.fetch_events(start, end)
    out = []
    for ev in sorted(events, key=lambda e: e["date"]):
        comp = ev["competitions"][0]
        t = {c["homeAway"]: c["team"] for c in comp["competitors"]}
        kick = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(nw.PT)
        if start <= kick.date() <= end:
            out.append((kick, t["away"], t["home"]))
    return out, week_no


def is_rams(g):
    return RAMS in (g[1].get("abbreviation"), g[2].get("abbreviation"))


def poll_payload(kick, away, home, now):
    rams = RAMS in (away.get("abbreviation"), home.get("abbreviation"))
    hours = int((kick - now).total_seconds() // 3600)  # rounds down, so it closes by kickoff
    q = f"{away['shortDisplayName']} @ {home['shortDisplayName']}  |  {kick:%a} {nw.fmt_time(kick)}"
    if rams:
        q = "\U0001F40F RAMS GAME: " + q

    def answer(team):
        media = {"text": team["displayName"][:55]}
        if team.get("abbreviation") == RAMS:
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
    # Cron runs at 19:00 and 20:00 UTC so one of them is noon PT in both PST and PDT.
    if SCHEDULED and now.hour != 12:
        print(f"{now:%H:%M} PT, not noon. Skipping.")
        return
    gs, week_no = games(now)
    # Skip anything kicking off within the hour (Discord's minimum poll length is 1 hour)
    gs = [g for g in gs if (g[0] - now).total_seconds() >= 3600]
    gs.sort(key=lambda g: (not is_rams(g), g[0]))

    tz = now.strftime("%Z")
    header = {
        "username": "Rams Pick'em",
        "embeds": [{
            "title": f"\U0001F3C8  Week {week_no or '?'} Pick'em",
            "description": (f"**{len(gs)} games.** Pick a winner in each poll below.\n"
                            f"Each poll locks at kickoff. Times in {tz}.\n\n"
                            "\U0001F40F Rams game is up top."),
            "color": RAMS_BLUE,
        }],
    }
    polls = [poll_payload(k, a, h, now) for k, a, h in gs]

    if not WEBHOOK:
        print(header["embeds"][0]["title"])
        for p in polls:
            pl = p["poll"]
            print(f"  {pl['question']['text']}  ({pl['duration']}h)  "
                  + " vs ".join(a["poll_media"]["text"] for a in pl["answers"]))
        return

    delete_previous()
    if not polls:
        save_state({"message_ids": [], "week": week_no})
        print("No upcoming games left this week.")
        return
    ids = [post(header)]
    for p in polls:
        time.sleep(1.2)
        ids.append(post(p))
    save_state({"message_ids": [i for i in ids if i], "week": week_no,
                "posted": now.isoformat(timespec="minutes")})
    print(f"Posted {len(polls)} polls.")


if __name__ == "__main__":
    main()
