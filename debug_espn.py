import json, urllib.request
UA = {"User-Agent": "Mozilla/5.0"}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20) as r:
        return json.load(r)
ros = get("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/14/roster")
ath = [a for g in ros["athletes"] for a in g.get("items", [])]
print("roster count", len(ath))
for a in ath:
    if "thomas" in a.get("fullName","").lower() or a.get("injuries"):
        print("ROSTER", a["id"], a["fullName"], a.get("position",{}).get("abbreviation"), json.dumps(a.get("status")), json.dumps(a.get("injuries")))
inj = get("https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams/14/injuries?limit=100")
print("core injuries count", inj.get("count"))
for it in inj["items"][:60]:
    d = get(it["$ref"].replace("http://", "https://"))
    aid = d.get("athlete", {}).get("$ref", "").split("/athletes/")[-1].split("?")[0]
    print("CORE", aid, d.get("status"), d.get("date"), json.dumps(d.get("type")), (d.get("shortComment") or "")[:90])
