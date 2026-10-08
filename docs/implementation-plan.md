# MVP megvalósítási terv

Utolsó frissítés: 2026-10-08.

Kapcsolódó specifikációk:

- [MVP tervezési dokumentum](design.md)
- [Authadapterek és meccsvisszatérés](auth-adapters.md)

Ez a dokumentum a megvalósítás sorrendjét és ellenőrzési feltételeit rögzíti. Az M0–M3 változásait a felhasználó mainbe merge-ölte és engedélyezte az M4 frontendjét, saját designskillekkel és CSS-változókkal. Az elkészült M1 részletei a [motor dokumentációjában](game-engine.md), az M2 a [backend dokumentációjában](backend-controller.md), az M3 az [auth/mentés dokumentációjában](backend-auth-storage.md), az M4 a [frontend dokumentációjában](frontend.md) olvasható. A deployment későbbi mérföldkő. A környezetkonfigurációt és M0 eredményeket a [környezeti dokumentum](development-environment.md) rögzíti; a [magyar adatbázis-útmutató](database-guide.md) az M3 használatát mutatja.

## 1. Elfogadott alapok

- Moduláris monolit, külön frontend/backend/motor/publikus szerződés egységekkel ugyanabban a repóban.
- npm workspaces monorepó, egy közös gyökér-package-lock.json fájllal; egységenként saját package.json és külön függőséglisták.
- Node.js 24 LTS és Express HTTP-keretrendszer; konkrét javító- és csomagverziók a kompatibilitás-ellenőrzés után rögzítendők.
- Workspace-mappák: apps/web, apps/server, packages/game-engine és packages/contracts.
- Vitest a motor- és szervertesztekhez, Playwright a böngészős folyamatok ellenőrzéséhez; fejlesztési függőségek, nem a motor implementációjának részei.
- Élesben ugyanaz a Node-folyamat szolgálja ki a frontend buildet, API-t, authot és Socket.IO-t.
- Natív TypeScript-játékmotor, külső könyvtárfüggőség és I/O nélkül.
- Szobánként/önálló meccsenként egy állapottulajdonos és állapotmódosítási sor; külön időzítő- és mentési adapter.
- PostgreSQL, Drizzle, Better Auth email + jelszó és Resend HTTPS emailadapter, külön SDK nélkül.
- Normál authsession 30 perc, aktív használat mellett 5 perces megújítási célütemmel; vendégsession 15 perc, 5 percenkénti HTTP-ellenőrzéssel újabb 15 percre megújítható, a végeredmény-képernyő végén megszűnik.
- Better Auth cookieCache az MVP-ben kikapcsolva; a normál sessionellenőrzés szerveroldalon, az adatbázis alapján történik.
- Elsőként rögzített kérdéskészlettel ellenőrizhető működés; a tényleges kérdésgenerálás és seedalapú újrajátszhatóság későbbi tervezési feladat.
- Felhasználónként egy játékfolyamat; több eszköz közös meccsrészvétel és válaszállapot.
- Üres bevárandó lista esetén a kérdés rendes határidőig nyitott; technikai megszakítás után 15 másodperces jelzés és visszatérés.

## 2. Projektalapok — elfogadott döntések és fennmaradó javaslatok

| Terület                  | Kiindulás                                    | Státusz / megjegyzés                                                                              |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Node                     | Node.js 24 LTS                               | Elfogadott. Implementáció előtt csomagkompatibilitás-ellenőrzés és konkrét 24.x verzió rögzítése. |
| Csomagkezelés            | npm workspaces, egy gyökér-package-lock.json | Elfogadott. Egységenként saját package.json, külön függőséglisták.                                |
| TypeScript               | strict ellenőrzés                            | Konkrét stabil verzió kompatibilitás alapján rögzítendő.                                          |
| Backend HTTP             | Express                                      | Elfogadott. Konkrét csomagverzió és Better Auth-integráció ellenőrzendő.                          |
| Frontend                 | React + Vite                                 | M4: kis History API-router, React külső store-feliratkozással.                                    |
| Adatbázis                | PostgreSQL                                   | Helyi és éles főverzió legyen azonos; konkrét főverzió még nyitott.                               |
| Helyi adatbázis          | Docker Compose vagy natív PostgreSQL         | Választás a fejlesztési környezet képességei szerint.                                             |
| Motor- és szervertesztek | Vitest, vezérelhető idő/sorsolás             | Elfogadott. A motor implementációjában nincs tesztkönyvtár-import.                                |
| Böngészős E2E            | Playwright                                   | Elfogadott. Külön fejlesztési eszköz; a motor implementációjába nem kerül.                        |

