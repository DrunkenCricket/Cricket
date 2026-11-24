import json, os, urllib.request, urllib.error
T=os.environ["DISCORD_BOT_TOKEN"].strip()
def get(p):
    r=urllib.request.Request("https://discord.com/api/v10"+p, headers={"Authorization":f"Bot {T}","User-Agent":"DiscordBot (x, 1)"})
    try:
        with urllib.request.urlopen(r,timeout=20) as x: return x.status, json.load(x)
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:200]
s,c=get("/applications/1574684181361852416/commands"); print("CMDS",s,[ (x["name"],x.get("contexts"),x.get("integration_types")) for x in c] if s==200 else c)
s,g=get("/users/@me/guilds"); print("GUILDS",s,[(x["id"],x["name"]) for x in g] if s==200 else g)
s,a=get("/applications/@me"); print("APP",s,{k:a.get(k) for k in ("name","interactions_endpoint_url","integration_types_config","install_params","bot_public")} if s==200 else a)
