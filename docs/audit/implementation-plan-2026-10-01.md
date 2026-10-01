# Crucix teljes audit és javítási terv

A felhasználó a teljes kód, az upstream minden PR és issue értékelését, a releváns változtatások beépítését és nagyobb egységenként GitHub-release-t kért magyar és angol changeloggal. A meglévő magyar nyelvet, IODA-adatokat és panelrendezést megőrizzük. A lekért upstream pillanatkép: 104 PR, 50 issue; upstream master `3db7068`, saját kiindulás `ef579d1`.

## Kiadási egységek

1. **2.1.0 – biztonság és üzemeltetés.** HTML- és attribútum-escaping a panelekben, popoverekben és inline JSON-ban; Discord jogosultság; privát Telegram-üzenetek kizárása; localhost alapértelmezés, választható HTTP-hitelesítés; SSE heartbeat/korlát; biztonságos process-indítás; érvényes port és env; reprodukálható, nem root Docker; függőségek és CI. Célzott támadási regressziós tesztek és HTTP-integrációs tesztek.
2. **2.2.0 – adatintegritás és megbízhatóság.** Fetch-időkorlát a teljes body olvasására, garantált cleanup, HTTP 429/Retry-After, méretkorlát; NOAA/OFAC javítás; pontos forrásállapot; hírkoordináták és időbélyegek; korlátos, jelölt OpenSky-fallback; szabályalapú ötletek, LLM-budget/parserek; upstream Gemini-javítás és hasznos kompatibilis provider támogatás. Determinisztikus helyi HTTP-fixture és valódi szolgáltatásokat nem terhelő tesztek.
3. **2.3.0 – kezelhetőség és ellenőrizhetőség.** Interaktív térképrétegek, adatfrissesség és kapcsolati állapot, olvasható üres/hibás állapotok, billentyűzetes és mobil panelrendezés, akadálymentes modal/fókusz, csökkentett mozgás. Asztali/mobil böngészős ellenőrzés; teljes audit- és upstream döntési dokumentum.

## Ellenőrzési feltételek

- Minden feltárt konkrét hiba kapja meg az okát igazoló ellenőrzést; külső szolgáltatás hibáját ne jelentsük sikernek vagy friss adatnak.
- Külső szöveg csak szövegként vagy escaped HTML-ként kerülhet a DOM-ba; link protokoll és attribútum külön védett.
- Nyers PR-t nem futtatunk, nem emelünk át vakon. A #27 és #142 külön statikus ellenőrzést igényel.
- Minden issue saját döntést kap, beleértve a nem kódhiba vagy választható funkció kategóriát. A halasztott funkciókat nem nevezzük kijavítottnak.
- Minden kiadás a saját fork konkrét commitjára mutat; magyar és angol változáslista, teszteredmény és ismert korlát tartozik hozzá.

## Kutatási irány

A [World Monitor](https://github.com/koala73/worldmonitor) közös térképréteg-katalógusa, adatfrissesség-kezelése és helyi AI-támogatása, valamint a [NEXUsint](https://github.com/Kit4Some/NEXUsint) forrásállapot- és korrelációs nézetei hasznos minták. Először a meglévő Crucix-adatok megbízható, kapcsolható és kereshető megjelenítése hoz közvetlen előnyt. A teljes desktop-, tudásgráf- vagy előrejelző alrendszer külön termékdöntés és validálás nélkül nem kerül automatikusan a forkba.
