# M4 — Reszponzív játék- és fiókfelület

Frissítés: 2026-10-09.

Az angol MVP-felület vendég szólómeccset és bejelentkezett többjátékos meccset
kezel a meglévő motorral, authsessionnel és adatbázissal. A fő implementáció az
`apps/web/src` alatt található; új csomagfüggőség nem került a repóba.

## Megjelenés és szerkezet

A felhasználó `apps/web/index.css` fájlja változatlanul a paletta és a betűcsaládok
forrása. A `src/styles.css` szemantikus változókra épít; a rendszer világos/sötét
témáját követi. Az elsődleges gomb szövege sötét emberárnyalatot kap a megfelelő
kontrasztért. A Bebas Neue, DM Sans és DM Mono helyi WOFF2 asset; a licencek a
`public/fonts` alatt vannak. Nincs külső fontkérés.

A telefonos elrendezés egyoszlopos. Asztalon a kezdőlap két oszlopra, a játék
kérdésre és játékospanelre vált. A válaszrács saját container queryt használ,
így a rendelkezésére álló szélesség dönt az egy/két oszlopról. A grid/flex,
`clamp()`, `dvh`, safe-area és CSS-változók végzik a méretezést. A designterv:
[`design-system/rapidfire/MASTER.md`](../design-system/rapidfire/MASTER.md).

Valódi linkek, natív válaszgombok/checkbox mezők, címkék, skip link, látható billentyűzetes
fókusz, hibára fókuszáló összesítő és natív dialog segítik a használatot. A
hibaszövegeknek fenntartott hely megelőzi a kattintás közbeni gombelmozdulást.
A jelszómező támogatja a beillesztést, a jelszókezelőt és a megjelenítés kapcsolását.
A csökkentett mozgás beállítása kikapcsolja az átmeneteket. A ticking timer nem
live region; a fázisváltás a fő tartalomra viszi a fókuszt.

A főoldali cím a csatolt prototípus ötletét követi: `Think.`, `Answer.`, `Guess.`,
`Learn.`, `Play.`, `Win.` váltakozik két másodpercenként a fix `Fast.` mellett.
A grid a leghosszabb szónak is helyet tart, így a váltás nem mozgatja az űrlapot.
Az animáció szüneteltethető, a vezérlő fókuszakor és rejtett tabon megáll;
csökkentett mozgásnál álló `Think. Fast.` cím látszik. A képernyőolvasó stabil
címet kap, a díszítő szavak váltása nem indít ismételt felolvasást. Az időzítő
és eseményfigyelők unmountkor takarítódnak, Strict Mode mellett is.

## Útvonalak

| Útvonal                               | Funkció                                                             |
| ------------------------------------- | ------------------------------------------------------------------- |
| `/`                                   | Vendég/bejelentkezett szólóindítás, szobalétrehozás és csatlakozás. |
| `/sign-up`, `/sign-in`                | Email/jelszó regisztráció és belépés.                               |
| `/forgot-password`, `/reset-password` | Semleges helyreállítási kérés és kétmezős új jelszó.                |
| `/verify-email`                       | Email-link ellenőrzése, angol siker/hiba képernyő.                  |
| `/profile`                            | Nickname, ELO, jelszócsere és végleges fióktörlés.                  |
| `/history`, `/history/:id`            | Saját mentett meccsek és rövid kérdésenkénti eredmények.            |
| `/game`                               | A szerver aktuális várószoba-/meccsállapota.                        |

A kis History API-router megtartja a linkek új tabos/Cmd/Ctrl+click működését.
A fázis és jogosultság a szerver snapshotjából származik. A kliens nem írja át
a szerver játékállapotát a böngésző URL-je alapján. A fiókűrlapok a belső
navigáció és az oldal elhagyása előtt figyelmeztetnek a módosított mezőkre.

## Kapcsolat, állapot és auth

