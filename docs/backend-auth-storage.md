# M3 — Auth, PostgreSQL és email

Utolsó frissítés: 2026-10-08.

Az M3 a korábbi backendhez valódi Better Auth / Drizzle / PostgreSQL integrációt, saját HTTP-végpontokat, memóriabeli vendég- és meccsigazolásokat, valamint cserélhető emailadaptert ad. A motor továbbra is natív TypeScript, külső függőség nélkül. A játék- és authfelület elkészült az [M4-ben](frontend.md). Az első adatbázis-indításhoz lásd a [magyar útmutatót](database-guide.md).

## Modulok

| Mappa                      | Felelősség                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `auth/`                    | Better Auth opciók, hookok, session/socket híd, opaque cookie-nyilvántartás, korlátozók. |
| `database/`                | Generált authséma, saját táblák, migráció, mentési és profil/előzmény-adapter.           |
| `email/`                   | Verziózott angol templates, küldési port, sor, Resend HTTPS-adapter.                     |
| `transport/http.ts`        | HTTP-bemenetek, auth/jogosultság, saját végpontok és hibaválaszok.                       |
| `bootstrap/application.ts` | Összeállítás; szolgáltatók nem kerülnek a motorba vagy socketparancsokba.                |

A Better Auth 1.7.7-hez az új hivatalos `auth` 1.7.7 CLI tartozik. A régi `@better-auth/cli` verzióját nem használjuk. Drizzle Kit 0.31.11 fejlesztői eszköz; az éles migrációt a meglévő ORM migrátora futtatja, a CLI nem szükséges a futó szerverhez. Az auth CLI a backend fejlesztői függősége. A Kit azonos verzióval szerepel a backend és a gyökér fejlesztői függőségeiben is: az npm 11 workspace-célcsomagnál elvesző overrides továbbítása miatt a gyökérből is szükséges függőségi él. A CLI-t csak a backend sémagenerálása használja. Az `@esbuild-kit/core-utils` régi esbuildjét célzottan 0.28.2-re írjuk felül; friss lockfile-feloldás és `npm ci` után az audit 0 találatot ad. A korábban rögzített csomagverziók változatlanok.

## HTTP-folyamatok

Minden saját API-válasz `Cache-Control: no-store`. Módosító kérésnél az originnek az engedélyezett listához kell tartoznia; cross-site kérés elutasított. A backend felülírja a belső kliens-IP fejlécet a tényleges TCP-kapcsolat címével; küldött forwarded IP-t nem tekint megbízhatónak. Reverse proxy mögötti valódi IP-kezelés és deployment az M5 feladata.

