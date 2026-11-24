// Runs every minute. GitHub's own schedules often start 5-15 minutes late, so this
// starts the GitHub jobs at the exact minute instead. The GitHub schedules stay on as a
// backup; the scripts skip anything already done, so a double start is harmless.
//
//   Monday 11:00 PM PT   pick'em: log last week's picks
//   Tuesday 12:00 PM PT  pick'em: scorecard, then the new week a minute later
//   Kickoff - 60 min     game day lineup

const REPO = "DrunkenCricket/Cricket";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=";

function pacific(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles", weekday: "short", hour: "2-digit", minute: "2-digit",
      year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { weekday: parts.weekday, hour: +parts.hour, minute: +parts.minute,
           ymd: `${parts.year}${parts.month}${parts.day}` };
}

async function dispatch(env, workflow) {
  if (!env.GH_DISPATCH_TOKEN) {
    console.log(`No GH_DISPATCH_TOKEN; skipping ${workflow} (GitHub's own schedule will run it)`);
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "rams-bot-worker",
    },
    body: JSON.stringify({ ref: "main", inputs: { scheduled: "true" } }),
  });
  console.log(`Started ${workflow}: ${res.status}`);
}

async function ramsKickoff(pt) {
  // Today's (Pacific) scoreboard, cached at the edge for 10 minutes.
  const res = await fetch(ESPN + pt.ymd, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!res.ok) return null;
  const data = await res.json();
  for (const ev of data.events || []) {
    const teams = ev.competitions?.[0]?.competitors || [];
    if (teams.some((c) => c.team?.abbreviation === "LAR")) return new Date(ev.date);
  }
  return null;
}

export async function runTimer(now, env) {
  const pt = pacific(now);
  if (pt.minute === 0 && ((pt.weekday === "Mon" && pt.hour === 23) || (pt.weekday === "Tue" && pt.hour === 12))) {
    await dispatch(env, "pickem.yml");
  }
  // Ram game: award pick points and settle prop bets (every 2 minutes).
  if (pt.minute % 2 === 0 && env.GAME) {
    try { await env.GAME.get(env.GAME.idFromName("main")).tick(); } catch (e) { console.log("game tick", e); }
  }
  const kick = await ramsKickoff(pt);
  if (kick) {
    const minutesOut = Math.round((kick - now) / 60000);
    if (minutesOut === 60) await dispatch(env, "gameday.yml");
  }
}
