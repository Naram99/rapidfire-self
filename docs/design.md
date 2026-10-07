# Rapidfire — MVP tervezési dokumentum

Utolsó frissítés: 2026-10-07.

Ez a dokumentum a beszélgetésben elfogadott termék-, adatmodell-, socket- és tranzakciós döntéseket foglalja össze. Nem SQL-séma vagy TypeScript-típusdefiníció. Az engedélyezett M0 környezet, M1 natív motor és M2 backendvezérlő/socket elkészült; részleteik a kapcsolódó megvalósítási dokumentumokban szerepelnek. Valódi auth-, email-, domainséma- és migrációs integráció még nem készült.

## 1. Státusz és hatókör

### Elfogadott tervek

- Játékszabályok és időzítések.
- Domainmodell és kliens–szerver socket-szerződés MVP-alapja.
- PostgreSQL-táblaterv és mezőszintű specifikáció.
- Mentési, újrapróbálási és fióktörlési tranzakciós terv.
- Angol MVP-felület, későbbi i18n-re alkalmas rendszerüzenetekkel.
- Moduláris monolit, egy Node szolgáltatásból kiszolgált frontenddel és backenddel az MVP-ben.
- npm workspaces monorepó, egy közös gyökér-package-lock.json fájllal, egységenként saját package.json és külön függőséglisták.
- Node.js 24 LTS és Express HTTP-keretrendszer; konkrét verziók kompatibilitás-ellenőrzés után rögzítendők.
- Workspace-mappák: apps/web, apps/server, packages/game-engine és packages/contracts. Vitest a motor- és szervertesztekhez, Playwright a böngészős folyamatokhoz.
- Külön mappában élő, natív TypeScript-játékmotor, harmadik féltől származó könyvtárfüggőség nélkül.
- Alkalmazási rétegbeli állapottulajdonos és egy sor az állapotváltozásokhoz szobánként vagy önálló meccsenként; külön időzítőadapter és mentési sor.
- Játék közben nincs kijelentkezési gomb; explicit kijelentkezés meccsből kilépést, fióktörlés kilépést és végül kijelentkezést okoz.
- Authsession puszta lejárata nem távolítja el az aktív meccs résztvevőjét, idle állapotban sem; új játékhoz ismét érvényes azonosítás szükséges.
- Meccshez korlátozott jogosultság; a következő várószobában legfeljebb 60 másodperces újraazonosítási helyfenntartás; vendégjogosultság megszüntetése a végeredmény-képernyő végén.
- Az MVP belépési módja email + jelszó, Better Auth használatával. Google, Apple és egyéb szolgáltatói belépés későbbi fejlesztés.
- Linkes email-megerősítés és emailből indítható jelszó-visszaállítás; legalább 8 karakteres, kisbetűt, nagybetűt, számot és speciális karaktert tartalmazó jelszó, regisztrációkor és módosításkor megerősítő jelszómezővel.
- A Better Auth session 30 perces, folyamatosan megújítható élettartamú; nincs belépéstől számított 24 órás abszolút korlát.
- Normál authsession megújításának célüteme aktív használat mellett 5 perc. Később mérés alapján 10 percre növelhető. Vendégsession élettartama 15 perc, aktív használat mellett 5 percenkénti HTTP-ellenőrzéssel újabb 15 percre megújítható; a végeredmény-képernyő végén megszűnik.
- A Better Auth cookieCache az MVP-ben kikapcsolt; normál hitelesítésnél szerveroldali sessionellenőrzés történik.
- Email-megerősítés nélkül nem lehet bejelentkezni; a vendég egyjátékos mód továbbra is elérhető.
- Helyreállítási link: 15 perc, egyszer használható. Email-megerősítési link: 24 óra. Újraküldés legfeljebb percenként. Sikeres jelszó-visszaállítás minden korábbi sessiont és meccsjogosultságot visszavon.
- Szolgáltatófüggetlen SMTP emailadapter Nodemailerrel és ingyenes MVP-szolgáltatóval; memóriabeli küldési sor: 5 másodperces timeout, legfeljebb három próbálkozás, 2/8 másodperces szünetek. HttpOnly cookie-s meccsvisszatérés, szerveroldali hashnyilvántartással, a meccs indulásától számított fix 30 perces érvényességgel, játék közbeni hosszabbítás nélkül.
- Az MVP emailprovidere SMTP2GO; az SMTP-adapter és konfiguráció megőrzi a könnyű szolgáltatócserét.
- Felhasználónként egy játékfolyamat: szobatagság mellett nem indul külön szólómeccs. Ha senkit nem várunk be, a kérdés a rendes határidőig nyitott. Technikai megszakítás után 15 másodperces jelzés, majd várószoba/vendég-kezdőképernyő.

### Még nem véglegesített részletek

- Az elfogadott négy workspace-mappa belső könyvtárszerkezete, az npm workspace konfigurációja és a modulhatárok implementációs részletei.
- Authsession-frissítés kliensfolyamata, vendégsession megújításának technikai folyamata, SMTP2GO tényleges bekötése, csomagverziók és deployment-részletek. A normál session 5 perces megújítási célüteme, a vendégsession aktív használat mellett megújítható 15 perces élettartama és a Better Auth cookieCache kikapcsolása már elfogadott.
- Better Auth fióktörlésének illesztése a közös törlési folyamathoz.
- Kérdésforrás, kérdésgenerálás, seed és reprodukálhatósági szerződés.
- Néhány szélső eset és fizikai adatbázis-validáció; ezeket a 12. fejezet sorolja fel.

Az elfogadott terméktervek önmagukban nem jelentenek kipróbált működést. Az M0 technikai alap és környezeti ellenőrzések eredményeit a [környezeti dokumentum](development-environment.md), az M1 és M2 tényleges tesztjeit a [motor](game-engine.md) és [backendvezérlő](backend-controller.md) dokumentációja rögzíti. Valódi auth és tartós domainadatok továbbra is későbbi integrációk.

## 2. Termék és technológiai kiindulás

### Termék

- Regisztráció nélküli egyjátékos mód.
- Bejelentkezéshez kötött többjátékos mód, szobakódos csatlakozással.
- Szobánként legfeljebb 10 játékos; egy bejelentkezett játékossal is indítható.
- Egyéni játék és pontozás.
- Szerver által automatikusan vezérelt meccsek.
- Választható fordulószám; fordulónként egy kategória és pontosan öt kérdés.
- Egyszeres és többszörös választás, kérdésenként 2, 4 vagy 6 opcióval.

### Technológiai kiindulás

| Terület | Korábbi ajánlás / kiválasztott irány |
|---|---|
| Frontend | React, Vite, TypeScript. |
| Backend | Node.js 24 LTS, TypeScript, Express — elfogadott. |
| Realtime | Socket.IO. |
| Tartós adatok | PostgreSQL. |
| ORM és migráció | Drizzle ORM és Drizzle Kit. |
| Auth | Better Auth, Drizzle-adapterrel. |
| Hosting | Render kiindulási platform; konkrét szolgáltatások még nincsenek beállítva. |

A frontend-router, a konkrét verziók és a deployment részletei még nyitottak. Az MVP auth-belépési módja email + jelszó; frontendjét és backendjét ugyanaz a Node szolgáltatás szolgálja ki. A korábbi Render-korlátokat éles beállítás előtt aktuális dokumentációból kell ellenőrizni.

Az MVP egyetlen backendpéldányra készül. Redis, több backendpéldány és aktív meccsek újraindítás utáni folytatása későbbi feladat.

## 3. Játékszabályok

### 3.1. Szoba, profil és indulás

- Egy felhasználó egyszerre egy szobának lehet tagja. Másikba lépéshez előbb explicit kilép.
- Egy felhasználónak egyszerre egy játékfolyamata lehet. Többjátékos szobatagság mellett nem indíthat külön szólómeccset; ehhez előbb ki kell lépnie a szobából. Ez több eszközről indított kérésekre is érvényes.
- Több eszköz és böngészőfül ugyanahhoz a tagsághoz és válaszállapothoz kapcsolódik.
- Új tag ready állapota false.
- Legalább egy tag és mindenki ready állapota esetén automatikus indulási visszaszámlálás kezdődik.
- Új belépő, ready visszavonása vagy kilépés megszakítja a visszaszámlálást. A megmaradt tagok alapján az indulási feltétel újraértékelhető.
- A tulajdonos várószobában vagy indulási visszaszámlálás alatt módosíthatja a beállításokat. Tényleges változás minden ready jelzést töröl és megszakítja az indulást.
- Tulajdonos távozásakor a leghosszabb ideje bent lévő megmaradt játékos veszi át a szerepet.
- Az utolsó tag explicit kilépése törli a szobát és megszakítja az esetleges aktív meccset.
- A résztvevőlista és a meccsbeállítások a meccs indulásakor rögzülnek.
- A nickname a profiloldalon módosítható, nem egyedi, legfeljebb 40 karakter. Az MVP-ben nincs foglaltság- vagy tartalomellenőrzés.
- A profil és a következő meccsek az új nevet használják; az aktuális és korábbi meccsekben az induláskori név marad. Fióktörléskor a tárolt neveket is eltávolítjuk.
- A profilnév-módosítás folyamatába később beilleszthető névellenőrzés: ütköző, rasszista vagy káromkodó nevek tiltása.

### 3.2. Időzítések és korlátok