A `lib/client.ts` egy komponensektől független store-ban tartja a socketet,
azonosságot, snapshotot és függő parancsot. A React `useSyncExternalStore`-ral
iratkozik fel. A komponensek csak a publikus contracts csomagot importálják;
motor- és szerverimport nincs a frontendben. Az HTTP/socket válaszok futásidőben
validáltak, és a hibák stabil kódokból kapnak angol szöveget. A saját másolatok
a `lib/copy.ts` cserélhető, típusos katalógusában vannak; szám/dátum: `Intl`.

- A sessionellenőrzés relatív HTTP-kérés, HttpOnly cookie-val. Játék és aktív,
  látható lap esetén ötpercenként történik; fókusz, láthatóvá válás és hálózati
  visszatérés is ellenőrzést indít. A háttérben felfüggesztett lap nem igényel
  pontos időzítőfutást.
- A normál session 30 perces, a vendégsession 15 perces. A socket nem újítja meg
  a cookie-t; HTTP-ellenőrzés frissíti a szerver kapcsolatait. A vendég nickname
  a megújítási válaszból biztonságosan visszaállítható.
- A tényleges meccskezdet után HTTP adja ki a fix, kezdettől számított 30 perces
  meccsvisszatérési cookie-t. A frontend nem hosszabbítja meg ezt a határidőt.
- Meccs közbeni sessionlejárat mellett a játék folytatható. A következő lobbyban
  az újraazonosítást igénylő tag ready=false marad; a belépési link ugyanoda
  viszi vissza. A 60 másodperces türelmi időt a backend tartja nyilván.
- A játékfelület csak kilépést kínál. A főoldali kijelentkezés minden eszközre
  érvényes; a reset, jelszócsere és törlés a backend visszavonási szabályait követi.
- Kapcsolatvesztéskor a nézet megmarad, a módosító vezérlők zárolnak. Reconnect
  teljes snapshotot kér. Lejárt hely vagy megszűnt scope esetén a kliens visszatér
  a főoldalra; egy elutasított state:sync nem indít rekurzív sync-kéréseket.
- A parancsok egyedi requestId-t kapnak. Az öt másodperces ack-timeout után nincs
  automatikus módosító újraküldés; a kliens lekéri az aktuális állapotot. Késői
  válaszack nem írhatja felül a következő kérdést vagy egy már elfogadott választ.
- A timer szerveridőt és monoton `performance.now()` eltérést használ.
  Rendszeróra-átállítás nem változtatja meg a kliens visszaszámlálását.

## Játék és mentett eredmények

A kérdés előtti countdown csak a kategóriát és az időt jeleníti meg. A kérdés
és az opciók megnyitáskor kerülnek a DOM-ba. Egyetlen elküldött válasz minden
azonos felhasználói tabon zárol; az értékelésig nincs helyesopció-jelzés.
Egyszeres választásnál a natív válaszgomb koppintása vagy Enter/Space aktiválása
azonnal beküldi az opciót, külön megerősítés nélkül. Egy folyamatban lévő
beküldést a gyors ismételt aktiválás sem dupláz meg. Többválaszos kérdésnél
a kiválasztás szerkeszthető a külön `Lock in answer` megerősítésig. Több
helyes opcióhoz checkbox és részpont-kijelzés tartozik. A score/rank/idle/offline
a szerver adata, a kliens nem számol saját pontot.

A végeredmény a mentés `pending/retrying/saved/failed` állapotát is jelzi.
A vendégeredmény csak ezen a képernyőn érhető el, a későbbi belépés nem menti
visszamenőleg. A bejelentkezett előzmény 20-as kurzoros lapozást használ.
A részletekhez rövid eredmény és pont tartozik, kérdésszöveg/seed visszajátszás
továbbra sincs. Közös eredményben a törölt személy „Deleted user” néven szerepel.

## Kisebb HTTP-kiegészítések

- `GET /api/game-config`: a rendelkezésre álló, legfeljebb tíz forduló száma.
  A jelenlegi mintakérdés-provider három kategóriája miatt most három. A frontend
  ezt a szervertől veszi át, nem tárol másolatot a kérdésekből/kategóriákból.
