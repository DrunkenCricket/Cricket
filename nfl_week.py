#!/usr/bin/env python3
"""Post this NFL week's schedule (Tuesday through Monday) to Discord, times in Pacific.

Usage:
  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... python nfl_week.py
  python nfl_week.py            # no webhook set = prints to terminal (dry run)
"""
import json
import os
import sys
import urllib.error
import urllib.request
from collections import OrderedDict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")
WEBHOOK = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={}"
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
    """One request per day (ESPN rejects date ranges). Pads a day on each
    side, dedupes by game id, then build() filters by Pacific date."""
    events, week_no = {}, None
    d = start - timedelta(days=1)
    while d <= end + timedelta(days=1):
        req = urllib.request.Request(API.format(d.strftime("%Y%m%d")), headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            print(f"ESPN {e.code} for {d}, skipping", file=sys.stderr)
            d += timedelta(days=1)
            continue
        for ev in data.get("events", []):
            events[ev["id"]] = ev
        if start <= d <= end and week_no is None:
            week_no = data.get("week", {}).get("number")
        d += timedelta(days=1)
    return list(events.values()), week_no


def game_tile(ev):
    """Returns (pacific datetime, tile title, tile body, plain text line)."""
    comp = ev["competitions"][0]
    teams = {c["homeAway"]: c for c in comp["competitors"]}
    away, home = teams["away"], teams["home"]
    an, hn = away["team"]["shortDisplayName"], home["team"]["shortDisplayName"]
    dt = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(PT)
    state = comp.get("status", {}).get("type", {}).get("state", "pre")
    nets = [n for b in comp.get("broadcasts", []) for n in b.get("names", [])]
    net = ", ".join(nets) if nets else "TBD"
    t = fmt_time(dt)

    if state in ("post", "in"):
        a, h = int(away.get("score") or 0), int(home.get("score") or 0)
        if state == "post":
            an_s = f"**{an}**" if a > h else an
            hn_s = f"**{hn}**" if h > a else hn
            body = f"\u2705 Final\n{an_s} {a} - {h} {hn_s}"
            plain = f"Final: {an} {a} - {h} {hn}"
        else:
            body = f"\U0001F534 LIVE\n{an} {a} - {h} {hn}"
            plain = f"LIVE: {an} {a} - {h} {hn}"
    else:
        body = f"\U0001F552 `{t}`\n\U0001F4FA {net}"
        plain = f"{t:>8}  {net}"

    title = f"\U0001F3C8 {an} @ {hn}"
    return dt, title, body, f"{an} @ {hn}  |  {plain}"


def build(now=None):
    now = now or datetime.now(PT)
    start, end = week_range(now)
    events, week_no = fetch_events(start, end)

    days = OrderedDict()
    for ev in sorted(events, key=lambda e: e["date"]):
        tile = game_tile(ev)
        if start <= tile[0].date() <= end:
            days.setdefault(tile[0].date(), []).append(tile)

    tz = now.strftime("%Z")  # PST or PDT
    title = f"NFL Week {week_no}" if week_no else "NFL This Week"
    sub = f"{start:%b} {start.day} - {end:%b} {end.day}"
    return title, sub, days, tz


# Per-day accent colors
DAY_COLOR = {0: 0xD50A0A, 1: 0x6B7280, 2: 0x6B7280, 3: 0xF59E0B,
             4: 0x8B5CF6, 5: 0x10B981, 6: 0x013369}
BLANK = {"name": "\u200b", "value": "\u200b", "inline": True}


def to_discord(title, sub, days, tz):
    n_games = sum(len(v) for v in days.values())
    embeds = [{
        "title": f"\U0001F3C8  {title}",
        "description": f"**{sub}**  \u2022  {n_games} games  \u2022  times in {tz}",
        "color": 0x013369,
    }]
    for d, tiles in list(days.items())[:9]:  # Discord max 10 embeds
        fields = [{"name": tt, "value": body, "inline": True} for _, tt, body, _ in tiles][:24]
        while len(fields) % 3:
            fields.append(BLANK)  # keep the 3-column grid aligned
        embeds.append({
            "title": f"\U0001F4C5  {fmt_day(d)}",
            "color": DAY_COLOR[d.weekday()],
            "fields": fields,
        })
    if len(embeds) == 1:
        embeds[0]["description"] += "\n\nNo games this week."
    embeds[-1]["footer"] = {"text": f"All times {tz}  \u2022  Data: ESPN"}
    return {"username": "NFL Schedule", "embeds": embeds}


def main():
    title, sub, days, tz = build()

    if not WEBHOOK:
        print(f"{title}  |  {sub}")
        for d, tiles in days.items():
            print(f"\n{fmt_day(d)}")
            for *_, plain in tiles:
                print("  " + plain)
        print(f"\nAll times {tz}")
        return

    body = json.dumps(to_discord(title, sub, days, tz)).encode()
    req = urllib.request.Request(WEBHOOK, data=body, method="POST",
                                 headers={**UA, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"Posted to Discord ({r.status}).")
    except urllib.error.HTTPError as e:
        sys.exit(f"Discord {e.code}: {e.read().decode(errors='replace')}")


if __name__ == "__main__":
    main()
