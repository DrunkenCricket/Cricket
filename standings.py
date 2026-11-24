#!/usr/bin/env python3
"""Keep one standings card in #pickem up to date.

The first run posts the card (pin it in Discord). Every later run edits that same
message, so the pin always shows current standings. Pick'em runs this after each
Tuesday's grading; "Rams Standings" in Actions refreshes it on demand.
"""
import json
import os
import sys
import urllib.error
from datetime import datetime

import grading
import nfl_week as nw
import pickem

STATE = os.path.join(grading.ROOT, "state", "standings.json")
SHEET = "https://docs.google.com/spreadsheets/d/1GgcU934xu0bw1Z5bAAqILJ-PYJhg5WE-M9XhRbrRb2M/edit"
SPACER = {"url": "https://raw.githubusercontent.com/DrunkenCricket/Cricket/main/assets/spacer.png"}


def load():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def payload(now):
    picks = grading.read_csv(grading.PICKS_CSV)
    season = max((int(r["season"]) for r in picks), default=now.year if now.month >= 3 else now.year - 1)
    rows = [r for r in picks if str(r["season"]) == str(season)]
    weeks = sorted({r["label"] for r in rows}, key=lambda l: [int(x) if x.isdigit() else x for x in l.split()])
    contests = [r for r in grading.read_csv(grading.CONTESTS_CSV) if str(r["season"]) == str(season)]

    fields = [{"name": "\U0001F3C8  Pick'em", "value": grading.board(grading.tally(rows), limit=25, pct=True)[:1024],
               "inline": False}]
    if contests:
        fields.append({"name": "\U0001F3C6  Contests", "value": grading.board(grading.tally(contests), limit=10)[:1024],
                       "inline": False})
    fields.append({"name": "\U0001F4CB  Full Breakdown", "value": f"[Week-by-week sheet]({SHEET})", "inline": False})

    return {
        "username": "Rams Pick'em",
        "embeds": [{
            "title": f"\U0001F4C8  {season} Season Standings",
            "description": (f"Graded: {', '.join(weeks) or 'nothing yet'}\n"
                            f"Updated {now:%a, %b} {now.day}, {nw.fmt_time(now)} {now:%Z}"),
            "color": grading.GOLD,
            "fields": fields,
            "image": SPACER,
        }],
    }


def update(now=None):
    now = now or datetime.now(nw.PT)
    body = payload(now)
    mid = load().get("message_id")
    if mid:
        try:
            pickem.discord("PATCH", f"/messages/{mid}", body)
            print(f"Updated standings card {mid}.")
            return
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            print("Standings card was deleted, posting a new one.")
    msg = pickem.post(body)
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w") as f:
        json.dump({"message_id": msg.get("id")}, f, indent=2)
        f.write("\n")
    print(f"Posted standings card {msg.get('id')}. Pin it in #pickem.")


if __name__ == "__main__":
    if not pickem.WEBHOOK:
        sys.exit("Needs the DISCORD_PICKEM_WEBHOOK secret.")
    update()