- `POST /api/guest/session/renew`: a meglévő határidők mellett `guest.nickname`-t
  ad; userId/token továbbra sem kerül a válaszba.
- A böngészős `GET /api/auth/verify-email` relatív app-URL-re irányít. A képernyő
  JSON-kérése az eredeti Better Auth ellenőrzést használja. A reset/verify token
  memóriába kerül, majd eltűnik a címsorból; nincs localStorage mentés és
  referrer-továbbítás.

Nincs DB-sémaváltozás, új migráció vagy socket-protokollverzió-váltás.

## Ellenőrzés

Futtatás a repó gyökeréből, elérhető tesztadatbázissal:

```sh
npm run build
npm test
npm run test:e2e
npm run test:e2e:production
```

A Playwright `environment` projekt a fejlesztési/production origin működését
ellenőrzi. A `frontend` projekt minden teszthez valódi, egy origint kiszolgáló
alkalmazást, elkülönített PostgreSQL adatbázist és böngészőket indít. Csak az
emailport és a kérdésprovider/óra teszthelyettesítő; az auth, socket, mentés és
tranzakciók valódiak. A tesztadatbázisok létrehozásához CREATEDB jogosultság kell.
A fixtureszek a server workspace alatt vannak, így az adott függőséghatárt
öröklik. A kötelező `tsconfig.browser.json` DOM-típusokkal ellenőrzi ezeket;
a frontend/contracts/motor/tooling declaration check változatlanul bekapcsolt.

Hat böngészős M4 teszt már lefutott sikeresen: teljes vendégmeccs, kétjátékos
meccs/többtabos lock/reconnect/history/törlés, auth/reset/profil, nyolc
viewport/téma-kombináció és 200%-os szöveg/billentyűzet/reduced motion,
offline lobby eltávolítás, ötperces HTTP-vendégmegújítás. A többjátékos teszt
sessionlejáratot, lobby-újrabelépést és auth-timeoutot is ellenőriz.
Hat kliens/séma unit teszt és két frontend HTTP-integrációs teszt is sikeres.
A screenshotok alapján a 375/390px mobil és a 1440px asztali kezdőlap/játék
olvasható, a világos és sötét kezdőlap nem csordul túl.

Az eredeti M4 `npm run check` sikeres: strict típusellenőrzés, build, **151 Vitest teszt**,
**9 fejlesztői és 9 production böngészőteszt**. A `format:check`, `npm ls --all`
és az audit is sikeres (0 függőséghiba, 0 audit találat). A frontend assetekben
a konfigurált adatbázis/auth titkok nem találhatók, a motor runtime függősége
továbbra is nulla. A világos/sötét normál linkszöveg és elsődleges gomb
szövegkontrasztját böngészős 4,5:1 küszöbbel is ellenőrizzük.
Valódi Resend-kézbesítés továbbra is hiányzó providerkonfigurációt igényel;
email-megerősítés nincs kikapcsolva. Más böngészőmotor és fizikai mobilkészülék
nem volt tesztelve. A kérdésgenerálás/seed, ranglista/ELO-algoritmus, social login
és deployment későbbi feladat.

A 2026-10-09-i frontendfinomítás után a teljes `npm run check` ismét sikeres:
**191 Vitest teszt, 12 fejlesztői és 12 production böngészőteszt**. A játékteszt
koppintással és Enterrel történő azonnali egyszeres válaszküldést, külön
megerősített többszörös választ és a többtabos zárolást is ellenőrzi. Két új
kezdőlapteszt vizsgálja a szövegváltást, a változatlan űrlappozíciót, a szünetet
és folytatást, a billentyűzetes fókuszt, a reduced motion beállítást, valamint a
világos/sötét témát három képernyőméreten, 200%-os szövegmérettel.

Az emailprovider a frontend elkészítése után Resendre változott; a korábbi
böngészőtesztek emailportot helyettesítenek. A [Resend útmutató](email-guide.md)
leírja az API-kulcs és saját domain beállítását emailtárhely nélkül.
