# Seed, választható kiadás és determinisztikus kérdések

Dátum: 2026-10-10. Státusz: a termékszabályok felhasználói pontosításokkal
elfogadottak; az algoritmus és a fizikai mezők alább technikai javaslatok.
Ez dokumentáció, nincs hozzá implementált generátor, migráció vagy felület.

Kapcsolódó tervek: [kérdésgenerálás](question-generation.md),
[adatimport](lol-champion-data.md), [forrásmezők](lol-source-schema.md).

## 1. Az elfogadott garancia

- Azonos seed és azonos kiválasztott kiadás azonos kérdéseket,
  válaszopciókat, opciósorrendet és helyes halmazt eredményez.
- Megmarad a játékos kategóriaválasztása. Egy kategóriaváltozat öt kérdése
  ugyanabból a seed/kiadás párból mindig ugyanaz, a kiválasztás fordulószámától
  és a korábban választott más családoktól függetlenül.
- A kategóriakínálat is seedelt. Azonos korábbi kategóriaválasztások mellett
  azonos a következő kínálat; más választás más, még felhasználható kategóriákat
  hagyhat. Egy meccsen belül továbbra sem választható kétszer ugyanaz a változat.
- Két teljes meccs kérdéssora azonos, ha a seed, kiadás és a tényleges
  kategóriaválasztások sorrendje egyezik. Eltérő választás eltérő meccset adhat.
- Játékosok, pontszámok, válaszidők és technikai meccsazonosítók nem részei
  a kérdésgenerálásnak. Az eredmények és a kategóriát választó személy
  nem lesznek a seedből előre rögzítve.

A kiadás a teljes tartalomgenerálási szerződést azonosítja; egy LoL-patch
száma önmagában nem védi meg a kérdéseket egy későbbi sablon- vagy algoritmusváltozástól.

## 2. A seed szöveges szabályai és eredete

Elfogadott formátum: 1–10 ASCII alfanumerikus karakter, kis- és nagybetűt
megkülönböztetve. A megengedett ábécé:

`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`

Minden karakternek ebbe kell tartoznia; szóköz, sortörés, ékezet és más jel
nem megengedett. Nincs hallgatólagos trim vagy kisbetűsítés. `Ab1` és `ab1`
külön seed; `001` szövegként megmarad, nem alakítjuk 1-es számmá.

Két szerver által megkülönböztetett mód van:

| Mód         | Várószobai beállítás                          | Tényleges meccsseed                                                           |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------------- |
| Automatikus | A seedmező üres, az angol jelzés `Automatic`. | A szerver a meccs előkészítésekor új, tízkarakteres véletlen szöveget készít. |
| Kézi        | A tulajdonos érvényes seedet ad meg.          | Pontosan a megadott szöveg, `custom` eredettel.                               |

Az automatikus seedhez a backend meglévő Node `crypto.randomInt` képessége
használható: tíz, egyenletesen sorsolt karakter a fenti 62 elemű ábécéből.
Ez nem igényel új csomagot. A seed egyszer rögzül az indulási előkészítésben;
a kérdés-előkészítés retryja, reconnect vagy új eszköz nem generálja újra.
Megszakított indulás után egy új automatikus meccselőkészítés új seedet kaphat.

Tervezett játékbeállítás: `generationReleaseId` UUID és `seedSelection`.
A kiadásazonosító a felkínált, az adott témához tartozó kész kiadásra mutat.
A `seedSelection` diszkriminált választás; automatikus
módban nincs kliens által megadható érték, kézi módban kötelező az érvényes
szöveg. A szerver állítja elő és rögzíti a végső `seed_origin` értéket.
Nem fogadunk el kliens által szabadon beállítható ELO-jogosultságot.

A kézi seed látható a közös várószobai beállításban. Az automatikus mód ott
jelzésként jelenik meg; a tényleges automatikus seed a meccs után mutatható
meg és menthető az előzménybe. A szerver a teljes meccs alatt megőrzi.

## 3. ELO-kizárás

A kézzel megadott seed az adott meccs **összes résztvevőjét** kizárja az
ELO-változásból: senki nem kap és nem veszít ELO-t. Ez akkor is érvényes,
ha egy korábban automatikusan kapott seedet másolnak be kézzel.

Az automatikus seed önmagában nem kizáró ok. Ez nem jelent automatikus
ranglistás jogosultságot: a későbbi ELO-rendszer további szabályai még nincsenek
megtervezve. Az MVP-ben az ELO mindenkinél továbbra is 1000, nem számolunk
ELO-változást.

Az induláskor érvényes mód számít. Ha a tulajdonos a kézi értéket a kezdés
előtt törli, automatikus módra vált; ez valódi beállításváltozás, törli a ready
állapotokat. A meccs már rögzített eredete később nem módosítható.
A meccshez mentendő kizárási ok `custom_seed`; a felület angol üzenete például
`Custom seed — no ELO changes`. Ez már a várószobában mindenki számára látható.

