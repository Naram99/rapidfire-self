# Publikálás előtti katalógusellenőrzés

Dátum: 2026-10-10. A katalógus és a küszöblépések jóváhagyva. Az ellenőrzés
részleges: a stat- és hőscímadatok vizsgálata elkészült, a teljes hősrészlet-készlet
és az alkalmazásbeli generátor hiányzik. Játszható kiadás nem készült.

A [review.json](review.json) öt `pendingBeforePublication` pontjának
eredménye a [publication-checks.json](publication-checks.json) fájlban található.
Az alkalmazás kódja, függőségei és adatbázissémája ebben a szeletben nem változtak.

## 1. Forrásminőség és adathiány

A változatlan referenciák a 16.20.1-es, 173 hősös
[champions.json](../question-generation-input/champions.json) és az
[Aatrox-részlet](../question-generation-input/aatrox.json).
A felhasználó az Aatrox-fájlhoz `en_US` Data Dragon-végpontot adott meg.
Az ellenőrzés feltöltött fájlokon történt; élő Riot-letöltés ebben a
környezetben a hálózati proxy 403-as elutasítása miatt nem érhető el.

Ellenőrizve: egyedi hőskulcsok, egyező verziók, hősönként 20 véges numerikus
stat, valamint az Aatrox-lista és -részlet közös mezőinek egyezése.
145 hős `Mana` erőforrású; mana- és mananövekedési kérdés csak ezekből készül.
Hat hős `Energy`, hat `None`; a többi név külön forrásjelzés.
Bel'Veth üres `partype` értéke `unknown`, ebből nem lesz manaadat;
egyéb érvényes statjai használhatók. Ez nem teljes importer-validálás.

Az Aatrox-részletben:

- 41 közös skin/chroma-rekord: egy alapkinézet, 12 skin és 28 chroma;
- a chromát a `parentSkin` jelenléte jelzi; a szülő az adott hős skinjének
  `num` mezőjére hivatkozik, nem az `id` mezőre;
- minden chroma létező, nem chroma szülőre mutat; nincs önhivatkozás;
- a szülők `chromas` jelzése összhangban van a felsorolt gyerekekkel;
- négy képesség, megfelelő rangszámú numerikus cooldown-tömbbel;
  az első rang értékei Q/W/E/R sorrendben 14/18/9/120 másodperc.

172 hős részletes válasza hiányzik. Emiatt a teljes skin/chroma-felsorolás,
szülőkapcsolatok, cooldown-adatok, képesség- és passzívnév-ütközések még nem
ellenőrizhetők. Egyetlen hős mintája nem igazol teljes készletet vagy
külső forrásból a felsorolás teljességét. A `damage` és a képes családok későbbiek.

## 2. Effektív sávok és használható párok

Az elfogadott katalógus 16 numerikus metrikát tartalmaz: 12 hősstatot,
három skin/chroma-számlálót és egy első rangú cooldown-metrikát.
Kimarad az AD-növekedés, továbbá az öt nem végleges egységű regenerációs/
támadásisebesség-növekedési metrika. A négy megmaradt növekedési stat:
`hpperlevel`, `mpperlevel`, `armorperlevel`, `spellblockperlevel`.

A 12 hősstat 48 metrika/nehézség sorát az összes engedélyezett művelettel
vizsgáltuk, pontos racionális számítással. A teljes eredmény és az egyes
referenciaértékekhez való opciókészlet létezése a
[source-and-coverage.json](source-and-coverage.json) fájlban szerepel.

| Nehézség   | Sáv                               | Teljesíthető metrika/művelet párok | Engedélyezett párok |
| ---------- | --------------------------------- | ---------------------------------- | ------------------- |
| easy       | legalább 30%                      | 29                                 | 36                  |
| medium     | 10–30%                            | 35                                 | 36                  |
| hard       | legfeljebb 10%                    | 51                                 | 60                  |
| challenger | nincs korlát; hat különböző érték | 84                                 | 84                  |

A statcsaládokhoz a jelenlegi sávok megtarthatók, felülírás nélkül.
A 19 nem teljesíthető pár kimarad. Például easy mozgási sebességhez nincs
érvényes művelet; hard armorhoz nincs második legkisebbet kérő hatopciós
halmaz. A `feasibleReferenceCount: 0` kizárt párt jelent, nem nullás statot.
Az egyéb, részletes adatot igénylő metrikák sávjai még ellenőrizendők.

## 3. Ötös csomagok, helyesség és ismétlődés

A referencia a minimum-/maximumkérdéshez tartozó rejtett helyes értékeket
egyetlen promptként számolja. Exact/threshold esetén a látható célérték/
küszöb az azonosság része. Így a kapacitás nem puszta jelöltdarabszám.

| Kategória             | easy | medium | hard | challenger |
| --------------------- | ---- | ------ | ---- | ---------- |
| Base stats at level 1 | 132  | 233    | 241  | 476        |
| Base stat growth      | 64   | 101    | 91   | 1413       |

A táblázat a teljesíthető különböző promptok számát mutatja, mindegyik
legalább öt. A `title:easy` felismerési kategóriának 173 egyedi nyoma van;
nincs több hőshöz tartozó azonos cím.

207 seedet ellenőriztünk: `A`, `a`, `001`, `1`, `Ab1`, `ab1`,
`0123456789`, valamint `Check0`–`Check199`. Seedenként kilenc kategóriaváltozat
ötös csomagja készült: összesen 1863 csomag és 9315 kérdés. Ellenőrizve:

