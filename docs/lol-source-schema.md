# LoL JSON-forrás — mezőszintű import- és normalizálási szerződés

Dátum: 2026-10-09; teljes forrásfelülvizsgálat: 2026-10-10.
Státusz: mintákkal és a teljes feltöltött ZIP-pel ellenőrzött tervezési szerződés;
a skin/chroma-leképezés elfogadott, az Aatrox-minta forrását a felhasználó
megadta. Nincs implementált validátor, adatbázis-migráció vagy importfutás.

Kapcsolódó tervek: [adatimport](lol-champion-data.md),
[kérdésgenerálás](question-generation.md). Feldolgozott referenciák:
[champions.json](question-generation-input/champions.json) és
[aatrox.json](question-generation-input/aatrox.json). A repóbeli másolatok
szemantikailag változatlan tervezési adatok; a futó alkalmazás nem olvassa őket.
Az új [16.20.1.zip](question-generation-input/16.20.1.zip) 173 hősrészlete,
`champion.json` és `championFull.json` tartalma egyezik egymással és a
korábbi mintákkal. A [teljes ellenőrzési jelentés](question-catalog-draft/publication-checks.md)
rögzíti a jóváhagyott alanyszűréseket és az előállítható kategóriákat.

## 1. A mintákból ellenőrzött tények

- Mindkét fájl fejlécében `type = champion`, `format = standAloneComplex`,
  `version = 16.20.1` szerepel. A formátumnév önmagában nem különbözteti meg
  a listát és a részletes választ.
- A `champions.json.data` 173 hőst tartalmaz. A rekordok saját `version`
  mezője egyezik a fejlécével, minden térképkulcs egyezik a rekord `id` mezőjével,
  és a Riot `key` mezők egyediek.
- Mind a 173 összefoglaló ugyanazt a 20 statmezőt tartalmazza.
- Az Aatrox-részlet közös `id`, `key`, `name`, `title`, `tags`, `partype`
  és `stats` mezői egyeznek a listabeli Aatrox-rekordéval.
- `partype = Mana` 145, `Energy` hat rekordban szerepel. Vannak további
  erőforrásnevek, és Bel'Veth rekordjában üres szöveg is. A partype nem
  szűkíthető kötelezően nem üres mana/energy enumra a forrássémában.
- Aatrox statjai között valódi 0 is szerepel, például `mp` és
  `attackdamageperlevel`. A hiányzó adatot és a nullát külön kezeljük.
- Aatrox Q/W/E/R `maxrank` értéke 5/5/5/3; a numerikus `cooldown`
  tömbök hossza ezekkel egyezik. Első rangon 14/18/9/120 másodperc.
- Az Aatrox-mintában `skins` alatt 41 rekord van. A `parentSkin` alapján
  egy alapkinézet, 12 skin és 28 chroma különíthető el. Ez a minta szerkezeti
  eredménye, nem ellenőrzött állítás a játék teljes aktuális katalógusáról.