## 4. A kiválasztható verzió jelentése

A felhasználó elfogadta, hogy a javítások külön kiadást kapnak.
Egy publikált kiadás változatlanul összeköti:

- a teljes normalizált adatállományt és annak tartalomhash-ét;
- a normalizálási verziót és a forráslocale-t;
- a kérdéstípus-/kategóriamanifestet, annak hash-ét és kérdésnyelvét;
- a generátor, seedleképezés, PRNG és opciókeverés verzióját;
- a használható kategóriaváltozatokat és a tartalmat befolyásoló
  keresési, kerekítési és sorrendezési szabályokat.

A kerek küszöblépés metrikánként külön tartalomadat: HP 50, cooldown 1 s,
darabszámok 1, alap támadási sebesség 0,05, alap AD-/armor-/regenerációértékek 1,
növekedési paraméterek 0,2 az elfogadott induló értékek. A `lessThan`/`moreThan`
küszöbével egyező jelöltek kihagyása szintén a változatlan tartalmi szabály része.
A százalékos sávok az easy/medium/hard nehézségnél az adathalmaz alapján a
kiadás előkészítésében hangolhatók és arányosíthatók. Challengerben nincs
minimum- vagy maximumeltérés; minden numerikus kérdés hat különböző
metrikaértékű opciót igényel. A nem teljesíthető párok kimaradnak, a
rendelkezésre álló részhalmazt a kiadás rögzíti.
A végleges effektív profil a manifestben és a kiadáshash-ben
rögzül; egy már publikált kiadás nem kap megváltozott léptéket vagy sávot.
A részletes szabály a [generálási tervben](question-generation.md) szerepel.

Az első kiadás felirata például `16.20.1`, a kérdéseket módosító következőé
`16.20.1 · r2`. A gépi azonosító saját UUID, nem a felirat. Ugyanazon patch
újraimportja azonos tartalommal nem hoz létre új kiadást; megváltozott tény,
sablon vagy generálási szabály új revíziót igényel. A régi kiadás és a hozzá
tartozó kompatibilis generátor megmarad. A felhasználó nem adhat meg
tetszőleges Riot-verziószöveget vagy külső letöltési URL-t.

A várószobai választó csak az adatbázisban meglévő, kész adatokhoz kötött,
publikált és futtatható kiadásokat kínálja fel. Staging, hibás vagy generátor
nélküli készlet nem indíthat játékot. Régi, érvényes kiadás is választható.
A legfrissebb alapértéket a LoL-verzió numerikus komponensei, majd a kiadás
revíziószáma alapján keressük; nem a felirat lexikografikus sorrendje vagy
egy régi patch későbbi importideje alapján. Például 16.10.1 újabb 16.9.1-nél.

Új várószoba a legfrissebb játszható kiadás konkrét azonosítóját kapja.
Közben publikált új kiadás nem írja át csendben a meglévő szoba választását;
láthatóan választhatóvá válik. A tulajdonos explicit váltása törli a ready
állapotokat. A meccs induláskor rögzíti ezt a kiadást, és minden forduló,
eszköz és retry ugyanezt használja. A következő meccsnél az automatikus
seed megújul, a szoba explicit kiadásválasztása megmarad.

Ha a választott kiadás nem használható, jelzett hiba és letiltott indulás
kell; nincs automatikus helyettesítés a legfrissebbel. A kiadáshoz tartozó
használható kategóriákból számoljuk a fordulómaximumot, továbbra is legfeljebb
tíz. A tulajdonosnak rendeznie kell az ezzel ütköző fordulóbeállítást.

## 5. Javasolt determinisztikus algoritmus

Javasolt PRNG: `xoshiro128**`, négy 32 bites állapotszóval.
A szorzásokat 32 bites egészműveletként, a XOR-okat, biteltolásokat és
rotációkat rögzített unsigned szabállyal végezzük. Ezt kis, natív TypeScript
modul tudja megvalósítani, külső könyvtár nélkül.

Az algoritmus állapotát egy ismert átmeneti szabály lépteti. Ugyanazon
kezdőállapotból ugyanazok a 32 bites kimenetek származnak; az automatikus seed
előállítása és a seed utáni determinisztikus sorsolás külön művelet.

Javasolt verziózott leképezés:

1. A gyökérdigest SHA-256 a seedből és a kiadás tartalomhash-éből.
   Bemeneti kódolása UTF-8, rögzített JSON-tömb:
   `rapidfire-seed-v1`, a seed változatlan szövege, kiadáshash.