- pontos 4/6 opciószám és különböző alanyok;
- a forrásadatból újraszámított helyes halmaz, egyértelmű single megoldás;
- inkluzív százalékos határok, nulla referencia kihagyása;
- második hely és challenger esetén különböző metrikaértékek;
- szigorú küszöbpredikátum, egyenlő értékű opció kizárása,
  legalább egy helyes és egy hibás válasz;
- öt egyedi prompt kategóriánként, más nehézségen eltérő alanyhalmaz.

Hét határeseti seed ismételt futtatása és a családkérések megfordított
sorrendje azonos eredményt adott. A fordított forrássorrendből képzett
jelöltpool is azonos. Kis-/nagybetű és vezető nullák külön seedet adnak.
Az `Ab1` seed 45 kérdésmintája a
[stat-pack-witnesses.json](stat-pack-witnesses.json) fájlban átnézhető,
a helyesség ellenőrzéséhez forrásértékekkel együtt.

Ez elemzési referencia, nem a leendő TS-generátor kimenete vagy minden
lehetséges seedre vonatkozó sikerességi bizonyítás. A további 18 tervezett
kategóriaváltozat teljes forrás híján még nem vizsgált.

## 4. Véges keret, súlyok és PRNG-vektorok

Az elemzési referencia stabil kulcs szerint rendezett, teljesíthető
metrika/művelet/referencia indexből dolgozott. Minden slotban:

1. Egyenletes választás a még használható metrikák közül.
2. Egyenletes választás a metrika még használható műveletei közül.
3. Egyenletes választás a művelet még használható referenciaértékei közül.
4. Érvényes opciók közvetlen képzése a szűrt értékcsoportokból;
   különböző értékeknél előbb érték, utána annak egy hőse sorsolódik.
5. Legfeljebb 128 opcióhalmaz-próba ugyanazon prompt korábbi nehézségbeli
   alanyhalmazának elkerülésére. A mért maximum egy próba volt.

Ezek technikai ajánlások, nem felhasználói termékszabályok vagy globálisan
egyenletes kérdéseloszlás állítása. A sok lehetséges küszöb így nem súlyozza
túl automatikusan saját metrikáját. A referencia indexválasztásánál
legfeljebb 256 rejection-lépés van; kimerülés hiba, nincs torz modulo-fallback.
A kanonikus easy/medium/hard/challenger családterv sorrendje rögzített,
a slot- és opciósorrend-stream különálló. A célirányos indexképzés és a
teljes készleten mért költség még a natív generátor feladata.

A [prng-test-vectors.json](prng-test-vectors.json) tartalmazza a
`xoshiro128**`, SHA-256 seed-/streamleképezés, little-endian állapotképzés
és mind-nullás állapot kezelésének vektorait. Négy nyers állapot 64 kimenete
és hét seedelt stream 112 kimenete egyezett a külön megírt Python- és
Node 24.19.0 referenciában. Ellenőriztük az `n = 1`, `3`, `2³¹ + 1`, `2³²`
indexhatárokat, érvénytelen listaméreteket, elutasítás utáni újrahúzást és
a próbakeret kimerülését. A Fisher–Yates vektora, ismételhetősége, valamint
az üres/egyelemű listák kezelése is ellenőrzött.

A javasolt algoritmusnak most már vannak ellenőrzött vektorai. Az alkalmazás
natív TS-generátora, fordítója és kiadásmanifestje még nem készült el;
a referencia kereteit és vektorait abban is ellenőrizni kell.

## 5. Immutable kiadás és hash-határ

A jelentés valódi SHA-256 hash-t tartalmaz a katalógus, a szövegek és a
listából képzett részleges tényfixture kanonikus JSON-járól. A referencia
kulcsrendezett, whitespace nélküli UTF-8 JSON-t használ; a tények decimális
statjai pontos szövegként szerepelnek. Objektumkulcs-sorrend változása nem
módosította a hash-t; lépték- vagy szövegváltozás módosította.
A tömbsorrend tartalmi adat, nem rendezhető át általánosan.

A `fixtureReleaseContentHash` előállítása csak a részleges referenciához:
`SHA-256(canonical({ scope: "partial-source-reference-audit-v1", catalog,
texts, sourceFacts }))`; az utolsó három mező az egyes referenciahash-eket
tartalmazza. Ez nem valódi normalizált dataset vagy publikálható release hash-e.
Minden mintafájlban `productionRelease: false` szerepel.

A fizikai kiadáshoz még kell a teljes normalizált adatkészlet, verziózott
normalizáló, katalógusfordító, generátor, keresési/sorsolási/sorrendezési
manifest, használható kategóriák és tényleges tárolási integráció.
A részleges forrásból nem készítünk publikált DB-kiadást vagy lobbyverziót.

## A lezáráshoz szükséges feltöltés

Egy ZIP-ben az azonos patchhez tartozó `champions.json` összesítő és
minden benne szereplő hős részletes `champion/<ChampionId>.json` válasza,
`en_US` locale-lal. A 16.20.1 illeszkedik a mostani mintákhoz; más patch is
ellenőrizhető, de az összesítő és minden részlet abból származzon.
Képek nem szükségesek. Egyetlen összevont, hősazonosítóval kulcsolt teljes
részletfájl is megfelelő, ha megmaradnak a verzió- és forrásadatok.

Ezekkel lezárható a forráslefedettség és a többi család referenciavizsgálata.
A későbbi implementáció és tényleges release-publikálás külön munkafázis.
