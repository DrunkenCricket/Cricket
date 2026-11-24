#!/usr/bin/env python3
"""One-off prediction polls: Super Bowl winner, AFC #1 seed, conference champs, MVP...

Run from GitHub: Actions > Rams Contest > Run workflow.

  ACTION=create  TITLE="Who wins Super Bowl LXI?" OPTIONS="Rams, Eagles, Bills" CLOSE_DATE=2026-12-31
  ACTION=resolve CONTEST_ID=who-wins-super-bowl-lxi WINNER="Rams"
  ACTION=list

Discord polls allow 2-10 options and up to 32 days open. Votes stay readable after a
poll closes, so settle it whenever the answer is known (even months later).
Every vote is logged to data/contests.csv.
"""
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta

import grading
import nfl_week as nw
import pickem

ACTION = os.environ.get("ACTION", "list").strip().lower()
TITLE = os.environ.get("TITLE", "").strip()
OPTIONS = [o.strip() for o in os.environ.get("OPTIONS", "").split(",") if o.strip()]
CLOSE_DATE = os.environ.get("CLOSE_DATE", "").strip()
CONTEST_ID = os.environ.get("CONTEST_ID", "").strip()
WINNER = os.environ.get("WINNER", "").strip()
STATE = os.path.join(grading.ROOT, "state", "contests.json")


def load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save(data):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "contest"


def create(now):
    if not TITLE or not 2 <= len(OPTIONS) <= 10:
        sys.exit("Need a title and 2-10 comma-separated options.")
    close = (datetime.fromisoformat(CLOSE_DATE).replace(hour=23, minute=59, tzinfo=nw.PT)
             if CLOSE_DATE else now + timedelta(days=7))
    hours = int((close - now).total_seconds() // 3600)
    if hours < 1:
        sys.exit("Close date has to be in the future.")
    if hours > 768:
        sys.exit("Discord polls can stay open 32 days max. Pick an earlier close date.")

    data = load()
    cid = CONTEST_ID or slug(TITLE)
    if cid in data:
        sys.exit(f"Contest '{cid}' already exists. Give it a different CONTEST_ID.")

    msg = pickem.post({
        "username": "Rams Contests",
        "content": f"\U0001F3C6 **New contest!** Locks {close:%a, %b} {close.day} at {nw.fmt_time(close)} {close:%Z}.",
        "poll": {
            "question": {"text": TITLE[:300]},
            "answers": [{"poll_media": {"text": o[:55]}} for o in OPTIONS],
            "duration": hours,
            "allow_multiselect": False,
            "layout_type": 1,
        },
    })
    data[cid] = {"title": TITLE, "options": OPTIONS, "message_id": msg.get("id"),
                 "channel_id": msg.get("channel_id"), "answers": grading.answer_map(msg, OPTIONS),
                 "season": now.year if now.month >= 3 else now.year - 1,
                 "created": now.isoformat(timespec="minutes"), "closes": close.isoformat(timespec="minutes"),
                 "resolved": None}
    save(data)
    print(f"Created contest '{cid}'. Settle it later with CONTEST_ID={cid}.")


def resolve(now):
    data = load()
    c = data.get(CONTEST_ID)
    if not c:
        sys.exit(f"No contest '{CONTEST_ID}'. Run with ACTION=list to see ids.")
    if c.get("resolved"):
        sys.exit(f"'{CONTEST_ID}' was already settled: {c['resolved']}.")
    match = [o for o in c["options"] if o.lower() == WINNER.lower()]
    if not match:
        sys.exit(f"WINNER must be one of: {', '.join(c['options'])}")
    answer = match[0]
    if not grading.TOKEN:
        sys.exit("Needs the DISCORD_BOT_TOKEN secret to read votes.")

    rows, votes = [], defaultdict(list)
    for aid, option in c["answers"].items():
        for u in grading.voters(c["channel_id"], c["message_id"], aid):
            votes[option].append(u["id"])
            rows.append({"season": c["season"], "contest_id": CONTEST_ID, "title": c["title"],
                         "user_id": u["id"], "user_name": grading.user_name(u), "pick": option,
                         "answer": answer, "correct": int(option == answer)})
    grading.append_csv(grading.CONTESTS_CSV, grading.CONTEST_FIELDS, rows)

    right = votes.get(answer, [])
    total = sum(len(v) for v in votes.values())
    split = "  •  ".join(f"{o} {len(votes.get(o, []))}" for o in c["options"] if votes.get(o))
    right_txt = " ".join(f"<@{u}>" for u in right) or "Nobody. Ouch."

    season_rows = [r for r in grading.read_csv(grading.CONTESTS_CSV) if str(r["season"]) == str(c["season"])]
    fields = [
        {"name": f"✅  Called It ({len(right)}/{total})", "value": right_txt[:1024], "inline": False},
        {"name": "\U0001F5F3️  Vote Split", "value": split or "No votes.", "inline": False},
        {"name": "\U0001F4C8  Contest Standings", "value": grading.board(grading.tally(season_rows))[:1024],
         "inline": False},
    ]
    pickem.post({
        "username": "Rams Contests",
        "embeds": [{"title": f"\U0001F3C6  {c['title']}", "description": f"Answer: **{answer}**",
                    "color": grading.GOLD, "fields": fields,
                    "image": {"url": "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/assets/spacer.png"}}],
    })
    c["resolved"] = answer
    save(data)
    print(f"Settled '{CONTEST_ID}': {answer}. {len(right)}/{total} got it.")


def list_contests():
    data = load()
    if not data:
        print("No contests yet.")
    for cid, c in data.items():
        status = f"settled: {c['resolved']}" if c.get("resolved") else f"open, closes {c['closes']}"
        print(f"{cid}  |  {c['title']}  |  {', '.join(c['options'])}  |  {status}")


def main():
    if not pickem.WEBHOOK and ACTION != "list":
        sys.exit("Needs the DISCORD_PICKEM_WEBHOOK secret.")
    now = datetime.now(nw.PT)
    {"create": create, "resolve": resolve}.get(ACTION, lambda _: list_contests())(now)


if __name__ == "__main__":
    main()
