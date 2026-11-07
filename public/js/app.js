// HC Alcedo – statistiky a docházka (čistý JS, data z data/data.json)
const OUR = 'Alcedo';
const PTS = { W: 3, OTW: 2, OTL: 1, L: 0 };
const OUT_LABEL = { W: 'V', OTW: 'VP', OTL: 'PP', L: 'P' };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dtOf = (date, time) => new Date(`${date}T${time || '00:00'}:00`);
const wday = (d) => d.toLocaleDateString('cs-CZ', { weekday: 'long' });
let showYear = false; // v pohledu „Celkem“ se u dat zobrazuje i rok, aby se ročníky nepletly
const dm = (d) => `${d.getDate()}. ${d.getMonth() + 1}.${showYear ? ` ’${String(d.getFullYear()).slice(2)}` : ''}`;
const dmy = (d) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
const hm = (d) => d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : '–');
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '–');
const pct = (n) => `${Math.round(n * 100)} %`;
const plural = (n, a, b, c) => (n === 1 ? a : n >= 2 && n <= 4 ? b : c);

let DATA;
let seasonIdx = 0;
let M; // model vybrané sezóny
let tab = 'prehled';
let profile = null; // id hráče, jehož profil je otevřený
let profMode = 'game'; // graf vývoje: 'game' | 'cum'
let playerSort = { key: 'b', dir: -1 };
let timer;

// ---------------------------------------------------------------- model
function wrap(m) {
  const isHome = m.home === OUR;
  const side = isHome ? 'home' : 'away';
  const opp = isHome ? m.away : m.home;
  const us = isHome ? m.homeScore : m.awayScore;
  const them = isHome ? m.awayScore : m.homeScore;
  const ot = m.result === 'p' || m.result === 'sn';
  let out = null;
  if (m.played && us != null) out = us > them ? (ot ? 'OTW' : 'W') : ot ? 'OTL' : 'L';
  return {
    m, isHome, side, opp, us, them, ot, out, pts: out ? PTS[out] : null,
    dt: dtOf(m.date, m.time),
    roster: m.rosters[side] || [],
    goalies: m.goalies[side] || [],
    reported: m.played && (m.rosters[side] || []).length > 0,
    // hráči v poli = soupiska bez brankáře (a bez fiktivního hráče)
    nSk: (m.rosters[side] || []).filter((p) => p.pos !== 'B' && !(m.goalies[side] || []).some((x) => x.id === p.id) && !/fiktivn/i.test(p.name)).length,
  };
}