| Végpont                                  | Szerződés                                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/sign-up/email`           | `name`, `email`, `password`, kötelező `passwordConfirm`, opcionális `callbackURL`. Megerősítő email.                                                                 |
| `POST /api/auth/sign-in/email`           | Email/jelszó; meg nem erősített emaillel nincs belépés.                                                                                                              |
| `GET /api/auth/get-session`              | Valódi DB-ellenőrzés és szükség esetén cookie-megújítás. `null` vagy publikus `user` profil + `session.id/expiresAt/renewAfterSeconds`; sessiontokent nem ad vissza. |
| `POST /api/auth/sign-out`                | **Minden eszköz összes authsessionjét** és meccsigazolását visszavonja; közös kilépés és `closed` snapshot.                                                          |
| `POST /api/auth/send-verification-email` | Email és opcionális `callbackURL`; semleges válasz, percenként legfeljebb egyszer adott címre.                                                                       |
| `POST /api/auth/request-password-reset`  | Email és opcionális `redirectTo`; létező és nem létező címre ugyanaz a válasz.                                                                                       |
| `POST /api/auth/reset-password`          | `token`, `newPassword`, kötelező `passwordConfirm`; egyszer használható reset és minden eszköz visszavonása.                                                         |
| `POST /api/auth/change-password`         | `currentPassword`, `newPassword`, `passwordConfirm`; siker után új belépés szükséges minden eszközön.                                                                |
| `POST /api/auth/delete-user`             | Érvényes normál session és aktuális `password`; saját, atomikus fióktörlés, majd cookie-törlés és minden eszköz kiléptetése.                                         |
| `POST /api/guest/session`                | `{nickname}`; új 15 perces vendégsession. Meglévő érvényes session/meccs mellett nem cserél identitást.                                                              |
| `POST /api/guest/session/renew`          | Érvényes vendégcookie; öt perc elteltével újabb 15 perc. Lejárt vendéget nem éleszt fel.                                                                             |
| `POST /api/guest/sign-out`               | Vendég session/meccsigazolás megszüntetése és kilépés.                                                                                                               |
| `POST /api/match-access`                 | Normál vagy vendégsession és tényleges élő részvétel alapján ad meccscookie-t; nincs kliensből választott user/match ID.                                             |
| `GET /api/profile`, `PATCH /api/profile` | Saját profil; csak a `nickname` módosítható.                                                                                                                         |
| `GET /api/games`                         | Saját eredmények, `limit` 1–50, lapozás az előző oldal utolsó `startedAt` + `id` értékéből `before` + `beforeId` paraméterrel.                                       |
| `GET /api/games/:id`                     | Csak saját `user_game` kapcsolattal olvasható. Közös anonim standings és a kérő saját rövid kérdésösszesítése.                                                       |

A saját törlési végpont a Better Auth megszokott HTTP-útját használja, de a natív `auth.api.deleteUser` letiltott. A Better Auth natív törlése külön adapterműveletekkel törölné a sessiont/accountot/usert; ezt nem tekintjük egy közös domaintranzakciónak. A saját út az adatbázis-tranzakcióban ellenőrzi az aktuális jelszót a Better Auth publikus verifierével, és egyben töröl. A cookie formátumát és törlését továbbra is Better Auth kezeli.

Email kisbetűsítve; nickname 1–40 karakter, nem egyedi és nincs tartalmi moderálás. A profiladat-ellenőrzésnél később name check illeszthető be. Jelszó 8–128 karakter, Unicode kisbetű, nagybetű, szám és nem whitespace speciális karakter. A megerősítés a szerveren is kötelező. Alap hash a Better Auth scryptje; saját jelszóhasher vagy auth-JWT nincs.

A HTTP-hibák stabil `code` értéket adnak. A kliens a contracts angol katalógusát / későbbi nyelvi katalógust használja, a Better Auth szöveges hibaüzenete nem UI-szerződés. Ismeretlen kódhoz a későbbi UI általános hibát mutathat. A reset/verify kérés semleges angol szövege külön publikus konstans.

## Session és meccsvisszatérés

- Normál session 30 perc, öt perc elteltével HTTP-ellenőrzéssel megújítható, abszolút napi korlát nélkül. A `cookieCache` kikapcsolt. Socket-ellenőrzés `disableRefresh: true`: nem hosszabbít DB-lejáratot olyan kapcsolatban, ahol új böngészőcookie nem adható.
- Megújítás csak az adott authsession kapcsolatait és az újraazonosított személy meccsigazolással belépett kapcsolatait frissíti. Más eszköz saját cookie-jának élettartamát nem módosítja.
- Puszta authlejárat nem szakítja meg a már futó meccset. A következő várószobában a vezérlő először auth-hold állapotot ad, majd külön aszinkron DB-ellenőrzés feloldhatja. Két hatvanmásodperces türelmi idő esetén a korábbi határidő érvényes, ready nem áll automatikusan vissza.
- Meccscookie 32 véletlen byte; memóriában csak SHA-256 hash. Határideje **startedAt + 30 perc**; későbbi kiadás csak a hátralévő időre érvényes. Több tab párhuzamos kiadása nem vonja vissza a másik tab még érvényes igazolását.
- Normál session elsőbbséget élvez. Másik bejelentkezett user nem örökölhet régi meccscookie-t. Meccsigazolás csak ugyanazon személy még létező részvételével ad olvasási/játékengedélyt, profilra, előzményre vagy új meccsre nem.
- Regisztrált személy visszatérési igazolása meccsvégkor megszűnik; meglévő socket megkapja az eredményt. Vendégnél az eredményképernyő végéig használható, utána a vendégsession is megszűnik.
- Logout/reset/törlés az összes meccsigazolást és authsessiont visszavonja. Lejárt normál vagy vendégsession, de még érvényes saját meccsigazolás mellett a logout is megszünteti a részvételt; a vendégvégpont regisztrált user igazolását nem fogadja el.
- Visszavonási epoch védi a folyamatot: kijelentkezéssel megelőzött, lassú sessionellenőrzés vagy socket admission nem állíthat vissza régi jogosultságot.
- Saját cookie-k: HttpOnly, SameSite=Lax, Path=/, domain nélkül; HTTPS esetén Secure és `__Host-` prefix. Helyi HTTP-hoz eltérő, prefix nélküli név.
- A hiányzó, hibás, lejárt vagy visszavont vendégsession megújítása `401 AUTH_REQUIRED` választ ad cookie-módosítás nélkül. Egy korábbi kérés későn érkező elutasítása így nem törli a közben létrehozott vendégcookie-t. Az explicit vendégkijelentkezés továbbra is törli a cookie-kat és visszavonja a szerveroldali jogosultságot.

A memóriabeli credential-/korlátozó nyilvántartás korlátos és lejáró. Újraindítás nem tartja meg a vendéget, szobát vagy meccsigazolást. A böngésző időzített ötperces ellenőrzése és háttérből visszatéréskor végzett ellenőrzése az [M4-ben](frontend.md) megvalósult.

## Mentés és törlés

Induláskor, kérdéslezáráskor és meccsvégkor teljes, változatlan checkpoint mentődik. Résztvevőnként pontösszegek kerülnek upsertbe, nem pontnövekmények. Meccsenként advisory tranzakciós zár kezeli az első beszúrás versenyét, növekvő bigint revision és végleges státusz védi az elavult mentés ellen. Végső mentés korábbi sikeres mentés nélkül is felépíti a meccset. A motor kérdésazonosítója sem kerül SQL-be.

Mentéskor a létező userek kulcszára a fióktörléssel koordinál. A törlési trigger egy tranzakcióban törli a szólómeccseket, anonimizálja a közös résztvevőket, törli a resetbizonyítékokat; FK cascade törli a profilt, authsessiont/accountot és user_game kapcsolatot. Késői mentés hiányzó usert nem állít vissza: szólómentést kihagy, közös résztvevőt név nélkül ment. A live/lezárt motorprojekcióból is törlődik a név; az angol „Deleted user” megjelenítés az identityState kódon alapul.

DB-kapcsolat, statement és query timeout öt másodperc, pool legfeljebb tíz kapcsolat. PostgreSQL 17-es `transaction_timeout` a teljes checkpointtranzakcióra is öt másodperces korlátot ad. Indulás előtti, megszakított countdown nem kerül mentésbe. Köztes hiba a játék szempontjából silent fail; végső mentés az M2 három próbálkozásos, két-két másodperces retry-ját és publikus mentési állapotát használja. Leállításkor legfeljebb 15 másodperces keretben ürítjük a mentéseket; ez nem korlátlan mentési garancia. Startup a megmaradt `in_progress` meccseket egyszer `interrupted/server_restart` állapotba teszi; checkpointból nincs élőmeccs-folytatás.

## Email

Az MVP emailprovidere a felhasználó 2026-10-08-i döntése alapján Resend. A szolgáltatófüggetlen `EmailPort` mögött natív Node `fetch` alapú HTTPS-adapter működik; konfigurációja `RESEND_API_KEY` és `EMAIL_FROM`, a végpont `https://api.resend.com/emails`. Külön emailtárhely nem szükséges, saját feladóhoz a domain DNS-ellenőrzése kell. A gyakorlati lépések a [Resend útmutatóban](email-guide.md) találhatók.

