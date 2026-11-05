"""Display-name helpers shared by the Discord posts."""
import random

K_WORDS = ["Kumquat", "Kombucha", "Kettlebell", "Karaoke", "Kazoo", "Kiwi", "Ketchup",
           "Kangaroo", "Kale", "Kebab", "Koala", "Kickflip", "Karate", "Kayak", "Keyboard",
           "Kimchi", "Knuckles", "Kilowatt", "Kettlecorn", "Kitten"]
M_WORDS = ["Muffin", "Mongoose", "Meatball", "Moonpie", "Mustache", "Marmalade", "Mudslide",
           "Mixtape", "Minivan", "Moose", "Macaroni", "Mayhem", "Marshmallow", "Mothership",
           "Mango", "Mullet", "Monsoon", "Meerkat", "Microwave", "Meatloaf"]

SUFFIXES = {"jr.", "jr", "sr.", "sr", "ii", "iii", "iv", "v"}
_fake = {}


def is_konata(name):
    n = (name or "").lower()
    return "konata" in n or "mumpfield" in n or "mumfield" in n


def konata():
    """One random K + M name per run, so he's consistent within a post."""
    if "name" not in _fake:
        _fake["name"] = f"{random.choice(K_WORDS)} {random.choice(M_WORDS)}"
    return _fake["name"]


def full(name):
    return konata() if is_konata(name) else name


def short(athlete):
    """Last name for lineup lists (full fake name for Konata)."""
    name = athlete.get("fullName") or athlete.get("displayName") or "?"
    if is_konata(name):
        return konata()
    if athlete.get("lastName"):
        return athlete["lastName"]
    parts = name.split()
    while len(parts) > 1 and parts[-1].lower() in SUFFIXES:
        parts.pop()
    return parts[-1]
