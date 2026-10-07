# PostgreSQL Dockerben: első használat, séma és migráció

Az alkalmazás **PostgreSQL** adatbázist használ. A PostgREST egy külön, adatbázis elé tehető HTTP-szolgáltatás; erre itt nincs szükség, az Express backend Drizzle-en keresztül éri el a PostgreSQL-t.

## Első indítás

Telepített, futó Docker Engine / Docker Desktop és Docker Compose v2, valamint a repóban rögzített Node 24.19.0 és npm 11.9.0 szükséges. A parancsokat a repository gyökérmappájában futtasd; ezek Windows PowerShellben és Linux/macOS terminálban is használhatók.

```sh
npm ci
npm run env:init
npm run db:up
npm run db:migrate
npm run dev
```

Az `env:init` létrehozza a helyi `.env` fájlt véletlen adatbázisjelszóval és authsecrettel. Meglévő konfiguráció esetén csak a hiányzó, üres authsecretet pótolja; a meglévő adatbázisjelszót és SMTP-adatokat megőrzi. A `.env` nem kerül Gitbe. A `db:up` elindítja a PostgreSQL 17 konténert és megvárja, amíg fogad kapcsolatokat. A `db:migrate` létrehozza a verziózott migrációkból a táblákat. A `dev` indítja az alkalmazást.

**Egy frissen lehúzott repónál nem kell újragenerálni a sémát vagy a migrációkat.** A verziózott fájlokat alkalmazd a `db:migrate` paranccsal.

Fejlesztéskor a backend 3000-es, a frontend 5173-as portot használ. A böngésző az 5173-as originről éri el az API-t és a socketet a Vite proxyn át. A PostgreSQL a helyi 5432-es porton érhető el, nem publikus hálózati interfészen.

## Mi hol található?

| Elem                                      | Szerepe                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `compose.yaml`                            | A PostgreSQL konténer, port, healthcheck és adatvolume konfigurációja.   |
| `.env`                                    | Helyi konfiguráció, adatbázis- és SMTP-hozzáférések.                     |
| `apps/server/src/database/auth-schema.ts` | A Better Auth CLI által generált Drizzle-táblák.                         |
| `apps/server/src/database/schema.ts`      | Saját profil-, meccs-, résztvevő- és eredménytáblák.                     |
| `apps/server/migrations/*.sql`            | Verziózott, alkalmazandó adatbázismódosítások.                           |
| `apps/server/migrations/meta/`            | A Drizzle séma-pillanatképei és migrációs naplója; ezek is verziózottak. |
| `drizzle.__drizzle_migrations`            | A már alkalmazott migrációk nyilvántartása az adatbázisban.              |

A konténer a PostgreSQL programot futtatja. Az adatok a Docker **named volume**-jában élnek, ezért a konténer leállítása vagy szokásos újralétrehozása nem törli őket. A `.env` jelszó átírása már inicializált volume esetén nem változtatja meg az adatbázisban tárolt felhasználói jelszót. Portváltoztatáskor a `POSTGRES_PORT` és a `DATABASE_URL` portját együtt kell módosítani.

## Táblák és azonosítók

Better Auth táblák: `user`, `session`, `account`, `verification`. A `user.id` UUID; ugyanezt az értéket használja a profil `user_id` mezője. Az email a `user` táblában marad, a módosítható nickname és az 1000-es ELO a `user_profile` táblában van.

A `game` tárolja a beállításokat és a meccs állapotát. A `game_participant` tartalmazza a résztvevő pontját/helyezését; a `user_game` kapcsolja a regisztrált felhasználót a saját résztvevőjéhez és biztosítja az előzmény jogosultságát. A `game_question_result` csak rövid kérdésenkénti összesítést tartalmaz, kérdésszöveget, opciót vagy beküldött opcióazonosítót nem. A vendégmeccsek nem kerülnek ezekbe a táblákba.

## Beletekintés az adatbázisba

```sh
docker compose ps
npm run db:console
```

A konzol a konténerben futó `psql` programot indítja. Például:

```sql
\dt
\d game
\d user_game
SELECT code FROM game_status;
SELECT status_code, count(*) FROM game GROUP BY status_code;
SELECT count(*) FROM user_profile;
SELECT * FROM drizzle.__drizzle_migrations ORDER BY id;
\q
```