2. Egy külön stream digestje SHA-256 egy másik rögzített JSON-tömbből:
   `rapidfire-stream-v1`, gyökérdigest 64 kisbetűs hex karaktere, streamcél
   és logikai kulcsok.
   Nincs elválasztó nélküli szövegösszefűzés, locale-függő formázás vagy UUID.
3. A streamdigest első 16 bájtja négy, little-endian unsigned 32 bites
   állapotszó. A mind-nullás állapotnál a negyedik szó rögzítetten 1;
   nincs újrasorsolt véletlen fallback.
4. Indexválasztásnál egész, torzításmentes rejection sampling, `1 ≤ n ≤ 2³²`.
   Az elfogadási határ `m = floor(2³² / n) · n`; a `0 ≤ u < m` kimenetet
   fogadjuk el, a nulla alapú index `u mod n`. Üres lista hiba;
   az `u ≥ m` kimenet új PRNG-lépést kér ugyanebből a streamből.
5. Opciókeveréshez Fisher–Yates, ugyanezzel az egészindex-választással.

A SHA-256 a backend standard Node-API-ja; a tiszta generátor a rögzített
állapotot/tényeket kapja, nem végez hálózati vagy adatbázisműveletet.
A [Blackman–Vigna referencia](https://prng.di.unimi.it/xoshiro128starstar.c)
az algoritmus forrása; a leendő implementációhoz előre rögzített tesztvektorok
kellenek. Ebben a dokumentációs szeletben ilyen implementáció vagy teszt még nincs.

## 6. Streamhatárok és a kategóriacsomagok

| Stream célja                   | Stabil bemenetek a gyökérdigesten túl                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| Kategóriakínálat               | Fordulósorszám és a korábban kiválasztott kategóriakulcsok listája.                    |
| Automatikus kategóriaválasztás | Fordulósorszám és a felkínált stabil kulcsok; külön stream.                            |
| Családon belüli terv           | Családkulcs; a használható nehézségek rögzített easy/medium/hard/challenger sorrendje. |
| Kérdésslot                     | Kategóriaváltozat kulcsa és az 1–5 kérdéssorszám.                                      |
| Opciósorrend                   | Kategóriaváltozat kulcsa és kérdéssorszám; a jelöltképzéstől külön stream.             |

A kategória ötös csomagja nem kap fordulósorszámot a seedbemenetébe.
Ez szándékosan felváltja a korábbi fordulóseed-javaslatot. Egy változat
meccsenként csak egyszer választható, ezért ugyanaz az ötös csomag nem
ismétlődik azonos nehézségen.

Az azonos prompt más nehézségen csak eltérő alanyhalmazzal térhet vissza.
Ennek ellenőrzése nem függhet a játékos választási sorrendjétől: a család
használható nehézségeihez egy kanonikus közös tervet képzünk a rögzített
nehézségi sorrendben. Ez akár előállítható előre, akár azonos eredménnyel
lustán; egy korábbi, ténylegesen kiválasztott kategória nem módosítja a tervet.
Egy slot vagy csomag sikertelen előkészítése nem fogyasztja el más stream
állapotát. A korábbi prompt- és halmazellenőrzés e kanonikus terv része.

Játékos-/tulajdonosválasztás, online állapot és válaszok nem fogyaszthatják
a tartalom streamjeit. A motor jelenleg közös `Context.random` listából
sorsolja a kínálatot és a választó személyt; ezt az integrációban külön
szerepű bemenetekre kell bontani. A motor továbbra sem ismeri a seedet,
adatbázist vagy Node-cryptót, és továbbra sem kap külső csomagfüggőséget.

A jelöltek külső tartalomkulcson, rögzített összehasonlítással rendezettek.
Adatbázissor-sorrend, `localeCompare`, aktuális óra, meccs-UUID, `attempt`
vagy korábbi socketparancsok száma nem adhat rejtett véletlenbemenetet.
Az eltérések és keresési lépések egész/ellenőrzött decimális szabálya a kiadás
része. Falióra-timeout megszakíthatja a generálást, de nem választhat más
kérdést; a verziózott logikai próbakeret és az előálló csomag változatlan.

## 7. Javasolt tárolási és publikus határok

| Tervezett adat                        | Szerep                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `question_template_manifest`          | UUID, séma-/tartalomverzió, nyelv, eredeti/véglegesített JSONB, tartalomhash; publikálás után változatlan.                                                  |
| `question_generation_release`         | UUID, téma, forrásverzió, revízió, dataset- és manifest-FK, generátor-/seed-/PRNG-verzió, locale/nyelv, tartalomhash, publikálási idő és publikált állapot. |
| `question_catalog.default_release_id` | A legfrissebb használható kiadás pointere; nem írja át a régi kiadásokat vagy a szobák explicit választását.                                                |
| `game.generation_release_id`          | A konkrét meccs kiadására mutató FK, törlésvédelemmel.                                                                                                      |
| `game.generation_seed`                | A tényleges 1–10 karakteres seed, változatlan szöveg.                                                                                                       |
| `game.seed_origin`                    | `automatic` vagy `custom`; a szerver rögzíti.                                                                                                               |
| `game.elo_exclusion_reason`           | Kézi seednél `custom_seed`, egyébként e feltétel szerint NULL.                                                                                              |
| Fordulómetadata                       | Sorszám, kiválasztott kategóriaváltozat stabil kulcsa és generált tartalomhash.                                                                             |

A kiadás természetes egyedisége téma + forráslocale + kérdésnyelv +
forrásverzió + revízió. A tartalomhash rögzíti a dataset-/manifesthash-t,
normalizáló-, generátor-, seed- és PRNG-verziókat, nyelveket és kanonikus
katalógust; kizárja az új UUID-kat és időpontokat.
Az immutable kiadás a változatlan adatkészlethez és manifesthez kötődik;
ezeket, illetve a meccshez rögzített kiadást `ON DELETE RESTRICT` védi.
Ugyanaz a seed/kiadás pár több meccshez is felhasználható, tehát nem unique key.

Régi mintameccseknél az új generálási mezők NULL maradhatnak. Az új,
valóban generált meccseknél a kiadás, seed és eredet együtt kötelező;
kizárási oka összhangban kell legyen a `custom` eredettel. A későbbi ELO-kód
a hiányzó régi metadata alapján nem állíthat automatikus seederedetet.
Vendégmeccsnél a kontextus a futásban és kiértékelőn megmarad, de továbbra
sem készül tartós személyes history.

A `/api/game-config` a témához tartozó választható kiadásokat, alapértéküket
és kiadásonként a fordulómaximumot adhatja vissza. A címke/UUID és a
várószobai seedválasztás publikus; a generátor belső állapota, nyers tények,
csomagcache és előre kiszámolt helyes válaszok nem. A tényleges automatikus
seed a meccs utáni eredmény/history része lehet. Új kliensmezők és snapshotok
miatt a contracts és a socketprotokoll tudatos verzióváltást igényelnek.

A szólóindítás ugyanazt a közös beállításmodellt használja. A már meglevő
`expectedSettingsVersion` védi a tulajdonosi lobbyváltoztatást; a ready-
állapotok, meccselőkészítés és mentési checkpoint az új mezőket is figyelembe
veszik. Az indulási kontextus létrehozása egyszeri, a vezérlő sorába visszatérő
eredmény; nem tart nyitva DB-várakozást a motor állapotmódosítási sorában.

## 8. Tervezett ellenőrzések és következő lépés

- Seedhossz 1 és 10; üres kézi seed, 11 karakter, szóköz/sortörés és nem ASCII
  elutasítása; kis-/nagybetű és vezető nulla megőrzése.
- Automatikus és kézi eredet; bemásolt automatikus seed is `custom`; minden
  résztvevő meccsszintű ELO-kizárása; a kliens nem állíthatja felül az okot.
- Numerikus patch- és revíziósorrend; régi patch újraimportja nem lesz
  legfrissebb; hibás/nem publikált kiadás nem választható; üres verziólista.
- Fix seed/kiadás/stream tesztvektorok, PRNG-kezdőállapot és egészindex-határok.
- Azonos kategóriacsomag eltérő fordulóban, meccsben, játékosszámmal és
  korábbi családválasztással; más nehézségen a halmazkülönbség változatlan.
- Azonos választásoknál azonos kínálat és kérdéssor; módosult választási útnál
  eltérhet a kínálat, de az azonos kategóriacsomag nem változik.
- Retry, reconnect, DB-sorrend és streamhívások száma nem változtatja meg
  más stream eredményét; abort után ugyanaz a csomag állítható elő.
- Új kiadás aktiválása közben a régi szoba és meccs rögzített verziót tart;
  változó tartalom csak új revízióban; régi generátor elérhetetlensége jelzett hiba.
- Kézi seed/kiadás váltása törli a ready állapotokat; a kérdés és opciók
  továbbra is csak a visszaszámlálás utáni megnyitáskor látszanak.
- Metrikánkénti küszöbrács és effektív százalékos profil reprodukálása;
  sávhangolás csak új kiadásban, a korábbi seed/kiadás eredménye változatlan.

A tesztek még nem futottak le, mert az implementáció nincs engedélyezve.
A következő tervezési feladat a leíró katalógus végleges mezői, a további
metrikák konkrét küszöblépései/profiljai és a véges keresési keret. Ezeket a publikált kiadás rögzíti;
az itt leírt seedformátum, verzióválasztás és ELO-kizárás már elfogadott.
