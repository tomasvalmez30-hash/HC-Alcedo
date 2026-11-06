// HC Alcedo – stahování dat z ahl.cz a oficiálního rozpisu (estranky.cz)
// Spuštění:  node scraper/scrape.mjs
// Výstup:    public/data/data.json
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'data.json');
const CACHE = join(ROOT, 'scraper', '.cache');

const AHL = 'https://www.ahl.cz/';
const LEAGUE = 'soutez/ahlvm3b/';
const OUR_TEAM_ID = 9887;
const OUR_NAME = 'Alcedo';
const OUR_ABBR = 'ALCD';
const SCHEDULE_URL = 'https://valmezliga.estranky.cz/clanky/terminy.html';
// ročníky: id z ahl.cz (souteznirocnikid); první je aktuální
const SEASONS = [
  { id: 1159, label: '2026/27', startYear: 2026 },
  { id: 1010, label: '2025/26', startYear: 2025 },
];
// zkratky týmů v oficiálním rozpisu -> název na ahl.cz (Kat. = Kateřinice, na AHL vedena jako „Kačice“)
const ABBR = {
  'Alcd.': 'Alcedo', 'Pišk.': 'Piškoti', 'Potš.': 'Potštát', 'Rat.': 'Ratiboř',
  'Kelč': 'Kelč', 'Kat.': 'Kačice', 'Por.': 'Poruba', 'Oga.': 'Oga.',
};
const DELAY_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const normName = (s) => s.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'HC-Alcedo-statistiky (soukromá týmová aplikace)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await sleep(DELAY_MS);
      return await res.text();
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      await sleep(1000 * attempt);
    }
  }
}