Az első parancs listázza a táblákat, a `\d` megmutatja az oszlopokat, kulcsokat és korlátokat. A `\q` kilép. SQL-parancs után pontosvessző kell, a `\` kezdetű psql-parancsok után nem. Normál fejlesztéskor a profilokat és eredményeket az API módosítja; authsessiont vagy jelszóhash-t ne szerkessz kézzel.

## Séma generálása és migrálása: három külön lépés

1. **Better Auth séma generálása:** `npm run auth:generate`. A közös authopciókból újragenerálja az auth Drizzle TypeScript-fájlt. Adatbázist nem módosít. Authbeállítás vagy későbbi plugin által igényelt séma változásakor használd; a generált fájlt ezután formázd és ellenőrizd.
2. **SQL-migráció készítése:** `npm run db:generate`. Összehasonlítja a Drizzle TypeScript-sémát a korábbi pillanatképpel és új SQL-fájlt készít. Ez sem módosítja az adatbázist. Nézd át a generált SQL-t, különösen az átnevezéseket és esetleges adatvesztést okozó műveleteket.
3. **Migráció alkalmazása:** `npm run db:migrate`. Lefuttatja a még nem alkalmazott, verziózott SQL-fájlokat a `.env` / környezeti `DATABASE_URL` adatbázisán. Másodszori futtatáskor a már alkalmazottakat kihagyja.

Ha saját táblán változtatsz, először a `schema.ts` fájlt módosítsd, majd generálj, ellenőrizz és alkalmazz migrációt. Authváltozásnál előbb az authséma generálása következik. A sémafájl, új SQL és `meta` fájlok együtt kerüljenek commitba. A már alkalmazott migrációt ne írd át; további változásnak új migráció kell.

A `0001_lifecycle.sql` kézi SQL-migráció: állapotkódokat tölt fel és profil-létrehozási/fióktörlési triggereket készít. A Drizzle generátora ezeket a függvényeket nem kezeli; változtatásukhoz új kézi migráció szükséges. Üres fájlt a backend mappájában így készíthetsz:

```sh
cd apps/server
npx drizzle-kit generate --config drizzle.config.ts --custom --name descriptive_change
```

Ezután vissza kell lépni a repó gyökerébe a közös `npm run ...` parancsokhoz. A CLI által kért átnevezési döntést ténylegesen nézd át. Éles környezetben a már ellenőrzött migrációkat alkalmazzuk az alkalmazás indítása előtt, nem generálunk új sémát. Az MVP nem használ közvetlen `db:push` sémafelülírást.

## Leállítás, újraindítás és mentés

Az alkalmazást a futó terminálban `Ctrl+C`-vel állíthatod le. Az adatbázis:

```sh
npm run db:stop
npm run db:up
```

Mindkettő megtartja az adatokat. A volume törlését jelentő `docker compose down -v` adatvesztést okoz; a szokásos fejlesztési folyamatban nincs rá szükség.

Migráció vagy adatot érintő kísérlet előtt készíthetsz mentést:

```sh
npm run db:backup
```

Ez PostgreSQL custom-format `.dump` mentést ír a Gitből kizárt `backups/` mappába. Authadatokat is tartalmaz, ezért tartsd privát helyen. A mentés teljes adatbázist fed le; visszaállítását külön céladatbázisra, ellenőrzött `pg_restore` folyamattal érdemes végezni. A mentés elkészítése ellenőrzött; ez nem állítja automatikusan vissza vagy írja felül az aktuális adatbázist.

## Email és konfiguráció

Az auth és a mentés működéséhez a helyi adatbázis és authsecret szükséges. A valódi megerősítő/reset emailhez további `.env` értékek kellenek:

| Változó           | SMTP2GO beállítás                                                                    |
| ----------------- | ------------------------------------------------------------------------------------ |
| `SMTP_HOST`       | Alapértelmezés: `mail.smtp2go.com`.                                                  |
| `SMTP_PORT`       | Alapértelmezés: `587`, kötelező STARTTLS; `465` esetén közvetlen TLS.                |
| `SMTP_USER`       | A szolgáltatóban létrehozott SMTP-felhasználó.                                       |
| `SMTP_PASSWORD`   | Az SMTP-felhasználó jelszava.                                                        |
| `SMTP_FROM`       | SMTP2GO-ban ellenőrzött feladó / domain alapján megengedett cím.                     |
| `BETTER_AUTH_URL` | A böngészőből elérhető alkalmazás originje; helyben például `http://localhost:5173`. |

Az SMTP-hozzáférések nem az alkalmazásba belépő játékos adatai. Másik SMTP-szolgáltatóhoz a konfigurációt és a feladó ellenőrzését kell átállítani. SMTP-adatok nélkül a szerver `SMTP_NOT_CONFIGURED` jelzéssel elindul, de valódi emailt nem kézbesít. A regisztrációhoz megkövetelt megerősítést ez nem kerüli meg. A tesztek külön emailadapterrel, elkülönített adatbázisokban ellenőrzik a linkek működését.

Az M3 a backendfolyamatokat tartalmazza. A regisztrációs, reset-, profil- és játékoldalak, valamint a böngésző ötpercenkénti sessionellenőrzése az M4-ben készülnek el.

## Gyakori hibák

- **Docker nem érhető el:** indítsd el a Docker Desktopot/Engine-t, majd `npm run db:up`.
- **5432 foglalt:** állíts más portot a `POSTGRES_PORT` és `DATABASE_URL` értékben, majd indítsd újra a konténert.
- **Hiányzó tábla / adatbázis-inicializálási hiba:** ellenőrizd a céladatbázist, futtasd a `db:migrate` parancsot.
- **Jelszóhiba meglévő volume mellett:** az eredeti `.env` hozzáférését használd; az inicializálási környezeti változó átírása nem módosít régi adatbázisfelhasználót.
- **Teszt nem tud adatbázist létrehozni:** az integrációs tesztek saját `rapidfire_m3_test_...` adatbázist készítenek és törölnek, ehhez helyi/CI tesztszerepkörnek `CREATEDB` jogosultság kell. Éles adatbázis ellen ne futtasd ezt a tesztfolyamatot.
- **Migráció létrehozásakor nincs változás:** ez sikeres eredmény, a TypeScript-séma és a migrációs pillanatkép egyezik.

```sh
npm run format:check
npm run check
```

A teljes ellenőrzéshez futó PostgreSQL és Chromium kell. Az integrációs tesztek saját adatbázisaikat tisztítják, a fejlesztői adatbázist nem ürítik ki.