// „Celkem“ = všechny ročníky dohromady: zápasy se spojí, tabulka se sečte po týmech
function combinedSeason() {
  const rows = new Map();
  for (const s of DATA.seasons) {
    for (const r of s.standings.find((t) => t.caption === 'Základní část')?.rows || []) {
      const x = rows.get(r.team) || { team: r.team, full: r.full, gp: 0, w: 0, otw: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      for (const k of ['gp', 'w', 'otw', 'd', 'l', 'gf', 'ga', 'pts']) x[k] += r[k];
      x.full = r.full;
      rows.set(r.team, x);
    }
  }
  const table = [...rows.values()].sort((a, b) => b.pts / (b.gp || 1) - a.pts / (a.gp || 1) || (b.gf - b.ga) - (a.gf - a.ga));
  table.forEach((r, i) => { r.rank = i + 1; });
  return {
    label: 'Celkem',
    matches: DATA.seasons.flatMap((s) => s.matches),
    standings: [{ caption: 'Základní část', rows: table }],
  };
}

function buildModel(idx) {
  const isAll = idx === 'all';
  showYear = isAll;
  const season = isAll ? combinedSeason() : DATA.seasons[idx];
  const table = season.standings.find((t) => t.caption === 'Základní část')?.rows || [];
  const full = {};
  for (const r of table) full[r.team] = r.full;
  const name = (s) => full[s] || s;

  const all = season.matches;
  const ours = all.filter((m) => m.home === OUR || m.away === OUR).map(wrap).sort((a, b) => a.dt - b.dt);
  const played = ours.filter((g) => g.played !== false && g.m.played);
  const reported = played.filter((g) => g.reported);

  // hráči
  const players = new Map();
  const goalieIds = new Set();
  for (const g of reported) for (const gl of g.goalies) goalieIds.add(gl.id);
  for (const g of reported) {
    for (const p of g.roster) {
      if (/fiktivn/i.test(p.name)) continue;
      let e = players.get(p.id);
      if (!e) players.set(p.id, (e = { id: p.id, name: p.name, number: p.number, pos: p.pos, games: new Set(), g: 0, a: 0, pim: 0 }));
      e.games.add(g.m.id);
      e.g += p.g; e.a += p.a; e.pim += p.pim;
      if (p.number) e.number = p.number;
      e.pos = p.pos;
    }
  }
  const list = [...players.values()].map((p) => {
    const n = reported.length;
    const withG = reported.filter((g) => p.games.has(g.m.id));
    const withoutG = reported.filter((g) => !p.games.has(g.m.id));
    const avg = (arr) => (arr.length ? arr.reduce((s, g) => s + g.pts, 0) / arr.length : NaN);
    return {
      ...p, gp: p.games.size, att: n ? p.games.size / n : 0, b: p.g + p.a,
      ppg: p.games.size ? (p.g + p.a) / p.games.size : 0,
      ppgWith: avg(withG), ppgWithout: avg(withoutG), nWithout: withoutG.length,
      isGoalie: goalieIds.has(p.id) || p.pos === 'B',
    };
  });
  const skaters = list.filter((p) => !p.isGoalie);

  // brankáři
  const gk = new Map();
  for (const g of reported) {
    for (const gl of g.goalies) {
      let e = gk.get(gl.id);
      if (!e) gk.set(gl.id, (e = { id: gl.id, name: gl.name, gp: 0, min: 0, ga: 0, so: 0, w: 0, l: 0 }));
      e.gp++; e.min += gl.min; e.ga += gl.ga;
      if (gl.ga === 0 && gl.min >= 55) e.so++;
      if (g.goalies.length === 1) { if (g.out === 'W' || g.out === 'OTW') e.w++; else e.l++; }
    }
  }
  const goalies = [...gk.values()].map((x) => ({ ...x, gaa: x.min ? (x.ga * 60) / x.min : NaN })).sort((a, b) => b.min - a.min);

  // tabulka + pozice
  const standing = table.find((r) => r.team === OUR);
  const isCurrent = idx === 0 || isAll; // další zápas se ukazuje u aktuálního ročníku i u pohledu „Celkem“

  // nadcházející zápasy (oficiální rozpis + ahl.cz)
  let upcoming = [];
  if (isCurrent) {
    const now = Date.now();
    const seen = new Set();
    for (const r of DATA.schedule) {
      if ((r.home !== OUR && r.away !== OUR) || r.score) continue;
      const dt = dtOf(r.date, r.time);
      if (dt.getTime() < now - 2.5 * 3600e3) continue;
      const isHome = r.home === OUR;
      upcoming.push({ dt, isHome, opp: isHome ? r.away : r.home, referee: r.referee, source: 'rozpis' });
      seen.add(`${r.date}|${isHome ? r.away : r.home}`);
    }
    for (const g of ours) {
      if (g.m.played || g.dt.getTime() < now - 2.5 * 3600e3) continue;
      if (seen.has(`${g.m.date}|${g.opp}`)) continue;
      upcoming.push({ dt: g.dt, isHome: g.isHome, opp: g.opp, source: 'ahl', stadium: g.m.stadium });
    }
    upcoming.sort((a, b) => a.dt - b.dt);
  }

  const formOf = (team) => all
    .filter((m) => m.played && (m.home === team || m.away === team))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map((m) => {
      const home = m.home === team;
      const us = home ? m.homeScore : m.awayScore;
      const them = home ? m.awayScore : m.homeScore;
      const ot = m.result === 'p' || m.result === 'sn';
      return us > them ? (ot ? 'OTW' : 'W') : ot ? 'OTL' : 'L';
    });

  const seasonText = isAll ? 'všechny ročníky' : `ročník ${season.label}`;
  return { season, isAll, seasonText, table, name, ours, played, reported, list, skaters, goalies, standing, isCurrent, upcoming, formOf };
}

const rec = (games) => {
  const r = { gp: games.length, W: 0, OTW: 0, OTL: 0, L: 0, gf: 0, ga: 0, pts: 0 };
  for (const g of games) { r[g.out]++; r.gf += g.us; r.ga += g.them; r.pts += g.pts; }
  return r;
};

// ---------------------------------------------------------------- pomocné HTML
const pill = (o) => `<span class="pill ${o || 'none'}" title="${o ? { W: 'Výhra', OTW: 'Výhra v prodloužení / nájezdech', OTL: 'Prohra v prodloužení / nájezdech', L: 'Prohra' }[o] : ''}">${o ? OUT_LABEL[o] : '–'}</span>`;
const form = (arr) => `<span class="form">${arr.map(pill).join('')}</span>`;
const tagHA = (isHome) => `<span class="tag ${isHome ? 'home' : 'away'}">${isHome ? 'doma' : 'venku'}</span>`;
const kpi = (v, l, s = '') => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

function countdown(dt) {
  const diff = dt - Date.now();
  if (diff < -2.5 * 3600e3) return '<span class="cd-today">Už se odehrálo</span>';
  if (diff <= 0) return '<span class="cd-today">Právě se hraje</span>';
  const d = Math.floor(diff / 864e5);
  const h = Math.floor((diff % 864e5) / 36e5);
  const mi = Math.floor((diff % 36e5) / 6e4);
  const sameDay = dt.toDateString() === new Date().toDateString();
  const box = (v, l) => `<div class="cd-box"><b>${v}</b><span>${l}</span></div>`;
  return `${sameDay ? '<span class="cd-today">Dnes hrajeme!</span> ' : ''}<span class="countdown">${d ? box(d, plural(d, 'den', 'dny', 'dní')) : ''}${box(h, plural(h, 'hodina', 'hodiny', 'hodin'))}${box(mi, 'min')}</span>`;
}

// ---------------------------------------------------------------- PŘEHLED
function heroHTML() {
  const n = M.upcoming[0];
  if (!M.isCurrent) return '';
  if (!n) {
    return `<section class="hero"><div class="hero-top"><span class="kicker">Další zápas</span></div>
      <p style="text-align:center;font-family:var(--head-font);font-size:1.4rem;color:var(--blue)">V oficiálním rozpisu zatím není žádný další zápas Alcedu.</p></section>`;
  }
  const opp = M.name(n.opp);
  const trow = M.table.find((r) => r.team === n.opp);
  const oppForm = M.formOf(n.opp).slice(-5);
  const h2h = M.played.filter((g) => g.opp === n.opp);
  const facts = [];
  if (trow) facts.push(`<span class="fact">Soupeř: <b>${trow.rank}. místo</b> · ${trow.pts} b. · skóre ${trow.gf}:${trow.ga}</span>`);
  if (oppForm.length) facts.push(`<span class="fact">Forma soupeře: ${form(oppForm)}</span>`);
  if (h2h.length) {
    facts.push(`<span class="fact">Vzájemné zápasy v sezóně: ${h2h.map((g) => `${pill(g.out)} <b>${g.us}:${g.them}</b> ${g.isHome ? 'doma' : 'venku'}`).join(' · ')}</span>`);
  } else facts.push('<span class="fact">Se soupeřem jsme letos ještě nehráli</span>');
  if (n.referee) facts.push(`<span class="fact">Rozhodčí: <b>${esc(n.referee)}</b></span>`);
  const left = n.isHome ? OUR : opp;
  const right = n.isHome ? opp : OUR;
  const cell = (nm) => `<div class="vs-team ${nm === OUR ? 'us' : 'them'}">${esc(nm === OUR ? 'HC Alcedo' : nm)}<small>${nm === OUR ? 'my' : 'soupeř'}</small></div>`;
  return `<section class="hero" aria-label="Další zápas">
    <div class="hero-top">
      <span class="kicker">Další zápas</span>
      <span class="badge-ha ${n.isHome ? 'home' : 'away'}"><span>${n.isHome ? 'Hrajeme doma' : 'Hrajeme venku'}</span></span>
    </div>
    <div class="versus">${cell(left)}<div class="vs-mid">VS</div>${cell(right)}</div>
    <div class="when">
      <div class="date">${esc(wday(n.dt))} <b>${dmy(n.dt)}</b> · <b>${hm(n.dt)}</b></div>
      <div id="cd" style="margin-top:10px">${countdown(n.dt)}</div>
    </div>
    <div class="hero-facts">${facts.join('')}</div>
  </section>`;
}

function viewPrehled() {
  const r = rec(M.played);
  const st = M.standing;
  const att = M.reported.length ? M.reported.reduce((s, g) => s + g.nSk, 0) / M.reported.length : NaN;
  const tops = [...M.skaters].sort((a, b) => b.b - a.b || b.g - a.g);
  const topG = [...M.skaters].sort((a, b) => b.g - a.g || b.b - a.b);
  const topA = [...M.skaters].sort((a, b) => b.a - a.a || b.g - a.g);
  const nextList = M.upcoming.map((u, i) => `<li class="${i === 0 ? 'next' : ''}">
      <span class="when-s"><b>${esc(wday(u.dt))} ${dm(u.dt)}</b> ${hm(u.dt)}</span>
      ${tagHA(u.isHome)} <span>${u.isHome ? 'Alcedo – ' + esc(M.name(u.opp)) : esc(M.name(u.opp)) + ' – Alcedo'}</span></li>`).join('');
  const attBars = M.played.map((g) => {
    const n = g.reported ? g.nSk : 0;
    return `<div class="col"><div class="b ${g.out || 'none'}" style="height:${Math.max(4, n * 8)}px" title="${esc(g.opp)}: ${n} hráčů v poli, ${g.us}:${g.them}">${n ? `<i>${n}</i>` : ''}</div><span>${dm(g.dt)}</span></div>`;
  }).join('');
  return `
    ${heroHTML()}
    <div class="kpis">
      ${kpi(r.gp, 'Odehráno zápasů', M.played.some((g) => g.m.type !== 'Základní část') ? 'včetně play-off' : 'základní část')}
      ${kpi(`${r.W}–${r.OTW}–${r.OTL}–${r.L}`, 'V – VP – PP – P', r.gp ? `úspěšnost ${pct((r.W + r.OTW) / r.gp)}` : '')}
      ${kpi(`${r.gf}:${r.ga}`, 'Skóre', `${sign(r.gf - r.ga)} · ${f1(r.gf / (r.gp || 1))} : ${f1(r.ga / (r.gp || 1))} / zápas`)}
      ${kpi(st ? `${st.rank}.` : '–', 'Pořadí v lize', st ? `${st.pts} bodů z ${st.gp} zápasů` : '')}
      ${kpi(f1(att), 'Hráčů v poli na zápase', 'průměr bez brankáře')}
    </div>
    <div class="grid cols-2">
      <section class="card"><h2>Forma <small>posledních 5 zápasů, vpravo nejnovější</small></h2>
        <p>${form(M.played.slice(-5).map((g) => g.out))}</p>
        <div class="tbl-wrap"><table><thead><tr><th class="l">Datum</th><th class="l">Zápas</th><th>Výsledek</th></tr></thead><tbody>
          ${[...M.played].reverse().slice(0, 5).map((g) => `<tr class="${g.out === 'W' || g.out === 'OTW' ? '' : ''}"><td class="l">${dm(g.dt)}</td><td class="l">${tagHA(g.isHome)} ${esc(g.opp)}</td><td><b>${g.us}:${g.them}</b> ${pill(g.out)}${g.ot ? ` <span class="muted">${g.m.result === 'sn' ? 'sn' : 'pp'}</span>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
      </section>
      <section class="card"><h2>Nejbližší zápasy <small>oficiální rozpis</small></h2>
        ${nextList ? `<ul class="insights upc">${nextList}</ul>` : '<p class="empty">Žádné další zápasy v rozpisu.</p>'}
        <p class="muted" style="font-size:.8rem;margin:10px 0 0">Rozpis bere z <a href="${DATA.sources.schedule}" target="_blank" rel="noopener">ValMez ligy</a> – tam se zveřejňuje jen pár týdnů dopředu.</p>
      </section>
      <section class="card"><h2>Nejlepší hráči</h2>
        ${M.skaters.length ? `<div class="tbl-wrap"><table><thead><tr><th class="l">Body</th><th>B</th></tr></thead><tbody>
          ${tops.slice(0, 5).map((p) => `<tr><td class="l">${plink(p)}</td><td class="num"><b>${p.b}</b> <span class="muted">(${p.g}+${p.a})</span></td></tr>`).join('')}
        </tbody></table></div>
        <p style="margin:12px 0 0;font-size:.9rem"><b>Střelec:</b> ${esc(topG[0].name)} (${topG[0].g} g) · <b>Nahrávač:</b> ${esc(topA[0].name)} (${topA[0].a} a)</p>` : '<p class="empty">Zatím nejsou zápisy.</p>'}
      </section>
      <section class="card"><h2>Hráči v poli na zápase <small>bez brankáře · barva = výsledek</small></h2>
        <div class="chart">${attBars}</div>
        <div class="legend"><span>${pill('W')} výhra</span><span>${pill('OTW')} výhra pp/sn</span><span>${pill('OTL')} prohra pp/sn</span><span>${pill('L')} prohra</span></div>
      </section>
    </div>`;
}

// ---------------------------------------------------------------- ZÁPASY
function eventsHTML(g) {
  const m = g.m;
  const nameOf = new Map();
  for (const p of [...m.rosters.home, ...m.rosters.away]) nameOf.set(p.id, p.name);
  const nm = (id) => esc(nameOf.get(id) || '?');
  const goals = m.goals.length ? `<ul class="events">${m.goals.map((x) => {
    const ours = x.side === g.side;
    return `<li class="${ours ? 'ours' : 'theirs'}"><span class="t">${esc(x.time)}</span><span class="sc">${esc(x.score)}</span><span>${ours ? '<b>' : ''}${nm(x.scorer)}${ours ? '</b>' : ''}${x.assists.length ? ` <span class="muted">(${x.assists.map(nm).join(', ')})</span>` : ''}</span></li>`;
  }).join('')}</ul>` : '<p class="empty">Branky nejsou v zápise.</p>';
  const pens = m.penalties.length ? `<ul class="events">${m.penalties.map((x) => `<li class="pen ${x.side === g.side ? 'ours' : 'theirs'}"><span class="t">${esc(x.time)}</span><span>${x.side === g.side ? '<b>' : ''}${nm(x.player)}${x.side === g.side ? '</b>' : ''} – ${esc(x.penalty.replace(/\s*-\s*Menší trest/, ' min').replace(/Menší trest/, ''))} <span class="muted">${esc(x.reason)}</span></span></li>`).join('')}</ul>` : '<p class="empty">Žádné tresty.</p>';
  const roster = g.roster.length ? `<div class="tbl-wrap"><table><thead><tr><th class="l">#</th><th class="l">Hráč</th><th>G</th><th>A</th><th>B</th><th>TM</th></tr></thead><tbody>
    ${[...g.roster].sort((a, b) => (b.g + b.a) - (a.g + a.a) || b.g - a.g || a.name.localeCompare(b.name, 'cs')).map((p) => `<tr><td class="l muted">${esc(p.number || '')}</td><td class="l">${plink(p)} ${p.pos === 'B' ? '<span class="muted">(B)</span>' : ''}</td><td>${p.g || ''}</td><td>${p.a || ''}</td><td><b>${p.g + p.a || ''}</b></td><td>${p.pim || ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">Soupiska není v zápise.</p>';
  const gk = g.goalies.length ? `<p style="margin:8px 0 0;font-size:.9rem"><b>Brankář:</b> ${g.goalies.map((x) => `${esc(x.name)} (${x.min} min, ${x.ga} OG)`).join(', ')}</p>` : '';
  return `<div class="two-col"><div><h3>Branky</h3>${goals}<h3>Tresty</h3>${pens}</div><div><h3>Naše soupiska (${g.roster.length})</h3>${roster}${gk}</div></div>
    <p style="margin:12px 0 0;font-size:.85rem"><a href="https://www.ahl.cz/soutez/ahlvm3b/zapas/?zapasid=${m.id}" target="_blank" rel="noopener">Zápis na AHL.cz ↗</a>${m.periods ? ` · třetiny: ${esc(m.periods.join(' | '))}` : ''}</p>`;
}

function viewZapasy() {
  const upc = M.upcoming.map((u, i) => `<div class="match ${i === 0 ? 'next' : ''}"><div class="match-head" style="cursor:default">
      <div class="m-date">${dm(u.dt)}<small>${esc(wday(u.dt))} ${hm(u.dt)}</small></div>
      <div class="m-teams">${tagHA(u.isHome)} ${u.isHome ? `Alcedo – ${esc(M.name(u.opp))}` : `${esc(M.name(u.opp))} – Alcedo`}${i === 0 ? ' <span class="tag home" style="background:var(--red);color:#fff">příští</span>' : ''}</div>
      <div class="m-score muted">–:–</div><span></span></div></div>`).join('');
  const done = [...M.played].reverse().map((g) => `<div class="match" data-id="${g.m.id}">
      <button class="match-head" aria-expanded="false">
        <div class="m-date">${dm(g.dt)}<small>${esc(wday(g.dt))} ${hm(g.dt)}</small></div>
        <div class="m-teams">${tagHA(g.isHome)} ${g.isHome ? 'Alcedo – ' : ''}<span class="${g.isHome ? 'opp' : ''}">${esc(M.name(g.opp))}</span>${g.isHome ? '' : ' – Alcedo'}</div>
        <div class="m-score">${g.us}:${g.them} ${pill(g.out)}${g.ot ? `<span class="muted" style="font-size:.8rem">${g.m.result === 'sn' ? 'sn' : 'pp'}</span>` : ''}${g.m.result === 'kon' ? '<span class="muted" style="font-size:.8rem">kontumace</span>' : ''}</div>
        <span class="chev">▶</span>
      </button>
      <div class="match-body">${g.reported ? eventsHTML(g) : '<p class="empty">K tomuto zápasu zatím není zápis.</p>'}</div></div>`).join('');
  return `${upc ? `<section class="card"><h2>Nadcházející</h2>${upc}</section>` : ''}
    <section class="card"><h2>Odehrané zápasy <small>kliknutím rozbalíš branky, tresty a soupisku</small></h2>${done || '<p class="empty">Zatím žádné odehrané zápasy.</p>'}</section>`;
}

// ---------------------------------------------------------------- DOCHÁZKA
function viewDochazka() {
  const cols = M.played;
  const rep = M.reported;
  if (!rep.length) return '<section class="card"><p class="empty">Zatím nejsou k dispozici zápisy, ze kterých by se dala docházka spočítat.</p></section>';
  const rows = [...M.list].sort((a, b) => b.gp - a.gp || b.b - a.b || a.name.localeCompare(b.name, 'cs'));
  const head = cols.map((g) => `<th class="mcol" title="${esc(g.opp)} ${g.us}:${g.them}">${dm(g.dt)}<small>${g.isHome ? 'doma' : 'venku'}</small><small>${esc(g.opp.slice(0, 7))}</small></th>`).join('');
  const body = rows.map((p) => {
    const cells = cols.map((g) => {
      if (!g.reported) return '<td class="c"><span class="dot unk" title="Zápis chybí">?</span></td>';
      if (!p.games.has(g.m.id)) return '<td class="c"><span class="dot out" title="Nehrál">–</span></td>';
      const r = g.roster.find((x) => x.id === p.id);
      const pts = r ? r.g + r.a : 0;
      return pts ? `<td class="c"><span class="dot pts" title="${r.g} g + ${r.a} a">${pts}</span></td>` : '<td class="c"><span class="dot in" title="Hrál">✓</span></td>';
    }).join('');
    return `<tr><td class="l">${plink(p)} ${p.isGoalie ? '<span class="muted">(B)</span>' : ''}</td>${cells}<td class="num"><b>${p.gp}</b>/${rep.length}</td><td class="num"><span class="bar-track"><span class="bar ${p.att < 0.5 ? 'low' : ''}" style="width:${p.att * 100}%"></span></span>${pct(p.att)}</td></tr>`;
  }).join('');

  // postřehy
  const sizes = rep.map((g) => g.nSk);
  const avg = sizes.reduce((s, n) => s + n, 0) / sizes.length;
  const min = Math.min(...sizes), max = Math.max(...sizes);
  const th = Math.round(avg);
  const big = rep.filter((g) => g.nSk >= th), small = rep.filter((g) => g.nSk < th);
  const ppg = (arr) => arr.reduce((s, g) => s + g.pts, 0) / arr.length;
  const ins = [];
  ins.push(`Na zápasech je průměrně <b>${f1(avg)}</b> hráčů v poli bez brankáře (nejméně <b>${min}</b>, nejvíc <b>${max}</b>).`);
  if (big.length && small.length) {
    const d = ppg(big) - ppg(small);
    ins.push(`Při <b>${th} a více</b> hráčích bereme <b>${f2(ppg(big))}</b> b./zápas (${big.length}×), při méně než ${th} jen <b>${f2(ppg(small))}</b> (${small.length}×) – ${d > 0.2 ? 'plná sestava se zjevně vyplácí.' : d < -0.2 ? 'počet hráčů se v bodech zatím nepromítá.' : 'rozdíl je zatím malý.'}`);
  }
  const always = rows.filter((p) => p.gp === rep.length);
  if (always.length) ins.push(`Dochvilní na <b>100 %</b>: ${always.map((p) => esc(p.name)).join(', ')}.`);
  const away = rows.map((p) => {
    let n = 0;
    for (let i = rep.length - 1; i >= 0 && !p.games.has(rep[i].m.id); i--) n++;
    return { p, n };
  }).filter((x) => x.n >= 2 && x.p.gp > 0).sort((a, b) => b.n - a.n);
  if (away.length) ins.push(`Delší pauza: ${away.slice(0, 5).map((x) => `${esc(x.p.name)} (${x.n} ${plural(x.n, 'zápas', 'zápasy', 'zápasů')} v řadě chybí)`).join(', ')}.`);
  const home = rec(M.played.filter((g) => g.isHome)), road = rec(M.played.filter((g) => !g.isHome));
  if (home.gp && road.gp) ins.push(`Doma: <b>${home.W + home.OTW}</b> výher ze ${home.gp} (${home.gf}:${home.ga}), venku: <b>${road.W + road.OTW}</b> ze ${road.gp} (${road.gf}:${road.ga}).`);
  const missing = cols.length - rep.length;

  return `<section class="card"><h2>Docházka <small>spočítaná ze soupisek v zápisech na AHL.cz</small></h2>
      <p class="note"><b>Jak to funguje:</b> hráč se počítá jako přítomný, pokud je zapsaný v zápisu zápasu. Neměl-li v zápase žádný bod, je u něj ✓, jinak počet bodů (g+a).${missing ? ` U ${missing} ${plural(missing, 'zápasu', 'zápasů', 'zápasů')} zápis chybí (?) a do procent se nezapočítává.` : ''}</p>
      <div class="tbl-wrap"><table class="att"><thead><tr><th class="l">Hráč</th>${head}<th>Zápasů</th><th class="l">Docházka</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="legend"><span><span class="dot in">✓</span> hrál</span><span><span class="dot pts">2</span> hrál a bodoval</span><span><span class="dot out">–</span> nehrál</span><span><span class="dot unk">?</span> chybí zápis</span></div>
    </section>
    <div class="grid cols-2">
      <section class="card"><h2>Postřehy</h2><ul class="insights">${ins.map((t) => `<li>${t}</li>`).join('')}</ul></section>
      <section class="card"><h2>Hráči v poli na zápase <small>bez brankáře · barva = výsledek</small></h2>
        <div class="chart">${cols.map((g) => { const n = g.reported ? g.nSk : 0; return `<div class="col"><div class="b ${g.out || 'none'}" style="height:${Math.max(4, n * 8)}px" title="${esc(g.opp)} ${g.us}:${g.them}">${n ? `<i>${n}</i>` : ''}</div><span>${dm(g.dt)}</span></div>`; }).join('')}</div>
        <div class="legend"><span>${pill('W')} výhra</span><span>${pill('OTW')} výhra pp/sn</span><span>${pill('OTL')} prohra pp/sn</span><span>${pill('L')} prohra</span></div>
      </section>
    </div>`;
}

// ---------------------------------------------------------------- SOUPISKA
const plink = (p, txt) => `<a class="plink" href="#hrac/${p.id}">${esc(txt ?? p.name)}</a>`;
const SK_COLS = [
  ['name', 'Hráč', 'l'], ['gp', 'Z'], ['att', 'Doch.'], ['g', 'G'], ['a', 'A'], ['b', 'B'], ['ppg', 'B/Z'], ['exp', 'Oček. body'], ['pim', 'TM'],
  ['ppgWith', 'Body týmu s ním'], ['ppgWithout', 'bez něj'],
];
function viewSoupiska() {
  if (!M.skaters.length && !M.goalies.length) return '<section class="card"><p class="empty">Zatím nejsou zápisy.</p></section>';
  const { key, dir } = playerSort;
  const cur = DATA.seasons[0].standings.find((s) => s.caption === 'Základní část')?.rows || [];
  // letos stejný rozsah jako loni: délku základní části bereme z minulého ročníku
  const prev = DATA.seasons[1]?.standings.find((s) => s.caption === 'Základní část')?.rows || [];
  const seasonGames = Math.max(0, ...prev.map((r) => r.gp)) || Math.ceil(2.5 * (cur.length - 1));
  const gpNow = cur.find((r) => r.team === OUR)?.gp ?? 0;
  const left = M.isCurrent ? Math.max(M.upcoming.length, seasonGames - gpNow) : 0;
  for (const p of M.skaters) p.exp = Number.isFinite(p.ppg) ? p.ppg * left : NaN;
  const val = (p) => (Number.isFinite(p[key]) ? p[key] : -1e9);
  const rows = [...M.skaters].sort((a, b) => {
    const c = key === 'name' ? a.name.localeCompare(b.name, 'cs') : val(a) - val(b);
    return c * dir || b.b - a.b || a.name.localeCompare(b.name, 'cs');
  });
  const th = SK_COLS.map(([k, t, cls]) => `<th class="sortable ${cls || ''} ${k === key ? 'sorted' + (dir > 0 ? ' asc' : '') : ''}" data-sort="${k}" ${k === 'exp' ? `title="Body za zápas × zbývající zápasy v rozpisu (${left})"` : ''}${k === 'ppgWith' ? 'title="Body za zápas, které tým získal, když hráč hrál"' : ''}${k === 'ppgWithout' ? 'title="Body za zápas, které tým získal, když hráč chyběl"' : ''}>${t}</th>`).join('');
  const body = rows.map((p) => {
    const d = p.ppgWith - p.ppgWithout;
    return `<tr><td class="l"><span class="muted">${esc(p.number || '')}</span> ${plink(p)}</td><td class="num">${p.gp}</td>
      <td class="num"><span class="bar-track"><span class="bar ${p.att < 0.5 ? 'low' : ''}" style="width:${p.att * 100}%"></span></span>${pct(p.att)}</td>
      <td class="num">${p.g}</td><td class="num">${p.a}</td><td class="num"><b>${p.b}</b></td><td class="num">${f2(p.ppg)}</td><td class="num">${f2(p.exp)}</td><td class="num">${p.pim}</td>
      <td class="num">${f2(p.ppgWith)}</td><td class="num">${p.nWithout ? `${f2(p.ppgWithout)} <span class="${d > 0.3 ? 'pos' : d < -0.3 ? 'neg' : 'muted'}" title="rozdíl s ním − bez něj">${Number.isFinite(d) ? sign(+d.toFixed(1)).replace('.', ',') : ''}</span>` : '<span class="muted">–</span>'}</td></tr>`;
  }).join('');
  const gk = M.goalies.length ? `<section class="card"><h2>Brankáři</h2><div class="tbl-wrap"><table><thead><tr><th class="l">Brankář</th><th>Z</th><th>Minut</th><th>OG</th><th>OG/60</th><th>Nuly</th><th>V</th><th>P</th></tr></thead><tbody>
    ${M.goalies.map((x) => `<tr><td class="l">${plink(x)}</td><td>${x.gp}</td><td>${x.min}</td><td>${x.ga}</td><td><b>${f2(x.gaa)}</b></td><td>${x.so}</td><td>${x.w}</td><td>${x.l}</td></tr>`).join('')}
    </tbody></table></div><p class="muted" style="font-size:.8rem;margin:10px 0 0">V/P jsou jen zápasy, kde stál v bráně sám. AHL.cz u zápasů nezapisuje počet zákroků, úspěšnost zásahů tedy nejde spočítat.</p></section>` : '';
  return `<section class="card"><h2>Soupiska – hráči v poli <small>klikni na jméno pro profil, na záhlaví pro řazení</small></h2>
      <div class="tbl-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="muted" style="font-size:.82rem;margin:10px 0 0"><b>Oček. body</b> = body na zápas × počet zbývajících zápasů (${left}). Základní část má stejný rozsah jako loni, tedy ${seasonGames} zápasů na tým. Odehráno ${gpNow}.<br><b>Body týmu s ním / bez něj</b> = průměr bodů do tabulky na zápas (3 / 2 / 1 / 0), když hráč hrál, a když nehrál. Vzorek je malý, bereme to jako orientační.</p></section>${gk}`;
}

// ---------------------------------------------------------------- PROFIL HRÁČE
function profileRows(p) {
  return M.played.map((g) => {
    if (!g.reported) return { g, st: 'unk' };
    const r = g.roster.find((x) => x.id === p.id);
    if (!r) return { g, st: 'out' };
    const gl = g.goalies.find((x) => x.id === p.id);
    return { g, st: 'in', goals: r.g, ast: r.a, pts: r.g + r.a, pim: r.pim, ga: gl ? gl.ga : 0, min: gl ? gl.min : 0 };
  });
}

// sloupcový graf: rozpad bodů podle soupeře (hráč v poli: góly + asistence, brankář: obdržené góly)
function barsByOpp(rows, isG) {
  const by = new Map();
  for (const r of rows) {
    const o = by.get(r.g.opp) || { opp: r.g.opp, apps: 0, g: 0, a: 0, ga: 0 };
    if (r.st === 'in') { o.apps++; o.g += r.goals; o.a += r.ast; o.ga += r.ga; }
    by.set(r.g.opp, o);
  }
  const list = [...by.values()].sort((x, y) => (isG ? y.ga - x.ga : y.g + y.a - (x.g + x.a)) || x.opp.localeCompare(y.opp, 'cs'));
  const val = (o) => (isG ? o.ga : o.g + o.a);
  const max = Math.max(1, ...list.map(val));
  const cols = list.map((o) => {
    const v = val(o);
    const h = v ? Math.round((v / max) * 128) + 8 : 4;
    const tip = isG ? `${o.opp}: ${o.ga} OG v ${o.apps} zápasech` : `${o.opp}: ${o.g} g + ${o.a} a v ${o.apps} zápasech`;
    const inner = !v ? '' : isG ? '<div class="seg ga" style="flex:1"></div>' : `${o.a ? `<div class="seg a" style="flex:${o.a}"></div>` : ''}${o.g ? `<div class="seg g" style="flex:${o.g}"></div>` : ''}`;
    return `<div class="col"><div class="stack ${v ? '' : 'zero'}" style="height:${h}px" title="${esc(tip)}">${v ? `<i>${v}</i>` : ''}${inner}</div><span>${esc(o.opp.slice(0, 9))}</span><span class="sub">${o.apps ? `${o.apps}× hrál` : 'nehrál'}</span></div>`;
  }).join('');
  const legend = isG ? '<span><i class="sw ga"></i> obdržené góly</span>' : '<span><i class="sw g"></i> góly</span><span><i class="sw a"></i> asistence</span>';
  return `<div class="chart tall">${cols}</div><div class="legend">${legend}</div>`;
}

// čárový graf: vývoj v sezóně (za zápas / kumulativně) + klouzavý průměr z posledních 3 odehraných zápasů
function lineChart(rows, mode, isG) {
  const n = rows.length;
  if (n < 2) return '<p class="empty">Na graf je zatím málo zápasů.</p>';
  const W = 680, H = 260, L = 38, R = 16, T = 18, B = 46;
  let cum = 0;
  const played = [];
  const pts = rows.map((r, i) => {
    if (r.st !== 'in') return { i, r, v: mode === 'cum' ? cum : null, raw: null };
    const raw = isG ? r.ga : r.pts;
    cum += raw; played.push(raw);
    const win = played.slice(-3);
    return { i, r, raw, v: mode === 'cum' ? cum : raw, roll: win.reduce((s, x) => s + x, 0) / win.length };
  });
  const maxV = Math.max(2, ...pts.map((p) => p.v ?? 0), ...pts.map((p) => (mode === 'game' ? p.roll ?? 0 : 0)));
  const yMax = Math.ceil(maxV);
  const step = yMax <= 6 ? 1 : yMax <= 12 ? 2 : Math.ceil(yMax / 6);
  const x = (i) => L + (i * (W - L - R)) / (n - 1);
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  let grid = '';
  for (let v = 0; v <= yMax; v += step) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const every = n > 14 ? 3 : n > 9 ? 2 : 1;
  const xl = rows.map((r, i) => (i % every ? '' : `<text class="ax" x="${x(i)}" y="${H - B + 16}" text-anchor="middle">${dm(r.g.dt)}</text><text class="ax sm" x="${x(i)}" y="${H - B + 29}" text-anchor="middle">${esc(r.g.opp.slice(0, 5))}</text>`)).join('');
  // hlavní čára (v režimu „za zápas“ se láme tam, kde hráč chyběl)
  let d = '';
  let pen = false;
  for (const p of pts) {
    if (p.v == null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)} `;
    pen = true;
  }
  const rollPts = mode === 'game' ? pts.filter((p) => p.roll != null) : [];
  const rollD = rollPts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.roll).toFixed(1)}`).join(' ');
  const dots = pts.map((p) => {
    const g = p.r.g;
    const lab = `${dm(g.dt)} ${g.isHome ? 'doma' : 'venku'} ${g.opp} ${g.us}:${g.them}`;
    if (p.r.st === 'unk') return '';
    if (p.r.st === 'out') {
      return mode === 'game' ? `<g class="miss"><title>${esc(lab)} – nehrál</title><text x="${x(p.i)}" y="${y(0) - 6}" text-anchor="middle">×</text></g>` : `<circle class="pt hollow" cx="${x(p.i)}" cy="${y(p.v)}" r="4"><title>${esc(lab)} – nehrál</title></circle>`;
    }
    const detail = isG ? `${p.raw} OG` : `${p.r.goals} g + ${p.r.ast} a = ${p.raw} b.`;
    return `<circle class="pt ${g.out}" cx="${x(p.i)}" cy="${y(p.v)}" r="6"><title>${esc(lab)}: ${detail}${mode === 'cum' ? ` (celkem ${p.v})` : ''}</title></circle>`;
  }).join('');
  const unit = isG ? 'obdržených gólů' : 'bodů';
  return `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Vývoj ${unit} v sezóně">${grid}<line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>${xl}
    <path class="main" d="${d}"/>${rollD ? `<path class="roll" d="${rollD}"/>` : ''}${dots}</svg>
    <div class="legend"><span><i class="sw main"></i> ${mode === 'cum' ? `${unit} celkem` : `${unit} v zápase`}</span>${rollD ? '<span><i class="sw roll"></i> průměr z posledních 3 odehraných (forma)</span>' : ''}<span>${pill('W')}${pill('L')} barva bodu = výsledek týmu</span>${mode === 'game' ? '<span>× nehrál</span>' : ''}</div>`;
}

function viewProfil(id) {
  const p = M.list.find((x) => x.id === id);
  if (!p) return '<section class="card"><p class="empty">Tento hráč v tomto výběru (' + esc(M.seasonText) + ') nehrál. <a href="#soupiska">← Zpět na soupisku</a></p></section>';
  const isG = p.isGoalie;
  const gk = M.goalies.find((x) => x.id === id);
  const rows = profileRows(p);
  const rep = M.reported.length;
  const d = p.ppgWith - p.ppgWithout;
  let kp;
  if (isG) {
    kp = [kpi(`${p.gp}/${rep}`, 'Zápasů', pct(p.att) + ' docházka'), kpi(gk ? gk.min : 0, 'Minut'), kpi(gk ? gk.ga : 0, 'Obdržené góly'), kpi(gk ? f2(gk.gaa) : '–', 'OG / 60 min'), kpi(gk ? gk.so : 0, 'Nuly'), kpi(gk ? `${gk.w}–${gk.l}` : '–', 'Bilance (V–P)', 'jen zápasy, kde stál sám')];
  } else {
    kp = [kpi(`${p.gp}/${rep}`, 'Zápasů', pct(p.att) + ' docházka'), kpi(p.g, 'Góly'), kpi(p.a, 'Asistence'), kpi(p.b, 'Body', `${f2(p.ppg)} na zápas`), kpi(p.pim, 'Trestné minuty'),
      kpi(f2(p.ppgWith), 'Body týmu s ním', p.nWithout ? `bez něj ${f2(p.ppgWithout)} (${sign(+d.toFixed(1)).replace('.', ',')})` : 'chyběl 0×')];
  }
  const best = !isG && p.gp ? rows.filter((r) => r.st === 'in').sort((a, b) => b.pts - a.pts)[0] : null;
  let streak = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].st === 'in'; i--) streak++;
  let absent = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].st === 'out'; i--) absent++;
  const facts = [];
  if (best && best.pts) facts.push(`Nejlepší zápas: <b>${best.pts} b.</b> (${best.goals} g + ${best.ast} a) proti ${esc(best.g.opp)} ${dm(best.g.dt)}`);
  if (streak >= 2) facts.push(`Hraje <b>${streak}</b> zápasů v řadě`);
  if (absent >= 1) facts.push(`Chybí na posledních <b>${absent}</b> ${plural(absent, 'zápase', 'zápasech', 'zápasech')}`);
  const body = [...rows].reverse().map((r) => {
    const g = r.g;
    const cells = r.st === 'in'
      ? (isG ? `<td>${r.min}</td><td><b>${r.ga}</b></td>` : `<td>${r.goals || ''}</td><td>${r.ast || ''}</td><td><b>${r.pts || ''}</b></td><td>${r.pim || ''}</td>`)
      : `<td colspan="${isG ? 2 : 4}" class="muted" style="text-align:center">${r.st === 'out' ? 'nehrál' : 'zápis chybí'}</td>`;
    const dot = r.st === 'in' ? '<span class="dot in">✓</span>' : r.st === 'out' ? '<span class="dot out">–</span>' : '<span class="dot unk">?</span>';
    return `<tr><td class="l">${dm(g.dt)}</td><td class="l">${tagHA(g.isHome)} ${esc(g.opp)}</td><td>${g.us}:${g.them} ${pill(g.out)}</td><td>${dot}</td>${cells}</tr>`;
  }).join('');
  const head = isG ? '<th>Min</th><th>OG</th>' : '<th>G</th><th>A</th><th>B</th><th>TM</th>';
  const unit = isG ? 'obdržených gólů' : 'bodů';
  return `<a class="back" href="#soupiska">← Zpět na soupisku</a>
    <section class="profile-head">
      <div class="puck">${esc(p.number || '–')}</div>
      <div><h2>${esc(p.name)}</h2><p>${isG ? 'Brankář' : { 'O': 'Obránce', 'Ú': 'Útočník', 'O/Ú': 'Obránce i útočník' }[p.pos] || 'Hráč v poli'} · ${esc(M.seasonText)}</p></div>
    </section>
    <div class="kpis">${kp.join('')}</div>
    ${facts.length ? `<p class="facts">${facts.map((f) => `<span class="fact">${f}</span>`).join('')}</p>` : ''}
    <section class="card"><h2>Vývoj v sezóně <small>forma hráče zápas po zápase</small></h2>
      <div class="seg-switch"><button data-mode="game" class="${profMode === 'game' ? 'on' : ''}">Za zápas</button><button data-mode="cum" class="${profMode === 'cum' ? 'on' : ''}">Kumulativně</button></div>
      ${lineChart(rows, profMode, isG)}</section>
    <section class="card"><h2>Rozpad ${isG ? 'gólů' : 'bodů'} podle soupeře</h2>${barsByOpp(rows, isG)}</section>
    <section class="card"><h2>Docházka a zápasy <small>hrál ${p.gp} z ${rep} zápasů</small></h2>
      <div class="tbl-wrap"><table><thead><tr><th class="l">Datum</th><th class="l">Soupeř</th><th>Výsledek</th><th>Hrál</th>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------- TABULKA
function viewTabulka() {
  const t = M.table;
  const st = t.length ? `<div class="tbl-wrap"><table><thead><tr><th class="l">#</th><th class="l">Tým</th><th>Z</th><th>V</th><th>VP</th><th>PP*</th><th>P</th><th>Skóre</th><th>±</th><th>Body</th></tr></thead><tbody>
    ${t.map((r) => `<tr class="${r.team === OUR ? 'us' : ''}"><td class="l">${r.rank}.</td><td class="l">${esc(r.full)}</td><td>${r.gp}</td><td>${r.w}</td><td>${r.otw}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}:${r.ga}</td><td class="${r.gf - r.ga > 0 ? 'pos' : r.gf - r.ga < 0 ? 'neg' : ''}">${sign(r.gf - r.ga)}</td><td><b>${r.pts}</b></td></tr>`).join('')}
    </tbody></table></div><p class="muted" style="font-size:.8rem;margin:10px 0 0">* prohry v prodloužení / na nájezdy (AHL je vede jako „remízy“ a dává za ně bod).</p>` : '<p class="empty">Tabulka není k dispozici.</p>';
  const opps = [...new Set(M.ours.map((g) => g.opp))].sort((a, b) => M.name(a).localeCompare(M.name(b), 'cs'));
  const h2h = opps.map((o) => {
    const gs = M.played.filter((g) => g.opp === o);
    const r = rec(gs);
    const nxt = M.upcoming.find((u) => u.opp === o);
    return `<tr><td class="l">${esc(M.name(o))}</td><td>${gs.length}</td><td>${gs.length ? form(gs.map((g) => g.out)) : '<span class="muted">–</span>'}</td><td>${gs.length ? `${r.gf}:${r.ga}` : '–'}</td><td>${gs.length ? r.pts : '–'}</td><td class="l">${nxt ? `${tagHA(nxt.isHome)} ${dm(nxt.dt)} ${hm(nxt.dt)}` : ''}</td></tr>`;
  }).join('');
  return `<section class="card"><h2>Tabulka – základní část <small>${esc(M.seasonText)}${M.isAll ? ' · sečteno za základní části, řazeno podle bodů na zápas' : ''}</small></h2>${st}</section>
    <section class="card"><h2>Bilance se soupeři</h2><div class="tbl-wrap"><table><thead><tr><th class="l">Soupeř</th><th>Zápasů</th><th>Výsledky</th><th>Skóre</th><th>Body</th><th class="l">Příště</th></tr></thead><tbody>${h2h}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------- render
