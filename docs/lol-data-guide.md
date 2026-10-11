# LoL-hősadatok importálása és adminfelület

Az import kézzel indul, ugyanazon Node backendben, háttérfeladatként. Nincs
időzített vagy induláskori hálózati frissítés. Az oldal bezárása nem állítja le
az importot. Az adatok PostgreSQL-be kerülnek, változatlan, verziózott készletekben.

## 1. Adatbázis frissítése

A repository gyökerében:

```sh
npm ci
npm run db:up
npm run build:shared
npm run db:migrate
```

A `0003_lol_champion_data.sql` migráció hozzáadja az admin-, import-, készlet-
és LoL-táblákat; a meglévő auth- és meccsadatokat megőrzi. Az ismételt
`db:migrate` biztonságos. **Első telepítéskor nem kell `db:generate`**: az a
Drizzle-séma fejlesztői módosításakor készít új, ellenőrizendő SQL-migrációt.
A kezdő Docker/PostgreSQL lépések az [adatbázis-útmutatóban](database-guide.md) vannak.

## 2. Első admin kijelölése

1. Regisztrálj az alkalmazásban, erősítsd meg az emailcímedet, jelentkezz be.
2. Nyisd meg az adatbázist: `npm run db:console`.
3. Keresd meg a saját fiókod UUID-jét paraméterezett alkalmazáskérés helyett az
   üzemeltetési SQL-konzolban, a saját emailcímed behelyettesítésével:

```sql
SELECT id, email, email_verified FROM "user"
WHERE email = 'your-address@example.com';
```

4. A konzolból `\q`-val kilépve, a repository gyökerében futtasd:

```sh
npm run admin:access -- grant <user-uuid>
```

5. Frissítsd az oldalt. A navigációban megjelenik az **Admin** hivatkozás,
   az oldal útvonala `/admin/lol-data`.

Csak már létező, megerősített fiókhoz adható jog. Nem keletkezik alapértelmezett
admin, nyilvános szerepkörállító végpont vagy regisztrációs adminflag.
Jogvisszavonás: `npm run admin:access -- revoke <user-uuid>`. A következő API-kérés
már elutasítja a visszavont jogot. Fióktörléskor az adminjog is törlődik;
a korábbi importadatok és futások megmaradnak, a kezdeményező FK-ja NULL lesz.

## 3. Frissítés az adminoldalon

- **Update champion data**: egyszer feloldja a numerikusan legfrissebb Data
  Dragon-patch verzióját. Azonos aktív patch és normalizáló esetén
  **Already up to date** eredményt ad letöltés nélkül.
- **Re-import current version**: az aktív patch két adatfájlját újra letölti.
  Azonos tartalomnál a meglévő készletet használja; eltérő tartalom új készletet
  kap. A korábbi készlet sorait nem írja át.
- Az aktív verzió, nyelv, aktiválási idő, darabszámok és az utolsó húsz futás
  látszik. A skinek darabszáma az alapkinézet és chromák nélküli szám.
- Aktív importnál a gombok tiltottak. Több eszközről történő indítás ugyanannak
  a folyamatban lévő importnak az azonosítóját adja vissza.
- A látható oldal kétmásodpercenként kér állapotot, ha van aktív import.
  Háttérben nincs polling; visszatéréskor újra lekéri az állapotot.
- A szerver leállásakor a futás `aborted`; következő induláskor az elhagyott
  `queued`/`running` sorok szintén így záródnak. Új próbához új adminművelet kell.

Az import nincs a játékmotor parancssorába kötve. Sikertelen letöltés, validálás
vagy mentés esetén az előző aktív készlet megmarad. Nincs sérült hős csendes
kihagyása vagy hiányos adatból kitalált nulla.

## 4. Forrás és normalizálás

A szerver a `https://ddragon.leagueoflegends.com` rögzített hostról kér:

- `/api/versions.json`;
- `/cdn/<version>/data/en_US/champion.json`;
- `/cdn/<version>/data/en_US/championFull.json`.

A teljes aggregátum ugyanazt a normalizálót használja, mint az ellenőrzött
hősreferenciák. Összeveti a listával az azonosítókat, verziót, közös statokat és
szövegeket; minden hőshöz pontosan négy, rangszám szerint validált képesség kell.
A forrásfájlok és a teljes hősrekordok JSONB-ben megmaradnak. A hálózati
forrás nem adhat át redirectet vagy a böngészőből származó tetszőleges URL-t.
Kérésenként 15 másodperces timeout, 10 MiB méretkorlát, legfeljebb három
próbálkozás és 120 másodperces teljes futásidőkorlát van. Csak átmeneti
hálózati/429/5xx hibát próbál újra, azonos rögzített verzióval.