Elfogadott mappaegységek: apps/web, apps/server, packages/game-engine, packages/contracts. Az M0-ban a négy workspace konfigurációja és minimális belépési pontjai elkészültek; a domainmodulok belső könyvtárszerkezete későbbi megvalósítási részlet.

A gyökércsomag a workspace-ek közös parancsait és közös fejlesztői eszközeit fogja össze. A frontend és a backend saját csomagjában deklarálja a függőségeit; a közös lockfile nem teszi ezeket minden egység függőségévé. A motor implementációja továbbra sem használ külső könyvtárat. Az M0-ban a package.json fájlok, lockfile és workspace-konfiguráció elkészültek. Az M1-ben a motor működő implementációt kapott; az M2-ben a contracts publikus típusokkal, Zod-validációval és angol üzenetkészletekkel bővült.

## 3. Mérföldkövek

### M0 — Projektalap és technikai ellenőrzések

Cél: rögzített, kompatibilis eszközök és megismételhető helyi fejlesztési alap.

Feladatok:

- Az elfogadott workspace-mappák és konfigurációjuk létrehozása, a belső könyvtárszerkezet pontosítása.
- Node/csomagverziók rögzítése, lockfile és egységenkénti függőségek.
- Helyi PostgreSQL és titkok nélküli konfigurációs minta.
- Backend és Vite helyi közös originű proxyterve; éles statikus kiszolgálás határai.
- Better Auth fióktörlési integrációjának ellenőrzése: mely támogatott mechanizmus tudja koordinálni a saját adatokkal?
- Payload-validátor kiválasztása a contracts egységhez, a motorfüggetlenség megőrzésével.
- CI-alap: típusellenőrzés és build; tesztek akkor kerülnek hozzá, amikor érdemi tesztek készülnek.

Kilépési feltétel: minden egység ellenőrizhető/buildelhető; a motornak nulla külső implementációs importja van; a titkok és szerver-only adatok nem jutnak a frontend buildbe. A authtörlés koordinációjának bizonyítatlan feltételezése nem marad rejtett.

### M1 — Önálló játékmotor

Megvalósítás: [motor API és integrációs határok](game-engine.md). A kilépés előtti elfogadott válasz még kiértékelődik; a bevárandó lista kérdésnyitáskor rögzül, kilépéskor szűkül, az idle-visszatérő a következő kérdéstől kerül bele. Ezeket a felhasználó az implementáció közbeni pontosításkor elfogadta.

Cél: egy teljes meccs lefutása felület, socket és adatbázis nélkül.

Feladatok:

- Belső domain- és fázistípusok az elfogadott szöveges specifikációból.
- Natív állapotátmenetek, kérdésvalidáció, kategóriaválasztás és pontozás.
- Parancsok és időbemenetek; a tényleges óra/időzítő kívül marad.
- Rögzített kérdéspéldányok és kontrollálható sorsolási bemenet a tesztekhez.
- Explicit kilépés, idle, üres bevárandó lista, fordulóváltás és végeredmény.

Kilépési feltétel:

- Teljes meccs és technikai megszakítás végigtesztelhető.
- Dupla válasz/időzítő nem dupláz pontot vagy lezárást.
- Határidő pontos egyezése elutasított.
- Pontozási szélső esetek, minden opció kijelölése és részpont ellenőrzött.
- Nincs motorból indított I/O, időzítő vagy rejtett véletlenforrás.

### M2 — Backendvezérlő és socket-szerződés

Megvalósítás: [backendvezérlő, publikus protokoll és adapterportok](backend-controller.md). 32 célzott M2-teszt ellenőrzi a szoba-/szólófolyamatot, versenyhelyzeteket, adatvédelmet és valódi Socket.IO-klienseket. A felhasználó elfogadta a v1 protokollütközés miatti kapcsolódás-elutasítást, a minden eszközre küldött végső `closed` snapshotot és az offline/auth türelmi idők párhuzamos futását a korábbi határidő érvényesítésével. Az alapértelmezett bootstrap még nem azonosít felhasználót; tesztadapterrel igazolt jogosultság nem jelent kész Better Auth-integrációt.

