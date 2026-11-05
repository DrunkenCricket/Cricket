#!/usr/bin/env python3
"""Post a Discord poll for every NFL game this week (Tue-Mon). Rams game first.
Each poll closes at (or just before) kickoff.

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
RAMS = "LAR"
RAMS_BLUE = 0x003594


def post(payload):
    url = WEBHOOK + ("&" if "?" in WEBHOOK else "?") + "wait=true"
    body = json.dumps(payload).encode()
    for _ in range(6):
        req = urllib.request.Request(url, data=body, method="POST",
                                     headers={**nw.UA, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20):
                return
        except urllib.error.HTTPError as e:
            raw = e.read()
            if e.code == 429:
                time.sleep(float(json.loads(raw or b"{}").get("retry_after", 2)) + 0.5)
                continue
            sys.exit(f"Discord {e.code}: {raw.decode(errors='replace')}")
    sys.exit("Discord rate limit, gave up")


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

    if not polls:
        print("No upcoming games left this week.")
        return
    post(header)
    for p in polls:
        time.sleep(1.2)
        post(p)
    print(f"Posted {len(polls)} polls.")


if __name__ == "__main__":
    main()