| Beállítás | MVP-érték |
|---|---|
| Indulási visszaszámlálás | 5 másodperc. |
| Kategóriaválasztás | 15 másodperc. |
| Kérdés előtti visszaszámlálás | 3 másodperc. |
| Válaszadási idő | Alapérték 20 másodperc; állítható egész másodpercben, 5–60 között. |
| Közös kiértékelés | 5 másodperc. |
| Végeredmény | 15 másodperc, majd közös visszatérés a várószobába. |
| Várószobai offline türelmi idő | 60 másodperc. |
| Kérdés-előkészítés | Legfeljebb 15 másodperc próbálkozásonként; egy újrapróbálás. |
| Fordulók száma | 1–10, legfeljebb az adott meccshez használható kategóriák száma. |

Csak a határidő előtt szerverre érkezett új válasz/választás fogadható el. A határidővel pontosan egyező időpont már elkésett. A kliens időadata nem hiteles bemenet.

### 3.3. Kategóriaválasztás

- A még részt vevő, aktív játékosok közül a legkevesebb ponttal rendelkező választ.
- Pontazonosságnál sorsolás; az első fordulóban mindenki nulla ponttal indul.
- Az offline, de még aktív résztvevő jogosult marad.
- Ha minden részt vevő játékos idle, a szerver választ.
- Legfeljebb négy különböző, még nem játszott kategóriát kínálunk.
- Ha négynél kevesebb maradt, mindet felkínáljuk. Egyetlen opciónál automatikus választás történik.
- A kiválasztott kategória nem ismétlődhet a meccsben. A felkínált, de ki nem választott kategória később újra megjelenhet.
- Határidő lejártakor a szerver sorsol a kínálatból, akkor is, ha a kijelölt játékos időközben kilépett.
- A kínálat összeállítása, a választó kijelölése és a választás eldöntése külön szabály marad, hogy később szavazás is bevezethető legyen.

### 3.4. Kérdések és válaszok

- A kérdés előtti visszaszámlálás alatt felül a kategória neve látható, a kérdés és opciók még nem.
- A kérdésszöveget és opciókat a szerver csak a kérdés megnyitásakor küldi el.
- Egyszeres választásnál az opcióra kattintás beküldést jelent.
- Többszörösnél külön submit szükséges; üres választás nem fogadható el.
- A szerver résztvevőnként és kérdésenként egy választ fogad el. Az első elfogadott válasz minden eszközön zárol.
- Az ismétlés nem módosít és nem pontoz újra.
- Nyitott kérdésnél megjeleníthető, ki válaszolt már, de a helyesség és az aktuális kérdés pontjai még nem.
- Minden bevárandó résztvevő válasza után a kérdés korábban lezárulhat; egyébként a határidő zárja le.
- Ha nincs egyetlen bevárandó résztvevő sem, a kérdés a rendes határidőig marad nyitott. Az üres bevárandó lista nem okoz azonnali lezárást; az idle résztvevő addig visszaaktiválódhat egy érvényes válasszal.
- A lezárás és pontozás egyszer történik meg; késői időzítő nem zárhat másik kérdést.
- Nem válaszolás esetén 0 pont jár.
- Lezárás után közös kiértékelés következik.

### 3.5. Pontozás

Egyszeres helyes válasz gyorsasági értéke:

**500 + 500 × (1 − eltelt idő / időkeret)**

Hibás vagy megválaszolatlan kérdés: 0 pont.

Többszörös választásnál a gyorsasági értéket a minőséggel szorozzuk:

**max(0, helyesen kijelölt / összes helyes − tévesen kijelölt / összes hibás)**

- A végső pont egész számra kerekített, nemnegatív.
- Minden helyes opció, hibás jelölés nélkül: teljes pont.
- Részleges helyes kijelölés: részpont, amelyet a téves jelölések csökkentenek.
- Minden opció kijelölése: 0 pont.
- Többszörös kérdésben legalább egy helyes és egy hibás opció szükséges.
- Az eltelt időt a szerver a megnyitástól a válasz beérkezéséig méri; a hálózati késést az MVP nem kompenzálja.

A kiértékelés külön jelöli: teljesen helyes, részben helyes, hibás, megválaszolatlan. Egy részben helyes válasz is lehet 0 pontos.

### 3.6. Kapcsolat, aktivitás és kilépés

Három külön tulajdonságot kezelünk:

| Fogalom | Értékek |
|---|---|
| Kapcsolati jelenlét | online / offline. |
| Aktivitás | aktív / idle. |
| Meccsrészvétel | részt vesz / explicit kilépett. |

- Offline csak az utolsó hitelesített kapcsolat megszűnésekor lesz a játékos.
- Várószobában ez ready = false állapotot és az indulás megszakítását okozza.
- A tagság 60 másodpercig megmarad offline jelzéssel. Visszatéréskor a ready false marad.
- A türelmi idő lejárta eltávolítja a tagot; szükség esetén tulajdonosváltás vagy szobatörlés történik.
- Aktív meccsben a kapcsolatvesztés nem explicit kilépés és nem indít várószobai eltávolítást.
- Öt egymást követő, elfogadott válasz nélkül lezárt kérdés után a résztvevő idle lesz.
- Idle játékost nem kell bevárni a korai lezáráshoz.
- Egy nyitott kérdésre adott elfogadott válasz nullázza a kihagyásokat és aktívvá tesz.
- Heartbeat és tetszőleges technikai üzenet nem állítja vissza az aktivitást.
- Explicit kilépés után az eredmény megmarad, a résztvevőt többé nem várjuk be, nem választ kategóriát és ugyanabba a meccsbe nem térhet vissza.
- Explicit kilépés után nem keletkeznek további kihagyások vagy kérdéseredmények számára.

Implementációkor elfogadott pontosítás: a kilépés előtt már elfogadott válasz a kérdés lezárásakor még kiértékelődik. A bevárandó lista a kérdés megnyitásakor rögzül, kilépéskor szűkülhet; az idle állapotból visszatérő a következő kérdéstől kerül vissza bele. Ha a lista kilépés miatt üresre szűkül, de marad meccsrésztvevő, a rendes határidő zárja a kérdést.

Aktív meccs alatt új játékos és explicit kilépett résztvevő sem csatlakozhat várakozóként. Az elutasítás kódja `ROOM_GAME_ACTIVE`. A magyarul egyeztetett jelentés: „A szobában aktív játék zajlik, csak várószobába lehet csatlakozni”. Angol MVP-szöveg:

> A game is in progress in this room. You can join once the room returns to the lobby.

A még részt vevő, hálózati szakadás után visszatérő játékos hitelesítés után visszaengedhető. Szobakód önmagában nem bizonyít korábbi részvételt.

### 3.7. Végeredmény és megszakítás

- Azonos pontszámhoz azonos helyezés tartozik, kihagyással: 1., 1., 3.
- Tiebreak későbbi tervezési feladat.
- 15 másodperc után a szoba közösen várószobává válik, a ready jelzések törlődnek.
- Az ekkor offline tagoknál elindul a 60 másodperces várószobai türelmi idő.
- Két sikertelen kérdés-előkészítési próbálkozás technikai megszakítást okoz; addigi eredmények megmaradhatnak, végleges győztes nincs.
- Technikai megszakítás után 15 másodperces megszakítási képernyő jelenik meg, majd a még létező szoba várószobává válik, minden ready jelzést törölve. Vendég az egyjátékos kezdőképernyőre tér vissza. Újraindítás után már nem létező szobát ez nem hoz létre újra.
- Backend-újraindítás megszakítja az aktív meccset; az MVP nem állítja helyre a játékmenetet.

### 3.8. Vendég egyjátékos mód

- Közös játékmotor, de nincs megosztható szobakód és többjátékos szobatagság.
- Az indítógomb közvetlenül elindítja az 5 másodperces visszaszámlálást.
- Szerver által kiadott, védett cookie-val kezelt vendégsession azonosítja a játékost.
- Ugyanabban a böngészőben, érvényes sessionnel oldalfrissítés vagy hálózati szakadás után a még futó meccs folytatható.
- Másik eszközre átvitel nincs az MVP-ben.
- A vendégmeccs nem kap tartós eredménymentést; eredménye csak az aktuális kiértékelő képernyőn érhető el.
- A vendégjogosultság a futó szólómeccsre és kiértékelésére korlátozott; a végeredmény-képernyő végén érvénytelenítjük.
- Utólagos bejelentkezés nem menti el a befejezett vendégmeccset.
- A felhívás a következő meccsre vonatkozik: „Sign in before your next game to save your results.”

## 4. Domainmodell és állapotgép

| Modell | Felelősség |
|---|---|
| Room | Szobakód, tulajdonos, aktuális tagok, következő meccs beállításai, aktuális meccs. |
| RoomMember | Felhasználó szobatagsága, csatlakozási sorrend, ready, kapcsolati jelenlét és türelmi határidő. |
| Match | Rögzített résztvevők és beállítások, fordulók, aktuális fázis, kimenetel. |
| Participant | Meccsazonosság, felhasználó/vendég kötés, pontszám, aktivitás és részvétel. |
| Round | Kategóriakínálat, választó, választási eredmény, öt kérdéspéldány. |
| Question | Meccsbeli kérdéspéldány, szöveg, típus, stabil opciók, szerveroldali helyes válaszok. |
| Answer | Résztvevő–kérdés pár elfogadott válasza, szerveroldali idő és kiértékelés. |
| Kapcsolatnyilvántartás | Hitelesített személy és socketkapcsolatai; nem a tartós résztvevőazonosság. |

Az állapotokat fázisonként külön adatkészlettel kell kifejezni, nem független boolean mezőkkel. A szoba és meccs fázisa nem tarthat fenn két ellentmondó állapotforrást.

