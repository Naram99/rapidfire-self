# Natív játékmotor — M1

Az M1 motor a `packages/game-engine` workspace-ben önálló, determinisztikus TypeScript-modulként fut. Nincs runtimefüggősége, Node/DOM típuskörnyezete, I/O-ja, saját órája, időzítője vagy véletlenforrása. A belső állapot és események nem a socket-szerződés DTO-i.

## Belépési pontok

- `createMatch(input, now)` ellenőrzi a beállításokat, résztvevőket és kategóriákat; létrehozza az öt másodperces indulási visszaszámlálást és visszaadja az első időzítő teendőjét.
- `transitionMatch(state, event, { now, random })` visszaadja az új állapotot, a teendők listáját és válaszparancsnál a visszaigazolást. Szabályhiba esetén az eredeti állapotot, üres teendőlistát és stabil angol hibakódot ad; megjeleníthető üzenetet nem tárol.
- `parseQuestionBatch(unknown, categoryId, existingQuestionIds)` egy forduló pontosan öt kérdését validálja és leválasztja a bemeneti objektumokról. Hibás tartalomnál `null` az eredmény. A motor is elvégzi ezt az ellenőrzést az előkészítési eredmény fogadásakor.

A `MatchInput` és `MatchEvent` szerveroldali, típusos domainbemenet. A HTTP/socket ismeretlen payloadjának szerkezeti ellenőrzése, hitelesítése és eseménnyé alakítása az M2 adapter feladata. A motor ezen felül ellenőrzi a saját szabályait: például egyedi résztvevőazonosító/sorrend, választási jogosultság, kérdésazonosság, határidő és opciók. A külső kérdésforrás payloadja közvetlenül `unknown`.

Az állapot readonly, a reducer nem módosítja a korábbi állapotot. A beállítások, résztvevők, kategóriák, kérdések és elfogadott opciólisták másolatként kerülnek bele. A változatlan belső részek megosztottak lehetnek egymást követő állapotok között; a hívó az állapotot, teendőket és visszaigazolásokat nem módosíthatja. A motor nem mélyfagyaszt minden objektumot minden átmenetben.

## Idő és sorrendezés

Minden idő egész, nemnegatív Unix-milliszekundum. A motor biztonságos egész tartományt követel, a támogatott leghosszabb fázishoz szükséges összeadási tartalékkal.

Az esemény `receivedAt` mezője a szerver által, az aszinkron várakozás előtt rögzített beérkezési idő. A kontextus `now` mezője a feldolgozás időpontja; nem léphet vissza a legutóbbi állapotváltozás elé. A válasz és kategóriaválasztás kizárólag `receivedAt < deadline` mellett fogadható el. Pontozásnál is a beérkezési idő számít. A következő fázis a feldolgozás idejétől teljes időtartamot kap; egy késői callback nem rövidíti le a következő kérdést.

A backend egyetlen sorban dolgozza fel a meccs parancsait, callbackjeit és aszinkron kérdésforrás-eredményeit. A határidő előtt sorba tett válasz megelőzi a később sorba tett lezárást. A motor nem rendezi át az eseményeket és nem nyit újra lezárt kérdést.

Az időzítő az aktuális `matchId`, `phaseId` és `deadline` hármast küldi vissza. Másik meccshez/fázishoz vagy eltérő határidőhöz tartozó callback hatástalan. Aktuális időzítő határidő előtti futása `INVALID_TIME`. Előkészítési eredménynél a meccs és fázis azonosságát vizsgáljuk; lejárt eredmény sikertelen próbálkozás. Egy újabb próbálkozás új fázisazonosítót kap, így a régi eredmény nem fogadható el.

## Sorsolási bemenet

A `random` egy kívülről kapott, `[0, 1)` tartományú számokból álló lista. A motor a szükséges értékeket sorrendben fogyasztja; az egyértelmű döntéshez nem kér véletlent. Fel nem használt értékek nem kerülnek a következő átmenetbe.

Fordulókezdésnél a sorrend: legfeljebb négy kategória mintavétele visszatevés nélkül, pontazonos választó sorsolása, mindenki-idle esetben automatikus kategóriaválasztás. Legfeljebb öt érték szükséges egy átmenethez. Ha négy vagy kevesebb kategória maradt, mind megjelenik a bemeneti sorrendben. Egyetlen kategóriánál nincs választó vagy sorsolás. Hiányzó/hibás, ténylegesen szükséges véletlenérték `INVALID_RANDOM_INPUT`, állapotváltozás és teendők nélkül.

A UUID-kat a szerver adja a meccsnek és a résztvevőknek; a motor nem generál perzisztens azonosítót. A `round:N` és `phase:N` belső azonosítók meccsen belüliek, külső koordinációban mindig a meccsazonosítóval együtt értelmezendők. Az authazonosságot és a meccsrésztvevő azonosítóját a backend kapcsolja össze.

## Fázisok és teendők

`start_countdown → category_selection / preparing_questions → question_countdown → answering → evaluation`

Öt kérdés után következő forduló vagy `finished`; sikertelen második előkészítés, utolsó kilépés vagy szerverleállítás esetén `interrupted`. A végeredmény/megszakítás 15 másodperc után `returned` állapotba lép és visszatérést kér.

A résztvevő `leftAt` mezője a kilépés feldolgozási idejét őrzi; ismételt kilépés nem írja felül. A meccs `endedAt` mezője a befejezés/megszakítás ideje. Visszatérés után is megmarad a végső rangsor vagy a megszakítás oka, így a későbbi mentési adapternek nem kell korábbi fázisobjektumokra támaszkodnia.

