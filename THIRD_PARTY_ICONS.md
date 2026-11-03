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
| **katonai / biztonság** (`military`) | `icon-military` | Lucide Icons | `crosshair.svg` | ISC (Feather MIT) |
| **árvíz / vízállás** (`flood`) | `icon-flood` | UN OCHA Humanitarian Icons | `Flood.svg` | Public Domain / CC0 1.0 |
| **aszály** (`drought`) | `icon-drought` | UN OCHA Humanitarian Icons | `Drought.svg` | Public Domain / CC0 1.0 |
| **járvány / egészség** (`health`) | `icon-health` | UN OCHA Humanitarian Icons | `Epidemic.svg` | Public Domain / CC0 1.0 |
| **sugárzás** (`radiation`) | `icon-radiation` | Lucide Icons | `radiation.svg` | ISC |
| **kiber / hálózat** (`cyber`) | `icon-cyber` | Lucide Icons | `network.svg` | ISC |
| **energia** (`energy`) | `icon-energy` | Lucide Icons | `zap.svg` | ISC |
| **gazdaság / piac** (`economy`) | `icon-economy` | Lucide Icons | `trending-up.svg` | ISC |
| **ellátási lánc / logisztika** (`supply-chain`) | `icon-supply-chain` | Lucide Icons | `boxes.svg` | ISC |
| **szankciók** (`sanctions`) | `icon-sanctions` | Lucide Icons | `ban.svg` | ISC |
| **általános figyelmeztetés** (`general`) | `icon-general` | Lucide Icons | `triangle-alert.svg` | ISC |

---

## 2. Licencszövegek és Forrásmegjelölések

### A. UN OCHA Humanitarian Icons (United Nations Office for the Coordination of Humanitarian Affairs)
- **Hivatalos forrás:** https://github.com/UN-OCHA/humanitarian-icons-archive (v2.0)
- **Licenc:** CC0 1.0 Universal / Public Domain Dedication
- **Kötelező megjelölés:** **Source: OCHA (United Nations Office for the Coordination of Humanitarian Affairs)**
- **Jogi nyilatkozat:** Az OCHA ikonok használata nem jelenti az ENSZ vagy az OCHA hivatalos jóváhagyását vagy jogi állásfoglalását a megjelenített eseményekkel kapcsolatban; tájékoztató és humanitárius célú szimbólumok.

### B. Lucide Icons
- **Hivatalos forrás:** https://github.com/lucide-icons/lucide
- **Licenc:** ISC License

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

*(A Cole Bemis által készített korábbi Feather Project ikonok – mint a crosshair – MIT licenc alá tartoznak, amelynek teljes jogi szövegét a Lucide projekt forráskódja tartalmazza.)*
