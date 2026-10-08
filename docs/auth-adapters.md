# Authadapterek és meccsvisszatérés — technikai terv

Utolsó frissítés: 2026-10-08.

Kapcsolódó dokumentum: [MVP tervezési dokumentum](design.md).

Az M3 megvalósítása, a végleges HTTP-útvonalak és a végrehajtott ellenőrzések a [backend auth- és tárolási dokumentumban](backend-auth-storage.md) találhatók; az alábbi szöveg a korábbi technikai terv.

Ez a dokumentum az elfogadott authéletciklus technikai tervét tartalmazza. Elfogadott: szolgáltatófüggetlen emailport, az MVP-ben Resend HTTPS-adapterrel; memóriabeli küldési sor a megadott timeout/újrapróbálási szabályokkal; valamint a meccs kezdetétől számított fix 30 perces HttpOnly meccsvisszatérési cookie, szerveroldali hashnyilvántartással. A felhasználó 2026-10-08-i Resend-döntése felülírja a korábbi SMTP2GO + Nodemailer szolgáltatóválasztást. Ez technikai terv, nem végrehajtott szolgáltatásbeállítás; a tényleges implementációt és ellenőrzéseit az M3/M4 dokumentációja rögzíti.

## 1. Rögzített követelmények

- Better Auth, email + jelszó belépés; bejelentkezés előtt linkes email-megerősítés szükséges.
- Password reset kérés létező és nem létező címre ugyanazt a semleges felületi választ adja.
- Reset-link 15 perc, egyszer használható; megerősítési link 24 óra.
- Újraküldés legfeljebb percenként, további szerveroldali kéréskorlátozással.
- Session 30 perc, megújítható, 24 órás abszolút korlát nélkül.
- Better Auth cookieCache az MVP-ben kikapcsolva; normál hitelesítésnél szerveroldali, adatbázisra támaszkodó sessionellenőrzés történik. Ez nem változtatja meg a futó meccs korlátozott jogosultságát vagy a socket requestId-cache-t.
- Normál authsession megújítási célüteme aktív használat mellett 5 perc; mérés alapján később 10 percre növelhető. A HTTP-megújítás folyamata a 3.10. pontban elfogadott; a szerver kérés nélkül nem hosszabbít korlátlanul.
- Vendégsession élettartama 15 perc, aktív használat mellett 5 percenkénti HTTP-ellenőrzéssel újabb 15 percre megújítható; a végeredmény-képernyő végén megszűnik. A külön meccsvisszatérési cookie fix 30 perces határidejét nem hosszabbítja meg.
- Authsession lejárata nem szakítja meg az aktív meccsrészvételt, idle állapotban sem.
- Új játék, profil és előzmények érvényes authot igényelnek.
- Explicit kilépés/logout, fióktörlés és sikeres password reset megszünteti a meccsjogosultságot.
- Password reset minden korábbi authsessiont visszavon, és meccsben explicit kilépést okoz.
- Újraazonosításra a következő várószobában 60 másodpercig tartjuk fenn a helyet, ready = false értékkel.
- Vendégeredményt nem mentünk tartósan; vendégjogosultság a végeredmény-képernyő végén megszűnik.
- Egy Node szolgálja ki a frontendet, HTTP API-t és Socket.IO-t ugyanazon originen.
- A játékmotor natív TS, külső könyvtár, email- és cookie-kezelés nélkül.
- A meccsvisszatérési cookie a meccs kezdetekor frissül, csak abba a meccsbe enged vissza, és az indulástól számított fix 30 percig érvényes. Játék közben nem hosszabbítjuk meg. A meglévő meccs és részvétel visszatéréskor mindig ellenőrizendő.
- Ha a meccs már nincs, létező várószobába irányíthatjuk a klienst a normál hitelesítési és csatlakozási szabályokkal.
- Az MVP emailküldő ingyenes csomagban használható tranzakciós szolgáltatás legyen; a tényleges keretek a providerfiókban ellenőrizendők.
- Az MVP emailprovidere Resend. Saját domain DNS-ellenőrzésével külön emailtárhely nélkül használható; a szolgáltató később könnyen cserélhető marad.
- Egy felhasználónak egy játékfolyamata lehet; szobatagság mellett nem indít külön szólómeccset. Ez a több eszköz jogosultsági koordinációjára is érvényes.

## 2. Emailküldő adapter

### 2.1. Felelősségek

