// Rams Bingo: 5x5 cards (free middle) drawn from a pool of ~80 squares. ESPN's live game summary marks them.
// Game squares are fixed; player squares come from that week's Sleeper projections for Rams players.

export const RAMS = "14";
const num = (v) => Number(String(v ?? "").split(/[-/]/)[0]) || 0;
const second = (v) => Number(String(v ?? "").split(/[-/]/)[1]) || 0;
const secs = (clock) => { const [m, s] = String(clock || "0:0").split(":").map(Number); return (m || 0) * 60 + (s || 0); };

/** Everything the squares look at, built once from an ESPN summary. */
export function gameView(sum) {
  const comp = sum.header?.competitions?.[0] || {};
  const st = comp.status?.type || {};
  const ramsC = (comp.competitors || []).find((c) => c.team?.id === RAMS) || {};
  const oppC = (comp.competitors || []).find((c) => c.team?.id !== RAMS) || {};
  const ramsHome = ramsC.homeAway === "home";
  const teamStats = (id) => Object.fromEntries(((sum.boxscore?.teams || []).find((t) => t.team?.id === id)?.statistics || []).map((s) => [s.name, s.displayValue]));
  const drives = [...(sum.drives?.previous || []), ...(sum.drives?.current ? [sum.drives.current] : [])];
  const plays = [];
  for (const d of drives) for (const p of d.plays || []) {
    const off = p.start?.team?.id || d.team?.id;
    plays.push({ type: (p.type?.text || "").toLowerCase(), text: p.text || "", off, rams: off === RAMS, yds: p.statYardage ?? 0,
      q: p.period?.number || 0, left: secs(p.clock?.displayValue), scoring: !!p.scoringPlay, turnover: !!p.isTurnover,
      r: ramsHome ? p.homeScore : p.awayScore, o: ramsHome ? p.awayScore : p.homeScore, driveTeam: d.team?.id });
  }
  const period = comp.status?.period || plays.at(-1)?.q || 0;
  const players = sum.boxscore?.players || [];
  return {
    state: st.state, final: st.state === "post", period, half: st.state === "post" || period >= 3 || /halftime/i.test(st.description || ""),
    rs: Number(ramsC.score) || 0, os: Number(oppC.score) || 0, opp: oppC.team?.abbreviation || "OPP",
    rams: teamStats(RAMS), oppS: teamStats(oppC.team?.id), plays, drives: drives.map((d) => ({ team: d.team?.id, plays: d.offensivePlays || 0, yards: d.yards || 0, score: !!d.isScore, result: d.result || "" })),
    players,
  };
}

// scoring plays with the score change they made
function scores(G) {
  let r = 0, o = 0; const out = [];
  for (const p of G.plays) {
    if (p.r == null || p.o == null) continue;
    if (p.r !== r || p.o !== o) { out.push({ ...p, dr: p.r - r, dO: p.o - o }); r = p.r; o = p.o; }
  }
  return out;
}
const ramsPen = (p) => /PENALTY on (LA|LAR)-/i.test(p.text);
const any = (G, f) => G.plays.some(f);
const count = (G, f) => G.plays.filter(f).length;
const fgYards = (p) => Number((p.text.match(/(\d+) yard field goal/i) || [])[1]) || 0;
const runOrPass = (p) => /rush|pass reception|passing touchdown|rushing touchdown/.test(p.type);
const quarterPts = (G, q) => { const s = scores(G).filter((x) => x.q === q); return { r: s.reduce((a, x) => a + Math.max(0, x.dr), 0), o: s.reduce((a, x) => a + Math.max(0, x.dO), 0) }; };
const qDone = (G, q) => G.final || G.period > q;

