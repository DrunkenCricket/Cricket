#!/usr/bin/env python3
"""Post the Rams injury report, plus this week's opponent, to Discord.

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
ROSTER = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{}/roster"
RAMS = "LAR"
RAMS_ID = "14"
RAMS_GOLD = 0xFFA300

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


def roster(team_id):
    data = get(ROSTER.format(team_id))
    out = []
    for group in data.get("athletes", []):
        out.extend(group.get("items", [group]) if isinstance(group, dict) else [])
    return out


def injured(team_id, now):
    rows = []
    for a in roster(team_id):
        inj = a.get("injuries") or []
        if not inj:
            continue
        i = inj[0]
        new = False
        if i.get("date"):
            try:
                d = datetime.fromisoformat(i["date"].replace("Z", "+00:00"))
                new = now - d < timedelta(hours=30)
            except ValueError:
                pass
        rows.append({
            "status": i.get("status") or "Unknown",
            "name": a.get("fullName") or a.get("displayName", "?"),
            "jersey": a.get("jersey", ""),
            "pos": (a.get("position") or {}).get("abbreviation", ""),
            "new": new,
        })
    return rows


def next_game(now):
    """Rams game this week, if any: {'side': 'vs'/'@', 'opp': team dict, 'kick': datetime}."""
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
            return {"side": "vs", "opp": teams["away"], "kick": kick}
        return {"side": "@", "opp": teams["home"], "kick": kick}
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


def status_fields(rows, compact_ir=False):
    groups = {}
    for r in rows:
        groups.setdefault(r["status"], []).append(r)
    fields = []
    for status in sorted(groups, key=lambda s: STATUS.get(s, ("", 4))[1]):
        emoji = STATUS.get(status, ("\u2754", 4))[0]
        people = sorted(groups[status], key=lambda r: r["name"])
        header = f"{emoji}  {status.upper()}  ({len(people)})"
        if compact_ir and status == "Injured Reserve":
            fields.append({"name": header, "inline": False,
                           "value": ", ".join(f"{r['name']} ({r['pos']})" for r in people)[:1024]})
            continue
        lines = [f"`#{r['jersey']:>2}` **{r['name']}** - {r['pos']}" + ("  \U0001F195" if r["new"] else "")
                 for r in people]
        for i, val in enumerate(chunk(lines)):
            fields.append({"name": header if i == 0 else "\u200b", "value": val, "inline": False})
    return fields[:25]


def team_color(team, fallback=0x6B7280):
    try:
        return int(team.get("color", ""), 16)
    except ValueError:
        return fallback


def embed_size(e):
    return len(e.get("title", "")) + len(e.get("description", "")) + len(e.get("footer", {}).get("text", "")) \
        + sum(len(f["name"]) + len(f["value"]) for f in e.get("fields", []))


def build(now=None):
    now = now or datetime.now(nw.PT)
    ng = next_game(now)
    tz = now.strftime("%Z")

    desc = f"**{now:%A, %b} {now.day}**"
    if ng:
        k = ng["kick"]
        desc += f"\nNext up: **{ng['side']} {ng['opp']['shortDisplayName']}**  |  {k:%a, %b} {k.day}, {nw.fmt_time(k)} {tz}"
    else:
        desc += "\nBye week. \U0001F634"

    teams = [("\U0001F40F  Rams Injury Report", RAMS_ID, RAMS_GOLD, desc)]
    if ng and ng["opp"].get("id"):
        opp = ng["opp"]
        teams.append((f"\U0001F19A  {opp.get('displayName', opp['shortDisplayName'])} Injury Report",
                      opp["id"], team_color(opp), None))

    for compact in (False, True):  # Discord caps all embeds at 6000 chars total
        embeds = []
        for title, tid, color, d in teams:
            try:
                rows = injured(tid, now)
            except Exception as e:
                print(f"Roster fetch failed for team {tid}: {e}", file=sys.stderr)
                continue
            e = {"title": title, "color": color, "fields": status_fields(rows, compact)}
            if d:
                e["description"] = d
            if not rows:
                e["description"] = (d + "\n\n" if d else "") + "No one on the injury report."
            embeds.append(e)
        if sum(embed_size(e) for e in embeds) < 5800:
            break
    if embeds:
        embeds[-1]["footer"] = {"text": "\U0001F195 = updated in the last day  \u2022  Data: ESPN"}
    return {"username": "Rams Injury Report", "embeds": embeds}


def main():
    payload = build()
    if not WEBHOOK:
        for e in payload["embeds"]:
            print("\n=== " + e["title"] + "\n" + e.get("description", ""))
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