| Egység | Feladat |
|---|---|
| Better Auth | Felhasználó, ellenőrző/reset-token és URL, érvényesség, emailVerified, jelszó-visszaállítás. |
| Auth-integráció | sendVerificationEmail/sendResetPassword callback bekötése, a célhoz illő feladat létrehozása. |
| Emailalkalmazási szolgáltatás | Sablon, locale, címzés, újraküldési korlát, küldési feladat koordinálása. |
| Emailadapter | Egy konkrét szolgáltató HTTP API-jának vagy SMTP-jének használata, válaszok egységesítése. |
| Fejlesztői/tesztadapter | Küldési folyamat tesztelése valódi felhasználói levelezés nélkül. |

Nem készül saját auth-token rendszer. A küldési feladat az adott Better Auth által létrehozott linket használja, nem generál új tokent.

### 2.2. Szolgáltató és függőségek

Elfogadott MVP-irány: Resend tranzakciós emailküldés a szolgáltató HTTPS API-jával. Ez a korábbi SMTP2GO + Nodemailer választást felülírja; a szolgáltatófüggetlen határ és a küldési sor megmarad.

- A backend a Node beépített `fetch` API-jával hívja a rögzített `https://api.resend.com/emails` végpontot. Külön Resend SDK vagy SMTP-könyvtár nem szükséges.
- `RESEND_API_KEY` és `EMAIL_FROM` konfigurációból jön; az API-kulcs csak szerveroldali titkos konfigurációba kerül. Az alkalmazás publikus alapcíme továbbra is `BETTER_AUTH_URL`.
- Saját feladóhoz a küldő domain DNS-ellenőrzése kell. A feladó neve és címe emailtárhely nélkül is használható; bejövő levél fogadását ez nem biztosítja.
- Az alapértelmezett Resend tesztfeladó saját fiókcímre szánt próba; tetszőleges játékoscímhez ellenőrzött domain kell.
- A Better Auth callback, sablonok és küldési sor a szolgáltatófüggetlen emailmodult használják. Másik szolgáltató később ugyanennek a portnak új adapterével kapcsolható, az authfolyamat és a játék módosítása nélkül.
- Nincs emailes import a motorban vagy a publikus contracts csomagban. A hozzáférés a frontend buildbe és Gitbe nem kerül.
- A szolgáltatói fiók, domain DNS-ellenőrzése és valódi kézbesítési próba külön bekötési feladatok. Lásd a [Resend útmutatót](email-guide.md).

2026-10-08-án a Resend hivatalos OpenAPI-leírása és Node SDK-forrása olvasható volt, a webes dokumentáció elérését a környezet proxyja 403-mal blokkolta. Az aktuális csomagkvóták, a felhasználó providerfiókja és domainbeállításai ezért nem ellenőrzöttek. A korábbi SMTP2GO/Brevo/SendPulse árazási vizsgálat a korábbi szolgáltatóválasztás előzménye, nem a Resend feltételeinek bizonyítéka.