export const COMMON = [
  ["fd15", "Rams 15+ first downs", (G) => num(G.rams.firstDowns) >= 15],
  ["fd22", "Rams 22+ first downs", (G) => num(G.rams.firstDowns) >= 22],
  ["yds300", "Rams 300+ total yards", (G) => num(G.rams.totalYards) >= 300],
  ["yds400", "Rams 400+ total yards", (G) => num(G.rams.totalYards) >= 400],
  ["rush100", "Rams 100+ rushing yards", (G) => num(G.rams.rushingYards) >= 100],
  ["pass250", "Rams 250+ passing yards", (G) => num(G.rams.netPassingYards) >= 250],
  ["third5", "Rams convert 5+ third downs", (G) => num(G.rams.thirdDownEff) >= 5],
  ["fourth", "Rams convert a 4th down", (G) => num(G.rams.fourthDownEff) >= 1],
  ["fourthstop", "Rams D gets a 4th-down stop", (G) => second(G.oppS.fourthDownEff) > num(G.oppS.fourthDownEff)],
  ["rz3", "Rams make 3+ red zone trips", (G) => second(G.rams.redZoneAttempts) >= 3],
  ["top", "Rams win time of possession", (G) => G.final && secs(G.rams.possessionTime) > secs(G.oppS.possessionTime)],
  ["tdpass", "Rams touchdown pass", (G) => any(G, (p) => p.rams && /passing touchdown/.test(p.type))],
  ["tdrush", "Rams rushing touchdown", (G) => any(G, (p) => p.rams && /rushing touchdown/.test(p.type))],
  ["td3", "Rams score 3+ touchdowns", (G) => count(G, (p) => p.rams && /touchdown/.test(p.type)) >= 3],
  ["fg", "Rams kick a field goal", (G) => any(G, (p) => p.rams && /field goal good/.test(p.type))],
  ["fg50", "Rams 50+ yard field goal", (G) => any(G, (p) => p.rams && /field goal good/.test(p.type) && fgYards(p) >= 50)],
  ["fgmiss", "Missed or blocked field goal", (G) => any(G, (p) => /field goal missed|blocked field goal/.test(p.type))],
  ["xpmiss", "Missed extra point", (G) => any(G, (p) => /extra point is no good|extra point.*(blocked|missed)/i.test(p.text))],
  ["twopt", "Two-point try", (G) => any(G, (p) => /two-point conversion/i.test(p.text))],
  ["int", "Rams interception", (G) => any(G, (p) => !p.rams && /interception/.test(p.type))],
  ["fumrec", "Rams recover a fumble", (G) => any(G, (p) => !p.rams && /fumble recovery \(opponent\)|fumble return/.test(p.type))],
  ["ofum", `Opponent fumbles`, (G) => any(G, (p) => !p.rams && /fumbles/i.test(p.text))],
  ["sack", "Rams sack", (G) => any(G, (p) => !p.rams && /sack/.test(p.type))],
  ["sack3", "Rams 3+ sacks", (G) => count(G, (p) => !p.rams && /sack/.test(p.type)) >= 3],
  ["take2", "Rams 2+ takeaways", (G) => num(G.oppS.turnovers) >= 2],
  ["noto", "Rams zero turnovers", (G) => G.final && num(G.rams.turnovers) === 0],
  ["deftd", "Rams defense or special teams TD", (G) => scores(G).some((p) => p.dr >= 6 && !p.rams)],
  ["safety", "Safety", (G) => any(G, (p) => /safety/.test(p.type) || /\bSAFETY\b/.test(p.text))],
  ["play40", "Rams 40+ yard play", (G) => any(G, (p) => p.rams && runOrPass(p) && p.yds >= 40)],
  ["td60", "Rams 60+ yard touchdown", (G) => any(G, (p) => p.rams && /touchdown/.test(p.type) && p.yds >= 60)],
  ["run20", "Rams 20+ yard run", (G) => any(G, (p) => p.rams && /rush/.test(p.type) && p.yds >= 20)],
  ["catch30", "Rams 30+ yard catch", (G) => any(G, (p) => p.rams && /pass reception|passing touchdown/.test(p.type) && p.yds >= 30)],
  ["scramble", "Rams QB scramble", (G) => any(G, (p) => p.rams && /scrambles/i.test(p.text))],
  ["kneel", "Rams take a knee to end it", (G) => any(G, (p) => p.rams && p.q >= 4 && /kneels/i.test(p.text))],
  ["first", "Rams score first", (G) => { const s = scores(G)[0]; return !!s && s.dr > 0; }],
  ["opdrive", "Rams score on their first drive", (G) => { const d = G.drives.find((x) => x.team === RAMS); return !!d && d.score; }],
  ["q1", "Rams score in the 1st quarter", (G) => quarterPts(G, 1).r > 0],
  ["half", "Rams lead at halftime", (G) => G.half && (() => { const s = scores(G).filter((x) => x.q <= 2).at(-1); return !!s && s.r > s.o; })()],
  ["pts30", "Rams score 30+ points", (G) => G.rs >= 30],
  ["win", "Rams win", (G) => G.final && G.rs > G.os],
  ["everyq", "Rams score in every quarter", (G) => G.final && [1, 2, 3, 4].every((q) => quarterPts(G, q).r > 0)],
  ["held17", "Opponent held under 17", (G) => G.final && G.os < 17],
  ["shutq", "A scoreless quarter", (G) => [1, 2, 3, 4].some((q) => qDone(G, q) && (() => { const x = quarterPts(G, q); return x.r + x.o === 0; })())],
  ["tie", "Tied up (not 0-0)", (G) => scores(G).some((x) => x.r === x.o && x.r > 0)],
  ["lead", "Lead change", (G) => { let last = 0, n = 0; for (const x of scores(G)) { const s = Math.sign(x.r - x.o); if (s && last && s !== last) n++; if (s) last = s; } return n > 0; }],
  ["down7", "Rams trail by 7+", (G) => scores(G).some((x) => x.o - x.r >= 7)],
  ["pts50", "50+ total points", (G) => G.rs + G.os >= 50],
  ["two1", "Score in the last 2:00 of the half", (G) => scores(G).some((x) => x.q === 2 && x.left <= 120)],
  ["two4", "Score in the last 2:00 of the game", (G) => scores(G).some((x) => x.q === 4 && x.left <= 120)],
  ["ot", "Overtime", (G) => G.period >= 5],
  ["blocked", "Blocked kick", (G) => any(G, (p) => /blocked/i.test(p.text) && /punt|field goal|extra point|kick/i.test(p.text))],
  ["onside", "Onside kick", (G) => any(G, (p) => /onside/i.test(p.text))],
  ["rettd", "Kick or punt return TD", (G) => any(G, (p) => /(kickoff|punt) return touchdown/.test(p.type))],
  ["challenge", "Coach's challenge", (G) => any(G, (p) => /challenged/i.test(p.text))],
  ["reversed", "Call overturned on replay", (G) => any(G, (p) => /REVERSED/.test(p.text))],
  ["dpi", "Defensive pass interference", (G) => any(G, (p) => /defensive pass interference/i.test(p.text))],
  ["rtp", "Roughing the passer", (G) => any(G, (p) => /roughing the passer/i.test(p.text))],
  ["fs", "Rams false start", (G) => any(G, (p) => ramsPen(p) && /false start/i.test(p.text))],
  ["hold", "Rams offensive holding", (G) => any(G, (p) => ramsPen(p) && /offensive holding/i.test(p.text))],
  ["dog", "Delay of game", (G) => any(G, (p) => /delay of game/i.test(p.text))],
  ["unr", "Unnecessary roughness", (G) => any(G, (p) => /unnecessary roughness/i.test(p.text))],
  ["pen8", "Rams 8+ penalties", (G) => num(G.rams.totalPenaltiesYards) >= 8],
  ["penyd", "100+ combined penalty yards", (G) => second(G.rams.totalPenaltiesYards) + second(G.oppS.totalPenaltiesYards) >= 100],
  ["opunt5", "Opponent punts 5+ times", (G) => count(G, (p) => !p.rams && /punt/.test(p.type) && !/return touchdown/.test(p.type)) >= 5],
  ["nopunt", "Rams don't punt in the 1st half", (G) => G.half && !any(G, (p) => p.rams && p.q <= 2 && /punt/.test(p.type))],
  ["3out", "Rams D forces a 3-and-out", (G) => G.drives.some((d) => d.team !== RAMS && d.plays <= 3 && /punt/i.test(d.result))],
  ["drive10", "Rams 10+ play drive", (G) => G.drives.some((d) => d.team === RAMS && d.plays >= 10)],
  ["drive80", "Rams 80+ yard TD drive", (G) => G.drives.some((d) => d.team === RAMS && d.score && d.yards >= 80)],
].map(([id, label, test]) => ({ id, label, test }));

