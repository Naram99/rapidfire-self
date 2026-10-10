# Publikálás előtti katalógusellenőrzés

Dátum: 2026-10-10. A katalógus, küszöblépések és az adathibákhoz tartozó
MVP-kizárások jóváhagyva. A teljes feltöltött forrás és az elemzési
referenciacsomagok ellenőrzése elkészült. Alkalmazásgenerátor, migráció,
importfutás és játszható kiadás még nem készült.

A [review.json](review.json) öt `pendingBeforePublication` pontjának aktuális
állapotát a [publication-checks.json](publication-checks.json) tartalmazza.
Az alkalmazás kódja, függőségei és adatbázissémája ebben a szeletben nem változtak.

## 1. Teljes forrás, egyezés és elfogadott kizárások

A [16.20.1.zip](../question-generation-input/16.20.1.zip) a felhasználó által
feltöltött eredeti archívum, változtatás nélkül. 175 JSON-t tartalmaz:
173 külön hősrészletet, `champion.json` összesítőt és `championFull.json`
aggregátumot. A részletek mind egyeznek az aggregátum megfelelő rekordjával;
az összesítő közös mezői is mind egyeznek. A korábbi
[champions.json](../question-generation-input/champions.json) és
[Aatrox-részlet](../question-generation-input/aatrox.json) szemantikailag
azonos a ZIP megfelelő tartalmával, és változatlanul megmarad.

A [full-source-inventory.json](full-source-inventory.json) rögzíti az archívum
és minden fájl pontos méretét, SHA-256 hash-ét és rekordszámát.
Ellenőrizve: egyező `16.20.1` verziók, egyedi hőskulcsok, az aggregátum
`keys` leképezése, duplikált JSON-kulcsok hiánya, hősönként 20 véges
numerikus stat, egyedi skin- és képességazonosítók. Az ellenőrzés feltöltött
adatokon történt; a forrás élő eredetét vagy a játék minden különleges
mechanikáját nem igazolja függetlenül.

A forrásban 145 mana-hős szerepel. Mana és mananövekedés csak ezekből
készül; Bel'Veth üres `partype` értéke `unknown`, egyéb statjai használhatók.
A regeneráció és támadásisebesség-növekedés nem végleges egységű metrikái
kimaradnak az MVP-ből; nyers adataik továbbra is megmaradnak.

### Skin/chroma-adatok

9207 rekord található: 173 alapkinézet, 1959 skin és 7075 chroma.
Minden hősnek egy alapkinézete van; mind a 9207 skin ID egyedi.
Minden `parentSkin` létező, ugyanazon hőshöz tartozó, nem chroma rekord
`num` mezőjére mutat. Nincs önhivatkozás vagy chromából képzett szülő.

A `parentSkin` jelenléte jelenti a chromát. A `chromas` forrásboolean
127 szülőnél false, miközben vannak gyerekrekordok; ezek validált
kapcsolatai alapján számolunk, az eltérő boolean csak megőrzött metadata.
Hat szülőnél true jelzés mellett nincs gyerekrekord. Ezek száma
**ismeretlen**, és a felhasználó döntése szerint az MVP-ben kizárt:

| Hős       | Skin                                    | `num` |
| --------- | --------------------------------------- | ----- |
| Ahri      | After Hours Spirit Blossom Springs Ahri | 89    |
| Akali     | Prestige Coven Akali                    | 71    |
| Diana     | Eclipse Eternal Aspect Diana            | 77    |
| Jhin      | Dark Cosmic Erasure Jhin                | 37    |
| Master Yi | Prestige Spirit Blossom Master Yi       | 53    |
| Master Yi | PROJECT: Command Line Yi                | 116   |

A hat skin a skinenkénti chromaszámlálásból kimarad. Az öt érintett hős
teljes chromaösszesítése sem igazolható, ezért abból is kimaradnak; skinjeik
száma, statjaik és névfelismerési adataik használhatók. Így 168 hős
chromaösszesítése és 2126 nem chroma szülőrekord használható. Az utóbbi
az alapkinézeteket is tartalmazza az elfogadott katalógusszűrés szerint;
a külön skinszám viszont kizárja az alapkinézetet és a chromákat.
A valóban nulla, ellenőrizhető gyerekszám 0 marad; a hat bizonytalan eset nem lesz 0.

### Cooldown és névfelismerés