const VIEWS = { prehled: viewPrehled, zapasy: viewZapasy, dochazka: viewDochazka, soupiska: viewSoupiska, tabulka: viewTabulka };

// adresa: #prehled, #soupiska, #hrac/12345
function route() {
  const h = location.hash.slice(1);
  const pm = h.match(/^hrac\/(\d+)$/);
  profile = pm ? +pm[1] : null;
  tab = pm ? 'soupiska' : VIEWS[h] ? h : 'prehled';
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  clearInterval(timer);
  $('#app').innerHTML = `<div class="view active">${profile != null ? viewProfil(profile) : VIEWS[tab]()}</div>`;
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => { profMode = b.dataset.mode; render(); }));
  $$('.tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  $$('.match-head[aria-expanded]').forEach((h) => h.addEventListener('click', () => {
    const m = h.parentElement;
    const open = m.classList.toggle('open');
    h.setAttribute('aria-expanded', open);
  }));
  $$('th[data-sort]').forEach((h) => h.addEventListener('click', () => {
    const k = h.dataset.sort;
    playerSort = { key: k, dir: playerSort.key === k ? -playerSort.dir : k === 'name' ? 1 : -1 };
    render();
  }));
  const cd = $('#cd');
  if (cd && M.upcoming[0]) timer = setInterval(() => { cd.innerHTML = countdown(M.upcoming[0].dt); }, 30000);
}

