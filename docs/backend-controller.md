# M2 — Backendvezérlő és Socket.IO

Utolsó frissítés: 2026-10-07.

Az M1 natív motort az M2 szoba-/szólóvezérlő és a Socket.IO transport kapcsolja össze. A publikus szerződések, jogosultsági szabályok, többeszközös állapot, reconnect és aszinkron adapterhatárok tesztelhetők. A valódi Better Auth-, cookie-, PostgreSQL- és emailadapter az M3 feladata; a játékfelület az M4-é.

## Modulok és állapottulajdonos

| Modul                         | Felelősség                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src`      | Publikus típusok, szigorú Zod-payloadok, protokollverzió, angol üzenetkészletek. Nem importálja a motort.                                              |
| `application/game-service.ts` | Kapcsolatok, személyenként egy játékfolyamat, szobakód-index, azonosítás és ismétlésvédelem.                                                           |
| `application/controller.ts`   | Egy szoba és aktuális meccse, vagy egy önálló szólómeccs egyetlen állapottulajdonosa. Várószoba, ready, tulajdonosváltás, türelmi idők és visszatérés. |
| `application/match-runner.ts` | A natív motor átmeneteinek és következményeinek végrehajtása. A szülő vezérlő sorát használja.                                                         |
| `application/projection.ts`   | Címzett szerinti, külön másolt publikus DTO-k; a privát motorállapot nem kerül közvetlenül a hálózatra.                                                |
| `application/persistence.ts`  | Rövid checkpointok és meccsenként külön aszinkron mentési sor.                                                                                         |
| `application/ports.ts`        | Óra, időzítő, kérdésforrás, mentés és megbízható authadapter szerződése.                                                                               |
| `infrastructure`              | Node-óra/időzítők, kriptográfiai azonosítók és rögzített kérdéspéldák.                                                                                 |
| `transport/socket.ts`         | Kapcsolódási ellenőrzés, fogadási idő rögzítése, socketparancsok és visszaigazolások.                                                                  |
| `bootstrap/create-server.ts`  | Injektálható Express/HTTP/Socket.IO összeállítás, originellenőrzés és statikus frontend.                                                               |

A létrehozási nyilvántartás rövid, külön sorral dolgozik. A játékállapotot érintő parancsok, időzítők, kérdés-előkészítési és mentési visszajelzések ugyanannak a vezérlőnek a sorába kerülnek. Egy állapotmódosítás szinkron; adatbázis- vagy hálózati várakozás nem tartja fel ezt a sort. Más szobák saját sorral működnek. Egy összetett módosítás után egy koherens snapshot-verzió készül.

## Kapcsolódás és hitelesítés

A Socket.IO handshake `auth` mezője pontosan `{ protocolVersion: 1 }`. Más verzió esetén a szerver még az azonosítás előtt elutasítja a kapcsolódást. A `connect_error.data` publikus típusa `ConnectionErrorData`: `code` és `supportedProtocolVersion`. A `PROTOCOL_VERSION_UNSUPPORTED` angol üzenete oldalfrissítést kér. Ismeretlen handshake-mező hibás payload.

A személyazonosságot a szerver `Authenticate(headers, signal)` adaptere állapítja meg. A kliens által küldött user ID, nickname vagy szerepkör nem azonosítás. Az adapter legfeljebb öt másodpercet kap, és megszakítási jelet is fogad. Normál felhasználói sessionhez megerősített email szükséges. Vendég csak önálló szólómeccset indíthat.

**Az alapértelmezett indítás jelenleg minden játék-namespace kapcsolódását elutasítja**, mert az M3 authadapter még nincs bekötve. Nincs fejlesztői user ID-, token- vagy authmegkerülő végpont. Az Engine.IO technikai handshake, az API-health és a frontend alapváz továbbra is ellenőrizhető. A valódi socketintegrációs teszt saját szerveroldali, tesztben létrehozott credential-nyilvántartást injektál; ez nem része az alkalmazás indításának.

A böngésző origint a szerver pontos egyezéssel ellenőrzi. A `GAME_ALLOWED_ORIGINS` opcionális, vesszővel elválasztott originlista; üresen a helyi Vite-origin, production módban a helyi Node-origin az alapérték. A Node-tesztkliensek Origin nélkül is kapcsolódhatnak, de az authellenőrzés rájuk is érvényes. A socketüzenet maximális mérete 16 KiB. A Socket.IO automatikus kapcsolatállapot-helyreállítása nincs bekapcsolva: reconnect ismételt azonosítást és teljes snapshotot igényel.

## Parancsok és ismétlés

A pontos, fordítóval és futásidőben ellenőrzött payloadok forrása a [commands.ts](../packages/contracts/src/commands.ts). Minden parancs `requestId` mezőt és acknowledgement callbacket igényel. Callback nélkül nem történik állapotmódosítás.

| Parancsok                                | Működés                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `room:create`, `room:join`, `room:leave` | Szobatagság létrehozása, csatlakozás és minden eszközre érvényes kilépés.                             |
| `room:settings:update`, `room:ready`     | Tulajdonosi beállításverzió, illetve a várószobai ciklushoz kötött kívánt ready érték.                |
| `solo:start`, `match:leave`              | Önálló szólófolyamat indítása és elhagyása.                                                           |
| `category:select`, `answer:submit`       | Aktuális meccs/forduló/fázis vagy kérdés és szerveroldali részvétel alapján ellenőrzött motorbemenet. |
| `state:sync`, `time:sync`                | Jogosult teljes állapot, illetve szerveridő kérése.                                                   |

A strict Zod-objektumok a beágyazott ismeretlen mezőket is elutasítják. A kliens nem küldhet hiteles személyazonosságot, pontot, helyességet vagy fogadási időt. Az opciólista nem lehet üres, ismétlődő vagy hatnál hosszabb; az aktuális kérdés további szabályait a motor ellenőrzi.

A cache kulcsa a hiteles személy és `requestId`; a fingerprint a parancs neve és normalizált tartalma. Az opciók sorrendje nem számít. Az azonos, még futó kérés ugyanazt a Promise-t kapja, befejezés után tíz percig ugyanaz az acknowledgement jár. Eltérő tartalom ugyanazzal az azonosítóval `REQUEST_ID_CONFLICT`. A jogosultságot cached replay előtt is ellenőrizzük. Új request ID-val ismételt válasz esetén a motor őrzi az eredeti elfogadást a meccs teljes életére.

A memóriabeli cache legfeljebb 20 000 kérést, személyenként 2000-et tart; beteléskor új kérésre `RATE_LIMITED` érkezik. A még érvényes és futó bejegyzéseket nem dobjuk ki kapacitás miatt. A cache szerverújraindítást nem él túl; a kliens bizonytalan létrehozási parancsot lejárat után csak szinkronizálást követően kezelhet. Ez kapacitáskorlát, nem mért terhelési vagy teljes körű visszaélésvédelmi garancia.

## Idő és aszinkron következmények

A runtime óra egy induláskor rögzített Unix-időpontot kapcsol a Node monoton `performance.now()` órájához. A publikus időbélyegek Unix-milliszekundumok; a folyamat futása közben falióra-állítás nem tolja el a határidőket. A fogadási idő még aszinkron munka előtt rögzül. Egy korábban beérkezett válasz a sor feldolgozási késése miatt nem válik elkésetté; a határidővel egyező fogadási idő már elutasított.

Az időzítő az eredeti meccs-, fázisazonosítót és határidőt küldi vissza a sorba. Az új fázis a tényleges feldolgozási időből indul; egy késő callback nem futtat végig gyorsítva több fázist. Régi időzítő vagy kérdés-előkészítési eredmény nem módosítja az új fázist. A provider `AbortSignal`-t kap; a motor a visszaadott `unknown` kérdéscsomagot önállóan validálja.

Az indulási névsor és beállítások rögzülnek. A várószobai csatlakozás, unready, valódi beállításváltozás vagy kapcsolat/auth hiánya megszakítja az öt másodperces indulási visszaszámlálást. Az eldobott visszaszámlálásból nem keletkezik tartós meccsmentés. Tényleges beállításváltozás mindenkinek törli a ready értékét; azonos érték visszaküldése nem.

## Snapshot és több eszköz

Az egyetlen állapotesemény a `state:snapshot`; a publikus mezők és fázisok a [snapshots.ts](../packages/contracts/src/snapshots.ts) fájlban találhatók. A `protocolVersion`, `scope`, `stateVersion` és `serverTime` mellett külön `room`, `match`, `self`, `permissions` és `recentResult` szerepel. Egy új scope verzióját a kliens külön kezeli; korábbi acknowledgement nem írhat felül frissebb snapshotot.

- A kérdés előtti visszaszámlálás csak a kategóriát, sorszámokat és határidőt adja át.
- Nyitott kérdésnél csak az aktuális kérdés és opciói láthatók; helyesség és új pontok lezárás előtt nem.
- A saját elfogadott opciólista minden saját eszközön megjelenik. Mások konkrét opciólistája soha nem publikus.
- Kiértékeléskor helyes opciók és rövid kérdéseredmények, a végén rangsor és eredménybontás jelenik meg.
- Authazonosító helyett külön UUID tagság-/résztvevőazonosítók szerepelnek. Token, belső socket ID és jövőbeli kérdés nincs a DTO-ban.
- A DTO-k külön másolatok; a kézbesített objektum módosítása nem módosítja a játékot.

A kapcsolatnyilvántartás személy szerint küld. Egyik eszköz válasza minden eszközön zárol; csak az utolsó kapcsolat megszakadása jelent offline állapotot. Explicit kilépés után az elfogadott válasz még pontozható, a személy többé nem térhet vissza ugyanabba a meccsrészvételbe. Aktív játék alatt új vagy korábban kilépett tag sem csatlakozhat várakozóként.

Kilépéskor minden saját kapcsolat végső `closed` fázist kap, külön okkóddal; önálló szólómeccs utáni visszatérés is ezt használja. A megszüntetett scope-hoz nem küldünk új játékállapotot. A `recentResult` kizárólag az illető korábbi meccsének mentési státuszát követi, a várószobába vagy kezdőképernyőre visszatérés után is. Újonnan csatlakozott tag nem kapja meg más korábbi eredményét; kilépett tag a szoba következő meccséről sem kap adatot.

Az angol hibaszövegek, mentési státuszok, kimenetelek és megszakítási okok közös katalógusban szerepelnek. A hálózaton kódok és strukturált adatok utaznak; a későbbi fordítás nem igényel szervermondatok értelmezését. Ismeretlen hibakódnak általános angol fallbackje van.

## Session és várószobai helyfenntartás

A `GameService.connect` megbízható adaptertől kapott `Access`-t fogad: normál sessiont vagy egy konkrét meccsre érvényes visszatérési igazolást. A meccsigazolás csak létező meccs még részt vevő személyéhez használható. Új játékra, readyre, beállításra vagy általános HTTP-adatra nem jogosít.

A már azonosított élő kapcsolatok játékkezdetkor szűk, meccshez kötött jogosultságot kapnak. Normál session puszta lejárata az aktív játékot nem szakítja meg. Reconnecthez újra érvényes normál session vagy meccsigazolás kell. Az M3 adja ki és ellenőrzi a meccs indulásától fix harmincperces cookie/hash bizonyítékot; az M2 nem ad ki cookie-t és nem hosszabbít tokent.

A következő várószobában érvényes normál session kell. Hiányában ready=false és `authentication: required` jelenik meg, legfeljebb hatvan másodperces helyfenntartással. Offline állapot esetén külön hatvan másodperces határidő indul. **A kettő párhuzamosan fut; a korábban lejáró távolít el.** Reconnect csak az offline okot oldja fel, az újraazonosítási határidőt nem hosszabbítja. Azonos személyhez tartozó sikeres `refresh` feloldja az authhiányt, de nem állítja automatikusan readyre.

A szerver a már ellenőrzött normál session lejáratát offline állapotban is ismeri, amíg az adapter meg nem újítja vagy vissza nem vonja. Ez átmeneti lejárati nyilvántartás; a Better Auth `cookieCache` továbbra is kikapcsolt marad. A tényleges adatbázis-alapú HTTP-sessionellenőrzés, ötperces megújítás, következő várószobai újraellenőrzés és több authsession visszavonási hatóköre az M3 adapter feladata.

A `revoke(personId)` azonnal letiltja a személy kapcsolatainak parancsait, törli a request cache-t, majd a vezérlő sorában kiléptet és minden eszköznek lezárt snapshotot küld. Reset/fióktörlés számára ez a minden eszközre kiterjedő port. A normál kijelentkezés konkrét Better Auth-session hatókörét az M3-ban kell hozzáilleszteni; a játékból kilépés mindenképp közös.

A vendég a szólófolyamat végén már nem használhatja régi játékhozzáférését. Az `onGuestFinished` értesítésből az M3 megszünteti a HTTP-vendégsessiont/cookie-t is. Az `onMatchStarted` a cookie-kiadási koordináció értesítési pontja. Mindkét callback szinkron értesítés, külső munkát külön indít; kivételét kód alapján naplózzuk, a játékállapot és kilépés végrehajtása folytatódik.

## Mentési port

Bejelentkezett meccs tényleges indulásakor, minden kérdés lezárásakor és végén növekvő `revision`-nel teljes checkpoint készül. Tartalma: beállítások, státusz/időpontok, induláskori résztvevőnevek és azonosítók, lezárt pontok, rövid kérdéseredmények, végső rangsor. Nincs benne kérdésszöveg, opciószöveg, elfogadott választás vagy válaszidő. A vendégmeccs nem kap mentési feladatot.

A meccs mentési lánca külön fut. Köztes mentési hiba nem akadályozza a játékot, csak naplókódot ad. A következő checkpoint minden addigi lezárt eredményt tartalmaz, hogy az M3 tranzakciós adapter hiányzó rekordokat is pótolhasson. A végső mentés legfeljebb háromszor próbálkozik, két-két másodperces szünettel, mindvégig ugyanazzal a meccsazonosítóval és verzióval. Minden adapterhívás külön másolt payloadot kap.

A végső publikus státusz `pending`, `retrying`, majd `saved` vagy `failed`. A visszajelzés a vezérlő sorában módosítja a snapshotot; várószobai visszatérés vagy szobamegszűnés nem törli a mentési láncot. A runtime adapter jelenleg `null`, így bejelentkezett tesztmeccsnél `not_configured`, vendégnél `not_saved_guest` látszik. A retry és hibastátusz tesztadapterrel ellenőrzött; ez nem valódi PostgreSQL-meccsmentés.

Az M3 DB-adapternek kell megvalósítania a tranzakciókat, revision-ellenőrzést, upsertet, fióktörléssel közös zárakat és korlátozott DB-hívási időt. A függő, soha le nem záruló mentési hívás nem blokkolja a játékot, de az adott meccs mentési láncát feltartja. Leállításkor az M2 megszakítja a futó motort és leállítja a játékidőzítőket; tartós mentések korlátos drainje és restart-helyreállítása M3/M5 feladat.

## Kérdéspéldák és függőségek

A runtime rögzített Science, Geography és Mathematics kategóriákat használ, mindegyikben öt angol, egyszeres választású kérdéssel. Emiatt ezzel a forrással legfeljebb három forduló kérhető. A motor és publikus settings 1–10 fordulót támogat a ténylegesen elérhető kategóriák számáig. Ez integrációs mintaforrás; kérdésgenerálás, seed és újrajátszhatóság nem készült.

A natív motorhoz nem került dependency vagy Node/DOM ambient típus. A contracts `DOM` deklarációs könyvtára kizárólag a Zod publikus `URL` típusainak fordítói feloldásához került be; nincs böngésző-API használat a modellben. A szerver sockettesztje ugyanazt a már engedélyezett, lockfile-ban lévő `socket.io-client` 4.8.4 verziót deklarálja saját dev dependencyként. Nem frissült csomagverzió és nem került új csomag a feloldott gráfba.

A workspace-ek exportja a saját generált `dist` könyvtárukra mutat. A gyökér `dev`, `test`, `test:watch` és `typecheck` parancs ezért előbb `build:shared`-et futtat; friss klónozásnál és új publikus export hozzáadásakor sem függ korábbi buildmaradványtól. A közös források módosítása után futó fejlesztési/watch munkamenetben külön `npm run build:shared` és újraindítás szükséges.

## Ellenőrzés

A célzott M2-ellenőrzés 32 tesztje sikeres:

- Contracts: strict payloadok, hamis személy/idő/pont mezők, opcióhalmazok, beállításkorlátok és i18n-fallback.
- Vezérlő: teljes meccs, két eszköz közös zárolása, reconnect, tízfős korlát, tulajdonosváltás, ready/ciklusverzió és párhuzamos türelmi határidők.
- Aszinkron adapterek: lassú kérdésforrás/mentés mellett másik szoba működése, határidő előtti fogadás késői feldolgozással, lejárt callback, végső retry és hibastátusz visszatérés után.
- Adatvédelem és életciklus: kilépett/új tag hozzáférése, meccsigazolás hatóköre, auth-visszavonás, másolt snapshot, adapterértesítési hiba izolálása.
- Valódi Socket.IO: protokollütközés, hitelesítés/origin elutasítása, teljes többjátékos meccs, két eszköz, reconnect és minden eszközön lezárt snapshot.

Futtatás a repository gyökeréből:

```sh
npm test -- apps/server/test/controller.test.ts apps/server/test/adapters.test.ts apps/server/test/lifecycle-regressions.test.ts apps/server/test/socket.integration.test.ts packages/contracts/test
npm run check
npm run format:check
```

A teljes ellenőrzéshez a README szerinti helyi PostgreSQL szükséges. A böngészős tesztek jelenleg a fejlesztési és production alapvázat, API/proxyt és Engine.IO handshake-et vizsgálják; a játékfolyamatot az M2 szerver- és valódi sockettesztjei ellenőrzik. Better Auth-, SMTP2GO-, domainmigrációs vagy böngészős játékfelület-tesztet ez nem helyettesít.

A felhőkörnyezetben a generált engine/contracts/server/web `dist` könyvtárak eltávolítása után futtatott `npm run check` sikeres: mind a négy workspace és a tooling típusellenőrzése, teljes build, **105 Vitest-teszt** (72 motor + 32 M2 + 1 PostgreSQL), **2 fejlesztési és 2 production Chromium-teszt**. A `npm run format:check` és `git diff --check` is sikeres. Az első teljes futás elavult contracts-deklaráció miatt hibázott; a javított közös build-sorrendet a tiszta generált állapotból induló futás ellenőrizte. Ezek helyi eredmények, nem GitHub CI- vagy deployment-eredmények.