692 Q/W/E/R képesség van. Mindegyik numerikus cooldown-tömbjének hossza
egyezik a pozitív `maxrank` értékkel; a forrás 1/3/4/5/6 rangú tömböket
is tartalmaz. A slotsorrendet az adapterprofil adja, nem az ID utolsó betűje.
Húsz képesség tömbje végig 0. A felhasználó döntése szerint ezek
cooldown-kérdéshez nem használhatók külön feldolgozásig; a nyers 0
megmarad, a képességnév-felismerésben továbbra is szerepelhetnek.
Így 672 pozitív rang 1 cooldown marad, 61 különböző értékkel, 0,25–200 másodperc között.

692 egyedi képességnév, 173 egyedi passzívnév és 173 egyedi hőscím van;
egyetlen nyom sem tartozik több hőshöz az adott családon belül.
A részletes eltérések a [source-anomalies.json](source-anomalies.json), az
elfogadott, importált snapshotból levezetendő szűrés a
[source-eligibility.json](source-eligibility.json) fájlban szerepel.
Ezek kiadáshoz tartozó tartalmi szabályok, nem örök hős-/skin-tiltólisták.

## 2. Effektív sávok és használható párok

A jóváhagyott katalógus 16 numerikus metrikája 64 metrika/nehézség sorban
ellenőrizve van, pontos racionális számítással. Az eredmény a
[full-source-and-coverage.json](full-source-and-coverage.json) fájlban található.
A korábbi százalékos profilok megtarthatók, metrikafelülírás nem szükséges.

| Nehézség   | Sáv                               | Teljesíthető metrika/művelet párok | Engedélyezett párok |
| ---------- | --------------------------------- | ---------------------------------- | ------------------- |
| easy       | legalább 30%                      | 41                                 | 48                  |
| medium     | 10–30%                            | 47                                 | 48                  |
| hard       | legfeljebb 10%                    | 64                                 | 80                  |
| challenger | nincs korlát; hat különböző érték | 112                                | 112                 |

A pár itt legalább egy érvényes opciókészletet jelent; a teljes család
öt különböző promptja külön követelmény. A 24 nem teljesíthető pár kimarad.
A nulla referencia kihagyása és az egyenlő küszöbértékű opció kizárása megmarad.
A darabszám és cooldown rácsa 1, a statok léptékei a jóváhagyott katalóguséi.

## 3. Ötös csomagok, helyesség és ismétlődés

| Kategória                | easy | medium | hard           | challenger |
| ------------------------ | ---- | ------ | -------------- | ---------- |
| Base stats at level 1    | 132  | 233    | 241            | 476        |
| Base stat growth         | 64   | 101    | 91             | 1413       |
| Number of skins          | 25   | 22     | 15             | 69         |
| Number of chromas        | 59   | 56     | 52             | 215        |
| Chromas per skin         | 14   | 10     | **3: kimarad** | 64         |
| Ability cooldowns rank 1 | 63   | 59     | 35             | 463        |

A táblázat különböző promptokat számol: a minimum-/maximumkérdés rejtett
helyes értéke vagy új opcióhalmaza nem új prompt. Exact/threshold esetén
viszont a látható célérték/küszöb az azonosság része. A három easy felismerési
család további 692/173/173 egyedi nyomot biztosít.

**27 tervezett változatból 26 teljesíthető.** A `chromaPerSkin:hard` csak
három különböző promptot ad: maximum és pontosan 10/11 chroma. Ezért az
elfogadott szabály szerint kimarad; nincs ismételt kérdés, 6→4 opciócsökkentés
vagy csendes sávhangolás. Az easy/medium/challenger változatai megmaradnak.

207 seedet vizsgáltunk: `A`, `a`, `001`, `1`, `Ab1`, `ab1`, `0123456789`,
valamint `Check0`–`Check199`. Seedenként 26 ötös csomag készült:
**5382 csomag és 26 910 kérdés**. Ellenőrizve:

- pontos 4/6 opciószám és különböző alanyok;
- forrásból újraszámított helyes halmaz, egyértelmű single megoldás;
- inkluzív sávhatárok, nulla referencia kihagyása;
- második hely és challenger esetén különböző metrikaértékek;
- szigorú küszöbpredikátum, egyenlő érték kizárása, legalább egy helyes és egy hibás;
- öt egyedi prompt kategóriánként, más nehézségen eltérő alanyhalmaz;
- az elfogadott alanyszűrések betartása.

Hét határeseti seed ismételt futtatása és fordított családkérési sorrendje
azonos eredményt adott. Fordított forrássorrendből is azonos pool keletkezik.
Kis-/nagybetű és vezető nullák külön seedet adnak. Az `Ab1` seed
130 kérdésmintája a [full-pack-witnesses.json](full-pack-witnesses.json)
fájlban átnézhető, ellenőrzéshez szükséges forrásértékekkel együtt.
Ez elemzési referencia, nem a leendő TS-generátor kimenete vagy minden
lehetséges seedre adott sikerességi bizonyítás.

