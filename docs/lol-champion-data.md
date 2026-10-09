# League of Legends hősadatok — PostgreSQL-import terve

Tervezési dátum: 2026-10-09. Státusz: megvalósítás előtti terv.

Kapcsolódik a [backend kérdésprovideréhez](backend-controller.md), az
[adatbázis-útmutatóhoz](database-guide.md) és a [megvalósítási tervhez](implementation-plan.md).
Ez a dokumentum az adatimportot és az adminfrissítést tervezi át; nem migráció
és nem elkészült importáló. A kérdéssablonok és a seed/generátor részletes
szerződése a következő, külön tervezési feladat.

## 1. Elfogadott hatókör

- PostgreSQL + Drizzle, a meglévő Express backendben.
- Az MVP-ben kizárólag kézi, adminfelületről indítható frissítés. Nincs cron,
  automatikus időközönkénti ellenőrzés vagy induláskori hálózati adatfrissítés.
- A forrás a csatolt programban is használt Data Dragon.
- A chromáknál az MVP-ben elég a skinhez tartozó `has_chromas` boolean.
  Egyedi chromanevek, színek és szülőkapcsolatok későbbi bővítések.
- Az MVP adatnyelve `en_US`; a verziózott készletben külön locale mező készíti
  elő a későbbi nyelveket. A rendszerüzenetek továbbra is fordítható kódok.
- Egy meccs egyetlen, rögzített adatkészletből kapja az összes forduló kérdését.

## 2. A csatolt programból megtartott és módosított részek

Az `update.ts` folyamata továbbra is felismerhető: elérhető verzió keresése,
hőslista letöltése, hősönkénti részletes letöltés, átalakítás, mentés.

| Korábbi rész                    | Új szerep                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Firebase `onCall` belépési pont | Adminjogosultságot ellenőrző Express HTTP-végpont.                                  |
| `getLatestVersion`              | Data Dragon elérhető kiadásának keresése, futásidőben validált verzióválasszal.     |
| `getChampions`                  | Az adott kiadás teljes hőslistája, azonosítókkal és elvárt darabszámmal.            |
| `updateChampions`               | Határolt párhuzamosságú letöltés, validálás és PostgreSQL-re alkalmas normalizálás. |
| Firebase `.set()` hívások       | Új, elkülönített adatkészlet építése és rövid, atomi publikálási tranzakció.        |
| `UpdateError`                   | Stabil hibakód, importfutás-státusz és angol adminfelületi fordítás.                |

A régi kódban a patch és az utolsó frissítés időpontja a tartalomtáblák előtt
frissül. Egy későbbi mentési hiba emiatt késznek látszó, részleges állapotot
hagyhat. Az új tervben az aktív készlet az utolsó lépésig változatlan.

A Firebase-belépési pont bármely azonosított felhasználót átenged. Az új
HTTP-végpontnál érvényes bejelentkezés és külön adminjogosultság kell.

A `ChampionData` TypeScript-típus önmagában nem validálja a hálózati JSON-t.
Az adapter `unknown` bemenetet ellenőriz a már meglévő Zoddal; nincs típusra
kényszerítéssel vagy hiányzó mezők nullával pótlásával történő elfogadás.

## 3. Adatforrás és adatminőség

Az adapter a verziólista lekérése után konkrét verziót használ minden további
URL-ben. Nem oldja fel újra a legfrissebb kiadást minden egyes hősnél.
A Data Dragon kiadási verziója nem azonos automatikusan a játék minden
régiójának aktuális kliensverziójával; az admin ezt adatforrás-verzióként látja.

A csatolt adattípus szerint a `skins[].chromas` boolean. Ez nem egyedi
chroma-lista. A régi `parentSkin`-ág nem garantál chromarekordokat pusztán
attól, hogy az opcionális mező szerepel a saját TS-típusban. Az új import
közvetlenül a boolean értéket menti, és nem talál ki chromaneveket.

