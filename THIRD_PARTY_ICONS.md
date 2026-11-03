# Harmadik Fél Ikonok és Piktogramok (Third-Party Icons)

Ez a dokumentum a Crucix felületén használt SVG kategória- és figyelmeztető ikonok eredetét, licencét, fájlneveit és ellenőrzési dátumait tartalmazza az offline és külső hálózati kérés nélküli működés garantálására.

- **Sprite fájl:** `dashboard/public/icons.svg`
- **Leképező modul:** `dashboard/public/icons.js`
- **Működési mód:** Helyi SVG-sprite (`<symbol>` definíciók és `<use href="#icon-...">`), külső hálózati kérések nélkül.
- **Utolsó licencellenőrzés dátuma:** 2026-11-03

---

## 1. Kategória és Piktogram Leképezési Jegyzék

| Kategória | Ikon Symbol ID | Forrás Projekt | Eredeti Fájlnév | Licenc |
|---|---|---|---|---|
| **űridőjárás** (`space-weather`) | `icon-space-weather` | Lucide Icons | `sun.svg` | ISC |
| **időjárás / szél** (`weather`) | `icon-weather` | Lucide Icons | `cloud-rain.svg` | ISC |
| **földrengés** (`earthquake`) | `icon-earthquake` | UN OCHA Humanitarian Icons | `Earthquake.svg` | Public Domain / CC0 1.0 |
| **tűz** (`fire`) | `icon-fire` | UN OCHA Humanitarian Icons | `Fire.svg` | Public Domain / CC0 1.0 |
| **baleset / közlekedés** (`transport`) | `icon-transport` | Lucide Icons | `car.svg` | ISC |
| **katonai / biztonság** (`military`) | `icon-military` | Lucide Icons (Feather Project) | `crosshair.svg` | ISC (Feather MIT) |
| **árvíz / vízállás** (`flood`) | `icon-flood` | UN OCHA Humanitarian Icons | `Flood.svg` | Public Domain / CC0 1.0 |
| **aszály** (`drought`) | `icon-drought` | UN OCHA Humanitarian Icons | `Drought.svg` | Public Domain / CC0 1.0 |
| **járvány / egészség** (`health`) | `icon-health` | UN OCHA Humanitarian Icons | `Epidemic.svg` | Public Domain / CC0 1.0 |
| **sugárzás** (`radiation`) | `icon-radiation` | Lucide Icons | `radiation.svg` | ISC |
| **kiber / hálózat** (`cyber`) | `icon-cyber` | Lucide Icons | `network.svg` | ISC |
| **energia** (`energy`) | `icon-energy` | Lucide Icons | `zap.svg` | ISC |
| **gazdaság / piac** (`economy`) | `icon-economy` | Lucide Icons | `trending-up.svg` | ISC |
| **ellátási lánc / logisztika** (`supply-chain`) | `icon-supply-chain` | Lucide Icons | `boxes.svg` | ISC |
| **szankciók** (`sanctions`) | `icon-sanctions` | Lucide Icons | `ban.svg` | ISC |
| **általános figyelmeztetés** (`general`) | `icon-general` | Lucide Icons (Feather Project) | `triangle-alert.svg` (korábban `alert-triangle.svg`) | ISC (Feather MIT) |

---

## 2. Licencszövegek és Forrásmegjelölések

### A. UN OCHA Humanitarian Icons (United Nations Office for the Coordination of Humanitarian Affairs)
- **Hivatalos forrás:** https://github.com/UN-OCHA/humanitarian-icons (kanonikus repó; korábbi v1/v2 archívum: https://github.com/UN-OCHA/humanitarian-icons-archive)
- **Licenc:** CC0 1.0 Universal (Public Domain Dedication)
- **Használati jogok és forrásmegjelölés (a hivatalos README alapján):**
  A repó `README.md` fájlja szerint:
  > "The Humanitarian Icons are in the Public Domain. You are free to:
  > - Copy, modify, and distribute the icons without requesting permission.
  > 
  > While attribution is not required, we would appreciate:
  > - Crediting OCHA where feasible.
  > - Sending a notification to ochavisual@un.org with a link to your webpage or publication, for our records."