// ---------- pomocné parsery ----------
function tablesOf(html) {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((m) => {
    const body = m[1];
    const caption = text((body.match(/<caption[^>]*>([\s\S]*?)<\/caption>/) || [, ''])[1]);
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]))
      .filter((cells) => cells.length);
    return { caption, rows };
  });
}
const playerLink = (html) => {
  const m = html.match(/hracid=(\d+)"[^>]*>([^<]+)</);
  return m ? { id: +m[1], name: normName(decode(m[2])) } : null;
};
const allPlayerLinks = (html) => [...html.matchAll(/hracid=(\d+)"[^>]*>([^<]+)</g)]
  .map((m) => ({ id: +m[1], name: normName(decode(m[2])) }));

// ---------- tým a zápas ----------
async function matchHtml(id) {
  const file = join(CACHE, `zapas-${id}.html`);
  try {
    await stat(file);
    return { html: await readFile(file, 'utf8'), cached: true };
  } catch { /* není v cache */ }
  return { html: await get(`${AHL}${LEAGUE}zapas/?zapasid=${id}`), cached: false };
}

function parseMatch(id, html, listInfo) {
  const ogTitle = decode((html.match(/og:title"\s+content="([^"]*)"/) || [, ''])[1]).trim();
  const ogDesc = decode((html.match(/og:description"\s+content="([^"]*)"/) || [, ''])[1]);
  // „AHLVM3B 26/27 | Základní část | Neděle 1. 11. 2026, 15:00 | Valašské Meziříčí“
  const parts = ogDesc.split('|').map((s) => s.trim());
  const dm = (parts[2] || '').match(/(\d+)\.\s*(\d+)\.\s*(\d{4}),\s*(\d+):(\d+)/);
  const date = dm ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
  const time = dm ? `${dm[4].padStart(2, '0')}:${dm[5]}` : null;
  const sm = ogTitle.match(/^(.*?)\s+-\s+(.*?)(?:\s+(\d+):(\d+))?(?:\s+(?:p|sn|kon))?$/);
  const home = listInfo.home || (sm && sm[1].trim());
  const away = listInfo.away || (sm && sm[2].trim());
  const hasScore = sm && sm[3] !== undefined;
  const played = !!hasScore;
  const periods = (text(html).match(/\d+\s*:\s*\d+\s*\((\d+:\d+(?:, \d+:\d+)*)\)/) || [, null])[1];

  const tabs = tablesOf(html);
  const cap = (prefix) => tabs.filter((t) => t.caption.startsWith(prefix));
  const rosters = cap('Hráči - ').map((t) => ({
    team: t.caption.replace('Hráči - ', '').trim(),
    players: t.rows.map((c) => {
      const p = playerLink(c[2]);
      if (!p) return null;
      return {
        id: p.id, name: p.name, number: text(c[0]).replace('-', '') || null, pos: text(c[1]),
        g: +text(c[3]) || 0, a: +text(c[4]) || 0, pim: +text(c[6]) || 0,
      };
    }).filter(Boolean),
  }));
  const goalieTabs = cap('Brankáři - ').map((t) => ({
    team: t.caption.replace('Brankáři - ', '').trim(),
    goalies: t.rows.map((c) => {
      const p = playerLink(c[0]);
      if (!p) return null;
      const num = (s) => +String(text(s)).replace(',', '.') || 0;
      return { id: p.id, name: p.name, min: num(c[1]), ga: num(c[2]), saves: num(c[3]) };
    }).filter(Boolean),
  }));
  const sideOf = (pid) => {
    if (rosters[0]?.players.some((p) => p.id === pid)) return 'home';
    if (rosters[1]?.players.some((p) => p.id === pid)) return 'away';
    return null;
  };
  const goals = (tabs.find((t) => t.caption === 'Branky')?.rows || []).map((c) => {
    const scorer = playerLink(c[2]);
    return {
      time: text(c[1]), scorer: scorer?.id ?? null,
      assists: allPlayerLinks(c[3]).map((p) => p.id),
      type: text(c[4]), score: text(c[5]), side: scorer ? sideOf(scorer.id) : null,
    };
  });
  const penalties = (tabs.find((t) => t.caption === 'Tresty')?.rows || []).map((c) => {
    const p = playerLink(c[2]);
    return { time: text(c[1]), player: p?.id ?? null, side: p ? sideOf(p.id) : null, penalty: text(c[3]), reason: text(c[4]) };
  });

  return {
    id, date, time, type: parts[1] || listInfo.type || null, stadium: parts[3] || listInfo.stadium || null,
    home, away,
    homeScore: played ? +sm[3] : null, awayScore: played ? +sm[4] : null,
    periods: periods ? periods.split(',').map((s) => s.trim()) : null,
    result: listInfo.marker || null, // p = prodloužení, sn = nájezdy, kon = kontumace
    played, hasReport: rosters.some((r) => r.players.length > 0),
    rosters: rosters.length === 2
      ? { home: rosters[0].players, away: rosters[1].players } : { home: [], away: [] },
    goalies: goalieTabs.length === 2
      ? { home: goalieTabs[0].goalies, away: goalieTabs[1].goalies } : { home: [], away: [] },
    goals, penalties,
  };
}

// ---------- seznam zápasů ročníku ----------
async function listSeasonMatches(seasonId) {
  const found = new Map();
  for (const page of ['vysledky', 'rozpis']) {
    const html = await get(`${AHL}${LEAGUE}${page}/?souteznirocnikid=${seasonId}&limit=300`);
    for (const m of html.matchAll(/<tr class="tabulka_radek[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)) {
      const row = m[1];
      const idm = row.match(/zapasid=(\d+)/);
      if (!idm) continue;
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
      const teamLinks = [...row.matchAll(/ucastniksouteznihorocnikuid=(\d+)"[^>]*>([^<]+)</g)];
      const names = teamLinks.map((x) => decode(x[2]).trim());
      const typeCell = row.match(/class="charakter_zapasu[^"]*">([^<]*)</);
      const markerCell = [...row.matchAll(/zapas_vysledek_link[^>]*>([^<]*)</g)].map((x) => decode(x[1]).replace(/^\s*\d+:\d+/, '').trim());
      const lastCell = markerCell[markerCell.length - 1] || '';
      const info = {
        home: names[0], away: names[1], homeId: +teamLinks[0]?.[1], awayId: +teamLinks[1]?.[1],
        type: typeCell ? decode(typeCell[1]).trim() : null,
        stadium: null,
        marker: /^(p|sn|kon)$/.test(lastCell) ? lastCell : null,
      };
      found.set(+idm[1], info);
    }
  }
  return found;
}

// ---------- tabulky ----------
async function scrapeStandings(seasonId, idToShort) {
  const html = await get(`${AHL}${LEAGUE}tabulky/?souteznirocnikid=${seasonId}`);
  return tablesOf(html).filter((t) => t.caption && t.rows.length).map((t) => ({
    caption: t.caption,
    rows: t.rows.filter((c) => c.length >= 9).map((c) => {
      const sc = text(c[7]).match(/(\d+):(\d+)/) || [];
      return {
        rank: parseInt(text(c[0]), 10), full: text(c[1]),
        team: idToShort.get(+(c[1].match(/ucastniksouteznihorocnikuid=(\d+)/) || [])[1]) || text(c[1]),
        gp: +text(c[2]), w: +text(c[3]), otw: +text(c[4]), d: +text(c[5]), l: +text(c[6]),
        gf: +sc[1] || 0, ga: +sc[2] || 0, pts: +text(c[8]),
      };
    }),
  }));
}

// ---------- oficiální rozpis (estranky) ----------
async function scrapeSchedule() {
  const html = await get(SCHEDULE_URL);
  const rows = [];
  const startYear = SEASONS[0].startYear;
  for (const t of tablesOf(html)) {
    for (const cells of t.rows) {
      const c = cells.map((x) => text(x));
      if (c.length < 5 || !/^\d{1,2}\.\d{1,2}$/.test(c[0])) continue;
      const [d, mo] = c[0].split('.').map(Number);
      const home = ABBR[c[3]];
      const away = ABBR[c[4]];
      if (!home || !away) continue; // jen týmy naší ligy
      const year = mo >= 7 ? startYear : startYear + 1;
      const score = c.find((x, i) => i >= 5 && /^\d+:\d+$/.test(x)) || null;
      rows.push({
        date: `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        time: c[2].replace(/^(\d):/, '0$1:'), home, away,
        score, referee: c[5] && c[5] !== '-' ? c[5] : null,
      });
    }
  }
  return rows;
}

// ---------- hlavní běh ----------
async function main() {
  const seasons = [];
  for (const s of SEASONS) {
    const list = await listSeasonMatches(s.id);
    console.log(`Ročník ${s.label}: ${list.size} zápasů`);
    const matches = [];
    for (const [id, info] of list) {
      const { html, cached } = await matchHtml(id);
      const m = parseMatch(id, html, info);
      // starší odehrané zápasy se už nemění -> uložit do cache, příště se nestahují
      const old = m.date && (Date.now() - new Date(m.date).getTime()) / 864e5 > 7;
      if (!cached && old && m.played) {
        await mkdir(CACHE, { recursive: true });
        await writeFile(join(CACHE, `zapas-${id}.html`), html);
      }
      matches.push(m);
    }
    matches.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const idToShort = new Map();
    for (const i of list.values()) { idToShort.set(i.homeId, i.home); idToShort.set(i.awayId, i.away); }
    const standings = await scrapeStandings(s.id, idToShort);
    seasons.push({ ...s, standings, matches });
  }
  const previous = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => null);

  // oficiální rozpis: když se nepodaří stáhnout nebo přečíst, zůstane ten předchozí
  let schedule = [];
  try {
    schedule = await scrapeSchedule();
  } catch (e) {
    console.warn(`VAROVÁNÍ: rozpis z estranek se nepodařilo stáhnout (${e.message}).`);
  }
  if (!schedule.length && previous?.schedule?.length) {
    console.warn('VAROVÁNÍ: z oficiálního rozpisu se nepodařilo přečíst žádný zápas, ponechávám předchozí rozpis.');
    schedule = previous.schedule;
  }
  console.log(`Oficiální rozpis: ${schedule.length} zápasů ligy`);

  const data = {
    generated: new Date().toISOString(),
    team: { id: OUR_TEAM_ID, name: OUR_NAME, abbr: OUR_ABBR },
    sources: { league: AHL + LEAGUE, team: `${AHL}${LEAGUE}ucastnici/?&ucastniksouteznihorocnikuid=${OUR_TEAM_ID}`, schedule: SCHEDULE_URL },
    seasons, schedule,
  };

  // kontrola, aby se při změně webu AHL nepřepsala dobrá data špatnými
  const problems = sanityCheck(data, previous);
  if (problems.length && !process.argv.includes('--force')) {
    console.error('\nCHYBA: stažená data vypadají podezřele, původní data.json ponechávám beze změny:');
    for (const p of problems) console.error(` - ${p}`);
    console.error('Pokud je to v pořádku, spusť znovu s přepínačem --force.');
    process.exit(2);
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data));
  const cur = seasons[0].matches;
  console.log(`Hotovo: ${cur.length} zápasů, z toho ${cur.filter((x) => x.played).length} odehraných, ${cur.filter((x) => x.hasReport).length} se zápisem.`);
}

function sanityCheck(data, prev) {
  const problems = [];
  const cur = data.seasons[0];
  if (!cur.matches.length) problems.push('aktuální ročník nemá žádné zápasy');
  if (cur.matches.some((m) => !m.date || !m.home || !m.away)) problems.push('některé zápasy nemají datum nebo týmy');
  if (!cur.standings.some((t) => t.caption === 'Základní část' && t.rows.some((r) => r.team === OUR_NAME))) problems.push(`v tabulce chybí tým ${OUR_NAME}`);
  if (!cur.matches.some((m) => m.home === OUR_NAME || m.away === OUR_NAME)) problems.push(`v aktuálním ročníku není žádný zápas týmu ${OUR_NAME}`);
  if (prev) {
    data.seasons.forEach((s, i) => {
      const o = prev.seasons?.[i];
      if (!o || o.id !== s.id) return;
      if (s.matches.length < o.matches.length) problems.push(`ročník ${s.label}: zápasů ubylo (${o.matches.length} → ${s.matches.length})`);
      const played = (x) => x.matches.filter((m) => m.played).length;
      if (played(s) < played(o)) problems.push(`ročník ${s.label}: odehraných zápasů ubylo (${played(o)} → ${played(s)})`);
      const reports = (x) => x.matches.filter((m) => m.hasReport).length;
      if (reports(s) < reports(o)) problems.push(`ročník ${s.label}: zápisů ubylo (${reports(o)} → ${reports(s)})`);
    });
  }
  return problems;
}

main().catch((e) => { console.error(e); process.exit(1); });