## 4. Véges keret, súlyok és PRNG-vektorok

A referencia teljesíthető metrika/művelet/referencia indexből dolgozik.
Slotonként egyenletesen választ metrikát, azon belül műveletet, majd azon
belül referenciaértéket. Különböző metrikaértékeknél előbb érték, utána annak
egy alanya sorsolódik. Ez nem állít globálisan egyenletes kérdéseloszlást.

Legfeljebb 128 opcióhalmaz-próba van az azonos prompt korábbi nehézségi
alanyhalmazának elkerülésére; a mért maximum egy volt. Az indexválasztás
legfeljebb 256 rejection-lépést használ. Kimerülés hiba, nincs torz modulo-fallback.
A családterv easy/medium/hard/challenger sorrendben dolgozik, kihagyva a
nem elérhető változatot. A slot és az opciósorrend külön stream.

A v2 elemzési referenciában részhalmazhoz részleges, előrefelé haladó
Fisher–Yates választás szerepel; teljes opciósorrendhez a visszafelé haladó
keverés megmarad. Ez rögzített PRNG-fogyasztási különbség a korábbi v1
referenciához képest, ezért külön fixture-hash tartozik hozzá.

A [full-prng-test-vectors.json](full-prng-test-vectors.json) vektorai a teljes
forrásból és elfogadott szűrésből képzett fixture-hash-t használják.
Négy nyers állapot 64 kimenete és hét seedelt stream 112 kimenete egyezett
Pythonban és Node 24.19.0-ban. A little-endian állapot, mind-nullás kezelés,
indexhatárok, rejection és kimerülés, teljes és részleges Fisher–Yates,
üres/egyelemű lista szintén ellenőrizve. A natív generátornak ezeket majd
szintén teljesítenie kell. A keretek technikai ajánlások; alkalmazásbeli
futási költség és hibakimenet még külön ellenőrizendő.

## 5. Immutable kiadás és a fennmaradó implementáció

A fixture-hash pontosan a katalógus, szövegek, teljes kérdésalap-tények,
elfogadott szűrés és részhalmazmintavétel verziózott receptjét fedi le:
`SHA-256(canonical({ scope: "full-upload-reference-audit-v2", catalog, texts,
sourceFacts, eligibility, sampling: "partial-fisher-yates-for-subsets-v1" }))`.
A `catalog`, `texts`, `sourceFacts` mezők a részek hash-ei.
A kanonikus kódolás kulcsrendezett, whitespace nélküli UTF-8 JSON;
a tények numerikus statjai és cooldownjai pontos decimális szövegek.
A hősök Riot-kulcson, a skinek ID-n rendezettek; a képességek Q/W/E/R sorrendje tartalmi adat.

A teljes referencia tényreceptje: hős kulcs/ID/név/cím/erőforrás és 20 stat;
skinenként ID/num/név/sourceHasChromas/isChroma/parentNum; képességenként
ID/slot/név/maxRank/cooldownsByRank; végül passzívnév. A boolean-forrást is
megőrzi, a számokat nem kerekíti. Az `eligibility` objektum az új jelentésben
olvasható két effektív kizárási szabály. Ez reprodukálható ellenőrzési
fixture, nem kész DB-dataset vagy éles kiadás.

Objektumkulcs- és forrássorrend-változás nem változtatta meg a referenciahash-t;
forrástény-, lépték- és szövegváltozás megváltoztatta. Minden mintában
`productionRelease: false` szerepel. A korábbi részleges v1
[source-and-coverage.json](source-and-coverage.json),
[stat-pack-witnesses.json](stat-pack-witnesses.json) és
[prng-test-vectors.json](prng-test-vectors.json) változatlan előzmény marad;
a teljes forrás vektorai külön fájlok, a korábbi tesztértékeket nem írják át.

További JSON-feltöltés nem szükséges az MVP-forrás ellenőrzéséhez.
A fennmaradó publikálási feladatok: normalizáló/import és séma, leíró
katalógusfordító, natív TS-generátor, tartalmi szabályokat rögzítő valódi
kiadásmanifest, majd provider/HTTP/socket/mentés és seed-/verzióválasztás
integrációs tesztjei. A jelentés elkészülte ezeket nem implementálja és
nem publikál automatikusan játszható kiadást.