| Fázis | Fázisspecifikus adatok |
|---|---|
| Várószoba | Tagok, ready, beállítások, várószobai ciklusazonosító. |
| Indulási visszaszámlálás | Várószobai adatok, indulási határidő. |
| Kategóriaválasztás | Forduló, kínálat, választó, határidő. |
| Kérdés-előkészítés | Kategória, próbálkozás és határidő. |
| Kérdés előtti visszaszámlálás | Kategória, sorszámok, megnyitási határidő; publikus kérdés még nincs. |
| Válaszadás | Aktuális kérdés, nyitási idő és határidő, elfogadott válaszok. |
| Közös kiértékelés | Lezárt kérdés, eredmények, következő átmenet határideje. |
| Végeredmény | Végső rangsor, mentési állapot, várószobai visszatérés határideje. |
| Technikai megszakítás | Ok, elérhető részeredmények, mentési állapot. |

Minden fázispéldánynak külön `phaseId` tartozik. Korábbi fázis időzítője vagy aszinkron eredménye nem alkalmazható az aktuális állapotra.

## 5. Kliensnek látható állapot és i18n

A belső modellből külön, címzettenként készülő snapshotot állítunk elő.

- Nyitott kérdésben: publikus kérdés, opciók, határidő, ki válaszolt, saját elfogadott választás.
- Lezárás után: helyes opciók, résztvevői kiértékelés és pontok.
- Mások konkrét opcióválasztását lezárás után sem küldjük el.
- Jövőbeli kérdés, előzetes helyes válasz, auth/sessiontitok és belső socketazonosító nem kerül publikus DTO-ba.
- A belső és közzétett pontszám különválik: az aktuális kérdés pontja az összpontszámban sem jelenhet meg lezárás előtt.

Az MVP felülete angol. A hibák, megszakítási okok, eredménytípusok és mentési állapotok nyelvfüggetlen kódok. A kliens saját fordítási készlete adja a szöveget.

- A paraméterek strukturált adatok, nem kész mondatok.
- Ismeretlen hibakódhoz általános angol üzenet tartozik.
- A kérdés és kategórianév tartalomnyelvi jelölést kap; MVP-ben `en`.
- Többnyelvű kérdéskészlet és fordítási infrastruktúra részletes terve későbbi feladat.
- Törölt felhasználónál kód alapján jelenik meg a „Deleted user” felirat; nem ez kerül nickname-ként az adatbázisba.

## 6. Socket-szerződés

### 6.1. Munkamegosztás és formátumok

- MVP protokollverzió: 1. A handshake pontosan ezt a verziót közli; eltéréskor nincs kapcsolódás, stabil `PROTOCOL_VERSION_UNSUPPORTED` kód és oldalfrissítést kérő kliensüzenet jár.
- HTTP: auth, profil és tartós előzmények.
- Socket.IO: szoba- és játékparancsok, aktív állapot és időszinkron.
- A szerver hitelesített kapcsolatból állapítja meg a személyazonosságot. Payloadban küldött userId nem hitelesítés.
- Azonosítók: átlátszatlan szövegek a protokollban.
- Időpontok: Unix-idő egész milliszekundumban; időtartamok milliszekundumban.
- Sorszámok 1-től indulnak; pontok nemnegatív egész számok.
- Válaszopciók halmazt jelentenek; sorrendjük nem számít.
- Futásidejű payload-validáció szükséges a későbbi TS-típusok mellett is.

### 6.2. Kliensparancsok

Minden parancs tartalmaz `requestId` mezőt.

| Parancs | További payload | Feltétel / hatás |
|---|---|---|
| room:create | settings | Bejelentkezett, másik szobában nem tag; tulajdonosként létrehozás. |
| room:join | roomCode | Bejelentkezett, van hely, csatlakozható szobafázis. |
| room:leave | roomId | Aktuális tagság; minden eszközre érvényes explicit kilépés. |
| room:settings:update | roomId, expectedSettingsVersion, teljes új settings | Tulajdonos, várószoba/indulás; valódi változás törli a ready állapotokat. |
| room:ready | roomId, lobbyCycleId, ready | Kívánt állapot beállítása, nem toggle. Régi várószobai ciklus elutasítandó. |
| solo:start | settings | Felhasználó vagy érvényes vendégsession. |
| match:leave | matchId | Önálló egyjátékos meccs explicit elhagyása. |
| category:select | matchId, roundId, phaseId, categoryId | Jogosult választó, aktuális kínálat, határidő előtt. |
| answer:submit | matchId, questionId, selectedOptionIds | Részt vevő játékos, nyitott kérdés, határidő előtt. |
| state:sync | Cél típusa és azonosítója | Jogosultság után teljes aktuális állapot. |
| time:sync | Nincs további kötelező mező | Szerveridő kérése. |

Egyszeres választásnál pontosan egy, többszörösnél legalább egy opció szükséges. Ismeretlen és ismétlődő opcióazonosító hibás payload. A kliens nem küld pontot, helyességet vagy hiteles válaszidőt.

### 6.3. Visszaigazolás és ismétlés

Minden parancs visszaigazolást kap:

| Mező | Jelentés |
|---|---|
| requestId | Eredeti kérés. |
| ok | Siker vagy elutasítás. |
| serverTime | Visszaigazolás időpontja. |
| data, siker esetén | Eredmény, szükséges azonosítók és ahol értelmezhető, állapotverzió. |
| error, hiba esetén | code, params, resyncRequired. |

Válasz sikeres visszaigazolása: kérdésazonosító, eredetileg elfogadott választás, eredeti elfogadási idő, új elfogadás vagy ismételt visszaigazolás. Helyességet és pontot még nem közöl.

- A kérés eredményét hitelesített személy és requestId alapján 10 percig őrizzük, újracsatlakozáson át is.
- A parancs neve és tartalma is része az ismétlés ellenőrzésének.
- Azonos kérés és tartalom: korábbi eredmény. Azonos requestId eltérő tartalommal: konfliktus.
- Új requestId-val ismételt answer:submit is az első elfogadott választ adja vissza; nem módosít és nem pontoz.
- Korábbi elfogadás lezárás után is visszaigazolható, megfelelő jogosultsággal; ez nem új válasz.
- A résztvevő–kérdés pár egyszerisége a teljes meccsben él, a 10 perces cache-től függetlenül.
- Lejárt ismétlésvédelem után a kliens előbb szinkronizál, nem ismétel automatikusan bizonytalan létrehozási/indítási parancsot.
- A cache memóriabeli, backend-újraindítást nem él túl.
- Visszaigazolás hiánya nem bizonyít sikertelenséget.

### 6.4. Szerverállapot: state:snapshot

Egyetlen teljes, személyre szabott snapshot az aktuális állapot hiteles közlése. Nem szükséges külön, garantáltan kézbesítendő question:results esemény.

| Mező | Tartalom |
|---|---|
| protocolVersion | Kapcsolatszerződés verziója. |
| scope | Szoba vagy önálló meccs, azonosítóval. |
| stateVersion | Scope-on belül növekvő verzió. |
| serverTime | Snapshot készítési ideje. |
| phase | Fázisazonosító és az adott fázis megengedett publikus adatai. |
| self | Saját tagság/részvétel és válaszállapot. |
| permissions | Az aktuális állapotban engedélyezett műveletek. |

A permissions csak a felületet segíti; minden parancsnál új szerveroldali jogosultság-ellenőrzés történik.

Régebbi verziót a kliens eldob; azonos verzió ismételt kézbesítése megengedett. Különböző játékosok személyre szabott tartalma azonos verziónál eltérhet. Késői visszaigazolás nem írhat felül újabb snapshotot.

Újracsatlakozáskor ismételt hitelesítés/részvétel-ellenőrzés és teljes snapshot szükséges. Socket.IO reconnect önmagában nem játékállapot-helyreállítás.

Explicit kilépéskor minden saját eszköz végső `closed` snapshotot kap. Megszűnt szoba és önálló szólómeccs utáni visszatérés ugyanezt a fázist használja külön okkóddal. A `recentResult` a saját korábbi meccs mentési státuszát visszatérés után is követheti; új tag nem kap korábbi meccshez eredményhivatkozást, kilépett tag nem kap következő meccsállapotot.

### 6.5. Hibakódok

| Kód | Jelentés |
|---|---|
| AUTH_REQUIRED | Bejelentkezés szükséges. |
| INVALID_PAYLOAD | Hibás mezők vagy opcióválasztás. |
| ROOM_NOT_FOUND | A szoba nem érhető el. |
| ROOM_FULL | Tízfős korlát. |
| ROOM_GAME_ACTIVE | Aktív meccs alatt nem lehet új/visszalépő tagként csatlakozni. |
| ALREADY_IN_ROOM | Másik szobában már tag. |
| ALREADY_IN_MATCH | Önálló meccsben már részt vesz. |
| FORBIDDEN | Nincs jogosultság. |
| STALE_STATE | Korábbi meccs, fázis, várószobai ciklus vagy beállításverzió. |
| DEADLINE_EXCEEDED | Határidő lejárt. |
| QUESTION_NOT_OPEN | Kérdés még vagy már nem válaszolható meg. |
| PARTICIPANT_LEFT | Explicit kilépett résztvevő. |
| REQUEST_ID_CONFLICT | Kérésazonosító eltérő tartalommal. |
| MATCH_INTERRUPTED | Technikailag megszakított meccs. |
| PROTOCOL_VERSION_UNSUPPORTED | Eltérő socketverzió; oldalfrissítés szükséges. |
| RATE_LIMITED | Az ismétlésvédelmi cache kapacitása betelt. |
| SERVER_UNAVAILABLE | A szerver átmenetileg nem tudja végrehajtani a kérést. |

## 7. Tartós adatmodell

