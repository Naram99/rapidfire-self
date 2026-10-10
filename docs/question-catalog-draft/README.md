# League of Legends — JSON-katalógustervezet

Dátum: 2026-10-10. Státusz: átnézésre kész tervezet. A mezőnevek és a
fájlszerkezet technikai javaslatok; a termékszabályok a korábban elfogadott
[generálási tervet](../question-generation.md) követik.

## Fájlok és olvasási sorrend

1. [catalog.json](catalog.json): a generálás leíró konfigurációja. A
   `difficultyProfiles` után a `families`, majd a `metrics` részt érdemes átnézni.
2. [texts.en.json](texts.en.json): az angol kategórianevek, metrikanevek,
   mértékegységek, opciófeliratok és teljes kérdéssablonok.
3. [review.json](review.json): a még nem elfogadott értékjavaslatok pontos
   JSON-pointerrel, valamint a publikálás előtti ellenőrzések.

A katalógus 21 numerikus metrikát tartalmaz: 17 hősstat, három skin/chroma
darabszám és egy rank 1 cooldown. Kilenc aktívnak tervezett szöveges család
van: hat numerikus és három felismerési. A 18 eredeti családkulcs megmarad;
a képes és egyéb későbbi családok `enabled: false` jelölést kapnak.
Az angol fájlban 45 teljes kérdéssablon szerepel.

Az `enabled: true` a tervezett használatot jelenti, nem igazolt játszhatóságot.
A fájlok nem tartalmaznak generált kérdéseket vagy valódi kiadásazonosítót.
Az alkalmazás még nem tölti be őket. A forrásként kapott JSON-ok külön,
változatlan referenciák maradnak.

## Mezők

| Mező                                       | Jelentés                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `schemaVersion`                            | A katalógus szerkezetének verziója; nem LoL-patch vagy generátorverzió.      |
| `catalogId`, `topicId`                     | A logikai katalógus és a meccstéma stabil kulcsa.                            |
| `status`                                   | Itt `draft`; ilyen tervezet nem publikálható játszható kiadásként.           |
| `language`, `translationsFile`             | A kérdésnyelv és a hozzá tartozó szövegfájl.                                 |
| `supportedMedia`                           | Az MVP-ben kizárólag `text`.                                                 |
| `categoryIdPattern`, `categoryLabelKey`    | Téma + család + nehézség stabil kulcsa, illetve fordítható felirata.         |
| `rules`                                    | Öt kérdés, értékkezelés, helyeshalmaz, küszöb és ismétlődés közös szabályai. |
| `subjects`                                 | Az opciók alanytípusa, stabil külső kulcsmezői és megjelenítési sablonja.    |
| `units`, `valueFormat`                     | Mértékegységek és pontos, angol számformázás.                                |
| `operators`                                | Műveletek jelentése, válaszadási módja és referenciája.                      |
| `difficultyProfiles`                       | Központi opciószám, numerikus műveletlista, sáv és értékkülönbözőség.        |
| `metricDifficultyOverrides`                | Publikálás előtt hangolt metrika/nehézség sávok; most üres lista.            |
| `metrics`                                  | Adatolvasás logikai hivatkozása, egység, küszöblépés, kapacitás és szűrés.   |
| `families`                                 | Numerikus vagy felismerési családok és a hozzájuk tartozó metrikák/sablonok. |
| `excludedMetricIds`, `deferredOperatorIds` | Az MVP-ből kizárt metrika és a későbbi műveleti tervek.                      |

Az objektum kulcsa maga az azonosító: például `metrics.hp` azonosítója `hp`.
Nem ismételjük meg külön `id` mezőben. Ezek tartalomkulcsok; az adatbázis
saját sorazonosítói továbbra is UUID-k. A `source`, `statKey` és `keyFields`
ismert logikai adapterhivatkozások, nem tetszőleges SQL-oszlopok vagy
kiértékelhető kód. Új olvasóhoz backendbővítés és validálás szükséges.

## Nehézségek és műveletek

| Nehézség   | Opciószám | Relatív eltérés          | Különböző értékek                                       |
| ---------- | --------- | ------------------------ | ------------------------------------------------------- |
| easy       | 4         | Minimum 30%.             | A megoldás egyértelmű; hibás opciók értéke egyezhet.    |
| medium     | 4         | 10–30%.                  | A megoldás egyértelmű; hibás opciók értéke egyezhet.    |
| hard       | 6         | Maximum 10%.             | Második helyet kérő műveletnél minden érték különbözik. |
| challenger | 6         | Nincs százalékos korlát. | Minden numerikus kérdésben mind a hat érték különbözik. |