Cél: a motor valós idejű szerverfolyamatban működik, érvényes publikus állapotot küld.

Feladatok:

- Szoba-/meccsvezérlők, személyenkénti játékfolyamat-index és kapcsolati nyilvántartás.
- Állapotmódosítási sor, időbélyegzés, időzítőadapter és késői események eldobása.
- Contracts típusok és futásidejű payload-validáció.
- Socketparancsok, requestId szerinti ismétléskezelés és személyre szabott snapshotok.
- Angol üzenetkulcsok, hibakódok és állapotverziók.
- Mentési adapter interfésze és teszthelyettesítője; valódi DB-művelet az M3-ban.

Kilépési feltétel:

- Tesztkliensekkel több külön szoba/meccs működik egymástól függetlenül.
- Egy meccsben parancs/időzítő/aszinkron eredmény nem módosít párhuzamosan állapotot.
- Publikus DTO nem szivárogtat helyes opciót, jövőbeli kérdést vagy idő előtti pontot.
- Két kapcsolat közös válaszállapothoz jut; reconnect teljes snapshotot kap.
- Tesztszemélyekkel a jogosultsági szabályok ellenőrizhetők. Éles felhasználói hitelesítés még nem minősül késznek.

### M3 — Tartós adatok, auth és email

Megvalósult: generált authséma és közös domainséma, két verziózott migráció, tranzakciós mentés/törlés, HTTP/socket sessionhíd, vendég- és meccscookie, emailküldési sor és cserélhető emailadapter. Az eredeti SMTP2GO-adaptert a felhasználó 2026-10-08-i döntése alapján Resend HTTPS-adapter váltja fel. Valódi Resend-kézbesítés konfiguráció hiányában külön, még nem ellenőrzött lépés. A normál kijelentkezés a felhasználó új döntése alapján minden authsessiont visszavon minden eszközön. Böngészőoldali megújítási ütemezés az M4-ben megvalósult.

Cél: a tényleges PostgreSQL és Better Auth integráció támogatja az elfogadott életciklust.

Feladatok:

- Better Auth sémagenerálás és saját táblák közös, átnézett Drizzle-migrációi.
- Profil, meccs, résztvevő, kapcsolatok és rövid kérdéseredmények.
- Tranzakciók, mentési verziók, hiányzó checkpointok pótlása és végső retry.
- Email/jelszó, email-megerősítés, semleges reset-válasz és jelszóvalidáció.
- Resend HTTPS-adapter és elkülönített emailküldési sor, szolgáltatófüggetlen porttal.
- 30 perces megújítható authsession, 5 perces megújítási célütem; HTTP-kliensfolyamat és háttérben felfüggesztett lapok kezelése. A megújítható 15 perces vendégsession HTTP-folyamatának kialakítása, a meccsvisszatérési cookie fix határidejének megőrzésével.
- Meccskezdethez kötött fix 30 perces visszatérési cookie, hashnyilvántartás és HTTP-kiadás.
- Logout/reset/törlés visszavonásai, több eszköz koordinációja.
- Fióktörlés, szólóadatok eltávolítása és közös eredmények anonimizálása.

Előfeltételek:

- Helyi PostgreSQL rendelkezésre áll.
- A fióktörlési integráció támogatott megoldása tisztázott.
- Valódi emailkézbesítéshez Resend API-kulcs és ellenőrzött küldő domain kell; külön feladópostaláda nem szükséges. Tesztadapterrel az önálló munka ettől függetlenül folytatható.

Kilépési feltétel:

- Valódi adatbázison érvényesek az FK/unique szabályok és a tranzakciós visszagördülés.
- Elmaradt köztes mentésből a következő/végső mentés teljes eredményt tud létrehozni.
- Újraindítás megszakítottként rendezi a korábbi in_progress meccseket.
- Reset és fióktörlés visszavonja a meccsengedélyt a már nyitott socketeken is.
- Törölt személyes adat késői mentésből nem áll vissza.
- Emailadapter tesztje és valódi szolgáltatói kézbesítési próba külön eredményként szerepel; az utóbbi hozzáférés nélkül nem nevezhető ellenőrzöttnek.