### 7.1. Megőrzés

Bejelentkezett játékosnál tartós: meccsbeállítások, kimenetel, végeredmény és rövid kérdésenkénti eredménybontás. A résztvevő az explicit kilépés után is hozzáférhet a saját meccselőzményhez.

Nem őrzünk meg teljes kérdésszöveget, konkrét opciókat, kijelölt opcióazonosítókat vagy válaszidőt. A rövid eredmény például: „2/3 helyes, 1 téves jelölés — 511 pont”. A mondatot nem tároljuk, csak a számszerű adatokat és eredménykódot.

Socketek, ready állapotok, időzítők, vendégmeccsek és aktív játékmotorállapot átmenetiek. A checkpointok nem biztosítanak meccsfolytatást.

### 7.2. Better Auth integráció

- Better Auth generálja a konfigurációhoz tartozó authtáblák Drizzle-sémáját.
- Alaptáblák: user, session, account, verification; plugin további adatot igényelhet.
- Auth és saját táblák közös Drizzle-migrációs folyamatban, PostgreSQL-ben.
- user.id a közös felhasználóazonosító; email nem másolódik a profilba.
- Auth user létrejöttekor a saját profilrekord létrehozásáról is gondoskodni kell.
- Saját UUID és auth user.id típusa nem feltétlenül ugyanaz; minden user_id mező a tényleges authazonosító típusát követi.
- Migrációk verziózottak; deploykor alkalmazás, nem újragenerálás történik.

### 7.3. user_profile

| Mező | Típus / szabály |
|---|---|
| user_id | Authazonosító; PK és FK a user.id-re, fióktörléskor törlődik. |
| nickname | Kötelező szöveg, legfeljebb 40 karakter, nem egyedi. |
| elo | Kötelező egész, default 1000; MVP-ben nem változik. |
| created_at | Kötelező timestamptz. |
| updated_at | Kötelező timestamptz. |

### 7.4. game_status

| Mező | Típus / szabály |
|---|---|
| code | Szöveges PK: in_progress, completed, interrupted. |

Rendszeradatok, nem felhasználói konfiguráció. Nincs tárolt fordított felirat.

### 7.5. game

| Mező | Típus / szabály |
|---|---|
| id | UUID, PK. |
| mode | Kötelező: solo / multiplayer. |
| status_code | Kötelező FK a game_status.code-ra. |
| started_at | Kötelező timestamptz. |
| ended_at | Opcionális timestamptz; véglegesítéskor kitöltött. |
| interruption_reason | Opcionális stabil kód, csak megszakításnál. |
| round_count | Kötelező egész, 1–10. |
| questions_per_round | Kötelező egész, MVP-ben 5. |
| answer_time_ms | Kötelező egész, 5000–60000. |
| start_countdown_ms | Kötelező egész, jelenleg 5000. |
| category_selection_ms | Kötelező egész, jelenleg 15000. |
| question_countdown_ms | Kötelező egész, jelenleg 3000. |
| evaluation_ms | Kötelező egész, jelenleg 5000. |
| final_results_ms | Kötelező egész, jelenleg 15000. |
| rules_version | Kötelező szöveg. |
| scoring_version | Kötelező szöveg. |
| checkpoint_question_number | Kötelező egész, induláskor 0; utoljára mentett lezárt kérdés meccsen belüli sorszáma. |
| persistence_revision | Kötelező bigint; elavult mentések kizárása. |
| created_at | Kötelező timestamptz. |
| updated_at | Kötelező timestamptz. |

A mode a közös táblában különbözteti meg a bejelentkezett szóló és többjátékos meccset. A vendégmeccset nem mentjük ide. Seed/generátor mezők még nincsenek meghatározva.

### 7.6. game_participant

| Mező | Típus / szabály |
|---|---|
| id | UUID, PK. |
| game_id | Kötelező FK a game.id-re. |
| display_name | Opcionális induláskori név; törölt fióknál eltávolítandó. |
| identity_state | Kötelező: registered / deleted_user. |
| participant_order | Kötelező egész, stabil sorrend. |
| participation_status | Kötelező: participating / left. |
| left_at | Opcionális timestamptz. |
| total_score | Kötelező nemnegatív egész, induláskor 0. |
| final_rank | Opcionális pozitív egész; szabályos véglegesítésnél kitöltött. |
| created_at | Kötelező timestamptz. |
| updated_at | Kötelező timestamptz. |

Unique: game_id + participant_order. A game_id + id párhoz a user_game összetett hivatkozása miatt további egyedi kulcs szükséges.

### 7.7. user_game

| Mező | Típus / szabály |
|---|---|
| user_id | Authazonosító; kötelező FK. |
| game_id | Kötelező UUID. |
| participant_id | Kötelező UUID, egyedi. |
| created_at | Kötelező timestamptz. |

- PK: user_id + game_id.
- FK: game_id + participant_id a game_participant megfelelő párjára.
- A fiók törlése törli ezt a kapcsolatot, nem a közös meccs résztvevőjét.
- Ez biztosítja a felhasználó saját előzményének jogosultságát.

### 7.8. game_question_result

| Mező | Típus / szabály |
|---|---|
| participant_id | Kötelező FK a game_participant.id-re. |
| round_number | Kötelező egész, 1-től. |
| question_number | Kötelező egész, 1–5. |
| question_type | Kötelező: single / multiple. |
| option_count | Kötelező egész: 2, 4 vagy 6. |
| outcome | Kötelező: correct / partial / incorrect / unanswered. |
| correct_option_count | Kötelező egész; legalább 1. |
| selected_correct_count | Kötelező nemnegatív egész. |
| selected_incorrect_count | Kötelező nemnegatív egész. |
| points_awarded | Kötelező nemnegatív egész. |

PK: participant_id + round_number + question_number.

- Helyes jelölések száma legfeljebb correct_option_count.
- Téves jelölések száma legfeljebb option_count − correct_option_count.
- Unanswered esetén jelölések és pont 0.
- Multiple esetén legalább egy hibás opció is szükséges.
- Explicit kilépés utáni kérdésekhez nem készül rekord.

### 7.9. Indexek és törlési kapcsolatok

Induló külön indexek: game_participant.game_id, user_game.game_id, game.status_code. A felhasználó szerinti keresést a user_game PK támogatja. ELO-index és további teljesítményindexek később, tényleges lekérdezések alapján.

- Game törlése törli résztvevőit, felhasználói kapcsolatait és kérdéseredményeit.
- User törlése törli profilját és user_game kapcsolatait.
- Szóló game feltételes törlését koordinált tranzakció végzi; egyszerű FK-cascade önmagában nem elég.

## 8. Tranzakciós terv

### 8.1. Közös szabályok

- Mentéshez változatlan állapotmásolat és növekvő persistence_revision tartozik.
- Meccsenként sorrendezett mentési feladatok és adatbázisoldali verzió/státuszvédelem.
- Összpontszámot aktuális értékre állítunk, nem ismételhető hozzáadással növelünk.
- Régi checkpoint nem írhat felül újabbat vagy véglegesítést.
- Sikertelen tranzakció teljes visszagördülés.
- Köztes silent fail csak a felületre vonatkozik; a szerver naplózza.
- Bizonytalan kimenetelű adatbázisművelet azonos rekordazonosítókkal ismételhető.

### 8.2. Indulás

Egy tranzakció: létező fiókok ellenőrzése; game, game_participant és user_game rekordok létrehozása; kezdeti verzió/checkpoint rögzítése.

Hiba: naplózás, nincs felhasználói hibaüzenet, a játék folytatódik. Későbbi mentés pótolhatja az alaprekordokat.

### 8.3. Kérdéslezárás

A motor előbb egyszer lezárja és kiértékeli a kérdést. Egy tranzakció:

1. Hiányzó alaprekordok pótlása.
2. Tárolt státusz és verzió ellenőrzése.
3. Az addigi teljes rövid kérdésenkénti eredménybontás mentése.
4. Összpontszámok és kilépési státuszok frissítése.
5. Checkpoint és verzió frissítése.

Legfeljebb 50 kérdés × 10 résztvevő = 500 rövid eredménysor. Ez nem bizonyított teljesítményadat, csak az MVP méretkorlátja.

Hiba: naplózás, játék folytatódik, közzétett kiértékelést nem vonunk vissza. Következő mentés pótolhatja a hiányt.

### 8.4. Szabályos meccsvég

Egy tranzakció: összes hiányzó alaprekord és eredmény pótlása; összpontszámok, részvétel és helyezések; completed státusz, befejezési idő és végső verzió.

A végső mentés korábbi sikeres checkpoint nélkül is képes elmenteni a teljes végeredményt.

- Összesen három próbálkozás: első + két újrapróbálás, kétmásodperces szünetekkel.
- Felület: folyamatban / sikeres / sikertelen mentés.
- Végleges hibánál egyértelmű jelzés, hogy az eredmény nem került az előzményekbe.
- A 15 másodperces képernyőváltás nem állítja le a szerveroldali mentési feladatot.

### 8.5. Megszakítás

A motor megszakítja a meccset és érvényteleníti az időzítőket. A véglegesítő tranzakció az addigi eredményeket, interrupted státuszt és okot menti, végleges helyezés nélkül.

Ugyanaz a hárompróbálkozásos mentési szabály érvényes. Ha van kapcsolódó játékos, láthatja a mentés kimenetelét.

### 8.6. Backend-újraindítás

