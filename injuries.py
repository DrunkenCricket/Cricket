#!/usr/bin/env python3
"""Post the Rams injury report to Discord, grouped by status.

  DISCORD_INJURY_WEBHOOK=https://discord.com/api/webhooks/... python injuries.py
  python injuries.py    # no webhook = dry run
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

import nfl_week as nw

WEBHOOK = os.environ.get("DISCORD_INJURY_WEBHOOK", "").strip()
ROSTER = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/14/roster"
RAMS = "LAR"

# status -> (emoji, sort order). Anything else lands at the end.
STATUS = {
    "Out": ("\U0001F534", 0),
    "Doubtful": ("\U0001F7E0", 1),
    "Questionable": ("\U0001F7E1", 2),
    "Day-To-Day": ("\U0001F7E2", 3),
    "Suspension": ("\U0001F6AB", 5),
    "Physically Unable to Perform": ("⚪", 6),
    "Injured Reserve": ("⚫", 7),
}


def get(url):
    req = urllib.request.Request(url, headers=nw.UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def roster():
    data = get(ROSTER)
    out = []
    for group in data.get("athletes", []):
        out.extend(group.get("items", [group]) if isinstance(group, dict) else [])
    return out


def injured(now):
    rows = []
    for a in roster():
        inj = a.get("injuries") or []
        if not inj:
            continue
        i = inj[0]
        status = i.get("status") or "Unknown"
        new = False
        if i.get("date"):
            try:
                d = datetime.fromisoformat(i["date"].replace("Z", "+00:00"))
                new = now - d < timedelta(hours=30)
            except ValueError:
                pass
        rows.append({
            "status": status,
            "name": a.get("fullName") or a.get("displayName", "?"),
            "jersey": a.get("jersey", ""),
            "pos": (a.get("position") or {}).get("abbreviation", ""),
            "new": new,
        })
    return rows


def next_game(now):
    """Rams game this week, if any: ('vs'/'@', opponent short name, kickoff)."""
    try:
        start, end = nw.week_range(now)
        events, _ = nw.fetch_events(start, end)
    except Exception:
        return None
    for ev in events:
        comp = ev["competitions"][0]
        teams = {c["homeAway"]: c["team"] for c in comp["competitors"]}
        if RAMS not in (teams["home"].get("abbreviation"), teams["away"].get("abbreviation")):
            continue
        kick = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(nw.PT)
        if teams["home"].get("abbreviation") == RAMS:
            return "vs", teams["away"]["shortDisplayName"], kick
        return "@", teams["home"]["shortDisplayName"], kick
    return None


def chunk(lines, limit=1024):
    out, cur = [], ""
    for l in lines:
        if len(cur) + len(l) + 1 > limit:
            out.append(cur)
            cur = ""
        cur += l + "\n"
    if cur:
        out.append(cur)
    return out


def build(now=None):
    now = now or datetime.now(nw.PT)
    rows = injured(now)
    groups = {}
    for r in rows:
        groups.setdefault(r["status"], []).append(r)

    fields = []
    for status in sorted(groups, key=lambda s: STATUS.get(s, ("", 4))[1]):
        emoji = STATUS.get(status, ("❔", 4))[0]
        lines = [f"`#{r['jersey']:>2}` **{r['name']}** - {r['pos']}" + ("  \U0001F195" if r["new"] else "")
                 for r in sorted(groups[status], key=lambda r: r["name"])]
        for i, val in enumerate(chunk(lines)):
            name = f"{emoji}  {status.upper()}  ({len(lines)})" if i == 0 else "​"
            fields.append({"name": name, "value": val, "inline": False})

    ng = next_game(now)
    desc = f"**{now:%A, %b} {now.day}**"
    if ng:
        side, opp, kick = ng
        desc += f"\nNext up: **{side} {opp}**  |  {kick:%a, %b} {kick.day}, {nw.fmt_time(kick)} {now:%Z}"
    if not fields:
        desc += "\n\nNo one on the injury report. \U0001F40F"

    return {
        "username": "Rams Injury Report",
        "embeds": [{
            "title": "\U0001F40F  Rams Injury Report",
            "description": desc,
            "color": 0xFFA300,
            "fields": fields[:25],
            "footer": {"text": "\U0001F195 = updated in the last day  •  Data: ESPN"},
        }],
    }


def main():
    payload = build()
    if not WEBHOOK:
        e = payload["embeds"][0]
        print(e["title"] + "\n" + e["description"])
        for f in e["fields"]:
            print("\n" + f["name"] + "\n" + f["value"].replace("**", "").replace("`", ""))
        return

    req = urllib.request.Request(WEBHOOK, data=json.dumps(payload).encode(), method="POST",
                                 headers={**nw.UA, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"Posted to Discord ({r.status}).")
    except urllib.error.HTTPError as e:
        sys.exit(f"Discord {e.code}: {e.read().decode(errors='replace')}")


if __name__ == "__main__":
    main()