// ---------- player squares (Sleeper projections -> lines; ESPN box score -> results) ----------
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const r5 = (v, step = 5) => Math.max(step, Math.round(v / step) * step);
const KEYS = { pass_yds: ["passing", "passingYards"], pass_td: ["passing", "passingTouchdowns"], rush_yds: ["rushing", "rushingYards"],
  rec_yds: ["receiving", "receivingYards"], rec: ["receiving", "receptions"], rush_td: ["rushing", "rushingTouchdowns"], rec_td: ["receiving", "receivingTouchdowns"] };
function pstat(players, name, stat) {
  const want = norm(name);
  const [cat, key] = KEYS[stat];
  for (const t of players) {
    if (t.team?.id !== RAMS) continue;
    const c = (t.statistics || []).find((s) => s.name === cat);
    if (!c) continue;
    const i = c.keys.indexOf(key);
    const a = (c.athletes || []).find((x) => norm(x.athlete?.displayName) === want);
    if (a) return num(a.stats[i]);
  }
  return 0;
}
/** Build this week's Rams player squares from Sleeper projections (list of {player, position, stats}). */
export function playerSquares(rams) {
  const out = [], name = (p) => `${p.player.first_name} ${p.player.last_name}`, last = (p) => p.player.last_name;
  const top = (pos, key) => rams.filter((p) => pos.includes(p.player.position)).sort((a, b) => (b.stats[key] || 0) - (a.stats[key] || 0));
  const add = (id, label, player, stat, line) => out.push({ id, label, player, stat, line });
  const qb = top(["QB"], "pass_yd")[0];
  if (qb) {
    const l = r5(qb.stats.pass_yd || 240, 25);
    add("qb_y1", `${last(qb)} ${l}+ pass yards`, name(qb), "pass_yds", l);
    add("qb_y2", `${last(qb)} ${l + 50}+ pass yards`, name(qb), "pass_yds", l + 50);
    add("qb_td2", `${last(qb)} 2+ TD passes`, name(qb), "pass_td", 2);
    add("qb_td3", `${last(qb)} 3+ TD passes`, name(qb), "pass_td", 3);
  }
  const rbs = top(["RB"], "rush_yd");
  if (rbs[0]) {
    const l = r5(rbs[0].stats.rush_yd || 60, 10);
    add("rb1_y", `${last(rbs[0])} ${l}+ rush yards`, name(rbs[0]), "rush_yds", l);
    add("rb1_y2", `${last(rbs[0])} ${l + 30}+ rush yards`, name(rbs[0]), "rush_yds", l + 30);
    add("rb1_td", `${last(rbs[0])} scores a TD`, name(rbs[0]), "any_td", 1);
  }
  if (rbs[1]) add("rb2_td", `${last(rbs[1])} scores a TD`, name(rbs[1]), "any_td", 1);
  top(["WR", "TE"], "rec_yd").slice(0, 4).forEach((p, i) => {
    const l = r5(p.stats.rec_yd || 40, 10);
    add("wr" + i + "_y", `${last(p)} ${l}+ receiving yards`, name(p), "rec_yds", l);
    add("wr" + i + "_td", `${last(p)} scores a TD`, name(p), "any_td", 1);
    if (i < 2) add("wr" + i + "_r", `${last(p)} ${Math.max(3, Math.round(p.stats.rec || 4) + 1)}+ catches`, name(p), "rec", Math.max(3, Math.round(p.stats.rec || 4) + 1));
  });
  return out;
}
const playerHit = (G, s) => s.stat === "any_td"
  ? pstat(G.players, s.player, "rush_td") + pstat(G.players, s.player, "rec_td") >= s.line
  : pstat(G.players, s.player, s.stat) >= s.line;

/** Which pool square ids are hit right now. */
export function hitsFor(sum, pool) {
  const G = gameView(sum), out = [];
  const byId = Object.fromEntries(COMMON.map((c) => [c.id, c]));
  for (const s of pool) {
    try { if (s.player ? playerHit(G, s) : byId[s.id]?.test(G)) out.push(s.id); } catch {}
  }
  return { hits: out, state: G.state };
}

export const LINES = [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24], [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]];
/** card: 25 ids with "free" in the middle */
export function bingos(card, hit) {
  const on = (i) => card[i] === "free" || hit.has(card[i]);
  return LINES.filter((l) => l.every(on)).length;
}