- Új játékok fogadása előtt a korábbi in_progress rekordokat keressük.
- Tranzakcióban interrupted státusz, server_restart ok; sikeres checkpointok megmaradnak.
- ended_at a megszakítás felismerése, nem az összeomlás állítólagos pontos ideje.
- Sikertelen rendezés után sem mutatjuk a régi meccset aktív, visszatérhető játékként; naplózás és későbbi újrapróbálás szükséges.
- A csak memóriában létezett meccs nem feltétlenül rendelkezik tartós rekorddal.

### 8.7. Fióktörlés

1. Jogosultság-ellenőrzés és ütközés kizárása az érintett mentésekkel.
2. Élő szobatagság megszüntetése; meccsben explicit kilépés.
3. Saját szólómeccsek és eredmények törlése.
4. Közös résztvevők display_name eltávolítása, deleted_user jelölés.
5. User_game, profil és authadatok törlése.
6. Kapcsolatok/sessionek érvénytelenítése és memóriabeli személyes adatok eltávolítása.

A saját adatbázismódosítások egy tranzakcióba tartoznak. A Better Auth törlési műveletének közös tranzakcióba illesztése még ellenőrizendő; nem feltételezzük, hogy tetszőleges auth-hook közös tranzakciót biztosít.

Későbbi mentés nem állíthatja vissza a nevet, user_game kapcsolatot vagy törölt szólómeccset, akkor sem, ha a mentési másolat a törlés előtt készült. Memória- és adatbázisoldali együttműködés szükséges. A törlést csak a koordinált folyamat befejezése után jelentjük sikeresnek.

## 9. Állandó érvényességi szabályok

- Egy résztvevő–kérdés párhoz legfeljebb egy elfogadott válasz tartozik.
- Elfogadott válasz minden eszközön ugyanaz és nem módosítható.
- Meccsbeállítás és résztvevőlista indulás után rögzített.
- Explicit kilépés végleges az adott meccsben.
- Kapcsolati jelenlét nem azonos az aktivitással.
- Kérdéslezárás, pontozás és állapotátmenet egyszeri.
- Régi időzítő/generálási eredmény nem hat az új fázisra.
- Helyes válasz és aktuális kérdés pontja lezárás előtt nem jut a klienshez.
- Mentés ismétlése nem duplikálhat adatot és nem adhat hozzá újra pontot.
- Végleges eredményt elavult checkpoint nem írhat felül.
- Törölt személyes adat késői mentésből sem állhat vissza.

## 10. Elfogadási tesztesetek terve

Ez ellenőrzési lista, nem elkészült vagy lefuttatott tesztkód.

### Motor és időzítés

- Egy és több játékossal automatikus indulás.
- Ready visszavonás, belépés, kilépés és beállításmódosítás megszakítja az indulást.
- Tulajdonosváltás és utolsó tag távozása.
- Kategóriaismétlés kizárása; csökkentett kínálat; egyetlen opció automatikus kiválasztása.
- Pontazonos választók sorsolása; mindenki idle szerveres választása.
- A választó kilépése után a választási timeout működik.
- Egyszeres/többszörös validáció; üres, ismeretlen és duplikált opció elutasítása.
- Gyorsasági pontozás, részpont, téves jelölés és mindent kijelölő stratégia.
- Határidő előtti, pontos és utáni érkezés; későn futó időzítő.
- Utolsó válasz és időzítő versenye nem okoz dupla lezárást.
- Öt kihagyás, idle, elfogadott válasz utáni visszaaktiválás.
- Mindenki idle/üres bevárandó lista esetén a kérdés a rendes határidőig nyitott; érvényes válasszal még vissza lehet aktiválódni.
- Szobatagság melletti szólóindítás és több eszközről párhuzamos új játék indítása nem hoz létre második játékfolyamatot.
- Fordulóváltás, végső közös helyezések, visszatérés és offline türelmi idő.
- Előkészítési timeout, újrapróbálás és késői eredmény eldobása.
- Technikai megszakítás 15 másodperces képernyőt, majd ready-törlést és várószobai/vendég-kezdőképernyős visszatérést eredményez.

### Socket és hozzáférés

- Hitelesítetlen/jogosulatlan és elavult parancs elutasítása.
- Több eszköz közös válaszállapota; elveszett visszaigazolás és ismétlés.
- Azonos requestId eltérő tartalommal konfliktus.
- 10 perc utáni ismétlésvédelem és szinkronizálás.
- Reconnect teljes, személyre szabott snapshotot ad.
- Új játékos és explicit kilépett résztvevő nem jut be aktív meccsbe.
- Saját válasz látható, mások opcióválasztása nem; pont és helyesség nem szivárog idő előtt.
- Régebbi snapshot/ack nem írja felül az újabb állapotot.
- Vendég visszatérés ugyanabban a böngészőben; nincs tartós mentés és utólagos eredményátkötés.
- Authsession lejárata nem dobja ki a meccs résztvevőjét, idle állapotban sem, de érvényes azonosítás nélkül nem indíthat új játékot.
- Explicit kijelentkezés minden, ugyanahhoz a meccsrésztvevőhöz kötött eszközön kilépést eredményez; nem kezelhető egyszerű hálózati szakadásként.
- Fióktörlés kilépést és a törlés befejezése után kijelentkezést eredményez.
- Regisztráció és jelszó-visszaállítás ellenőrzi a minimum 8 karakteres jelszót, minden megkövetelt karakterkategóriát és az űrlap két jelszómezőjének egyezését.
- Létező és nem létező emailre a jelszó-visszaállítási kérés ugyanazt a semleges visszajelzést adja.
- Nem megerősített emaillel a belépés elutasított; nem keletkezik többjátékos hozzáférést adó session. Érvényes megerősítési link után a belépés engedélyezhető, a vendégmód előtte is használható.
- Helyreállítási link új jelszó űrlapra vezet; hibás/lejárt token nem enged jelszómódosítást.
- A helyreállítási token 15 percig érvényes és sikeres felhasználás után nem használható újra. A link megnyitása önmagában nem a sikeres felhasználás.
- Email-megerősítési link 24 órás lejárata, valamint a percenkénti újraküldési korlát szerveroldalon érvényesül.
- Sikeres jelszó-visszaállítás visszavon minden korábbi sessiont és meccsjogosultságot; aktív meccsben kiléptet, több eszközről sem lehet a régi jogosultsággal visszatérni.
- Lejárt session mellett a meccsjogosultság csak a megkezdett meccs műveleteit engedi, új játékot és profilmódosítást nem.
- A várószobai újraazonosítás legfeljebb 60 másodpercig tartja fenn a helyet; ready = false, külön authhiányjelzés, majd eltávolítás és szükség esetén tulajdonosváltás.
- A vendégjogosultság a végeredmény-képernyő végén megszűnik; a korábbi vendégazonosító nem ad új játékhoz vagy régi eredményhez hozzáférést.
- Hibakódok angol megjelenítése és ismeretlen kód fallbackje.

### Adatbázis és életciklus

- Indulási/köztes mentéshiba silent a felületen, de naplózott.
- Következő checkpoint és végső mentés pótolja a hiányzó adatot.
- Tranzakció részleges hibája teljes visszagördülést okoz.
- Ismételt és bizonytalan kimenetelű mentés nem duplikál és nem pontoz újra.
- Régi checkpoint nem írja felül a végleges meccset.
- Végső/megszakítási mentés három próbálkozása és felületi állapota.
- Újraindítás interrupted státuszt eredményez, nem játékmenet-folytatást.
- Fióktörlés törli a szólóadatokat és anonimizálja a közös eredményt.
- Fióktörlés és mentés versenye nem támasztja fel a személyes adatot.
- Unique/FK szabályok elutasítják a duplikált vagy másik meccshez kapcsolt résztvevőt.
- Egy szobavezérlő sorában a válasz, időzítő és aszinkron eredmény nem módosíthatja párhuzamosan az állapotot.
- Köztes adatbázismunka nem állítja meg a játékmenetet; mentési visszajelzés csak a vezérlőn keresztül módosítja a publikus állapotot.

## 11. Architektúra

### 11.1. Elfogadott alapok

- Moduláris monolit: egy backendalkalmazás, elkülönített belső modulokkal.
- npm workspaces monorepó: egy közös gyökér-package-lock.json, csomagonként saját package.json és külön deklarált függőségek. A gyökér közös parancsokat és fejlesztői eszközöket fog össze; a motor külső könyvtáraktól való függetlensége megmarad.
- Node.js 24 LTS futtatókörnyezet és Express HTTP-keretrendszer. A konkrét verziók és a Better Auth-integráció ellenőrzése az implementáció előkészítéséhez tartozik.
- Az MVP frontendje és backendje ugyanarról a Node szolgáltatásról, azonos IP + port kombináción érhető el.
- Böngészőből a frontend, HTTP API, auth és Socket.IO ugyanazt az origint használja. Origin: séma + hostname + port; élesben egységes HTTPS-cím.
- A Node a Vite által elkészített statikus frontend buildet szolgálja ki. Élesben nem szükséges Vite fejlesztői szerver.
- A játékmotor natív TypeScript, külön mappában, harmadik féltől származó könyvtárfüggőség nélkül.

Az azonos origin a cookie/session és böngészős kérések kezelését egyszerűsíti. SameSite nem azonos az origin fogalmával; az IP + port egyezése mellett a sémának és a böngésző által használt hostname-nak is egyeznie kell. A cookie- és kérésjogosultsági beállításokat ettől még pontosan meg kell tervezni.

### 11.2. Modulhatárok és workspace-mappák

A felelősségi felosztás és függőségi irányok az elfogadott architektúra részei. A négy workspace-mappa elfogadott: apps/web, apps/server, packages/game-engine és packages/contracts; konfigurációjuk az M0-ban elkészült. A szerver src alatti bootstrap belépési pont létrejött; a többi szerveroldali belső útvonal az alábbi táblázatban továbbra is javaslat. Az M1 natív motor megvalósult; belső API-ját és integrációs határait a [motor dokumentációja](game-engine.md) írja le. A publikus szerződés továbbra is üres belépési pontot tartalmaz.