A `spells.damage` a régi átalakításban mindig üres objektum. Nem tekinthető
sem nulla sebzésnek, sem használható sebzésadatnak. A `cooldownBurn`, `costBurn`
és `rangeBurn` megjelenítési szövegként marad meg: a rangonként eltérő érték,
speciális költség vagy globális hatótáv nem alakítható általánosan egy számmá.
Az `effectBurn` és az esetleges további effekt-/változóadat a nyers forrásban
megmarad; jelentése későbbi, képességenként ellenőrzött feldolgozás tárgya.

A hősstatisztikák alapértékek és szintenkénti növekedések. Egy későbbi kérdés
ne kezelje automatikusan az alapadatot felszereléssel módosított vagy adott
szintű játékbeli értéknek. A magasabb szintű statok és a képességsebzés
számítási szabályai nincsenek ebben a tervben véglegesítve.

## 4. PostgreSQL-táblák

A saját rekordazonosítók UUID-k. A Riot külső azonosítói külön mezők, és nem
helyettesítik az alkalmazás UUID-it. Minden hősrekord egy konkrét készlethez
tartozik; másik patch hősrekordjai külön sorok. A közös készlet és aktív
katalógus a már létező `topicId`-hoz kapcsolódik, a LoL-specifikus tartalomtáblák
külön maradnak. Így egy további játék nem igényel új meccs–adatkészlet kapcsolatot.

| Tábla                | Fő mezők és kapcsolat                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `question_dataset`   | UUID `id`, `topic_id`, `source` (MVP: `ddragon`), Data Dragon `source_version`, `locale`, `normalization_version`, `content_hash`, `status` (`staging`, `ready`, `failed`), `created_at`, `completed_at`, elvárt és importált hősök száma.                 |
| `question_catalog`   | UUID `id`, `topic_id`, `locale`, `active_dataset_id` FK és `updated_at`. Témánként/locale-onként egyetlen aktív, kész készletre mutat.                                                                                                                     |
| `lol_import_run`     | UUID `id`, `requested_by_user_id` FK, `locale`, megcélzott verzió, `dataset_id` FK, `status` (`queued`, `running`, `unchanged`, `succeeded`, `failed`, `aborted`), `stage`, feldolgozott/összes hős, időpontok, `error_code`, strukturált hibaparaméterek. |
| `lol_source_payload` | UUID `id`, `dataset_id` FK, erőforráskulcs, verzióhoz kötött forrásútvonal, SHA-256, teljes eredeti JSON `jsonb` formában. A hőslista és a részletes hősök is megmaradnak.                                                                                 |
| `lol_champion`       | UUID `id`, `dataset_id` FK, Riot `riot_key` egész, Data Dragon `source_id` szöveg (pl. `Ahri`), `name`, `title`, ikonfájlnév.                                                                                                                              |
| `lol_skin`           | UUID `id`, `champion_id` FK, Riot `source_skin_id`, `skin_num` egész, `name`, `has_chromas` boolean, `is_base` boolean.                                                                                                                                    |
| `lol_champion_stats` | UUID `champion_id` PK/FK, a 20 alap- és növekedési stat külön `numeric` oszlopokban. Egy hőshöz egy stats sor.                                                                                                                                             |
| `lol_spell`          | UUID `id`, `champion_id` FK, Data Dragon `source_spell_id`, `slot` (`Q`, `W`, `E`, `R`), `name`, ikonfájlnév, `cooldown_display`, `cost_display`, `range_display`, a rendelkezésre álló effektadat `jsonb`.                                                |
| `lol_passive`        | UUID `champion_id` PK/FK, `name`, ikonfájlnév. Egy hőshöz egy passzív sor.                                                                                                                                                                                 |
| `lol_champion_tag`   | UUID `id`, `champion_id` FK, `tag` szöveg. A forrás szerepkörei, nem automatikusan kikövetkeztetett lane/pozíció.                                                                                                                                          |
| `app_admin`          | UUID `user_id` PK/FK a Better Auth `user.id` mezőjére, `granted_at`. A kliens és a profilfrissítés nem írhatja.                                                                                                                                            |

