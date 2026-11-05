#!/usr/bin/env python3
"""Post the Rams injury report, plus this week's opponent, to Discord.

  DISCORD_INJURY_WEBHOOK=https://discord.com/api/webhooks/... python injuries.py
  python injuries.py    # no webhook = dry run

Posts only when the report changes. Deletes the previous post first, then posts
the new one. State (last message id + content hash) lives in state/injury.json,
which the workflow commits back to the repo. FORCE=true posts regardless.
"""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

import names
import nfl_week as nw

WEBHOOK = os.environ.get("DISCORD_INJURY_WEBHOOK", "").strip()
FORCE = os.environ.get("FORCE", "").lower() == "true"
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state", "injury.json")
ROSTER = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{}/roster"
RAMS = "LAR"
RAMS_ID = "14"
RAMS_GOLD = 0xFFA300
# Invisible 1200x1 image so every card stretches to the same full width.
SPACER = {"url": "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/assets/spacer.png"}

# Position order within each status group: QB > RB > WR > TE > OL > DL > LB > CB > S > PK > P > PR > KR
POS_ORDER = {}
for i, group in enumerate([["QB"], ["RB", "FB"], ["WR"], ["TE"], ["OL", "OT", "T", "G", "OG", "C"],
                           ["DL", "DE", "DT", "NT"], ["LB", "ILB", "OLB", "MLB"], ["CB", "DB"],
                           ["S", "SS", "FS"], ["PK", "K"], ["P"], ["PR"], ["KR"], ["LS"]]):
    for pos in group:
        POS_ORDER[pos] = i

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
        people = sorted(groups[status], key=lambda r: (POS_ORDER.get(r["pos"], 99), r["name"]))
        header = f"{emoji}  {status.upper()}  ({len(people)})"
        if compact_ir and status == "Injured Reserve":
            fields.append({"name": header, "inline": False,
                           "value": ", ".join(f"#{r['jersey']} - {r['pos']} - {names.full(r['name'])}" for r in people)[:1024]})
            continue
        lines = [f"`#{r['jersey']:>2}` - {r['pos']} - **{names.full(r['name'])}**" + ("  \U0001F195" if r["new"] else "")
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


def build(now=None, ng=None):
    now = now or datetime.now(nw.PT)
    ng = ng or next_game(now)
    tz = now.strftime("%Z")

    desc = f"**Updated {now:%a, %b} {now.day}, {nw.fmt_time(now)} {tz}**"
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
        embeds, sig, failed = [], [], False
        for title, tid, color, d in teams:
            try:
                rows = injured(tid, now)
            except Exception as e:
                print(f"Roster fetch failed for team {tid}: {e}", file=sys.stderr)
                failed = True
                continue
            sig.append([tid, sorted([r["status"], r["name"]] for r in rows)])
            e = {"title": title, "color": color, "fields": status_fields(rows, compact), "image": SPACER}
            if d:
                e["description"] = d
            if not rows:
                e["description"] = (d + "\n\n" if d else "") + "No one on the injury report."
            embeds.append(e)
        if sum(embed_size(e) for e in embeds) < 5800:
            break
    if embeds:
        embeds[-1]["footer"] = {"text": "\U0001F195 = updated in the last day  \u2022  Data: ESPN"}
    if ng:
        sig.append([ng["opp"].get("id"), ng["kick"].isoformat()])
    digest = hashlib.sha256(json.dumps(sig, sort_keys=True).encode()).hexdigest()
    return {"username": "Rams Injury Report", "embeds": embeds}, digest, failed


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


def webhook_url(suffix="", query=""):
    base, _, q = WEBHOOK.partition("?")
    parts = [p for p in (q, query) if p]
    return base + suffix + ("?" + "&".join(parts) if parts else "")


def discord(method, url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={**nw.UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
        return json.loads(body) if body else {}


def main():
    now = datetime.now(nw.PT)
    ng = next_game(now)
    if WEBHOOK and ng and now.date() >= ng["kick"].date() and not FORCE:
        print("Game day or after, no updates until next week's report.")
        return
    payload, digest, failed = build(now, ng)
    if not WEBHOOK:
        for e in payload["embeds"]:
            print("\n=== " + e["title"] + "\n" + e.get("description", ""))
            for f in e["fields"]:
                print("\n" + f["name"] + "\n" + f["value"].replace("**", "").replace("`", ""))
        print(f"\nhash {digest[:12]}")
        return

    state = load_state()
    if failed and not FORCE:
        print("ESPN fetch failed for a team, skipping this run.")
        return
    if digest == state.get("hash") and not FORCE:
        print("No change since last post.")
        return

    old = state.get("message_id")
    if old:
        try:
            discord("DELETE", webhook_url(f"/messages/{old}"))
            print(f"Deleted previous post {old}.")
        except urllib.error.HTTPError as e:
            print(f"Could not delete {old} ({e.code}), continuing.")

    try:
        msg = discord("POST", webhook_url(query="wait=true"), payload)
    except urllib.error.HTTPError as e:
        sys.exit(f"Discord {e.code}: {e.read().decode(errors='replace')}")
    save_state({"message_id": msg.get("id"), "hash": digest,
                "posted": datetime.now(nw.PT).isoformat(timespec="minutes")})
    print(f"Posted new report {msg.get('id')}.")


if __name__ == "__main__":
    main()
