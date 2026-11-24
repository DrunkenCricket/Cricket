"""Kickoff weather for the pick'em polls. Domes say so; outdoor games get the
Open-Meteo forecast for the stadium's city at kickoff (free, no key, up to 16 days out).
Falls back to ESPN's own weather line when the forecast can't be had."""
import json
import urllib.parse
import urllib.request
from datetime import timezone

UA = {"User-Agent": "rams-pickem (github.com/DrunkenCricket/Cricket)"}
VENUES = {}   # event id -> {"indoor", "city", "state", "espn"}; filled by pickem.games()
_geo = {}

STATES = {"AL": "Alabama", "AZ": "Arizona", "CA": "California", "CO": "Colorado", "FL": "Florida", "GA": "Georgia",
          "IL": "Illinois", "IN": "Indiana", "LA": "Louisiana", "MA": "Massachusetts", "MD": "Maryland", "MI": "Michigan",
          "MN": "Minnesota", "MO": "Missouri", "NC": "North Carolina", "NJ": "New Jersey", "NV": "Nevada", "NY": "New York",
          "OH": "Ohio", "PA": "Pennsylvania", "TN": "Tennessee", "TX": "Texas", "WA": "Washington", "WI": "Wisconsin"}


def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
        return json.load(r)


def _coords(city, state):
    key = (city, state)
    if key not in _geo:
        q = urllib.parse.urlencode({"name": city, "count": 10, "language": "en", "format": "json"})
        res = _get(f"https://geocoding-api.open-meteo.com/v1/search?{q}").get("results") or []
        want = STATES.get(state or "", state or "")
        pick = next((r for r in res if want and r.get("admin1") == want), None) or (res[0] if res else None)
        _geo[key] = (pick["latitude"], pick["longitude"]) if pick else None
    return _geo[key]


def _icon(code, rain):
    if code in (71, 73, 75, 77, 85, 86):
        return "❄️"          # snow
    if code in (95, 96, 99):
        return "⛈️"          # thunder
    if code >= 51 or rain >= 50:
        return "\U0001F327️"      # rain
    if code in (45, 48):
        return "\U0001F32B️"      # fog
    if code in (2, 3):
        return "⛅"                # clouds
    return "☀️"              # clear


def line(event_id, kick):
    """Short weather text for a game, or None."""
    v = VENUES.get(event_id) or {}
    # SoFi has a fixed roof even though ESPN lists it as outdoor
    if v.get("indoor") or v.get("city") == "Inglewood":
        return "\U0001F3DF️ Dome"
    try:
        ll = _coords(v.get("city"), v.get("state")) if v.get("city") else None
        if ll:
            day = kick.astimezone(timezone.utc).strftime("%Y-%m-%d")
            q = urllib.parse.urlencode({"latitude": ll[0], "longitude": ll[1], "timezone": "UTC", "start_date": day, "end_date": day,
                                        "hourly": "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
                                        "temperature_unit": "fahrenheit", "wind_speed_unit": "mph"})
            h = _get(f"https://api.open-meteo.com/v1/forecast?{q}")["hourly"]
            i = min(range(len(h["time"])), key=lambda n: abs(int(h["time"][n][11:13]) - kick.astimezone(timezone.utc).hour))
            temp, rain = round(h["temperature_2m"][i]), h["precipitation_probability"][i] or 0
            wind, code = round(h["wind_speed_10m"][i]), h["weather_code"][i] or 0
            parts = [f"{_icon(code, rain)} {temp}°F"]
            if rain >= 20:
                parts.append(f"{rain}% rain")
            if wind >= 12:
                parts.append(f"{wind} mph wind")
            return " · ".join(parts)
    except Exception as e:   # forecast is a nice-to-have; never block the pick'em
        print(f"weather: {e}")
    return v.get("espn")