### M4 — Teljes frontend és felhasználói folyamat

Megvalósult: mobilra épített világos/sötét felület, helyi fontok, teljes auth/profil/history és solo/lobby/meccsfolyamat, runtime response-validáció, ötperces HTTP-sessionellenőrzés és újracsatlakozás. Hat valódi böngészős M4-folyamat sikeres; részletek és ellenőrzési határok a [frontend dokumentációjában](frontend.md). A mintakérdés-provider változatlan, a frontend a szerver által közölt fordulókorlátot használja.

Cél: angol MVP-felületen végigjátszható vendég és bejelentkezett meccs.

Képernyők/folyamatok:

- Vendég szólóindítás, kategória, visszaszámlálás, válasz, kiértékelés és eredmény.
- Regisztráció, email-megerősítés, belépés, elfelejtett jelszó és új jelszó.
- Profilnickname és 1000-es ELO kijelzése, fióktörlés.
- Szobalétrehozás, csatlakozás, tulajdonos, beállítások, ready és offline jelzések.
- Újracsatlakozás, sessionlejárat, 60 másodperces újraazonosítás.
- Mentési állapot, saját meccselőzmények és kérdésenkénti rövid bontás.
- Törölt felhasználó megjelenítése, technikai megszakítás és visszatérés.

Kilépési feltétel:

- Legalább két valódi böngészőkontextussal végigfutó többjátékos meccs.
- Több tab/eszköz ugyanazt a zárolt választ mutatja.
- Kérdés és opciók csak megnyitáskor láthatók; kategórianév a visszaszámlálás alatt megjelenik.
- Vendégnek nincs tartós eredmény; utólagos belépés nem menti el a vendégmeccset.
- Reset/verify és hibakódok angolul jelennek meg, beégetett szervermondat-függés nélkül.

### M5 — MVP üzemeltetési és kiadási ellenőrzés

Cél: a kiválasztott hostingon megismételhető, ellenőrzött működés.

Feladatok:

- Render aktuális Node/WebSocket/PostgreSQL és migrációs lehetőségeinek ellenőrzése.
- Egy origin, statikus Vite build, API és Socket.IO helyes útvonalkezelése.
- CI, build/start, migrációalkalmazás és titkos konfiguráció.
- Leállítás/újraindítás és folyamatban lévő mentések pontos kezelése.
- Több szobás, szobánként legfeljebb tízfős reprezentatív próba.
- Naplózás és provider/DB-hibák ellenőrzése; tényleges kapacitásmérés alapján korlátok.

Kilépési feltétel: működő bejelentkezett és vendégfolyamat, valós email és adatbázis, ellenőrzött megszakítás/reconnect, ismételhető build és migráció. Nem teszünk mérés nélküli kapacitásígéretet.

A deployment előkészítése nem azonos az éles publikálással; annak engedélyezését az aktuális felhasználói utasítás alapján kezeljük.

## 4. A következő mérföldkő előtt

Az M4 áttekintése után az M5-höz szükséges csomag:

1. Valódi Resend-konfiguráció, DNS-ben ellenőrzött feladó és tényleges verification/reset kézbesítési próba a [Resend útmutató](email-guide.md) szerint. Az emailtesztadapter nem váltja ki ezt.
2. Hosting és aktuális Node/WebSocket/PostgreSQL/migráció támogatásának ellenőrzése; közös HTTPS-origin és titkos konfiguráció.
3. Reprezentatív több szobás próba, mért kapacitás, naplózás és provider/DB hibák üzemeltetési ellenőrzése.
4. Kiadási/CI ellenőrzések a végleges hostingon. Éles publikálás a felhasználó aktuális utasítása alapján történik.

Nem szükséges a seed/generálás, tiebreak, ELO-algoritmus, social login vagy profilkép előrehozása az MVP-hez. Ezek továbbra is külön későbbi tervek.

A teljes implementáció mérföldkövenként készül. Az M0/M1/M2 helyi ellenőrzési eredményeit a kapcsolódó dokumentumok rögzítik; ezek nem igazolják előre az M3–M5 integrációit.