Öt másodperces hálózati/queue timeout, maximum száz memóriabeli feladat, egy aktív küldés, legfeljebb három próbálkozás, 2/8 másodperces szünetek. Átmeneti hálózati és HTTP szerverhiba ismételhető; hibás hozzáférés/feladó/paraméter végleges. Újrapróbálás ugyanazt a linket és tartalmat tartja meg, a stabil belső üzenetazonosítót Resend `Idempotency-Key` fejlécként használja. Nincs exactly-once postaládakézbesítési ígéret.

Megerősítő link 24 órás, reset 15 perces és egyszer használható. Ismételt reset/verify kérés emailenként és célonként legfeljebb percenként egyszer indulhat, nem létező címre is azonos szabállyal. Az általános IP- és authkorlátozás külön réteg. Fióktörléskor a várakozó email törlődik, az aktív küldés abortot kap; már a providernek átadott emailt ez nem tudja visszahívni. Lejárt linket nem küldünk újra. Token, jelszó, emailcím és link nem szerepel a munkanaplóban.

Szolgáltatói adatok nélkül tesztporttal ellenőrzött az authfolyamat. **Valódi Resend-kézbesítés és szolgáltatói/domainbeállítás továbbra is hozzáférést igényel, nem ellenőrzött.** A felhőkörnyezetben az `api.resend.com` HTTPS-elérése és a biztonságosan megadott backend API-kulcs szükséges. A környezet draftjának mentése önmagában nem igazolja az elérést vagy kézbesítést.

