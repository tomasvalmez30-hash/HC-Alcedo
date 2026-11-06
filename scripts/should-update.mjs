// Rozhodne, jestli je teď čas stáhnout data z AHL.cz a nasadit web.
// Použití:  node scripts/should-update.mjs <cesta k aktuálnímu data.json> [--always] [--now=2026-11-13T22:30:00Z]
// Výstup:   řádek "run=true|false" (do $GITHUB_OUTPUT) + důvod do logu.
//
// Pravidla (v tomto pořadí):
//  1. nejsou žádná předchozí data nebo --always            -> aktualizovat
//  2. uplynulo 90 min od začátku zápasu Alcedu a data jsou starší než ten okamžik  -> aktualizovat
//  3. zápas Alcedu skončil (>90 min od začátku, max 48 h zpět), ale v datech pořád chybí zápis
//     -> zkoušet znovu každou hodinu, než se zápis na AHL.cz objeví
//  4. data jsou starší než 6 hodin (průběžná aktualizace)   -> aktualizovat
import { readFile, appendFile } from 'node:fs/promises';

const OUR = 'Alcedo';
const AFTER_START_MIN = 90;
const RETRY_EVERY_MIN = 60;
const ROUTINE_HOURS = 6;
const TZ = 'Europe/Prague';

// datum + čas v pražském čase -> okamžik (ms, UTC); funguje i na serveru v UTC a přes změnu času
function pragueMs(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return guess - (asUtc - guess);
}

export function decide(data, now) {
  if (!data) return { run: true, reason: 'žádná předchozí data' };
  const generated = Date.parse(data.generated);
  const ageMin = (now - generated) / 6e4;

  // všechny zápasy Alcedu: z oficiálního rozpisu i z AHL.cz
  const games = [];
  for (const r of data.schedule || []) {
    if (r.home === OUR || r.away === OUR) games.push({ start: pragueMs(r.date, r.time), label: `${r.date} ${r.time}`, hasReport: false, fromSchedule: true });
  }
  for (const m of data.seasons?.[0]?.matches || []) {
    if ((m.home === OUR || m.away === OUR) && m.date) {
      const start = pragueMs(m.date, m.time);
      const dup = games.find((g) => Math.abs(g.start - start) < 12 * 36e5);
      if (dup) { dup.hasReport = dup.hasReport || m.hasReport; dup.fromSchedule = false; } else games.push({ start, label: `${m.date} ${m.time}`, hasReport: m.hasReport });
    }
  }

  for (const g of games) {
    const due = g.start + AFTER_START_MIN * 6e4;
    if (now >= due && generated < due && now - due < 48 * 36e5) {
      return { run: true, reason: `zápas ${g.label} začal před víc než ${AFTER_START_MIN} min a data jsou starší` };
    }
  }
  for (const g of games) {
    const due = g.start + AFTER_START_MIN * 6e4;
    if (now >= due && now - due < 48 * 36e5 && !g.hasReport && ageMin >= RETRY_EVERY_MIN) {
      return { run: true, reason: `u zápasu ${g.label} zatím chybí zápis, zkouším znovu (data stará ${Math.round(ageMin)} min)` };
    }
  }
  if (ageMin >= ROUTINE_HOURS * 60) return { run: true, reason: `průběžná aktualizace (data stará ${Math.round(ageMin / 60)} h)` };
  return { run: false, reason: `není co dělat (data stará ${Math.round(ageMin)} min)` };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const nowArg = args.find((a) => a.startsWith('--now='));
  const now = nowArg ? Date.parse(nowArg.slice(6)) : Date.now();
  let data = null;
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch { /* nic */ }
  const res = args.includes('--always') ? { run: true, reason: 'vynuceno' } : decide(data, now);
  console.log(`${res.run ? 'AKTUALIZOVAT' : 'přeskočit'}: ${res.reason}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `run=${res.run}\n`);
  else console.log(`run=${res.run}`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) main();