Az easy/medium/hard sávok a mintabeli kiinduló értékek. A teljes készlet
alapján hangolhatók; nem szükséges minden hiányzó kombinációt elérhetővé tenni.
A challenger korlátmentessége elfogadott szabály, nem hangolásra váró 5%-os profil.

A `relativeDifference: {}` korlátmentességet jelent. A hiányzó minimum vagy
maximum nem helyettesítődik be 0,3-mal vagy 0,05-tel. Az arányok inkluzívak:
`0.1` = 10%. A referenciaszám:

- `min`, `max`, `min2nd`, `max2nd`: a helyes opció értéke;
- `exactMatch`: a kérdésben látható célérték;
- `lessThan`, `moreThan`: a kérdésben látható küszöb.

A `requireDistinctOptionValues` effektív értéke a profil és a művelet
jelzőjének logikai VAGY-a. Így a hard második helyes kérdése is teljesen
holtversenymentes, és egy művelet `false` jelzője nem írhatja felül a
challenger `true` követelményét. Minden kérdésben különböző alanyok szerepelnek.

Az `answerMode` az egyetlen választásimód-forrás. `single` esetén pontosan
egy helyes opció van; `multiple` esetén legalább egy helyes és egy hibás.
Az egyetlen helyes válasz nem kapcsolja át a multiple felületet single-re.
Külön `multipleCorrect` mező így nem ismétli ugyanazt a döntést.

A `min2nd` és `max2nd` csak hard/challenger alatt engedélyezett, a
`lessThan` és `moreThan` a jelenlegi családokban csak challenger alatt.
A numerikus rangsor mindig a megjelenített opciókra vonatkozik.
A felismerési családok easy profiljuk opciószámát használják, de a numerikus
sáv és műveletlista helyett a külön `identify` műveletet alkalmazzák.

Egy későbbi `metricDifficultyOverrides` bejegyzés például:

```json
{
  "metricId": "hp",
  "difficultyId": "easy",
  "relativeDifference": { "minimum": 0.2 }
}
```

Ez kizárólag szerkezeti példa, nem elfogadott 20%-os HP-beállítás. Egy
metrika/nehézség pár legfeljebb egyszer szerepelhet. A felülírás a teljes
sávobjektumot helyettesíti, nem részleges mezőösszefésülés; a profil opciószáma,
műveletlistája és különbözőségi szabálya megmarad. Challengerhez nem adható
százalékos korlátot bevezető felülírás.

## Metrikák és adatfeltételek

Az alap AD-/armor-/regenerációértékek küszöblépése 1, a növekedési
paramétereké 0,2. HP 50, attack speed 0,05, cooldown és darabszám 1.
Négy további küszöblépés a tervezetben **javaslat**, a `review.json` jelöli:

| Metrika           | Javasolt lépték |
| ----------------- | --------------- |
| Alap mana         | 50              |
| Alap magic resist | 1               |
| Mozgási sebesség  | 5               |
| Támadási távolság | 25              |

A regeneráció 5 másodperces mértékegysége és az attack speed growth
százalékpont-egysége szintén külön ellenőrizendő javaslatként szerepel.
A `Base stat growth` megjelenítési név is átnézendő; a sablon a forrás
növekedési paraméterét kérdezi, nem kiszámított, tényleges szintenkénti statot.

Mana és manaregeneráció csak `resourceType: mana` hősökből készülhet.
Az `attackdamageperlevel` kizárt metrika; a hét másik növekedési metrika
és az alap AD ettől továbbra is aktívnak tervezett.

A skinszám kihagyja az alapkinézetet és a chromákat. A chromaszámot
tényleges, teljes chromarekordokból számoljuk; a forrás `chromas` booleanja
nem darabszám. A `parentSkin` alapú normalizálás a kapcsolódó
[forrásszerződésben](../lol-source-schema.md) szerepel. Hiányos chromalista
kapacitáshiány, nem nullás eredmény. Skinenkénti kérdés alanya szülőskin.

A cooldown Q/W/E/R első képességrangjának alapértéke, tárgyak és rúnák
nélkül. Nem ellenőrzött numerikus cooldown nem válik jelöltté.
A `requiredCapabilities` kapacitáskulcsai az adapter által igazolt adatokra
hivatkoznak; a fájl puszta jelenléte nem teljesíti ezeket.