A korábbi SMTP2GO-adapter M3 ellenőrzési előzmény: a `mail.smtp2go.com:587` nem hitelesített kapcsolati próbája `EAI_AGAIN` DNS-hibával állt meg; SMTP/TLS-kapcsolat és kézbesítés akkor sem volt igazolt. Ez a korábbi szolgáltatóra vonatkozó eredmény, a Resend eléréséről nem ad bizonyítékot.

## Ellenőrzés

A tesztek saját, migrált PostgreSQL adatbázisokat hoznak létre; csak ezeket törlik. Ellenőrzik a migráció ismételhetőségét, FK/unique/CHECK korlátokat, rollbacket, idempotens és elavult mentést, konkurens fióktörlést, név-/szólóadat visszaállásának kizárását és restartmegszakítást. A HTTP/socket tesztek valódi Better Auth sessionöket, email JWT-linkeket, reset-tokeneket, scrypt ellenőrzést és PostgreSQL-t használnak; emailküldéshez tesztportot. Böngészős smoke teszt a HttpOnly vendégcookie tényleges HTTP- és socket-használatát ellenőrzi mindkét kiszolgálási módban.

Végrehajtott helyi ellenőrzések 2026-10-07-én:

- `bash scripts/setup-cloud.sh`: tiszta függőségtelepítés, meglévő konfiguráció megőrzése, PostgreSQL-healthcheck, ismételt migráció és teljes ellenőrzés sikeres.
- A végleges kódon `npm run format:check` és `npm run check`: minden workspace és generátorkonfiguráció típusellenőrzése, build, 15 fájlban 143 Vitest-teszt, 3 fejlesztői és 3 production böngészős teszt sikeres.
- `npm audit`: 0 sérülékenység; `npm ls --all` érvényes függőségi fát ad. A korábbi lockfile-ban meglévő csomagok verziója nem változott.
- `auth:generate` változatlan authsémát adott; `db:generate` nem talált új változást; `db:migrate` ismételhető. `env:init` ismétlése byte-ra azonos konfigurációt hagyott.
- `db:console` a táblákat listázta, `db:backup` privát mentést készített; a mentés custom-format jegyzéke olvasható. Visszaállítást nem hajtottunk végre.
- A PostgreSQL zárolási/időkorlát-teszt elutasított mentés után sikeres új próbálkozást igazol. Lejárt vendégsession mellett érvényes meccsigazolással a logout minden kapcsolatot lezár.

A 2026-10-08-i Resend-átállás ellenőrzése: teljes típusellenőrzés és build, formázásellenőrzés, 186 Vitest-teszt (ebből 35 Resend-adapter/konfiguráció), 9 fejlesztői és 9 production böngészős teszt sikeres; hibamentes függőségi fa és 0 audit-találat. Az éles provider-elérést a jelenlegi proxy blokkolta, API-kulcs és feladó sincs még beállítva. Részletek a [Resend útmutatóban](email-guide.md).

A vendégmegújítás cookie-törlési versenyhelyzetét késleltetett 401-es válasszal reprodukáltuk: a javítás előtt elveszett a közben kiadott HttpOnly cookie. A javítás után a regresszió és az eredeti socket/megújítás teszt is sikeres. A teljes `CI=1 npm run check` helyben sikeres: típusellenőrzés, build, 191 Vitest-teszt, 10 fejlesztői és 10 production böngészős teszt. A formázásellenőrzés is sikeres. Az új HTTP-regressziók az érvénytelen sessionök elutasítását és az explicit kijelentkezés tényleges visszavonását is igazolják.

GitHub CI-futás, valódi szolgáltatói kézbesítés és új cloud taskban történő visszaállítás nem része a végrehajtott ellenőrzésnek.
