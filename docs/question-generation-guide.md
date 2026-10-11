# Kérdésgenerálás és játszható kiadások

A League of Legends játékok a PostgreSQL-be importált, ellenőrzött hősadatokból
készülnek. A produkciós alkalmazás nem használ mintakérdéseket, és nem indít
játékot publikált kiadás nélkül. Az import kézi; az utána következő
**ellenőrzés és kiadáspublikálás automatikus**.

## Első indítás és frissítés

1. Állítsd be az adatbázist a [Docker/PostgreSQL útmutató](database-guide.md)
   alapján, majd futtasd: `npm run db:up` és `npm run db:migrate`.
   A `0004_generation_releases.sql` migráció hozzáadja a kiadás-, sablon- és
   fordulómetadata-táblákat. A korábbi meccsek generálási mezői NULL maradnak.
2. Indítsd az alkalmazást: `npm run dev`. Éles buildnél `npm run build`,
   majd `npm start`.
3. Egy ellenőrzött fióknak adj adminjogot a
   [hősadat-importálási útmutató](lol-data-guide.md) szerint.
4. Az **Admin → Champion data → Update champion data** gombbal indíts importot.
   Már korábban importált, változatlan adatkészlethez is elkészülhet az első
   játszható kiadás; ehhez nem kell új LoL-patch.
5. Az import lezárása után a **Playable question versions** listán megjelenik
   a kiadás és a használható kategóriák száma. A főoldalra visszatérve a
   játékbeállítások újra lekérik a verziólistát.

A [helyi JSON-import CLI](lol-data-guide.md) ugyanazt az
ellenőrzést és automatikus publikálást végzi. A futó szerver a következő
`/api/game-config` lekéréskor a külön CLI-folyamatban publikált kiadásokat is
betölti; a már létrehozott szobák választása közben változatlan marad.

**Szokásos telepítéshez `db:migrate` kell, nem `db:generate`.** A sémafrissítés
fejlesztéskor készít új, verziókezelt migrációt. Az immutable tartalmat védő
SQL-triggerek is a migráció részei; a Drizzle sémadiff ezeket nem generálja újra.

## Játékbeállítások

- A főoldali szólóbeállításokban és a tulajdonos lobbybeállításaiban
  kiválasztható a **Question version**. Az alapérték a numerikusan legfrissebb
  patch, majd azon belül a legmagasabb revízió; például `16.20.1 · r2`.
- A szoba a létrehozáskor konkrét kiadás-UUID-t kap. Új publikálás nem váltja
  át a meglévő szobát vagy meccset. A lobbyba visszatérés is megtartja a kiadást.
- A **Use a custom seed** kapcsoló után 1–10 ASCII betű/szám adható meg.
  A kis-/nagybetű és a vezető nulla számít; nincs automatikus trim.
  Kikapcsolva a szerver meccsenként új, tízkarakteres seedet generál.
- A kézi seed az egész meccset kizárja a későbbi ELO-változásból. Egy korábbi
  automatikus seed kézi bemásolása is kézi eredetnek számít. ELO-számítás az
  MVP-ben továbbra sincs; az előkészített `custom_seed` ok már eltárolódik.
- A kiadás-/seedváltoztatás törli a ready állapotokat. A fordulómaximum az
  adott kiadás kategóriáinak száma, legfeljebb tíz; a felület nem módosítja
  automatikusan az érvénytelen fordulóbeállítást.
- A tényleges automatikus seed az aktív meccs alatt rejtett, HTTP-historyban is.
  A befejezett/megszakított játék kiértékelője és a belépett játékos előzménye
  megmutatja a seedet és a kiadás címkéjét. A vendégjáték továbbra sem kerül
  tartós személyes előzménybe.

## Mit jelent az azonos seed és kiadás?

Ugyanaz a seed és immutable kiadás ugyanazt a kategóriánkénti öt kérdést,
opcióhalmazt és opciósorrendet adja. A teljes meccs kérdéssora akkor egyezik,
ha ugyanazokat a kategóriákat választják. A kategóriakínálat a fordulószámtól
és a korábbi kategóriaválasztásoktól függ, a játékosszámtól és a
socketparancsok számától nem.

A generátor natív TypeScript. A seedelt sorsolás `xoshiro128**`, SHA-256-tal
képzett külön streammel a kínálathoz, automatikus kategóriaválasztáshoz,
kérdésslothoz és opciókeveréshez. Az index torzításmentes rejection sampling,
a keverés Fisher–Yates. A játékmotor továbbra is külön, külső könyvtárak és
I/O nélkül működik; célzott tartalmi döntési bemenetet kap.

Az eltérésellenőrzés és a metrikánkénti küszöbrács BigInt-alapú, pontos
szorzásokkal dolgozik. A forrásértékeket nem kerekíti át. A nehézségeket
családonként mindig easy → medium → hard → challenger sorrendben tervezi,
így a későbbi kategóriaválasztási sorrend sem változtatja meg a csomagokat.

## Ellenőrzés és tárolás

A publikálás új adat-/sablon-/generátor-tartalomhash esetén 207 rögzített seeden
ellenőrzi az összes elérhető ötös csomag alakját és kérdésszöveg-egyediségét.
A jelöltindex előzetesen ellenőrzi a sávokat, az opciószámot, a helyeshalmazt
és a kérdéskapacitást. Ez véges ellenőrzés, nem az összes lehetséges seed
felsorolása. A referencia-vektorokat és a 130 független referenciakérdés
opcióit/helyeshalmazát az automatizált TS-tesztek is ellenőrzik.

A csatolt `16.20.1` adatokkal 26 változat használható. A
`chromaPerSkin:hard` kimarad, mert nincs öt különböző látható prompt.
A jóváhagyott hat ismeretlen chromadarabszám és húsz nem pozitív cooldown
csak az érintett metrikákból záródik ki; a többi adat használható marad.
A képes kategóriák és a nem végleges növekedési/regenerációs unitok inaktívak.

A kiadás a datasetet, a teljes katalógus/szöveg-manifestet, valamint a
normalizáló-, generátor-, seed- és PRNG-verziót rögzíti. Publikálás után az
adatbázis FK-k és triggerek tiltják a tartalom módosítását/törlését. Egy új
szöveg vagy adat új revíziót kap; a régi meccs a régi manifesttel reprodukálódik.
Új generátorverzió bevezetésekor meg kell tartani a korábbi verzió futtatását;
ismeretlen generátorverziót a szerver nem kínál fel helyettesített tartalommal.

A meccshez seed/eredet/kiadás/ELO-kizárási ok, a fordulóhoz kategóriakulcs és
kérdéscsomag-hash mentődik. Teljes kérdésszöveg, opciók és beküldött
válaszazonosítók továbbra sem kerülnek az eredménytáblákba.

Sikertelen kiadásellenőrzésnél `GENERATION_CHECK_FAILED` jelenik meg az
importnaplóban, és a korábbi játszható kiadás marad az alapérték. A nyers
adatimport ettől még sikerülhetett: az aktív adat és az alap játszható kiadás
külön pointer. Hiányzó kiadásnál `GENERATION_UNAVAILABLE`, elérhetetlen
explicit kiadásnál `RELEASE_UNAVAILABLE` akadályozza az indulást.

A socketprotokoll **3**-as verzióra változott; a régi kliens oldalfrissítést
kér, és nem csatlakozhat eltérő szerződéssel. Új csomagfüggőség nem szükséges.