function setSeason(i) {
  seasonIdx = i;
  M = buildModel(i);
  render();
}

// ---------------------------------------------------------------- HESLO
// Na webu jsou data zašifrovaná (data.enc.json, AES-GCM, klíč z hesla přes PBKDF2). Lokálně bez hesla je data.json.
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decryptData(enc, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(enc.iv) }, key, unb64(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function askPassword(enc, wrong) {
  return new Promise((resolve) => {
    $('#app').innerHTML = `<section class="card gate"><h2>Zadej heslo</h2>
      <form id="gate-form"><input type="password" id="gate-pw" autocomplete="current-password" placeholder="Heslo" autofocus>
      <button type="submit">Otevřít</button></form>
      <p class="gate-err">${wrong ? 'Špatné heslo, zkus to znovu.' : ''}</p></section>`;
    $('#gate-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pw = $('#gate-pw').value;
      try {
        const data = await decryptData(enc, pw);
        try { localStorage.setItem('alcedo-pw', pw); } catch { /* nic */ }
        resolve(data);
      } catch {
        resolve(await askPassword(enc, true));
      }
    });
  });
}
async function loadData() {
  const v = Date.now();
  const encRes = await fetch(`data/data.enc.json?v=${v}`);
  const looksEnc = encRes.ok && (encRes.headers.get('content-type') || '').includes('json');
  if (looksEnc) {
    const enc = await encRes.json();
    if (enc && enc.ct) {
      let saved = null;
      try { saved = localStorage.getItem('alcedo-pw'); } catch { /* nic */ }
      if (saved) { try { return await decryptData(enc, saved); } catch { try { localStorage.removeItem('alcedo-pw'); } catch { /* nic */ } } }
      return askPassword(enc, false);
    }
  }
  const res = await fetch(`data/data.json?v=${v}`);
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

async function init() {
  try {
    DATA = await loadData();
  } catch (e) {
    $('#app').innerHTML = '<div class="error">Data se nepodařilo načíst. Spusť <code>npm run scrape</code> a otevři aplikaci přes server.</div>';
    return;
  }
  document.body.classList.remove('locked');
  const sel = $('#season');
  sel.innerHTML = DATA.seasons.map((s, i) => `<option value="${i}">${esc(s.label)}</option>`).join('') + '<option value="all">Celkem (všechny ročníky)</option>';
  sel.addEventListener('change', () => setSeason(sel.value === 'all' ? 'all' : +sel.value));
  $$('.tab').forEach((b) => b.addEventListener('click', () => {
    if (location.hash === `#${b.dataset.tab}`) route(); else location.hash = b.dataset.tab;
  }));
  window.addEventListener('hashchange', route);
  const gen = new Date(DATA.generated);
  $('#foot').innerHTML = `Data: <a href="${DATA.sources.league}" target="_blank" rel="noopener">AHL.cz</a> a <a href="${DATA.sources.schedule}" target="_blank" rel="noopener">oficiální rozpis ValMez ligy</a> · naposledy stažena ${dmy(gen)} ${hm(gen)}`;
  seasonIdx = 0;
  M = buildModel(0);
  route();
}
init();