Az időtartamok: indulás 5 s, választás 15 s, előkészítés próbálkozásonként 15 s, kérdés előtti visszaszámlálás 3 s, kiértékelés 5 s. Válaszidő a meccsbeállításban egész másodperc, 5–60 s; az elfogadott alapérték 20 s. Fordulók száma 1–10, fordulónként öt kérdés, maximum tíz résztvevő.

Teendők:

| Teendő                                 | Backend felelőssége                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `schedule_timer`, `cancel_timer`       | Időzítőadapter, majd sorba állított `timer_elapsed`.                         |
| `prepare_questions`                    | Kérdésforrás futtatása, majd `questions_prepared` vagy `preparation_failed`. |
| `match_started`                        | Indulási checkpoint és meccsvisszatérési jogosultság kiadása.                |
| `question_closed`                      | Rövid kérdéseredmények, checkpoint, új publikus snapshot.                    |
| `match_completed`, `match_interrupted` | Végső mentés és annak külön állapotjelzése.                                  |
| `return_requested`                     | Visszatérés a még létező szobába/vendég-kezdőképernyőre.                     |

A backend először elfogadja az új állapotot, aztán végrehajtja a teendőket azok sorrendjében. A motor nem vár adatbázismentésre. Az idempotens mentés és a meccsvégi újrapróbálás az M3 feladata.

## Válasz, idle és kilépés

Az első elfogadott válasz a résztvevő–kérdés párra a meccs teljes élettartamában zárol. Újabb beküldés az eredeti opciókat/időt adja vissza `repeated: true` jelzéssel, pontot nem ad újra. A visszaigazolás nem tartalmaz helyességet vagy pontot. Az elfogadott választás az opciók eredeti sorrendjére rendezett halmaz.

Pontot a kérdéslezárás ad az összpontszámhoz, egyszer. A kérdéseredmény csak a rövid számszerű bontást őrzi, nem megjelenítendő mondatot. Öt elfogadott válasz nélküli lezárt kérdés idle állapotot eredményez. Elfogadott válasz azonnal nullázza a kihagyásokat és aktívvá tesz, a kapcsolat/presence változása önmagában nem.

A bevárandó lista a kérdés megnyitásakor rögzül, és explicit kilépéskor szűkülhet. Az idle állapotból visszatérő a következő kérdéstől kerül bele. Üres lista esetén a kérdés határidőig nyitott, akkor is, ha a lista kilépés miatt ürült ki vagy közben érkezett idle-válasz.

Kilépés után nincs visszatérés vagy újabb kérdéseredmény. A kilépés előtt elfogadott válasz még kiértékelődik. Utolsó kilépésnél a nyitott kérdésben már elfogadott válaszokat lezárjuk, majd megszakítjuk a meccset; a kilépett, nem válaszoló játékosoknak nem készül megválaszolatlan sor. A megszakított meccsnek nincs végső helyezése. Normál végeredmény minden eredeti résztvevőt tartalmaz, pontazonosság esetén 1., 1., 3. helyezéssel; a megjelenítési sorrend a résztvevői sorrend.

## M2/M3 határa és ellenőrzés

A lobby, ready, tulajdonos, 60 másodperces lobby-offline eltávolítás, hitelesítés, több eszköz nyilvántartása, socket DTO, requestId-cache, DB és felület még nincs bekötve. Az indulási visszaszámlálást a lobbyvezérlő dobja el, ha a kezdési feltételek változnak; új indulás új meccsazonosítót kap. `match_started` csak a visszaszámlálás végén keletkezik.

A teljes `MatchState` szerver-only: tartalmazza a helyes opciókat és a jövőbeli kérdéseket. Tilos közvetlenül a kliensnek sorosítani. Az M2 vetülete a kérdés előtti visszaszámlálásban csak a kategóriát/sorszámot/határidőt közölheti; kérdés és opció a nyitástól, helyesség és pont a lezárástól látható. A motor tesztjei a belső szabályokat bizonyítják, a későbbi DTO-vetület titokszivárgás elleni ellenőrzése külön M2 feltétel.

Gyors, adatbázis nélküli ellenőrzés a repó gyökeréből:

```sh
npm run typecheck --workspace @rapidfire/game-engine
npm test -- packages/game-engine/test
```

A Vitest-tesztek fix óra- és sorsolási értékekkel vizsgálják a teljes meccset, a tíz forduló × tíz játékos felső korlátot, pontozást, validációt, késői/ismételt eseményeket, idle-visszatérést, kilépést és technikai megszakítást. Fagyasztott bemenetekkel az állapotváltoztatás hiányát is ellenőrzik. A tesztek és a Node/Vitest típusai külön tesztkonfigurációban maradnak; az implementáció `types: []` beállítása változatlan.

2026-10-07-i ellenőrzés: a motor típusellenőrzése és 72 Vitest-tesztje sikeres. A teljes `npm run check` is sikeres: workspace- és teszttípusok, minden build, 72 motorteszt + 1 PostgreSQL/Drizzle-teszt, 2 fejlesztői és 2 éles kiszolgálási Playwright-teszt. A `npm run format:check` és `git diff --check` sikeres. A forrásimportok és a natív függőséghatár kódáttekintése megtörtént; új csomag vagy lockfile-módosítás nincs. Az első teljes ellenőrzés éles böngészőszakaszát a korábban indított fejlesztői szerver portfoglalása blokkolta; annak leállítása után az egész ellenőrzési sor átment. Az M1 tesztjei nem ellenőriznek még kliensoldali játékfolyamatot, authot vagy tényleges kérdésgenerátort.