A skin/chroma kapcsolatot `parentSkin` jelenléte adja; a hivatkozás a skin
`num` mezőjére mutat. Az import saját UUID-ra oldja fel. A `chromas` boolean
külön forrásmetadata. Ha egy nem chroma rekord true-t állít, de nincs validált
gyereke, a számított chromaszám NULL, és a hős összesített chromaszáma is NULL.
A többi metrika megmarad. False flag melletti validált gyerekek számítanak.

A húsz stat PostgreSQL `numeric`; a normalizáló nem kerekít és nem tölt ki
hiányzó számot. A rangonkénti cooldownok normalizált JSONB-je decimális
szövegeket őriz; az eredeti numerikus tömb a nyers JSON-ban is megmarad.
A nem pozitív első rangú cooldown NULL kérdésmetrika. A `damage` minden
képességnél `{}`, a nyers effektadat külön megmarad.

A tartalomhash kanonikus JSON-ból készül: tárgykulcs-, hős- és skin-beolvasási
sorrendtől, UUID-któl és időpontoktól független. A raw mezők változása is új
hash-t ad. A normalizáló szerződésének későbbi változásakor új
`normalization_version` kell; a régi készletek nem módosíthatók az importálóval.
A tranzakciók hősönként tízes csoportokat mentenek; letöltés közben nincs
nyitott DB-tranzakció. A készlet, az aktív pointer és a sikeres futásállapot
végül egyetlen tranzakcióban áll át.

## 5. A feltöltött ZIP használata, hálózati letöltés nélkül

A Cloud-környezetben a Riot host elérését a proxy tiltja. A tesztek a teljes,
SHA-256-tal rögzített ZIP-et dolgozzák fel. A tényleges helyi importhoz az
üzemeltető ugyanazon az importfolyamaton betöltheti a kibontott két forrásfájlt.
Ez nem nyilvános upload API, és nem indít automatikusan frissítést.

Állítsd le a Node backendet az üzemeltetési fájlimport idejére, a PostgreSQL
maradjon futó állapotban. A repository gyökerében például:

```sh
mkdir -p .cache/lol-source
unzip docs/question-generation-input/16.20.1.zip -d .cache/lol-source
npm run lol:import-files -- <admin-user-uuid> "$PWD/.cache/lol-source/16.20.1"
npm run dev
```

A parancs adminfiókot ellenőriz, háttérfutást nyit, megvárja a befejezést és
kiírja a futás UUID-jét/státuszát. Hiba esetén nem nulla exitkódot ad. Ismételt
normál import ugyanazzal az aktív verzióval `unchanged`; az aktuális patch
kényszerített újraolvasásához utolsó argumentumként `reimport` adható.
A könyvtárnak `champion.json` és `championFull.json` fájlt kell tartalmaznia,
egyező verzióval. A fiók UUID-je nem titok; authsession vagy Resend-kulcs nem kell
az argumentumokba. A devparancsok az előzetesen felépített közös csomagokat használják.

## 6. API és következő fejlesztési lépés

`GET /api/admin/access` csak a frissen ellenőrzött `isAdmin` jelzést adja vissza.
Az adminadatok végpontjai:

- `GET /api/admin/lol-data`: aktív készlet és futáselőzmények;
- `POST /api/admin/lol-data/imports`, body: `{ "mode": "latest" }` vagy
  `{ "mode": "reimport" }`, válasz: `202` és az importfutás;
- `GET /api/admin/lol-data/imports/:runId`: egy futás állapota.

Mindhárom adatvégpont érvényes, megerősített normál sessiont és explicit
adminjogot kér. Vendég- vagy meccsvisszatérési cookie nem elég. A közös
originvédelem, payloadméret- és HTTP-korlátok itt is működnek. A hibák stabil
kódjaihoz angol szövegkatalógus tartozik, későbbi fordítások előkészítésével.

**Ez az adatréteg elkészült, a valódi kérdésgenerátor még nincs bekötve.**
Az aktív adatimport nem játszható generálási kiadás. A lobby jelenlegi
példakérdésproviderét nem címkézi át. A következő lépés az elfogadott
katalógus, determinisztikus generátor és változatlan kiadás publikálása, majd
seed-/verzióválasztás a lobbyban, a [kiadásterv](question-seed-version.md) szerint.

Az adminoldal a meglévő arculatot követi: Bebas Neue címsor, DM Sans szöveg,
`--canvas`/`--surface`/`--text`/`--brand-surface` változók az ash és ember
palettából. Egy hangsúlyos verzióblokkot követ a darabszámok rácsa és a
futások egyszerű listája; mobilon tördelődik, nincs széles görgetendő táblázat.