Az importnaplóban a kezdeményező felhasználó törlésekor a kapcsolat `SET NULL`,
az adminjogosultság viszont a userrel együtt törlődik. A LoL-tartalom nem a
kezdeményező felhasználó tulajdona, ezért a fióktörlés nem törli az adatkészletet.

### Mezők a korábbi denormalizált modellből

| Korábbi gyűjtemény | PostgreSQL-megfelelő                                                           |
| ------------------ | ------------------------------------------------------------------------------ |
| `champions`        | `lol_champion`, a külső kulcsok és szövegek megőrzésével.                      |
| `skins`            | `lol_skin`; a név mellett a korábban eldobott forrásazonosító is megmarad.     |
| `chromas`          | MVP-ben `lol_skin.has_chromas`; nincs mesterségesen feltöltött chromatábla.    |
| `stats`            | `lol_champion_stats`, tizedes értékeket megőrző oszlopokkal.                   |
| `spells`           | `lol_spell`, a négy slot megkülönböztetésével.                                 |
| `passive`          | `lol_passive`.                                                                 |
| `tags`             | `lol_champion_tag`; a jelenlétet egy sor jelenti, nem felesleges `true` érték. |
| `title`            | Egyszer tárolva a `lol_champion.title` mezőben.                                |

A 20 stat: `hp`, `hp_per_level`, `mp`, `mp_per_level`, `move_speed`, `armor`,
`armor_per_level`, `magic_resist`, `magic_resist_per_level`, `attack_range`,
`hp_regen`, `hp_regen_per_level`, `mp_regen`, `mp_regen_per_level`, `crit`,
`crit_per_level`, `attack_damage`, `attack_damage_per_level`,
`attack_speed_per_level`, `attack_speed`. A forrás `spellblock` mezője a
`magic_resist`, `spellblockperlevel` a `magic_resist_per_level` oszlopba kerül.
Hiányzó szám nem lesz 0. A numerikus tartományokat és mértékegységeket a
forrásadapter és a későbbi kérdéssablon külön ellenőrzi.

A megjelenítési szöveg, név és numerikus tény normalizált oszlopba kerül;
a változó szerkezetű forrás-/effektadat JSONB-ben marad. A kérdésgenerátor
a validált oszlopokból dolgozik, nem a tetszőleges nyers JSON-mezőkből.
Az üres régi `damage` objektumból nem lesz sebzésoszlop vagy kérdésalap.

A `skin_num = 0` alapmegjelenés külön jelzést kap. Ha a forrás neve `default`,
a későbbi megjelenítés a hős nevét használhatja; az eredeti név is megmarad.
A képességslotot a forrás ellenőrzött sorrendje adja, nem a névből találgatjuk.
Ez a forrás alap slotjait jelenti, nem minden átalakuló hős minden formájának
teljes és bizonyítottan kimerítő képességkészletét.

### Kulcsok és indexek

- `lol_champion`: egyedi `(dataset_id, riot_key)` és `(dataset_id, source_id)`.
  Ezek egyszerre védenek duplikáció ellen és támogatják a készletenkénti olvasást.
- `lol_skin`: egyedi `(champion_id, source_skin_id)` és `(champion_id, skin_num)`.
- `lol_spell`: egyedi `(champion_id, slot)`; a forrás spell ID-ja külön megmarad.
- `lol_champion_tag`: egyedi `(champion_id, tag)`, valamint `(tag, champion_id)`
  index a szerepkörből induló kereséshez.
- Stats/passive: a `champion_id` PK egyúttal FK és gyorsítja az 1:1 joinokat.
- Nyers payload: egyedi `(dataset_id, resource_key)`.
- Készlet: egyedi `(topic_id, source, source_version, locale, normalization_version, content_hash)`
  a véglegesített tartalomhoz; a staging sor hash-e eleinte NULL lehet.
- Import: locale-onként részleges unique index az aktív (`queued`, `running`)
  futásokra; továbbá a friss futások megjelenítéséhez időpontindex.
