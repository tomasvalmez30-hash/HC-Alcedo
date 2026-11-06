# HC Alcedo – statistiky a docházka

Webová aplikace pro tým HC Alcedo (AHL Valašské Meziříčí, divize 3B). Čistý HTML/CSS/JS bez frameworků, data se stahují skriptem z AHL.cz.

## Použití

```
npm run scrape    # stáhne čerstvá data do public/data/data.json
npm start         # lokální server na http://localhost:5173
```

## Odkud data jsou

- **AHL.cz** – zápasy, zápisy (soupisky, branky, tresty), tabulka. Z toho se počítá docházka i statistiky.
- **Oficiální rozpis** (valmezliga.estranky.cz) – budoucí zápasy a časy, ze kterých se určuje „další zápas“ a to, jestli hrajeme doma, nebo venku. AHL.cz budoucí zápasy Alcedu zatím nezveřejňuje.

Docházka = hráč je zapsaný v zápisu zápasu. Neznamená to tedy omluvenky ani účast, kterou nikdo do zápisu nezapsal.

Zápasy starší než 7 dní se ukládají do `scraper/.cache`, takže se při dalším stahování znovu nestahují.

## Nasazení na Firebase Hosting

```
firebase login
firebase use --add      # vyber projekt
npm run deploy          # stáhne data a nasadí
```

## Automatická aktualizace

Soubor `.github/workflows/update.yml` se spouští každých 30 minut a skript `scripts/should-update.mjs` rozhodne, jestli se mají data stáhnout a web nasadit:

- **90 minut po začátku zápasu Alcedu** podle oficiálního rozpisu (aby byl hotový zápis),
- **opakovaně po hodině**, dokud se k odehranému zápasu zápis na AHL.cz neobjeví (nejdéle 48 hodin),
- jinak **aspoň každých 6 hodin**.

Časy zápasů se počítají v pražském čase, takže to funguje i přes změnu letního a zimního času. GitHub spouští plánované úlohy s malým zpožděním, takže aktualizace může přijít o pár minut později. Kontrolní běhy trvají kolem minuty. V soukromém repozitáři to vychází na zhruba 1 500 minut měsíčně z 2 000 zdarma, ve veřejném je to bez limitu. GitHub navíc plánované úlohy po 60 dnech bez aktivity v repozitáři vypíná, stačí je znovu zapnout.

Nastavení (jednorázově):

1. Nahraj projekt na GitHub do repozitáře s hlavní větví `main`.
2. V repozitáři otevři Settings → Secrets and variables → Actions.
3. Do **Variables** přidej `FIREBASE_PROJECT_ID` (ID Firebase projektu).
4. Do **Secrets** přidej `FIREBASE_SERVICE_ACCOUNT` (JSON klíč servisního účtu). Vygeneruje ho `firebase init hosting:github`, který secret nastaví sám.

Skript při stahování kontroluje, že dat není méně než minule a že jsou v nich naše zápasy. Když ne, skončí chybou, na webu zůstanou původní data a GitHub pošle e-mail. Přepínač `--force` kontrolu obejde (`node scraper/scrape.mjs --force`).

## Když se rozpis změní

Zkratky týmů z oficiálního rozpisu jsou v `scraper/scrape.mjs` v objektu `ABBR`. Přibude-li nový tým, doplň ho tam.
