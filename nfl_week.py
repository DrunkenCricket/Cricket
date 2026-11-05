#!/usr/bin/env python3
"""Post this NFL week's schedule (Tuesday through Monday) to Discord, times in Pacific.

Usage:
  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... python nfl_week.py
  python nfl_week.py            # no webhook set = prints to terminal (dry run)
"""
import json
import os
import sys
import urllib.request
from collections import OrderedDict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")
WEBHOOK = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={}-{}&limit=100"
UA = {"User-Agent": "Mozilla/5.0 nfl-week-discord"}


def week_range(now):
    """Tuesday of the current NFL week through the following Monday."""
    start = now.date() - timedelta(days=(now.weekday() - 1) % 7)
    return start, start + timedelta(days=6)


def fmt_time(dt):
    return dt.strftime("%I:%M %p").lstrip("0")


def fmt_day(d):
    return f"{d:%A}, {d:%b} {d.day}"


def fetch_events(start, end):
    # Pad a day on each side, then filter by Pacific date below.
    a = (start - timedelta(days=1)).strftime("%Y%m%d")
    b = (end + timedelta(days=1)).strftime("%Y%m%d")
    req = urllib.request.Request(API.format(a, b), headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    return data.get("events", []), data.get("week", {}).get("number")


def game_line(ev):
    comp = ev["competitions"][0]
    teams = {c["homeAway"]: c for c in comp["competitors"]}
    away, home = teams["away"], teams["home"]
    an, hn = away["team"]["shortDisplayName"], home["team"]["shortDisplayName"]
    dt = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(PT)
    state = comp.get("status", {}).get("type", {}).get("state", "pre")

    if state == "post":
        tail = f"Final: {away.get('score')}-{home.get('score')}"
    elif state == "in":
        tail = f"LIVE: {away.get('score')}-{home.get('score')}"
    else:
        nets = [n for b in comp.get("broadcasts", []) for n in b.get("names", [])]
        tail = ", ".join(nets) if nets else "TBD"

    return dt, f"`{fmt_time(dt):>8}`  **{an} @ {hn}**  - {tail}"


def build(now=None):
    now = now or datetime.now(PT)
    start, end = week_range(now)
    events, week_no = fetch_events(start, end)

    days = OrderedDict()
    for ev in sorted(events, key=lambda e: e["date"]):
        dt, line = game_line(ev)
        if start <= dt.date() <= end:
            days.setdefault(dt.date(), []).append(line)

    tz = now.strftime("%Z")  # PST or PDT
    title = f"NFL Week {week_no}" if week_no else "NFL This Week"
    title += f"  |  {start:%b} {start.day} - {end:%b} {end.day}"
    return title, days, tz


def to_discord(title, days, tz):
    fields = [{"name": fmt_day(d), "value": "\n".join(lines)[:1024], "inline": False}
              for d, lines in days.items()]
    embed = {
        "title": title,
        "color": 0x013369,
        "fields": fields[:25] or [{"name": "No games", "value": "Nothing scheduled this week."}],
        "footer": {"text": f"All times {tz}"},
    }
    return {"username": "NFL Schedule", "embeds": [embed]}


def main():
    title, days, tz = build()

    if not WEBHOOK:
        print(title)
        for d, lines in days.items():
            print(f"\n{fmt_day(d)}")
            for l in lines:
                print("  " + l.replace("**", "").replace("`", ""))
        print(f"\nAll times {tz}")
        return

    body = json.dumps(to_discord(title, days, tz)).encode()
    req = urllib.request.Request(WEBHOOK, data=body, method="POST",
                                 headers={**UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        if r.status not in (200, 204):
            sys.exit(f"Discord returned {r.status}")
    print("Posted to Discord.")


if __name__ == "__main__":
    main()