- Catalog: egyedi `(topic_id, locale)`. Összetett FK biztosítja, hogy a pointer és a
  célkészlet témája és locale-ja is egyezzen; a `ready` állapotot a publikáló tranzakció ellenőrzi.

Minden gyereksor közvetlen szülő-FK-ja megakadályozza a különböző készletek
hős-/skin-/képességrekordjainak keverését. Nem indexelünk előre minden statot
vagy teljes nyers JSON-t: további indexhez tényleges lekérdezés és mérés kell.

## 5. Kézi import és atomi aktiválás

1. Érvényes, megerősített Better Auth session és `app_admin` ellenőrzés.
   Meccsvisszatérési cookie vagy vendégsession nem ad adminjogosultságot.
2. Tartós importfutás létrehozása. Az HTTP-kérés `202 Accepted` választ és
   `runId`-t ad; a letöltés a háttérben halad, az oldalnak nem kell nyitva maradnia.
3. A legfrissebb elérhető Data Dragon-verzió egyszeri feloldása. Azonos aktív
   forrás-/normalizálóverziónál normál frissítés `unchanged` eredményt ad.
4. Új staging készlet és konkrét verziós hőslista letöltése/validálása.
5. Hősönkénti letöltés és normalizálás, javasolt induló limitként öt párhuzamos
   hálózati kérés. Sikeres csoportok rövid DB-tranzakciókban kerülnek stagingbe.
   Hálózati várakozás közben nincs nyitva hosszú adatbázis-tranzakció.
6. Teljességi ellenőrzés: minden listabeli hős pontosan egyszer jelen van,
   a numerikus kulcsok összetartoznak, minden kötelező mező és szülőkapcsolat
   érvényes. Az elvárt hősszám a letöltött listából jön, nincs beégetett darabszám.
7. Stabil külső kulcsok szerint rendezett tartalomból hash és összesítés készül.
   UUID, futásazonosító és letöltési idő nem kerül a tartalomhash-be.
8. Egy rövid tranzakció zárolja a catalog sorát, a staging készletet `ready`-re
   állítja, átváltja az aktív pointert és sikeresre zárja a futást. Duplikált
   tartalom esetén a meglévő készlet használható. Egyik lépés sem válhat külön
   sikeressé, ha a tranzakció másik része hibázik.

Az adminnak lehet külön **Re-import current version** művelete is a javított
normalizáló vagy ugyanazon patch újraellenőrzésére. Ez is új készletet épít,
nem írja át a régi, meccsekhez rögzített sorokat. Külön kézi visszaállító
felület nem része az első adminpanel-javaslatnak.

Timeout, korlátos válaszméret és teljes futásidőlimit kell. Átmeneti hálózati,
429-es és 5xx hibára korlátos retry/backoff használható; 429-nél a `Retry-After`
figyelembevételével. Sérült JSON, idegen azonosító vagy hiányos adat nem lesz
észrevétlenül kihagyott hős. Szükségtelenül nagy vagy sémát sértő válasz
megszakítja a futást. Minden retry ugyanazt a rögzített verziót használja.

Hiba esetén a futás `failed`, a készlet nem aktív; a korábbi aktív készletből
tovább lehet új meccset indítani. Első import hibája esetén a valódi LoL-
kérdésprovider nem válik késznek; nem címkézünk általános példakérdést friss
LoL-adatként. Az importhibát az admin látja, nem minden játékos kap rendszerhibát.

Az MVP egyetlen backendpéldányára egyszerre egy aktív LoL-import jut. Párhuzamos
kattintásnál a már futó job azonosítója kerül vissza. A DB unique védelem
megakadályozza a kettős indítást. Újraindításkor az előző folyamat függő jobjai
`aborted` állapotba kerülnek; a korábbi aktív pointer megmarad, új import
kizárólag új adminműveletből indul. Több workerhez később külön lease/heartbeat
terv szükséges. Az import nem a meccsvezérlők állapotmódosítási sorában fut.

## 6. Adminpanel és jogosultság