## Értékek, küszöbök és szöveg

A forrásértékeket nem kerekítjük a küszöbrácsra. A `thresholdStep` csak
`lessThan`/`moreThan` esetén képez pozitív `k × step` küszöböt. A
`exactMatch` valódi forrásértéket mutat. A nulla referencia kimarad;
a nulla mint opcióérték továbbra is érvényes lehet. Hiányzó adat nem 0.
Az egyenlő küszöbértékű opció kimarad mindkét küszöbös kérdésből.

`valueFormat.fractionDigits: source` a pontos decimális érték megőrzését
jelenti, nem a nyers JSON szövegének látható tizedeshelyeit. A fölösleges
záró nullák elhagyhatók, de érdemi számjegy nem kerekíthető el. Egyezés és
sávhatár ellenőrzése skálázott egész/decimális szabállyal történik.

A kérdéssablonok megengedett placeholderjei:

- `metricName`: az adott metrika fordított neve;
- `valueWithUnit`: pontos célérték, a hozzá illő egyes/többes egységgel;
- `thresholdWithUnit`: pontos küszöb, a hozzá illő egyes/többes egységgel;
- `clue`: képességnév, passzívnév vagy hőscím.

Például `1 chroma` és `2 chromas` a `units` egyes/többes kulcsából képződik;
nem marad fix többes szám egy 1-et tartalmazó kérdésben. Az angol
egységválasztás 1 esetén egyes, minden más értéknél többes. Későbbi nyelv
saját pluralizációt és teljes sablonokat adhat, a művelet szemantikája megmarad.
A szövegkulcs nem kiértékelési szabály, és nem tetszőleges sablonprogram.

Az opciósablonok külön placeholderkészletet használnak: `championName`,
`skinName`, `spellSlot`, `spellName`. A kategóriafelirat `familyName` és
`difficultyName`, a kategóriakulcs `topicId`, `familyId`, `difficultyId`.
Ezek a külön szerepek nem keverhetők kérdéssablonba. A behelyettesített
értékek szöveges adatok; nem HTML vagy futtatható kód.

## Rendelkezésre állás, ismétlés és kiadás

Hibás JSON vagy ismeretlen kulcs/hivatkozás konfigurációhiba: a katalógus
elutasítandó. Az adatokból nem teljesíthető metrika/művelet/nehézség pár
kimarad; ha nincs öt különböző kérdés, a teljes család/nehézség is kimarad.
Ez az eredmény a kiadás előkészítésében rögzül, nem futó játékban változik.

Azonos család/nehézség alatt a metrika, művelet és látható paraméterek
adják a kérdésazonosságot. Egy minimumkérdés új opciókkal nem új prompt.
Felismerésnél nincs `metricId`; a `clue` a látható paraméter része. Numerikus
`exactMatch` esetén a célérték, küszöbös kérdésnél a küszöb tartozik ide.
A rejtett helyes statérték és az opciósorrend nem tartozik ide.

Más nehézségen ugyanaz a prompt csak legalább egy eltérő alannyal térhet
vissza. A család kanonikus nehézségi terve ezt választási sorrendtől
függetlenül ellenőrzi; puszta opciókeverés vagy új UUID nem számít eltérésnek.
Felismerésnél egy megjelenített nyom több különböző hőshöz tartozva kimarad;
ugyanazon hős többször előforduló nyoma önmagában nem ad második helyes hőst.

A dataset-, manifest-, szöveg- és generátorverziókat egy immutable
[generálási kiadás](../question-seed-version.md) kapcsolja össze. A kiadás
tartalomhash-e a végleges katalógust és az angol szövegeket is lefedi;
nem írunk hamis hash-t, patchszámot vagy kiadás-UUID-t ebbe a tervezetbe.
Egy későbbi fordítás külön nyelvi manifest/kiadás; nem írja át az angol kiadást.
Seed, ELO, session, DB-migráció és PRNG-állapot külön felelősség.

## Ellenőrzési határ

A tervezet JSON-szintaxisa, hivatkozásai, placeholderjei és az elfogadott
konfigurációs szabályok külön ellenőrizhetők. Ez nem működő generátor,
runtime validátor, teljes forrásimport vagy garantált ötös kérdéscsomag.
A `review.json` publikálás előtti listája ezeket továbbra is nyitva tartja.