- **Megjelölési követelmény pontosítása:** A CC0 1.0 Universal jogi szövege alapján a forrásmegjelölés jogilag **nem kötelező** (a mű közkincs), azonban az OCHA kérésének megfelelően a Crucix projekt felelősségteljesen feltünteti az alkotót. Ajánlott és alkalmazott forrásmegjelölés: **Source: OCHA (United Nations Office for the Coordination of Humanitarian Affairs)**.
- **ENSZ és OCHA jóváhagyási nyilatkozat:** Az OCHA ikonok használata **nem jelenti az ENSZ vagy az OCHA jóváhagyását, támogatását vagy hivatalos jelentését** a megjelenített eseményekkel vagy adatokkal kapcsolatban; tájékoztató és humanitárius célú szimbólumok.
- **Az OCHA kérése:**
  1. Az OCHA megnevezése, ahol megvalósítható (`Source: OCHA (United Nations Office for the Coordination of Humanitarian Affairs)`).
  2. Értesítés küldése az `ochavisual@un.org` e-mail címre a közzétételi oldal/kiadvány linkjével nyilvántartási célból (*Tájékoztató jellegű feljegyzés: privát helyi hálózat / fejlesztési fázis esetén e-mail nem kerül elküldésre*).

#### CC0 1.0 Universal Legal Code (Kivonat és összefoglaló / Waiver Summary)

```text
Creative Commons Legal Code
CC0 1.0 Universal

Statement of Purpose
The laws of most jurisdictions throughout the world automatically confer exclusive Copyright and Related Rights upon the creator and subsequent owner(s) of an original work of authorship and/or a database.
Certain owners wish to permanently relinquish those rights to a Work for the purpose of contributing to a commons of creative, cultural and scientific works that the public can reliably and without fear of later claims of infringement build upon, modify, incorporate in other works, reuse and redistribute as freely as possible in any form whatsoever and for any purposes, including without limitation commercial purposes.

1. Copyright and Related Rights. A Work made available under CC0 may be protected by copyright and related or neighboring rights.
2. Waiver. To the greatest extent permitted by, but not in contravention of, applicable law, Affirmer hereby overtly, fully, permanently, irrevocably and unconditionally waives, abandons, and surrenders all of Affirmer's Copyright and Related Rights and associated claims and causes of action in the Work worldwide for any purpose whatsoever (the "Waiver").
3. Public License Fallback. Should any part of the Waiver for any reason be judged legally invalid or ineffective under applicable law, Affirmer hereby grants to each affected person a royalty-free, non transferable, non sublicensable, non exclusive, irrevocable and unconditional license to exercise Affirmer's Copyright and Related Rights in the Work.
4. Limitations and Disclaimers. No trademark or patent rights held by Affirmer are waived, abandoned, surrendered, licensed or otherwise affected by this document. Affirmer offers the Work as-is and makes no representations or warranties.
```

### B. Lucide Icons és Feather Icons
- **Hivatalos forrás:** https://github.com/lucide-icons/lucide
- **Licenc:** ISC License (a legtöbb ikon), illetve MIT License (a Cole Bemis által készített korábbi Feather ikonokból származtatott szimbólumok).
- **Feather-eredetű ikonok a Crucix projektben:** A Lucide projekt `LICENSE` jegyzéke (amely a korábbi Feather ikonokból átvett szimbólumokat tételesen felsorolja) alapján a Crucix által használt ikonok közül az alábbi kettő Feather-eredetű, és Cole Bemis MIT licence alá tartozik:
  - `icon-military`: `crosshair.svg` (Feather: `crosshair`)
  - `icon-general`: `triangle-alert.svg` (Feather: `alert-triangle`, a Lucide projektben később átnevezve `triangle-alert`-re)
  A többi használt Lucide ikon (`sun.svg`, `cloud-rain.svg`, `car.svg`, `radiation.svg`, `network.svg`, `zap.svg`, `trending-up.svg`, `boxes.svg`, `ban.svg`) a Lucide saját kollekciójának része, az ISC licenc hatálya alatt.

#### 1. Lucide ISC License

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

#### 2. Feather MIT License (Cole Bemis)

A Lucide projekt által átvett Feather ikonok (köztük a `crosshair` / `icon-military`) az alábbi MIT licenc alá tartoznak:

```text
The MIT License (MIT)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