Javasolt oldal: `/admin/lol-data`, ugyanazon HTTP-originen, a meglévő React
alkalmazásban. Látható az aktív adatverzió, a locale, az aktiválás időpontja,
a hősök/skinrekordok száma, az importelőzmény és az aktuális feldolgozás állapota.

Javasolt HTTP-felület:

| Művelet                       | Tervezett végpont                        |
| ----------------------------- | ---------------------------------------- |
| Aktív adatok és futáselőzmény | `GET /api/admin/lol-data`                |
| Kézi frissítés indítása       | `POST /api/admin/lol-data/imports`       |
| Egy futás állapota            | `GET /api/admin/lol-data/imports/:runId` |

Az oldalon egy fő **Update champion data** gomb és egy elkülönített kézi
újraimport művelet szerepelhet. Aktív jobnál a gombok blokkoltak; reload után a
job tovább követhető. Az állapot háttérbe került oldalon nem pollingol, a látható
oldal rövid HTTP-pollinggal követi; új socketcsatorna nem szükséges.

Mindegyik adminvégpont friss szerveroldali session- és adminellenőrzést végez.
A gomb elrejtése önmagában nem jogosultságkezelés. Az első admin egy már
létező, ellenőrzött fiókhoz, szerveroldali üzemeltetési lépésből rendelhető;
sem regisztráció, sem nickname/profilfrissítés nem fogad el szerepkört.
Az általános adminfelhasználó-kezelő felület későbbi feladat.

POST-nál a meglévő originvédelem, strict payload és a HTTP-korlátok érvényesek.
A böngésző nem adhat tetszőleges letöltési URL-t. A forrás host/útvonal és a
locale szerveroldali adapterkonfiguráció; az adminban a patch érték és státusz
látszik, nem token, stack trace vagy külső szolgáltatói nyers hiba.

Javasolt stabil importhibakódok: `SOURCE_UNAVAILABLE`, `SOURCE_DATA_INVALID`,
`SOURCE_TIMEOUT`, `IMPORT_STORAGE_FAILED`, `IMPORT_ABORTED`. Az adminválasz
strukturált paramétereket és kódot ad, a felület az angol katalógusából fordít.

## 7. Kapcsolat a későbbi kérdésgenerálással

```mermaid
flowchart LR
  A[Adminindítás] --> B[Data Dragon letöltés]
  B --> C[Staging készlet és validálás]
  C --> D[Atomi aktívverzió-váltás]
  D --> E[Új meccs készletének rögzítése]
  E --> F[Kérdésprovider]
  F --> G[Natív játékmotor]
```

Az adatimport infrastruktúra-/alkalmazási feladat. A natív motor nem ismeri a
Riot-végpontot, adatbázist vagy nyers JSON-t; kész, validált kérdéseket kap.

A backend a meccs indulásának előkészítésekor rögzíti az aktuális `dataset_id`-t.
Indulási visszaszámlálás törlése után egy új indulás választhat frissebb készletet.
Tényleges indulás után minden forduló és előkészítési retry ugyanazt a készletet
használja. Frissítés közben sem az opciók, sem a helyes válaszok alapja nem vált át.

A tervezett adatkapcsolat a `game` táblában nullable `question_dataset_id` FK;
a korábbi mintameccsekben NULL marad, az új generált meccsekben kötelező.
A meccsmentési checkpoint a rögzített készletazonosítót is továbbadja. A pontos
provider-bővítést és generálási metadata mezőit a kérdésgenerálási szerződés
véglegesítésekor vezetjük be, nem helyettesítjük őket most kitalált seedformátummal.

Újrajátszhatósághoz a seed önmagában kevés: a készletazonosító, locale,
normalizáló- és generátorverzió, kérdéssablonok és a jelöltek stabil rendezése is
kell. A már publikált készlet nem változik meg. A meccsek által hivatkozott
készletek törlését `ON DELETE RESTRICT` akadályozza meg; az MVP nem törli
automatikusan a korábbi kész készleteket. Később a tárolási költség alapján
külön archiválási terv készülhet.