| Modul | Hely (belső szerverútvonalaknál javaslat) | Felelősség |
|---|---|---|
| Játékmotor | packages/game-engine/ | Domainállapot, állapotátmenetek, szabályok, pontozás, belső érvényességi szabályok. |
| Szerveralkalmazási réteg | apps/server/src/application/ | Szobák és meccsek életciklusa, parancsok koordinálása, jogosultság, meccsenkénti sorrendezés, időzítők és mentési feladatok. |
| Infrastruktúra | apps/server/src/infrastructure/ | Drizzle/PostgreSQL, Better Auth, rendszeróra/időzítő, kérdésforrás és naplózás adapterei. |
| HTTP és realtime belépési pontok | apps/server/src/transport/ | HTTP/Socket.IO payloadok fogadása, validáció, parancsleképezés, ack és snapshot kézbesítése. |
| Szerverösszeállítás | apps/server/src/bootstrap/ | Konfiguráció, adapterek összekötése, HTTP-szerver, statikus fájlok, indulás és leállítás. |
| Frontend | apps/web/ | React-felület, publikus állapot megjelenítése, parancsküldés, fordítások. |
| Publikus szerződés | packages/contracts/ | Kliens–szerver DTO-k, protokoll- és hibakódok, futásidejű payload-validáció. |

### 11.3. A játékmotor függőségi határa

A motor külső csomagfüggőségeinek száma nulla. A motoron belüli saját modulok egymást importálhatják. Az elfogadott felosztás a következő határokat követi:

- Nincs React, Express, Socket.IO, Drizzle, Better Auth vagy validációs könyvtár import.
- Nincs hálózati, adatbázis- vagy fájlrendszer-művelet.
- Nem olvas környezeti változót, sessiont vagy cookie-t.
- Nem hoz létre tényleges időzítőt, és nem olvassa önállóan az aktuális időt.
- Nem végez rejtett véletlensorsolást. A döntéshez szükséges sorsolási bemenetet kívülről kapja; a pontos véletlenforrás későbbi téma.
- Nem importálja a publikus contracts csomagot sem, így annak esetleges validációs könyvtára nem válhat közvetett motorfüggőséggé.
- Saját belső típusokat és ellenőrzéseket használ. Ezeket a szerver fordítja publikus DTO-vá.

A TypeScript fordító és a motor tesztelését futtató eszköz a fejlesztési környezet része; nem a motor implementációjának importált könyvtárfüggősége. Elfogadott eszközök: Vitest a motor- és szervertesztekhez, Playwright a böngészős folyamatokhoz. Ezeket csak a tesztek és a fejlesztési konfiguráció használják; a motor implementációja nem importálja őket.

### 11.4. Függőségi irányok

- A frontend csak a publikus szerződést használja; a belső motort és szerverállapotot nem importálja.
- A transport a contracts rétegen keresztül ellenőrzi a bemenetet, és az alkalmazási réteget hívja.
- Az alkalmazási réteg a motort hívja, és saját, szűk interfészeken keresztül használja a külső szolgáltatásokat.
- Az infrastruktúra ezekhez az interfészekhez ad konkrét implementációt.
- A bootstrap állítja össze a konkrét példányokat.
- A motor nem függ az alkalmazási, transport-, infrastruktúra- vagy frontendrétegtől.
- A contracts csomag nem függ a szervertől vagy a motortól. Csak publikus, elküldhető struktúrákat tartalmaz.

A publikus és belső típusok közötti különbség tudatos: a belső helyes opciókat vagy jövőbeli kérdéseket nem lehet a belső állapot egyszerű sorosításával kiküldeni.

### 11.5. Állapottulajdonos és parancsvégrehajtás — véglegesített terv

#### Szoba- és meccsvezérlő

A futó állapot tulajdonosa a backend alkalmazási rétegében lévő vezérlő. A motor az állapotváltozásokat számítja ki; a külső adapterek nem módosítják közvetlenül a futó állapotot.

- Egy szobának egy vezérlője és egy állapotmódosítási sora van.
- Ez a vezérlő tartja a várószobát, a tagokat és az aktuális meccset. Meccsinduláskor nem keletkezik második, ugyanazt az állapotot párhuzamosan módosító tulajdonos.
- Önálló szólómeccshez ugyanilyen vezérlő működik szobatagság nélkül.
- A socketkapcsolatok külön nyilvántartásban maradnak; a vezérlő kapcsolati változásokról kap eseményt.
- Az egymástól független szobák sorai egymástól függetlenül haladhatnak ugyanabban a Node-folyamatban.

Egy tulajdonos kilépése a taglistát, tulajdonost, visszaszámlálást és meccsrészvételt egyetlen koordinált műveletben változtatja meg. Node egyetlen JavaScript-szála nem helyettesíti ezt a sorrendezést: aszinkron eredmények eltérő sorrendben érkezhetnek vissza.

#### Állapotmódosítási sor

Ugyanabba a vezérlői sorba érkezik:

- játékosparancs;
- kapcsolati változás;
- időzítő lejárati eseménye;
- kérdés-előkészítés eredménye vagy hibája;
- mentési feladat sikeres vagy sikertelen eredménye.

Egyszerre csak egy művelet módosítja az adott vezérlő állapotát. A beérkezési időt és sorba állítást minden aszinkron várakozás előtt rögzíteni kell; a későbbi feldolgozás önmagában nem teheti elkésetté a határidő előtt beérkezett választ. A konkrét órakezelés és fogadási mechanizmus implementáció előtt pontosítandó.

#### Időzítőadapter

Az adapter a vezérlő kérésére ütemez, majd meccs-, fázis- és határidő-azonosságot tartalmazó eseményt küld vissza. Callbackje nem zárja le közvetlenül a kérdést.

A vezérlő ellenőrzi, hogy az esemény még az aktuális fázishoz tartozik-e. Ha az utolsó válasz már lezárta a kérdést, a régi időzítő eseménye hatástalan. Ugyanez az elv vonatkozik a késői kérdés-előkészítési eredményre.

#### A motor és a vezérlő együttműködése

1. A transport rögzíti a beérkezési időt, validálja a payloadot, és a hitelesített kapcsolatból meghatározza a személyt.
2. A parancs aszinkron várakozás előtt a megfelelő vezérlő sorába kerül. A jogosultság és a requestId szerinti ismétlés ellenőrzése az állapotváltozás előtt történik.
3. A motor megkapja az aktuális állapotot és a releváns bemenetet, beleértve a rögzített szerveroldali időt.
4. A motor visszaadja az új állapotot, a művelet eredményét és a szükséges domainkövetkezményeket, külső I/O nélkül.
5. A vezérlő érvényesíti az állapotot és verziót; időzítőt kér vagy érvénytelenít, és szükség esetén mentési másolatot készít.
6. A szerver elkészíti a címzettenkénti snapshotokat; a transport kézbesíti őket és a visszaigazolást.

A motor nem adatbázismentést hajt végre, hanem domaineredményt közöl. A transport kézbesítési sorrendjére a kliens nem építhet, a korábbi socket-szerződés szerint.

#### Külön mentési sor

Az adatbázismunka nem fogja a játékmenet állapotmódosítási sorát. A vezérlő változatlan másolatot és persistence_revision értéket ad át a mentési sornak.

- A mentési feladatok meccsenként sorrendben futnak.
- Az adapter betartja a tranzakció-, verzió- és újrapróbálási szabályokat.
- A mentési sor nem módosítja közvetlenül a játékállapotot.
- A kimenetelt eseményként visszaküldi a vezérlőnek; csak azon keresztül változik a publikus mentési állapot.
- A mentési feladat a várószobába visszatérés után is befejezhető.
- A sor memóriabeli: folyamat-újraindítást nem él túl. Nem tartós feladatsor.

A stateVersion a kliensnek látható változást követi, a persistence_revision a tartós mentési másolatok sorrendjét. Mentési visszajelzés új publikus állapotverziót eredményezhet új kérdés vagy pontozás nélkül.

A több szobát és mentést érintő fióktörlés külön alkalmazási műveletként koordinálja ezeket az egységeket. Az adatbáziszárak és Better Auth-integráció részletei még ellenőrizendők; egyetlen vezérlő sora önmagában nem oldja meg a felhasználói fiók teljes életciklusát.

### 11.6. Közös Node-kiszolgálás

Javasolt útvonal-felosztás ugyanazon publikus originen:

| Útvonal | Feladat |
|---|---|
| /api/auth/* | Better Auth HTTP-végpontok. |
| /api/* | Profil, előzmények és egyéb HTTP API. |
| /socket.io/* | Socket.IO polling és WebSocket kapcsolatok. |
| Statikus assetek és frontendútvonalak | A Vite build kiszolgálása, szükség esetén SPA útvonal-fallback. |

A frontend fallback nem kezelhet API- vagy Socket.IO-hibát HTML-oldalként. Az auth, API és Socket.IO útvonalak kezelése megelőzi a frontend fallbacket.

A frontend relatív API/socket címeket használhat; nem szükséges külön backenddomaint beégetni. A cookie, a védett vendégsession, a kérés eredetének ellenőrzése és az authbeállítások részletei még kidolgozandók.

Helyi fejlesztésben a Vite HMR külön belső folyamatot igényelhet. Javaslat: a böngésző továbbra is egy fejlesztői origint használjon, és a frontend/API/Socket.IO/HMR forgalom támogatott proxyn menjen a megfelelő belső szolgáltatáshoz. A konkrét proxyirány és fejlesztési portok még nyitottak; a külön originre történő közvetlen klienskérés nem a tervezett alapműködés.

### 11.7. Auth és session életciklus

#### Elfogadott működés

- Az MVP regisztrációja és belépése email + jelszó alapú, Better Auth használatával. A jelszó kezelését és ellenőrzését a Better Auth végzi; saját profil- vagy játéktáblába jelszó nem kerül.
- Google, Apple és más szolgáltatói belépés későbbi fejlesztés. Egy jövőbeli szolgáltatói belépésnél a fiók-összekapcsolás szabályait külön tervezzük meg; a játék a stabil user.id-re épül, nem a belépési szolgáltatóra.
- Játék közben a felület csak kilépést kínál, kijelentkezési gombot nem. Kijelentkezés a kilépés után érhető el.
- Ha mégis explicit kijelentkezési kérés érkezik, a szerver a meccsrészvételt explicit kilépésként megszünteti. A puszta sessionlejárat nem ilyen kérés.
- Több eszköz közös résztvevőállapota miatt a meccsből kilépés minden eszközön érvényes. Ez nem jelenti automatikusan minden más eszköz authsessionjének kijelentkeztetését; annak szabálya külön kérdés.
- Fióktörléskor játék közben is kiléptetjük a résztvevőt. A koordinált törlés befejezése után automatikus kijelentkezés és kapcsolatérvénytelenítés szükséges.
- Authsession puszta lejárata nem távolítja el az aktív meccs résztvevőjét, idle állapotban sem.
- Érvényes auth nélkül a játékos nem indíthat új játékot. A következő várószobában újra ellenőrizzük az azonosítást; szükség esetén új bejelentkezés kell.
- A vendégsession élettartama 15 perc, aktív használat mellett újabb 15 percre megújítható. Lejárata a kiadástól vagy legutóbbi sikeres megújítástól számított 15 perc; a végeredmény-képernyő végén jogosultsága ettől függetlenül megszűnik.

#### Better Auth technikai háttér — dokumentációból ellenőrizve 2026-10-06

- Alapértelmezett működés: cookie-val azonosított, szerveroldali session; a session_token cookie átlátszatlan sessionazonosító. Nem alapértelmezett JWT access/refresh token páros.
- A session időtartama és frissítési gyakorisága konfigurálható; a használat során a session meghosszabbítható. A dokumentált alapértékek nem az alkalmazásunk végleges konfigurációja.
- Az auth.api.getSession szerveroldali API ellenőrzi a sessiont. Express/Node esetén a fromNodeHeaders helper biztosítja a megfelelő headerformátumot.
- Saját vékony HTTP middleware és Socket.IO kapcsolódási adapter szükséges, de a sessiontoken ellenőrzését nem írjuk újra.
- A Socket.IO kapcsolódási ellenőrzés nem helyettesíti az élő kapcsolatok logout/törlés/lejárat kezelését. Egy nyitott socket nem HTTP-kérésenként újul meg.
- A null getSession eredmény önmagában nem bizonyít explicit logoutot. A kijelentkezési HTTP-folyamatot össze kell kötni a játékvezérlővel, akkor is, ha a kliens közvetlenül az authvégpontot hívja.
- A Better Auth opcionális cookieCache funkciója az MVP-ben kikapcsolt — elfogadott döntés. Normál hitelesítésnél a szerver az adatbázisban tárolt sessiont ellenőrzi; cookie-ba másolt sessionadat alapján nem hagyunk ki adatbázis-ellenőrzést.
- A cookieCache kikapcsolása nem érinti a socket requestId-cache-t vagy a futó meccshez korlátozott jogosultságot. A játékválaszok emiatt nem igényelnek egyenként Better Auth-adatbázisellenőrzést; az explicit visszavonást továbbra is össze kell kötni a játékvezérlővel.
- A JWT plugin külön szolgáltatásoknak adható JWT-ket biztosít; nem a hagyományos session automatikus helyettesítője. JWT-megoldást az MVP-re még nem választottunk.

#### Elfogadott meccsjogosultság és újraazonosítás

- A meccsre belépéskor szerveroldali, kizárólag az adott résztvevő aktuális meccsére korlátozott jogosultságot hozunk létre. A session lejárata után csak a már megkezdett meccs műveleteit engedi, nem új játékot, profilmódosítást vagy előzményhozzáférést.
- Újracsatlakozáshoz is hiteles bizonyíték kell. Ha lejárt a Better Auth session, szobakód/userId nem elég: külön védett, meccshez kötött visszatérési azonosító vagy új bejelentkezés szükséges. Ennek pontos szerződése még tervezendő.
- Explicit kilépés/logout, fióktörlés és meccsvég megszünteti a meccshez kötött jogosultságot.
- A várószobában újraazonosításra váró játékos helyét legfeljebb 60 másodpercig tartjuk fenn, ready = false értékkel. Az authhiány nem offline állapot; külön felületi jelzés szükséges. Lejáratkor eltávolítás, szükség esetén tulajdonosváltás.
- Offline és authhiány esetén a két 60 másodperces határidő párhuzamosan fut; a korábban lejáró távolít el. Reconnect csak a kapcsolathiányt oldja fel, az újraazonosítási határidőt nem hosszabbítja.
- Érvényes sessiont meglévő, támogatott frissítési folyamat hosszabbíthat meg; már lejárt sessionből nem hozunk létre önkényesen új hitelesítést.
- A vendég jogosultsága csak a futó szólómeccshez és annak kiértékeléséhez tartozik; a végeredmény-képernyő végén érvénytelenítjük. A még érvényes session aktív használat mellett újabb 15 percre megújítható. Ez nem hosszabbítja meg a külön meccsvisszatérési cookie fix 30 perces határidejét.

A fenti életciklus és az email + jelszó belépés elfogadott. A meccsvisszatérés a meccs kezdetétől számított fix 30 perces HttpOnly cookie-ra és memóriabeli hashnyilvántartásra épül; HTTP-kiadásának és visszavonási koordinációjának részletei még pontosítandók. Játék közben nem hosszabbítjuk meg, normál sessionfrissítés sem tolja ki a határidejét. A Better Auth session 30 perces, folyamatosan megújítható élettartama, 5 perces megújítási célüteme és a cookieCache kikapcsolása elfogadott, 24 órás abszolút maximum nélkül; a kliensfolyamat még nincs véglegesítve.

#### Jelszó és jelszó-visszaállítás — elfogadott követelmények

- Jelszóminimum: 8 karakter; legalább egy kisbetű, nagybetű, szám és speciális karakter.
- Regisztrációkor, jelszó-visszaállításkor és jelszómódosító űrlapon password + password confirm mező szükséges, egyezésellenőrzéssel.
- A confirm mező az űrlap része, nem tartós adat. A Better Auth jelszókezelése az új jelszóval dolgozik.
- A jelszókövetelményeket szerveroldalon is érvényesíteni kell minden releváns authvégponton; közvetlen HTTP-kérés sem kerülheti meg a szabályt.
- Elfelejtett jelszó emailcím megadásával kérhető.
- A visszajelzés nem árulhatja el, létezik-e a fiók. Egyeztetett jelentés: „Ha létezik ilyen email címmel felhasználó, akkor kiküldünk egy helyreállítási linket.”
- Angol MVP-szöveg: „If an account exists with this email address, we'll send a password reset link.” A szöveg kliensoldali fordításból érkezik.
- A helyreállítási link közvetlenül az új jelszó megadását és megerősítését kérő képernyőre vezet. A link megnyitása önmagában nem módosítja a jelszót.
- A token kezelését és ellenőrzését Better Auth végzi; saját reset-token rendszer nem készül.
- A helyreállítási link 15 percig érvényes és egyszer használható. A token sikeres jelszó-visszaállításkor válik felhasználttá, nem az emailben kapott link puszta megnyitásakor.
- Sikeres jelszó-visszaállítás minden korábbi authsessiont és meccsjogosultságot visszavon. Aktív meccsben ez explicit kilépést jelent; ezt követően új bejelentkezés szükséges.
- A session-visszavonást Better Auth támogatja a revokeSessionsOnPasswordReset beállítással; az alkalmazási réteg a korlátozott meccsjogosultságokat is megszünteti és a játékvezérlőt értesíti. Ez nem session puszta lejárata.

#### Email-megerősítés és küldés

- Linkkel történő email-megerősítés kötelező termékfunkció az MVP-ben.
- Better Auth alapból biztosítja a linkes email-megerősítési és jelszó-visszaállítási folyamatot. Külön auth-plugin ezekhez nem szükséges.
- A kiküldést saját emailadapter köti be a sendVerificationEmail és sendResetPassword callbackeken keresztül. Better Auth nem emailkézbesítő szolgáltató.
- Szükséges egy tranzakciós emailküldő szolgáltatás vagy SMTP-szolgáltatás, annak biztonságosan konfigurált hozzáférése, feladó és éles küldéshez szükséges szolgáltatói/domainbeállítások.
- Az MVP SMTP2GO szolgáltatót használ SMTP + Nodemailer adapterrel. Host, port, TLS-mód, hozzáférés és feladó konfigurálható; az authcallbackek és sablonok szolgáltatófüggetlenek. A Nodemailer csak a szerverinfrastruktúrába kerül, a játékmotorba nem. Másik SMTP-provider, később HTTPS API-adapter is alkalmazható.
- A user.emailVerified authmező a megerősítés forrása; külön, párhuzamos profiljelző nem szükséges.
- Elfogadott: nem megerősített emaillel nem lehet bejelentkezni; a vendég egyjátékos mód elérhető marad. Ezt Better Auth requireEmailVerification beállításával támogatja. A regisztráció után megerősítést kérő képernyő jelenik meg, nem bejelentkezett játékosként kezeljük a felhasználót.
- Az email-megerősítési link 24 óráig érvényes.
- Az authlevelek újraküldése legfeljebb percenként kérhető, további szerveroldali kéréskorlátozással. A felület gombjának korlátozása önmagában nem elegendő.
- Az SMTP2GO hozzáférése/csomagfeltételei, az általános kéréskorlátozás konkrét dimenziói és az emailkézbesítési hibák részletei még ellenőrizendők. A szolgáltatóválasztás, 15 perces reset-link, 24 órás megerősítési link és percenkénti újraküldés már elfogadott.

#### Session időtartam — elfogadott

- A session élettartama 30 perc, használat közben folyamatosan megújítható.
- Nincs belépéstől számított 24 órás abszolút korlát; aktív megújítás mellett a session ennél hosszabb ideig is használható.
- Better Auth expiresIn a session élettartamát, updateAge a frissítés gyakoriságát szabályozza. A megújítás a még érvényes sessiont hosszabbítja meg; lejárt sessionhez új azonosítás szükséges.
- A megújítás újabb 30 perces érvényességet jelent. Aktív használat mellett 5 perces megújítási célütemet választottunk; mérés alapján később 10 percre növelhető. A vendégnél is 5 percenkénti HTTP-ellenőrzés történik, sikeres megújítás után újabb 15 perces érvényességgel. Az elfogadott HTTP-folyamatot az [authterv 3.10. pontja](auth-adapters.md#310-elfogadott-sessionmegújítás-http-n) rögzíti; a háttérben felfüggesztett lapok kezelése még pontosítandó. Nyitott Socket.IO kapcsolat önmagában nem garantál megújítást; a szerver nem indít kérés nélküli, korlátlan sessionhosszabbítást.
- Lejárat esetén a már elfogadott korlátozott meccsjogosultság továbbra is megóvja az aktuális játékmenetet.

### 11.8. Még kidolgozandó üzemeltetés

- Email + jelszó belépés pontos sessionbeállításai, emailküldő adapter, kéréskorlátozás és a visszavonás technikai koordinációja. A linklejáratok és visszavonási termékszabályok elfogadottak.
- Az elfogadott Node.js 24 LTS és Express konkrét verziói, további csomagverziók, az npm workspace konkrét konfigurációja.
- Helyi és éles PostgreSQL főverzió, natív/Docker helyi futtatás.
- Konfiguráció, session/cookie/CORS/origin szabályok és titokkezelés.
- CI: típusellenőrzés, érdemi tesztek, build, verziózott migrációk.
- Deploy, leállítás, meccsek megszakítása, naplózás és egészségellenőrzés.
- Terhelési és payloadkorlátok, ismétléscache kapacitása.

### 11.9. Emailadapter és meccsvisszatérés — elfogadott technikai alapok

A részletes terv külön dokumentumban található: [Authadapterek és meccsvisszatérés](auth-adapters.md).

- Szolgáltatófüggetlen SMTP emailadapter Nodemailerrel, külön memóriabeli küldési sorral. Az MVP-provider SMTP2GO, könnyen cserélhető SMTP-konfigurációval. Az aktuális ingyenes csomagfeltételek és tényleges hozzáférés ellenőrzése még szükséges.
- Emailtimeout 5 másodperc; átmeneti hiba esetén legfeljebb három próbálkozás 2/8 másodperces szünetekkel, providerutasítás és tokenlejárat figyelembevételével.
- Véletlen, átlátszatlan HttpOnly cookie-s meccsvisszatérési azonosító, memóriabeli szerveroldali hashnyilvántartással.
- HTTP-végpont adja ki érvényes session és aktív meccsrészvétel alapján; Socket.IO kapcsolódás használhatja lejárt normál session mellett.
- A meccsengedély jogosultságai nem terjednek ki új játékra, profilra vagy előzményekre.
- A cookie meccskezdetkor frissül, csak az adott meccshez használható, és az indulástól számítva fix 30 percig él. Reconnect vagy sessionfrissítés nem hosszabbítja meg; visszatéréskor a meccs létezését és a részvételt is ellenőrizzük.
- Megszűnt meccs után létező várószobába irányítás lehetséges, érvényes normál auth és tagsági/csatlakozási ellenőrzés mellett. A meccstoken nem ruház át várószobai jogosultságot.

Az SMTP2GO + Nodemailer emailadapter, a memóriabeli küldési sor fenti szabályai és a cookie/hash alapú, meccsindulástól fix 30 perces meccsvisszatérés elfogadott döntések. A külön jelzett végrehajtási részletek még nyitottak. A visszatérési token lejárata önmagában nem lépteti ki a már játékban lévő résztvevőt; későbbi reconnecthez érvényes normál session vagy új bejelentkezés szükséges.

### 11.10. MVP megvalósítási terv

A mérföldköveket, előfeltételeket és ellenőrzési feltételeket külön dokumentum tartalmazza: [MVP megvalósítási terv](implementation-plan.md). Ez tervezési sorrend; nem jelent alkalmazáskód írására vagy deploymentre adott engedélyt.

## 12. Nyitott kérdések és ellenőrzendő részletek

### Következő architektúratervezésben

- SMTP2GO aktuális ingyenes csomagfeltételei és hozzáférése, újraküldés/kéréskorlátozás konkrét kulcsai és kézbesítési hibák részletei; a provider, linklejáratok és percenkénti újraküldési korlát már elfogadottak.
- Jelszókarakter-kategóriák, hosszmaximum és a szerveroldali komplexitásellenőrzés Better Auth-integrációja.
- Jelszó-visszaállítás után minden session és meccsjogosultság visszavonásának, valamint az explicit meccskilépésnek a technikai koordinációja; a termékszabály már elfogadott.
- Better Auth session 5 perces megújítási célütemének kliensfolyamata. Élettartam 30 perc, nincs 24 órás abszolút maximum; cookieCache kikapcsolva.
- Mi legyen a profil és érvényes session életciklusa authlétrehozási/profillétrehozási hiba esetén?
- Milyen folyamat biztosítja a Better Auth és saját adatok koordinált, tényleges törlését?
- Lejárt authsession utáni meccsvisszatérés HTTP-kiadási részletei és visszavonásának koordinációja. A meccs kezdetétől fix 30 perces, nem hosszabbított HttpOnly cookie és memóriabeli hashnyilvántartás már elfogadott.
- A vendégsession saját HTTP-végpontjának konkrét útvonala/metódusa és az aktív használat technikai felismerése; a 15 perces megújítható élettartam, 5 percenkénti HTTP-ellenőrzés és a végeredmény-képernyő végi megszüntetés már elfogadott.
- Kijelentkezés authsession-hatókörének pontos szabálya több eszköz esetén; a meccsből kilépés mindegyikre érvényes.
- A nickname szóköz-normalizálása, ürességellenőrzése és Unicode-hosszának pontos értelmezése. A 40 karakteres maximum elfogadott.
- Az M2-ben rögzített fogadási idő, monoton óra, sorba állítás, protokollütközés és lezárt scope frontendoldali kezelése az M4-ben; a backendmegvalósítást és teszteket a [vezérlő dokumentációja](backend-controller.md) rögzíti.
- Mentési és törlési zárak, tranzakciós izoláció, logstruktúra és leállítási eljárás.
- PostgreSQL CHECK/FK szabályok és alkalmazásoldali, több rekordot érintő invariánsok pontos felosztása.

### Későbbi termékfejlesztésben

- Google, Apple és más szolgáltatói belépés, fiók-összekapcsolási szabályokkal.
- Seedalapú újrajátszhatóság, generátor és forrásverziók, kérdésgenerálás.
- Tiebreak, csapatjáték és kategóriaszavazás.
- ELO számítása és ranglista.
- Nickname-ellenőrzés/moderáció és profilképfeltöltés.
- Többnyelvű felület és tartalom.
- Várakozóként csatlakozás aktív meccs alatt.
- Vendégeredmény utólagos mentése bejelentkezéssel.
- Soft delete, több backendpéldány és meccsek tartós helyreállítása.

## 13. Dokumentációs források

Ezek tájékozódási források, nem rögzített csomagverziók vagy igazolt integrációk.

- [Better Auth Drizzle-adapter](https://www.better-auth.com/docs/adapters/drizzle)
- [Better Auth adatmodell](https://www.better-auth.com/docs/concepts/database)
- [Better Auth Express-integráció](https://www.better-auth.com/docs/integrations/express)
- [Better Auth sessionkezelés](https://www.better-auth.com/docs/concepts/session-management)
- [Better Auth JWT plugin](https://www.better-auth.com/docs/plugins/jwt)
- [Better Auth email + jelszó](https://www.better-auth.com/docs/authentication/email-password)
- [Better Auth emailküldés](https://www.better-auth.com/docs/concepts/email)
- [Drizzle migrációk](https://orm.drizzle.team/docs/kit-overview)
- [Socket.IO kézbesítési garanciák](https://socket.io/docs/v4/delivery-guarantees/)
- [Socket.IO kapcsolat-helyreállítás](https://socket.io/docs/v4/connection-state-recovery/)
- [Render WebSocket](https://render.com/docs/websocket)
- [Render deploy](https://render.com/docs/deploys)

A további implementációhoz külön felhasználói utasítás szükséges. Ennek a dokumentumnak az elkészítése nem engedélyezi az alkalmazáskód írását.
