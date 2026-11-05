#!/usr/bin/env python3
"""Post the Rams projected game-day lineup about an hour before kickoff.

ESPN doesn't publish the official inactive list, so this is the Rams depth chart
with anyone ruled out (Out, Doubtful, IR, PUP, suspended) removed.

  DISCORD_INJURY_WEBHOOK=... python gameday.py   # posts if kickoff is 15-90 min away
  PREVIEW=true python gameday.py                 # print this week's lineup, no post
  FORCE=true  python gameday.py                  # post now for this week's game
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime

import injuries as inj
import names
import nfl_week as nw

WEBHOOK = os.environ.get("DISCORD_INJURY_WEBHOOK", "").strip()
PREVIEW = os.environ.get("PREVIEW", "").lower() == "true"
FORCE = os.environ.get("FORCE", "").lower() == "true"
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state", "gameday.json")
DEPTH = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{}/teams/14/depthcharts"
RAMS_BLUE = 0x003594

RULED_OUT = {"Out", "Doubtful", "Injured Reserve", "Suspension", "Physically Unable to Perform"}

# (column title, [(label, depth chart keys, max names)])
GROUPS = [
    ("\U0001F3C8  OFFENSE", [("QB", ["qb"], 3), ("RB", ["rb"], 4), ("WR", ["wr"], 6),
                            ("TE", ["te"], 4), ("OL", ["lt", "lg", "c", "rg", "rt"], 9)]),
    ("\U0001F6E1️  DEFENSE", [("DL", ["lde", "nt", "rde", "de", "dt"], 7),
                                   ("LB", ["wlb", "lilb", "rilb", "slb", "mlb", "olb"], 7),
                                   ("CB", ["lcb", "rcb", "nb"], 6), ("S", ["ss", "fs"], 5)]),
    ("\U0001F9B5  SPECIAL TEAMS", [("K", ["pk"], 1), ("P", ["p"], 1), ("LS", ["ls"], 1),
                                  ("KR", ["kr"], 2), ("PR", ["pr"], 2)]),
]


def rams_game(now):
    start, end = nw.week_range(now)
    events, _ = nw.fetch_events(start, end)
    for ev in events:
        comp = ev["competitions"][0]
        teams = {c["homeAway"]: c["team"] for c in comp["competitors"]}
        if inj.RAMS not in (teams["home"].get("abbreviation"), teams["away"].get("abbreviation")):
            continue
        home = teams["home"].get("abbreviation") == inj.RAMS
        return {
            "id": ev["id"],
            "kick": datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(nw.PT),
            "side": "vs" if home else "@",
            "opp": teams["away" if home else "home"],
            "venue": (comp.get("venue") or {}).get("fullName", ""),
        }
    return None


def depth_chart(season):
    """position key -> [(rank, slot, athlete id)]"""
    out = {}
    for formation in inj.get(DEPTH.format(season)).get("items", []):
        for key, pos in (formation.get("positions") or {}).items():
            for a in pos.get("athletes", []):
                m = re.search(r"athletes/(\d+)", (a.get("athlete") or {}).get("$ref", ""))
                if m:
                    out.setdefault(key, []).append((a.get("rank", 99), a.get("slot", 0), m.group(1)))
    return out


def build(game, now):
    season = game["kick"].year if game["kick"].month >= 3 else game["kick"].year - 1
    depth = depth_chart(season)
    roster = {str(a.get("id")): a for a in inj.roster(inj.RAMS_ID)}

    def status(a):
        return ((a.get("injuries") or [{}])[0]).get("status")

    fields = []
    for title, rows in GROUPS:
        lines = []
        for label, keys, cap in rows:
            entries = sorted((r, keys.index(k), s, aid)
                             for k in keys for r, s, aid in depth.get(k, []))
            seen, shown = set(), []
            for _, _, _, aid in entries:
                a = roster.get(aid)
                if not a or aid in seen or status(a) in RULED_OUT:
                    continue
                seen.add(aid)
                shown.append(names.short(a) + (" (Q)" if status(a) == "Questionable" else ""))
            if shown:
                lines.append(f"**{label}:** " + ", ".join(shown[:cap]))
        fields.append({"name": title, "value": "\n".join(lines)[:1024] or "​", "inline": True})

    out = sorted((a for a in roster.values() if status(a) in RULED_OUT - {"Injured Reserve"}),
                 key=lambda a: a.get("fullName", ""))
    k = game["kick"]
    desc = f"**{game['side']} {game['opp']['shortDisplayName']}**  |  Kickoff {nw.fmt_time(k)} {k:%Z}"
    if game["venue"]:
        desc += f"\n\U0001F4CD {game['venue']}"
    if out:
        desc += "\n\n\U0001F6AB **Not playing:** " + ", ".join(
            f"{names.full(a.get('fullName', '?'))} ({(a.get('position') or {}).get('abbreviation', '')})"
            for a in out)

    return {
        "username": "Rams Game Day",
        "embeds": [{
            "title": "\U0001F40F  Rams Game Day Lineup",
            "description": desc,
            "color": RAMS_BLUE,
            "fields": fields,
            "footer": {"text": "Projected from the ESPN depth chart minus players ruled out  •  "
                               "(Q) = questionable  •  Official inactives drop 90 min before kickoff"},
        }],
    }


def main():
    now = datetime.now(nw.PT)
    game = rams_game(now)
    if not game:
        print("No Rams game this week.")
        return

    mins = (game["kick"] - now).total_seconds() / 60
    if not (PREVIEW or FORCE):
        if _posted(game["id"]):
            print("Already posted for this game.")
            return
        if not 15 <= mins <= 90:
            print(f"Kickoff in {mins:.0f} min, not in the posting window.")
            return

    payload = build(game, now)
    if PREVIEW or not WEBHOOK:
        e = payload["embeds"][0]
        print("=== " + e["title"] + "\n" + e["description"])
        for f in e["fields"]:
            print("\n" + f["name"] + "\n" + f["value"].replace("**", ""))
        print("\n" + e["footer"]["text"])
        return

    inj.WEBHOOK = WEBHOOK
    try:
        msg = inj.discord("POST", inj.webhook_url(query="wait=true"), payload)
    except urllib.error.HTTPError as e:
        sys.exit(f"Discord {e.code}: {e.read().decode(errors='replace')}")
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f:
        json.dump({"event": game["id"], "message_id": msg.get("id"),
                   "posted": now.isoformat(timespec="minutes")}, f, indent=2)
        f.write("\n")
    print(f"Posted lineup {msg.get('id')}.")


def _posted(event_id):
    try:
        with open(STATE) as f:
            return json.load(f).get("event") == event_id
    except (OSError, ValueError):
        return False


if __name__ == "__main__":
    main()