- [Resend domain DNS-ellenőrzés](https://resend.com/docs/dashboard/domains/introduction)
- [Resend küldési API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend OpenAPI](https://github.com/resend/resend-openapi/blob/main/resend.yaml)

### 2.3. Belső küldési feladat

| Adat | Jelentés |
|---|---|
| jobId | Saját UUID a küldési feladat azonosításához. |
| purpose | verify_email / reset_password. |
| userId | A cél felhasználó szerveroldali azonosítója, törlés/visszavonás koordinálásához. |
| recipient | Cél email, nem publikus állapotadat. |
| locale | MVP-ben en; későbbi emailfordítás alapja. |
| templateVersion | Az alkalmazott sablon verziója. |
| actionUrl | Better Auth által létrehozott link. |
| linkExpiresAt | A link lejárata, a létrehozástól számítva. |
| createdAt | Feladat létrehozása. |
| attempt | Küldési próbálkozás száma. |

Két egyszerű, szöveg + HTML sablon elegendő: email-megerősítés és jelszó-visszaállítás. A szolgáltató nem kapja meg a felhasználó jelszavát.

A linket tartalmazó feladat érzékeny adat: a teljes levél, URL és token nem kerül normál naplóba. A későbbi fejlesztői előnézet csak elkülönített tesztadatokra és fejlesztői környezetre korlátozott.

### 2.4. Küldés menete

1. Az authvégpont fogadja az email-megerősítési/reset-kérést és alkalmazza a szerveroldali korlátokat.
2. Better Auth az adott folyamat szabályai szerint létrehozza a linket, és meghívja az emailcallbacket.
3. A callback átadja a küldési feladatot az emailalkalmazási szolgáltatásnak.
4. A kliens semleges visszajelzést kap; resetnél a válasz nem árulja el a fiók létezését vagy a címhez kötött providerhibát.
5. A küldési sor a megfelelő sablonnal meghívja az adaptert.
6. Az adapter visszaadja: szolgáltató által elfogadva, átmeneti hiba vagy végleges hiba.

Nem létező fiókra nem küldünk levelet. A sikeres HTTP-válasz sem azt jelenti, hogy az email megérkezett, hanem a kérelem semleges visszaigazolása. Az authvégpontok konkrét válasznormalizálását a kiválasztott Better Auth-verziónál ellenőrizni kell.

A provider elfogadó válasza nem garantál postaládába kézbesítést. Bounce/webhook kezelés nem része az első adapter javasolt MVP-hatókörének.

### 2.5. Sor, timeout és újrapróbálás — elfogadott

Az emailküldés külön alkalmazási feladatsor, nem a játék állapotmódosítási vagy eredménymentési sora.

- MVP-ben memóriabeli, korlátozott méretű sor; tartós email-outbox tábla és külső queue nem szükséges az első változathoz.
- Egy providerkérés timeoutja 5 másodperc.
- Átmeneti hálózati hiba, HTTP 429 vagy 5xx esetén összesen legfeljebb három próbálkozás. HTTP 409 esetén csak a `concurrent_idempotent_requests` hibakód ismételhető; eltérő tartalommal újrahasznált idempotenciakulcs végleges hiba.
- Próbálkozások közti szünet: 2, majd 8 másodperc. Lejárt linket nem küldünk ki. A korlátozott MVP-sor nem vezet új, korlátlan szolgáltatói várakozási ciklust.
- Hibás konfiguráció, érvénytelen szolgáltatói hozzáférés és más végleges hiba esetén nincs változatlan automatikus ismétlés.
- Minden próbálkozás ugyanazt a linket és jobId-t használja. Új felhasználói kérés másik folyamat, a percenkénti korlát alá tartozik.
- A stabil belső üzenetazonosító Resend `Idempotency-Key` fejlécként kerül minden próbálkozásba, legfeljebb 256 karakterrel. Az ismételt kérés ugyanazt a tartalmat tartja meg. Az API-idempotencia a provider aktuális szabályaihoz kötött.
- A provider elfogadása nem jelent postaládakézbesítési garanciát. Nem ígérünk pontosan egyszeri kézbesítést.

A link lejárata a token létrehozásától számít, nem a kézbesítéstől. Providerhibára nem hosszabbítjuk meg önkényesen a reset-token érvényességét.

Újraindításkor a még el nem küldött memóriabeli feladat elveszhet. A felhasználó új levelet kérhet a normál szabályok szerint. Ez az elfogadott MVP-megoldás ismert korlátja; tartós outbox később hozzáadható.

A sor betelése vagy szolgáltatási hiba naplózott és üzemeltetési jelzésre alkalmas legyen. Resetnél a felület nem különböztetheti meg az eseteket a célfiók létezése alapján.

### 2.6. Kéréskorlátozás és törlés

- A percenkénti korlát szerveroldali, célcím és célfolyamat alapján; a nem létező címekre is alkalmazható.
- A kulcs az auth által használt email-normalizálásból származzon; saját, eltérő normalizálás ne hozzon létre megkerülhető korlátot.
- További IP- és összesített szolgáltatási korlát szükséges, konkrét számértékek még nem véglegesek. Az IP nem felhasználóazonosság.
- A frontend újraküldési visszaszámlálója csak felületi segítség.
- Közvetlen Better Auth-végpontok sem kerülhetik meg a korlátokat.
- Fióktörlés törli/érvényteleníti a hozzá tartozó, még sorban álló küldési feladatokat és tokeneket a koordinált authfolyamat részeként.
- Provider által már elfogadott levél nem hívható biztosan vissza; a benne lévő jogosultság érvénytelenítése számít.
- Korábbi linkek sorsa újraküldés után a Better Auth kiválasztott verziójának tokenkezelésével összehangolandó; nem feltételezünk nem ellenőrzött automatikus visszavonást.

### 2.7. Naplózás és ellenőrzések

Naplózott: jobId, purpose, próbálkozás, időtartam, provider hibakód, elfogadás vagy sikertelenség. Nem naplózott: jelszó, token, teljes actionUrl vagy levéltartalom.

Tervezett ellenőrzések:

- Callback a megfelelő sablont, célt és lejáratot adja az adapternek.
- Létező/nem létező email reset-válasza semleges.
- Frontend megkerülésével is érvényes a percenkénti korlát.
- HTTP 429/5xx, ismételhető 409 és átmeneti hálózati hiba után újrapróbálás, végleges hiba után leállás.
- Retry ugyanazt a linket használja, lejárt linket nem küld.
- Fióktörlés után sorban álló levél nem válik új jogosultság forrásává.
- Provider elfogadását nem nevezzük bizonyított kézbesítésnek.

## 3. Meccshez kötött visszatérési azonosító

### 3.1. Elfogadott megoldás

Kriptográfiailag véletlen, átlátszatlan azonosító, HttpOnly cookie-ban. Nem JWT és nem Better Auth-session; csak egy konkrét meccs még részt vevő játékosának korlátozott visszatérési bizonyítéka.

Miért ez a javaslat:

- Az alkalmazásnak a meccs memóriabeli állapotát amúgy is ismernie kell.
- A szerveroldali rekord egyszerűen visszavonható kilépés/logout/reset/törlés esetén.
- Nincs szükség önálló JWT-aláírókulcsra vagy új refresh-token rendszerre.
- Oldalfrissítés, socketreconnect és a cookie élettartamán belüli böngésző-/gépújraindítás után a bizonyíték újraküldhető.

Az utolsó pont miatt a cookie nem csak a böngészőfolyamat végéig élő session-cookie. Az elfogadott lejárat a meccs indulása + 1800 másodperc. Később végrehajtott HTTP-kiadásnál a cookie Max-Age csak az ebből hátralévő idő lehet. Reconnect, normál sessionmegújítás és ismételt cookie-kiadás nem tolja ki a határidőt. Új meccs kezdetekor az új meccshez új 30 perces ablak tartozik; a régi meccs tokenje nem ruház át jogosultságot.

### 3.2. Létrehozás és tárolás

- A szerver legalább 32 kriptográfiailag véletlen bájtból készíti az azonosítót. Ez infrastruktúrafeladat, nem a TS-játékmotoré.
- A böngésző a nyers azonosítót cookie-ban kapja meg.
- A szerver a token hashét tárolja, például SHA-256-tal, a nagy entrópiájú véletlen tokenhez.
- Nincs token URL-ben, Socket.IO publikus payloadban, localStorage-ban vagy eredményadatbázisban.
- A nyilvántartás memóriabeli, az egy backendpéldányos MVP-ben. Nem kerül a game/user_game táblákba.
- Egy résztvevőnek több böngészőből/eszközről több érvényes azonosítója lehet, de közös válasz- és részvételi állapota marad.

| Szerveroldali adat | Feladat |
|---|---|
| credentialId | Belső UUID; nem maga a jogosító titok. |
| tokenHash | A cookie-érték ellenőrzéséhez. |
| gameId | Kizárólagos meccshatókör. |
| participantId | Stabil résztvevőazonosság. |
| userId | Jogosult felhasználó; fióktörlés/reset szerinti visszavonáshoz. |
| originatingSessionId | Kiadáskori authsession, ha rendelkezésre áll. |
| issuedAt | Kiadás időpontja. |
| expiresAt | A meccs indulása + 30 perc, kiadástól független fix határidő. |
| revokedAt | Visszavonás; MVP-ben a rekord el is távolítható. |

A visszatérési ellenőrzés mindig a token szerveroldali lejáratát, a meccs létezését és az aktuális részvételt is vizsgálja. Nem elegendő egy még megtalálható tokenrekord vagy a böngészőben maradt cookie. A visszatérési token lejárata nem egyenlő a már futó, ismert résztvevő meccsből kiléptetésével: az élő kapcsolat meccsjogosultságát és a visszacsatlakozási bizonyíték érvényességét külön kezeljük.

### 3.3. Cookie és HTTP-kiadás

A Socket.IO üzenet nem megfelelő hely HttpOnly cookie beállítására; a kiadást HTTP-végpont végzi ugyanazon originen.

Javasolt új végpont: POST /api/matches/{gameId}/access. Ez új technikai kiegészítés, nem az elfogadott játékparancsok HTTP-re költöztetése.

A végpont:

1. Érvényes Better Auth-sessiont ellenőriz.
2. Ellenőrzi, hogy a személy az aktuális meccs résztvevője és nem lépett ki.
3. Ellenőrzi, hogy a meccs indulásától számított 30 perces ablak még nyitott-e, majd kiadja a hátralévő időre szóló cookie-t vagy felhasználja a már érvényes azonosítót.
4. A nyers titkot nem adja vissza JSON-válaszban.

A frontend a meccsindulási snapshot után kéri a kiadást. Az aktív meccsbe érvényes sessionnel visszatérő új böngésző az első 30 perces ablakon belül kérhet az eredeti határidőig szóló cookie-t. Az ablak lejárta után a normál érvényes session és meccsrészvétel alapján még visszatérhet, de új visszatérési cookie-val nem indítunk újabb 30 percet. A már hitelesített, futó socket ettől függetlenül folytathatja a játékot.

Ha a session már a kiadás előtt lejárt, új azonosítót ezzel a végponttal nem adunk ki. A korábbi érvényes visszatérési cookie használható; ennek hiányában új bejelentkezés szükséges. A kliensnek a kiadási hibát és annak reconnectre gyakorolt hatását kezelnie kell.

Éles cookie-szabályok:

- HttpOnly, Secure, SameSite=Lax, hosthoz kötött, Domain attribútum nélkül.
- Path=/, hogy a cookie a /socket.io/ HTTP-handshake-re is eljusson. Kizárólag /api/ útvonalra korlátozott cookie ezt nem biztosítaná.
- Megfelelő __Host- előtag használható. Helyi HTTP-fejlesztéshez külön, kizárólag fejlesztői konfiguráció szükséges.
- A mutáló HTTP-végpont ellenőrzi az origin/kérésvédelmi követelményeket; a cookie megléte nem helyettesíti ezeket.
- A cookie neve még pontosítandó. Egy felhasználó párhuzamos játékfolyamatai nem engedélyezettek; több tab/eszköz ugyanahhoz a meccsrészvételhez kapcsolódhat.

Újrakapcsolódáskor nem szükséges tokenrotáció. Több tab egyidejű kiadási kérésénél nem szabad, hogy egy később érkező cookie-válasz már visszavont tokent állítson be; a kiadás idempotenciáját vagy az átmenetileg együtt érvényes kiadások kezelését külön ellenőrizni kell.

### 3.4. Kapcsolódás és parancsjogosultság

Socket.IO kapcsolódáskor a szerver megvizsgálja a normál sessiont és szükség esetén a meccshez kötött cookie-t.

| Helyzet | Eredmény |
|---|---|
| Érvényes session, még részt vevő játékos | Normál authból azonosítható; aktuális publikus állapot helyreállítható. |
| Lejárt session, érvényes visszatérési cookie | Csak a megjelölt aktív meccshez korlátozott kapcsolat. |
| Lejárt session, nincs megfelelő cookie | Új bejelentkezés szükséges; userId vagy szobakód nem helyettesíti. |
| Kilépett/visszavont/törölt résztvevő | A régi cookie nem engedi vissza. |
| Érvényes session másik felhasználóhoz tartozik | A korábbi felhasználó cookie-ja nem ruházza át a részvételt; nem keverjük össze a két azonosságot. |
| Backend újraindult | A régi memóriabeli engedélyek elvesztek, a meccs nem folytatható. |

A Socket.IO cookie-fogadás a közös originű HTTP-handshake/upgrade része. Az adapter feldolgozza a cookie-t; a motor sem tokent, sem cookie-headert nem lát.

Korlátozott meccskapcsolattal engedhető:

- aktuális meccs state:sync és time:sync;
- answer:submit, ha a kérdés nyitott;
- category:select, ha a résztvevő jogosult választó;
- saját explicit kilépés.

Nem engedhető: room:create/join, új solo:start, ready az új meccshez, beállításmódosítás, profil vagy előzmények. Ezek érvényes normál authot igényelnek.

A kilépés meccs- és tagsági változását a meglévő vezérlő koordinálja. A korlátozott engedély az aktív meccshez kötött kilépéshez felhasználható; általános szobakezelési jogosultságot nem ad.

Minden parancs végrehajtásakor ellenőrizni kell a résztvevő aktuális státuszát és a jogosultság visszavonását. Nem elég a socket első kapcsolódásakor végzett ellenőrzés.

### 3.5. Visszavonás

| Esemény | Meccsengedély | Részvétel |
|---|---|---|
| Normál authsession lejár | Megmarad az aktuális meccsre. | Megmarad, idle esetén is. |
| Hálózati szakadás | Megmarad. | Megmarad, normál idle szabály. |
| Explicit meccsből kilépés | Minden, résztvevőhöz kötött token visszavonva. | Explicit kilépett. |
| Explicit kijelentkezés | Meccsrésztvevő minden tokenje visszavonva. | Explicit kilépett. |
| Password reset | Felhasználó összes meccstokenje visszavonva, minden authsession is. | Érintett aktív meccsekből kilépés. |
| Fióktörlés | Felhasználó összes meccstokenje visszavonva. | Kilépés és a meglévő anonimizálási/törlési folyamat. |
| Meccs befejezése/megszakítása | Aktív játékengedély visszavonva. | Nincs új játékparancs. |
| Backend újraindítása | Nyilvántartás elveszik. | Korábbi aktív meccs megszakadt. |

A visszavonást a szerveroldali nyilvántartásban és a már kapcsolódó socketek jogosultságában is érvényesítjük. Nem elegendő egyetlen böngésző cookie-ját törölni: más eszközök cookie-ja távolról nem törölhető, de többé nem használható.

Az auth lejárata és explicit visszavonása külön esemény. Null getSession eredményből nem következtetünk automatikusan logoutkérésre.

### 3.6. Végeredmény és várószobai újraazonosítás

- Visszatéréskor először ellenőrizzük, létezik-e az aktív meccs. Ha igen, az aktuális résztvevő és token/session feltételei szerint folytatható.
- Ha a meccs megszűnt, de a hozzá tartozó várószoba megvan, a kliens oda irányítható. Belépéshez érvényes normál auth és a normál tagsági/csatlakozási ellenőrzések szükségesek; lejárt vagy visszavont meccstoken nem ad várószobai jogosultságot.
- Ha a normál session is lejárt, a várószobai visszatérés bejelentkezést kér; a még fennálló fenntartott tagságra a 60 másodperces szabály vonatkozik.
- Már megszűnt tagság esetén a visszacsatlakozás normál room:join: lehet megtelt szoba vagy időközben új aktív meccs. Létező szoba önmagában nem garantál helyet.
- Ha a szoba sem létezik, szobaválasztó/főoldal felé irányítunk érthető felületi jelzéssel. Ismert roomId vagy szobakód csak célhivatkozás, nem hitelesítés.
- A befejezés előtt már jogosult, kapcsolódó kliens megkapja a végső snapshotot és a kiértékelési időszak mentési visszajelzéseit. Ez nem jogosultság új játék indítására.
- A meccsvégi visszavonás után lejárt sessionnel a régi meccscookie nem jogosít új reconnectre; ahhoz normál bejelentkezés szükséges. Ez követi a korábban elfogadott meccsvégi visszavonást.
- A várószobába visszatéréskor új normál sessionellenőrzés történik.
- Ha nincs érvényes auth, a hely 60 másodpercig megmarad ready = false értékkel és bejelentkezési jelzéssel.
- Sikeres újraazonosításnak ugyanazt a user.id-t kell igazolnia; másik fiók nem veheti át a fenntartott helyet.
- Ha azonosítás nincs a határidőig, tagság megszüntetése és szükség esetén tulajdonosváltás/szobatörlés történik.
- Az újraazonosítási és offline 60 másodperces határidő párhuzamosan fut; a korábban lejáró távolítja el a játékost. Reconnect csak a kapcsolathiányt oldja fel, az authhatáridőt nem hosszabbítja; sikeres újraazonosítás csak az authhiányt szünteti meg.

### 3.7. Vendégmód

A vendég hiteles azonosságát a saját vendégsession adja, nem Better Auth userrekord. A védett cookie és memóriabeli nyilvántartás technikai megoldása megosztható a meccsvisszatérés infrastruktúrájával, de a vendég nem kaphat felhasználói jogosultságot.

- A vendégscope csak az aktuális szólómeccs és annak kiértékelése.
- A vendégsession élettartama 15 perc, aktív használat mellett 5 percenkénti HTTP-ellenőrzéssel újabb 15 percre megújítható. Lejárata a kiadástól vagy legutóbbi sikeres megújítástól számított 15 perc, így a hosszabb meccshez nem tartozik automatikus 15 perces megszakítás.
- Megújítás csak még érvényes vendégsession alapján történhet. Új vendégazonosító nem veheti át egy lejárt session korábbi meccsét; reconnectnél a hiteles visszatérési bizonyíték és a még fennálló részvétel ellenőrzése szükséges.
- A megújítás nem hosszabbítja meg a külön meccsvisszatérési cookie fix, meccsinduláshoz kötött 30 perces ablakát, és nem akadályozza meg az explicit kilépés vagy a kiértékelés vége miatti visszavonást.
- Eltérően a bejelentkezett játékos aktív meccstokenjétől, a vendégscope a 15 másodperces végeredmény-időszak végéig engedheti a saját eredmény visszaállítását.
- A képernyő végén a vendégjogosultság megszűnik, cookie törölhető; régi token új meccsre nem használható.
- Explicit kilépés és backend-újraindítás megszünteti a korábbi vendégmeccshez való visszatérést.
- Utólagos login nem kapcsolja a vendégeredményt a felhasználóhoz.

### 3.8. Még pontosítandó technikai határok

- A meccsvisszatérési cookie lejárata elfogadott: meccsindulás + 1800 másodperc, játék közbeni hosszabbítás nélkül. A vendégsession 15 perces élettartama és 5 percenkénti HTTP-ellenőrzése külön elfogadott szabály; az aktív használat technikai felismerése és a háttérben felfüggesztett lapok kezelése még pontosítandó.
- A jelenlegi szabályokkal 10 forduló, 60 másodperces válaszidő és teljes időkeretek mellett a meccs hozzávetőleg 65 perc lehet. Ez tervezési becslés, nem a folyamat működésének abszolút időgaranciája.
- Az elfogadott szabály szerint a már játékban lévő résztvevő nem eshet ki pusztán authlejárat miatt, idle állapotban sem. A 30 perces cookie lejárata új reconnecthez kérhet ismételt hitelesítést, de nem lehet önmagában explicit kilépés.
- Tokenkiadás és visszavonás sorrendje több tab, logout és password reset egyidejű kéréseinél.
- A meccscookie neve/scope-ja és a több tab/eszköz együttműködése az egy-felhasználó/egy-játékfolyamat szabály mellett.
- Socketjogosultság és visszavonási nyilvántartás adatstruktúrája, méretkorlátja, eltávolítása.
- Origin- és kérésvédelmi konfiguráció, helyi HTTPS/HTTP-fejlesztés.
- A HTTP és Socket.IO authadapterek pontos válaszai a jogosultsághiány/újraazonosítás állapotára.

### 3.9. Tervezett ellenőrzések

- A cookie JavaScriptből nem olvasható, HTTP-handshake során viszont eljut a szerverre.
- Token csak a megfelelő meccshez és résztvevőhöz enged hozzáférést.
- Lejárt normál session mellett a megkezdett meccs folytatható, új játék nem.
- Két eszköz tokenje közös válaszállapothoz jut; egyszeri pontozás.
- Logout/reset/törlés után már nyitott socket és másik eszköz sem használhat régi engedélyt.
- Válasz és visszavonási esemény sorba állításakor a végrehajtási sorrend egyértelmű, kilépés után nincs új elfogadás.
- Érvényes másik authfelhasználó nem veheti át a régi cookie résztvevőjét.
- Cookie nélküli új eszköz lejárt authból nem tud korábbi résztvevőnek látszani.
- Meccsvég és újraindítás után a token nem indít új játékot és nem állít helyre meccset.
- A cookie és a szerveroldali visszatérési érvényesség a meccs indulásától számítva legfeljebb 30 perc; tokenlejárat önmagában nem lépteti ki az élő kapcsolat résztvevőjét.
- Késői/ismételt cookie-kiadás, reconnect és authsession-megújítás nem hosszabbítja meg a meccs indulásához kötött határidőt. Új meccshez új, elkülönített ablak tartozik.
- Megszűnt meccs után létező várószobába irányítás csak érvényes normál auth és szabályos tagság/csatlakozás mellett történik.
- Megszűnt szoba, megtelt várószoba vagy időközben újra elindult játék külön kezelhető; a régi cookie nem kerülheti meg ezeket.
- Vendégscope csak a kiértékelési idő végéig használható; tartós előzmény nem keletkezik.
- 60 másodperces helyfenntartást reconnect nem hosszabbíthat végtelenül.

### 3.10. Elfogadott sessionmegújítás HTTP-n

Mindkét sessiontípusnál a frontend aktív használat mellett 5 percenként indít azonos originű HTTP-ellenőrzést. A nyitott socket nem helyettesíti a cookie frissítéséhez szükséges HTTP-választ.

| Session | Ellenőrzés | Sikeres megújítás utáni lejárat |
|---|---|---|
| Bejelentkezett felhasználó | Better Auth sessionvégpont; szokásos működésben GET /api/auth/get-session. | Most + 30 perc. |
| Vendég | Saját HTTP-végpont a védett vendégcookie és memóriabeli nyilvántartás ellenőrzésével. | Most + 15 perc. |

Folyamat:

1. A böngésző a kéréshez automatikusan elküldi a HttpOnly cookie-t; a frontend nem olvassa ki vagy továbbítja socketpayloadban a titkos azonosítót.
2. Better Auth az adatbázisban, a vendégadapter a szerveroldali vendégnyilvántartásban ellenőrzi az érvényességet és a visszavonást.
3. Esedékes megújításkor a szerver frissíti a lejáratot, és a HTTP-válasz Set-Cookie fejlécével hosszabbítja meg a cookie élettartamát.
4. A böngésző eltárolja a cookie-t; a meglévő socketkapcsolat folytatódik, emiatt nem kell újracsatlakoztatni.

Better Auth expiresIn = 1800 másodperc és updateAge = 300 másodperc az elfogadott célkonfiguráció. Az updateAge az esedékes szerveroldali megújítást szabályozza, nem indít időzítőt. A konkrét kiválasztott Better Auth-verzió végpontjának és HTTP-frissítési módjának ellenőrzése még implementáció-előkészítési feladat. A vendégvégpont konkrét útvonala és metódusa még nincs véglegesítve.

Több lap ugyanabban a böngészőprofilban közösen használja a cookie-t. Az MVP-ben minden aktív lap kezdeményezhet ellenőrzést; az összehangolt, egy lapból történő megújítás későbbi optimalizálás lehet. Az esedékesség-ellenőrzés csökkenti a felesleges lejáratfrissítéseket, de a párhuzamos kérések kezelése ettől még szükséges. Külön eszközök külön authsessionjeit külön kell megújítani.

A játék személyre szabott állapotát a szerver a hitelesített felhasználóhoz tartozó összes érintett socketre küldi; ez szinkronizálja a közös válaszállapotot, de nem hosszabbítja meg a másik eszköz cookie-ját. A userId szerveroldali azonosításból származik.

Hálózati hiba nem bizonyít kijelentkezést vagy sessionlejáratot. Már lejárt vagy visszavont sessiont a megújítás nem éleszt fel. A folyamatban lévő meccset puszta lejárat miatt nem szakítjuk meg; reconnectnél továbbra is hiteles visszatérési bizonyíték szükséges. A megújítás soha nem tolja ki a külön meccsvisszatérési cookie fix 30 perces határidejét.

## 4. Elfogadott technikai döntések és nyitott részletek

1. Szolgáltatófüggetlen emailport, külön küldési sorral; az MVP-ben Resend HTTPS-adapter, natív Node `fetch` használatával. Másik provider adaptere az authfolyamat és játékmotor módosítása nélkül kapcsolható ugyanide.
2. MVP-ben memóriabeli emailküldési sor: 5 másodperces timeout, legfeljebb három próbálkozás, 2/8 másodperces szünetekkel, providerutasítás és linklejárat figyelembevételével.
3. Véletlen, HttpOnly cookie-s meccsvisszatérési azonosító, szerveroldali hashnyilvántartással; JWT helyett, HTTP-n kiadva, Socket.IO-n ellenőrizve.

A fenti döntések és a Resend provider elfogadottak. A visszatérési cookie a meccs kezdetétől számított fix 30 percig érvényes, nem gördülően megújítható. A korábbi terv megvalósítását az M3/M4 dokumentációja rögzíti; a tényleges Resend-fiók/domain beállítása és kézbesítés ellenőrzése még külön feladat.