A fájlverzió a kapott adatok saját verziójelölése; nem élő latest-lekérés
eredménye. A felhasználó az Aatrox-fájlt a következő végpont közvetlen válaszaként
azonosította: [Data Dragon Aatrox 16.20.1, en_US](https://ddragon.leagueoflegends.com/cdn/16.20.1/data/en_US/champion/Aatrox.json).
A locale nincs külön payloadmezőben: az Aatrox-minta `en_US` nyelvét a megadott
útvonalból rögzítjük. Az élő lekérés ebben a környezetben a hálózati proxy
403-as CONNECT tiltásán elakadt, ezért a feltöltött és az élő válasz egyezését
nem ellenőriztük önállóan.

## 2. Közös fejléc és hőslista

A hálózati JSON bemeneti típusa `unknown`. Az alábbi mezők validálás után
válhatnak a megfelelő forrásmodell részévé. A külső forrásazonosítók és a saját UUID-k
nem cserélhetők fel.

| Útvonal             | Forrástípus és szabály                                                   | Normalizált szerep                                    |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `type`              | Szöveg, az adapter támogatott profiljában `champion`.                    | A forrásprofil ellenőrzése.                           |
| `format`            | Szöveg; a mintákban `standAloneComplex`.                                 | Forrásmetadata; nem list/detail-diszkriminátor.       |
| `version`           | Nem üres szöveg, pontos egyezés az import egyszer feloldott verziójával. | `source_version`.                                     |
| `data`              | Nem üres objektum, hősazonosító → rekord.                                | Letöltendő hősazonosítók és elvárt darabszám.         |
| `data.<id>.version` | Listarekordnál szükséges szöveg, egyezzen a fejléccel.                   | Verzióegyezés ellenőrzése.                            |
| `data.<id>.id`      | Nem üres szöveg, egyezzen a térképkulccsal és a kért hősazonosítóval.    | `lol_champion.source_id`.                             |
| `data.<id>.key`     | Pozitív, biztonságosan egészre alakítható numerikus szöveg.              | Riot `riot_key`; saját sorazonosító továbbra is UUID. |
| `name`, `title`     | Nem üres szöveg.                                                         | Hősnév és hőscím.                                     |
| `partype`           | Szöveg; az üres érték is megőrzendő.                                     | Forrás-erőforrásnév és külön besorolás.               |
| `tags`              | Szövegek listája, érvényes elemek és ismétlődésellenőrzés.               | `lol_champion_tag`.                                   |
| `image.full`        | Nem üres ikonfájlnév, az adapter megengedett fájlnévformájában.          | Ikonmetadata; verzió mellett megőrizve.               |
| `stats`             | A lent felsorolt, véges numerikus mezők objektuma.                       | `lol_champion_stats`.                                 |

Az összefoglaló `info.difficulty` mezője a Riot saját hősnehézségi adata.
Nem a generátor `easy`/`medium`/`hard`/`challenger` profilja.

Az elvárt hősszám mindig a letöltött lista darabszáma, nem a mintában látott 173.
A részletes válaszban a kért egyetlen hősnek kell szerepelnie. Idegen hős,
eltérő Riot key vagy verzió nem kerülhet észrevétlenül az adatkészletbe.
A részletes hősobjektumban nem kötelező saját `version` mező: az Aatrox-mintában
nincs ilyen, a válasz fejlécéből ellenőrizzük a verziót.

## 3. Statmezők és erőforrás-besorolás

| Forrásmező             | Normalizált oszlop        |
| ---------------------- | ------------------------- |
| `hp`                   | `hp`                      |
| `hpperlevel`           | `hp_per_level`            |
| `mp`                   | `mp`                      |
| `mpperlevel`           | `mp_per_level`            |
| `movespeed`            | `move_speed`              |
| `armor`                | `armor`                   |
| `armorperlevel`        | `armor_per_level`         |
| `spellblock`           | `magic_resist`            |
| `spellblockperlevel`   | `magic_resist_per_level`  |
| `attackrange`          | `attack_range`            |
| `hpregen`              | `hp_regen`                |
| `hpregenperlevel`      | `hp_regen_per_level`      |
| `mpregen`              | `mp_regen`                |
| `mpregenperlevel`      | `mp_regen_per_level`      |
| `crit`                 | `crit`                    |
| `critperlevel`         | `crit_per_level`          |
| `attackdamage`         | `attack_damage`           |
| `attackdamageperlevel` | `attack_damage_per_level` |
| `attackspeedperlevel`  | `attack_speed_per_level`  |
| `attackspeed`          | `attack_speed`            |

A forrásmező nem alakítható hallgatólagosan szövegből számmá, és nem lehet
NaN, végtelen, hiányzó vagy null. A valós 0 megmarad. A statok alapértékek és
növekedési paraméterek; tartományukat, egységüket és az adott kérdéshez való
használhatóságukat a metrikaleírás is ellenőrzi. A stattényeket nem javítjuk
ki pusztán játéktudás vagy az elvárt válasz alapján.

Javasolt további mezők a `lol_champion` táblában:

- `resource_name`: a `partype` eredeti szövege, üresen is megőrizve.
- `resource_type`: adapter által képzett `mana`, `energy`, `none`, `other`
  vagy `unknown`. A mintában `Mana` → `mana`, `Energy` → `energy`,
  `None` → `none`, a további ismert nevek → `other`, üres/ismeretlen név → `unknown`.

A besorolás az adatlocale-hoz tartozó ellenőrzött leképezésből készül.
Mana és manaregeneráció kérdésében kizárólag `resource_type = mana` jelölt
szerepelhet. Aatrox `BloodWell` erőforrása és Bel'Veth üres mezője nem mana.
Az üres forrásmező miatt a hős más, érvényes statjait nem kell eldobni.

## 4. Skin/chroma rekordok

| Útvonal a `skins[]` rekordban | Forrástípus                                              | Megjegyzés                                                                         |
| ----------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                          | Nem üres külső azonosító-szöveg.                         | Hősön belül egyedi, változatlanul megőrzendő.                                      |
| `num`                         | Nemnegatív egész.                                        | Hősön belül egyedi forrássorszám.                                                  |
| `name`                        | Nem üres szöveg.                                         | Skin vagy chroma neve.                                                             |
| `chromas`                     | Boolean.                                                 | A mintában chromával rendelkező szülőskinnél true, chromarekordnál false is lehet. |
| `parentSkin`                  | Opcionális, nemnegatív egész; jelenléte esetén nem null. | A szülő rekord `num` értékére hivatkozik.                                          |

Konkrét minta:

| Rekord                  | `num` | `chromas` | `parentSkin` | Elfogadott belső típus          |
| ----------------------- | ----- | --------- | ------------ | ------------------------------- |
| Mecha Aatrox            | 2     | true      | Hiányzik.    | Skin.                           |
| Mecha Aatrox (Obsidian) | 4     | false     | 2            | Chroma, a Mecha Aatrox gyereke. |

Ez bizonyítja, hogy a minta `chromas` mezője nem másolható `is_chroma`-ba.
Az előzetes szóbeli `chroma` mező és a kapott `chromas` forrásmező jelentését
külön kell kezelni. A felhasználó által elfogadott leképezés:

- A `parentSkin` jelenléte képzi az `is_chroma = true` értéket; hiánya false.
- A szülő ugyanazon hős `num` kulcsán keresztül `parent_skin_id` UUID-ra oldódik fel.
- `is_base = true` csak nem chroma rekordnál, `num = 0` esetén.
- Az eredeti boolean külön `source_has_chromas` mezőként megőrizhető.
  Ez forrásállítás, nem a normalizált gyerekszám redundáns helyettesítése.
- `skinsCount`: nem chroma és nem alapkinézet. `chromasCount`: tényleges
  chromarekordok. `chromasCountPerSkin`: validált gyerekek száma.

Két menet szükséges: rekordok gyűjtése, majd szülőfeloldás. A szülő előtti
chroma és a `parentSkin = 0` is kezelhető. Hiányzó/idegen/chroma szülő,
önhivatkozás és ciklus érvénytelen adat. A bool true nem jogosít fel
hiányzó chromarekordok vagy neveik kitalálására.

A forrásboolean és a gyerekek közötti kapcsolat adatminőségi ellenőrzéshez
használható, de a teljes katalógus meglétét önmagában nem bizonyítja.
Az Aatrox-mintában minden hivatkozott szülő megvan, egyik sem chroma,
és mindegyik ilyen szülőnél a boolean true. Minden szülőflag true értékhez
van legalább egy gyerek a mintában. Ettől még a felsorolás tényleges
teljessége külön ellenőrzendő.

A megadott forrás a verziózott Data Dragon-hősrészlet, ezért az MVP-adapter
innen tervezi beszerezni a közös skin/chroma-listát. A felhasználó szerint a
minta közvetlen válasz, nem külön kiegészített adathalmaz. Ezzel a forrásra
vonatkozó kérdés lezárult; az első teljes importnak még ellenőriznie kell,
hogy minden hős payloadja teljesíti ezt a szerződést. Ha egy verzió csak
boolean jelzést ad tényleges chromarekordok nélkül, a darabszámhoz szükséges
kapacitás hiányzik; nem gyártunk rekordot és nem tekintjük a darabszámot nullának.

A teljes ZIP-ben 9207 skin/chroma rekord található: 173 alapkinézet,
1959 skin és 7075 chroma, mindegyik szülőkapcsolat érvényes. 127 szülőnél
false forrásflag mellett is vannak gyerekrekordok; ezekből számolunk, a flag
megmarad metadata. Hat skinnél true mellett nincs gyerek: a skinenkénti
szám ismeretlen, és öt érintett hős teljes chromaszáma sem igazolható.
A felhasználó ezeket kizárta az MVP megfelelő kérdésmetrikáiból, más adataikat
megtartva. A számlálási adapternek alanyonként értéket vagy ismeretlen
állapotot kell képeznie; puszta `COUNT(*)` nem alakíthatja ezeket nullás ténnyé.
A [kizárási szabály](question-catalog-draft/source-eligibility.json) snapshotból
levezetendő, kiadáshoz kötött adat, nem végleges hőstiltás.

## 5. Képességek, cooldown és passzív

| Útvonal                          | Forrástípus és szabály                                               | Normalizált szerep                                      |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `spells`                         | Részletes válaszban a standard profil négy alapképességének listája. | Q/W/E/R slotsorrend, a forrásprofil szerint.            |
| `spells[].id`                    | Nem üres külső azonosító, hősön belül egyedi.                        | `source_spell_id`.                                      |
| `spells[].name`                  | Nem üres szöveg.                                                     | Képességnév és szöveges felismerési nyom.               |
| `spells[].image.full`            | Validált ikonfájlnév.                                                | Ikonmetadata a későbbi képes feladathoz.                |
| `spells[].maxrank`               | Nemnegatív egész.                                                    | Forrás rangmetadata; első ranghoz legalább 1 szükséges. |
| `spells[].cooldown`              | Nem üres lista, véges, nemnegatív számokkal.                         | Numerikus, rangonkénti alap cooldown másodpercben.      |
| `spells[].cooldownBurn`          | Szöveg.                                                              | Megjelenítési szöveg, külön megőrizve.                  |
| `spells[].costBurn`, `rangeBurn` | Szöveg.                                                              | Megjelenítési szöveg; most nem numerikus kérdésalap.    |
| `passive.name`                   | Nem üres szöveg.                                                     | Passzívnév és felismerési nyom.                         |
| `passive.image.full`             | Validált ikonfájlnév.                                                | Passzívikon metadata.                                   |

Az első rang ténye a validált `cooldown[0]`. A mintában:

| Slot | Név              | Első rang | Rangsorozat            |
| ---- | ---------------- | --------- | ---------------------- |
| Q    | The Darkin Blade | 14 s      | 14, 12, 10, 8, 6       |
| W    | Infernal Chains  | 18 s      | 18, 16.5, 15, 13.5, 12 |
| E    | Umbral Dash      | 9 s       | 9, 8, 7, 6, 5          |
| R    | World Ender      | 120 s     | 120, 100, 80           |

Az elfogadott kérdés tárgyak és rúnák nélküli alapértéket használ.
A `cooldownBurn` darabolása nem helyettesíti a numerikus tömb validálását.
Az R első rangja is használható; nem kötjük a hős első szintjéhez.
Az alap slotsorrendet a standard adapterprofil határozza meg, nem a név
vagy a spell ID utolsó betűje. A többformás vagy nem rangolható képességek
számára külön használhatósági feltétel kell.

A teljes ZIP 692 képességének tömbje a saját pozitív rangszámával egyező
hosszúságú; az adapter nem rögzítheti minden képesség rangszámát 5-re/3-ra.
Húsz tömb végig 0. A felhasználó döntése szerint ezek a numerikus
cooldown-kérdésekből kimaradnak külön feldolgozásig; a nyers nulla megmarad,
nem állítjuk róla, hogy bizonyított rang 1 cooldown. A képességnévük
felismerési nyomként használható. A többi 672 képesség pozitív első eleme
képezi az MVP forrásalapját, a forrás szerinti standard Q/W/E/R profilban.

Javasolt további `lol_spell` mezők:

- `max_rank`, `cooldowns_by_rank` JSONB, a numerikus tömb megőrzésére.
- `cooldown_rank_1` nullable `numeric`, csak ellenőrzött rangszerkezetnél.
  A standard esetben a tömb hossza egyezik a pozitív `maxrank` értékkel.
  Rendkívüli rangszerkezetnél a teljes forrás megmarad, a numerikus
  metrika használhatósága külön ellenőrizendő; nem lesz automatikusan 0.

A `cost`, `range`, `effect`, `effectBurn`, `vars`, `datavalues`, `tooltip`
és további képességmezők az eredeti JSONB-ben megmaradnak. A 25000-es range
nem lesz automatikusan játékosoknak állított, bizonyított hatótáv.
A `damage` továbbra is üres objektum; nullás effektlistából nem számítunk
sebzésadatot. A Riot tooltipjeinek HTML-jét és `{{...}}` változóit nem
futtatjuk a saját kérdéssablon-renderelőn, és nem hajtunk végre belőlük kódot.

## 6. Kötelező keresztellenőrzések és verzióhatár

- Fejléc, listarekordok és hősdetail verziója egyezzen a rögzített importverzióval.
- Minden listabeli hősnek pontosan egy, saját azonosítójú részlet készüljön.
  A summary/detail közös identitás- és statmezőinek eltérése nem oldható
  fel hallgatólagos forrásválasztással; jelzett importhiba/újrapróbálás kell.
- Külső champion key, skin ID/num és spell ID ne ismétlődjön a megfelelő hatókörben.
- A szülőkapcsolat ugyanazon hős és készlet nem chroma skinjére mutasson.
- A teljes nyers JSON és forrásmetadata megmarad; a generátor csak a validált
  tényekből olvas. Ismeretlen additív külső mező megőrizhető, nem kell miatta
  minden patchnél megtörni az importot. Kötelező mező típusváltása viszont hiba.
- A saját katalóguskonfiguráció szigorú: ismeretlen mezőt és elírást elutasít.
  Ez külön szabály a külső payload nyers megőrzésétől.
- A normalizáló szerződés változása új `normalization_version`-t jelent.
  Új saját sorok épülnek, a már meccshez rögzített adatkészlet nem változik.

Ellenőrzött: a két feltöltött minta JSON-szintaxisa, verzióegyezése,
hős-/skinazonosítói, Aatrox közös mezői, szülőkapcsolatai és rangtömbjei.
Az új ZIP mind a 173 részletének, összesítőjének és aggregátumának egyezése,
azonosítói, rangtömbjei és szülőkapcsolatai szintén ellenőrizve. Az elfogadott
hat skin-/öt hős-chromakizárás és húsz cooldown-kizárás mellett a kérdésalap
rendelkezésre áll. Nem ellenőrzött: a megadott endpoint aktuális élő válaszával
való egyezés és minden képesség különleges játékmeneti formájának szemantikája.
Az importáló és a tervezett validátorteszt-csomag még nem készült el.