Az ikonoknál a fájlnév mellé a készlet forrásverziója is megmarad. A metaadat
megőrzése nem garantálja egy külső CDN képfájljának változatlanságát, különösen
nem a verzió nélküli splash-art URL-eknél. Képalapú kérdések reprodukálásához
később helyi vagy más tartós, hash szerinti assetmegőrzés is kellhet.

## 8. Megvalósítási sorrend és ellenőrzés

1. Drizzle-séma, migráció, fixture-adatok és normalizáló mezőtérkép.
2. Data Dragon-adapter: version/champion list/detail validálás, timeout/retry,
   korlátos párhuzamosság, raw payload és stabil hash.
3. Importfutás és staging/publikáló tárolóadapter, adminjogosultság és indító HTTP-végpont.
4. Adminpanel: aktuális készlet, indítás, progress, semleges hibakódok és előzmény.
5. Valódi forráspróba és a kérdésgenerátor külön specifikációja, majd datasethez
   rögzített provider-/meccsmentési integráció.

A Data Dragon esetén natív Node `fetch`, Zod-validálás, Drizzle és PostgreSQL
elegendő; Firebase-, Riot SDK-, queue- vagy cron-csomag nem indokolt.
A Zod jelenleg a contracts workspace függősége. Közvetlen backendimportnál a
server workspace-ben is deklarálni kell a repóban rögzített verziót, a repó
előzetes függőségengedélyezési szabálya szerint; a telepített tranzitív csomag
önmagában nem helyettesíti ezt a deklarációt.
Az adminfelület megvalósításakor a repó React- és designskilljei alkalmazandók.

Szükséges tesztek: hősszám teljessége, duplikált/idegen azonosító, decimal stat,
chroma true/false, passzív és Q/W/E/R mezőtérkép, forrásmező-változás, 429/5xx
és timeout, részleges import hibája, sikeres atomi váltás, párhuzamos adminindítás,
azonos verzió és kézi újraimport, restart utáni megszakított job, admin/nem admin/
vendég HTTP-jogosultság, több forduló alatt változatlan készlet, régi készletből
generálás és hivatkozott készlet törlésvédelme. A JSON fixture-ket valódi,
archivált forrásmintával kell ellenőrizni.

## 9. Forrásellenőrzés és fennmaradó korlátok

A hét csatolt TS-fájl át lett nézve; a fájlok referenciaként szolgáltak, a
Firebase-program nem lett futtatva. Élő Data Dragon-verziót vagy teljes
hősletöltést ebben a felhőkörnyezetben nem sikerült ellenőrizni: a Data Dragon,
a Riot fejlesztői dokumentáció és a CommunityDragon RAW elérését hálózati
403 tiltás blokkolta. Ebből nem következtetünk forrásoldali kiesésre.

A CommunityDragon nyilvános GitHub README-je és assetdokumentációja elérhető
volt: hős-/skin-JSON és chromaképek rendelkezésre állását dokumentálják, a
pontos útvonalak és mezők változhatnak. Ez a jövőbeli egyedi chromák lehetséges
forrása; az elfogadott MVP-ben nincs ilyen adapter és nincs rá futási függőség.

Implementáció előtt a hálózati hozzáféréssel rendelkező környezetben a Data
Dragon válaszok tényleges mezői, képességslot-sorrendje, stat-/chromaértékei és
verzióegyezése ellenőrizendők. Ez a terv nem állít sikeres importot, működő
adminpanelt vagy ellenőrzött újrajátszhatóságot.

Hivatkozások:

- [Data Dragon verziólista](https://ddragon.leagueoflegends.com/api/versions.json)
- [Riot Data Dragon dokumentáció](https://developer.riotgames.com/docs/lol#data-dragon)
- [CommunityDragon leírás](https://github.com/CommunityDragon/Docs/blob/master/README.md)
- [CommunityDragon assetútvonalak](https://github.com/CommunityDragon/Docs/blob/master/assets.md)
