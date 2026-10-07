# Fejlesztési szabályok — React / TypeScript / Express

Kövesd ezeket a szabályokat minden kódírásnál, módosításnál és
kódellenőrzésnél. A felhasználó kifejezett utasításait és a projekt
specifikus követelményeit vedd figyelembe.

## Projektismeret és skillek

- Munka előtt olvasd el az alkalmazandó AGENTS.md fájlokat,
  a package.json-t és a releváns konfigurációkat.
- Vizsgáld meg az érintett kódot, a projekt struktúráját és
  a meglévő megoldásokat, mielőtt új mintát vezetsz be.
- Tekintsd át az alkalmazandó .agents/skills könyvtárban található
  skillek nevét és leírását. Ha a projekt más skillkönyvtárat
  jelöl meg az .agents alatt, azt is vedd figyelembe.
- A feladathoz illő skillek SKILL.md fájlját olvasd el,
  és kövesd a releváns hivatkozásaikat.
- Ne tölts be minden skillt válogatás nélkül.
- React-fejlesztéshez használd a vercel-react-best-practices
  skillt, ha telepítve van. A Next.js-specifikus szabályokat
  kizárólag Next.js projektben alkalmazd.
- Ha egy szükséges skill hiányzik vagy nem olvasható, jelezd.
  Ne állítsd, hogy használtál egy skillt, ha nem olvastad el.

## TypeScript és típusbiztonság

- Új alkalmazáskódhoz TypeScriptet használj.
  React-komponensekhez .tsx fájlokat készíts.
- Meglévő JavaScriptet csak a feladathoz indokolt körben migrálj.
- Kerüld az any típust és az implicit any-t.
- Ismeretlen külső adatot unknown típusként kezelj,
  majd validáld vagy szűkítsd a típusát.
- Kerüld az indokolatlan type assertion és non-null assertion
  használatát.
- Ne rejts el hibákat @ts-ignore vagy @ts-nocheck használatával.
- Ne lazítsd a TypeScript- vagy lintszabályokat azért,
  hogy a hibás kód átmenjen az ellenőrzésen.
- Használd a típusinferencia lehetőségeit; a publikus modulhatárok
  szerződése legyen egyértelmű.
- A TypeScript-típus nem futásidejű validáció.
  A külső bemeneteket futásidőben is ellenőrizd.

## Elnevezések, formázás és olvashatóság

- Használj beszédes, következetes angol azonosítókat.
  Kövesd a projekt meglévő szóhasználatát.
- Változók és függvények: camelCase.
- Komponensek, osztályok és típusok: PascalCase.
- Hookok: use előtag.
- Boolean értékeknél használj érthető is/has/can/should
  elnevezéseket, ahol ez természetes.
- Kövesd a projekt meglévő fájlelnevezési konvencióit.
- Kerüld a homályos neveket és az indokolatlan rövidítéseket.
- Kövesd a meglévő ESLint- és formázási konfigurációt.
- Ne formázd át a feladathoz nem kapcsolódó fájlokat.
- Használj egyszerű vezérlési folyamatot és korai visszatéréseket.
  Kerüld a mély egymásba ágyazást.
- A komment a döntés okát vagy a nem nyilvánvaló viselkedést
  magyarázza, ne ismételje meg a kódot.

## Clean Code és modularitás

- Minden függvény egy jól meghatározott feladatért feleljen.
- Minden komponens és modul legyen egyértelmű felelősségű.
- Ne készíts nagy, monolit fájlokat.
  Felelősségek alapján bonts, ne önkényes sorszámhatár szerint.
- Ne aprózd szét a kódot értelmetlenül.
- Különítsd el a megjelenítést, az üzleti logikát,
  az adatkezelést és a külső integrációkat.
- A cserélhető infrastruktúrát indokolt modulhatároknál
  szűk interfészek vagy adapterek mögé szervezd.
- Ne szivárogtasd a szolgáltatói SDK-kat a domainlogikába
  vagy a UI-komponensekbe.
- Használj explicit függőségátadást, ahol ez segíti
  a cserélhetőséget és a tesztelést.
- Kerüld a redundáns kódot. A valóban közös viselkedést emeld ki.
- Ne készíts túl általános absztrakciót pusztán hasonló
  kódrészletek miatt.
- Ne készíts spekulatív funkciókat, használatlan segédfüggvényeket
  vagy szükségtelen architekturális rétegeket.
- Kerüld a rejtett mellékhatásokat, körkörös importokat
  és a megosztott, módosítható globális állapotot.

## React

- Használj funkcionális komponenseket és szabályosan
  alkalmazott hookokat.
- A komponensek maradjanak fókuszáltak.
  Az összetett, újrahasznosítható logikát indokolt esetben
  emeld ki custom hookba.
- A render legyen tiszta: ne módosíts propsot vagy state-et,
  és ne indíts mellékhatásokat renderelés közben.
- Származtatott értéket lehetőleg render közben számolj.
  Ne tarts fenn hozzá redundáns state-et és effectet.
- Az effectek függőségei legyenek helyesek.
  Gondoskodj a szükséges takarításról.
- Használj stabil listakulcsokat. Változó sorrendű vagy
  szerkeszthető listánál ne az index legyen a kulcs.
- Kezeld a betöltési, hiba-, üres és sikeres állapotokat.
- Kezeld az aszinkron műveletek versenyhelyzeteit és
  az elavult eredményeket.
- Használj szemantikus HTML-t, hozzáférhető vezérlőket,
  címkéket és megfelelő billentyűzetes működést.
- Ne használj automatikusan useMemo, useCallback vagy React.memo
  optimalizálást; legyen konkrét indoka.
- Kövesd a projekt meglévő adatlekérési és állapotkezelési
  megoldását.

## Express és API-k

- A route/controller kezelje a HTTP-réteget.
  Az üzleti logikát és az adatkezelést különítsd el,
  a feladat méretéhez igazodva.
- Validáld a params, query és body adatokat a rendszer határán.
  Használd a meglévő validációs megoldást.
- Külön kezeld a hitelesítést és a jogosultságellenőrzést.
- A kliens által küldött user ID vagy szerepkör önmagában
  nem jogosultságigazolás.
- Használj konzisztens API-válaszokat, megfelelő HTTP-státuszokat
  és központi hibakezelést.
- Az aszinkron hibákat a telepített Express-verziónak megfelelően
  továbbítsd a hibakezelőhöz.
- Ne küldj belső stack trace-t vagy titkos adatot a kliensnek.
- Ne naplózz jelszavakat, tokeneket vagy érzékeny személyes adatokat.
- Használj paraméterezett adatbázis-lekérdezéseket.
- Összetartozó adatváltoztatásoknál használj indokolt tranzakciót.
- Ne blokkolj szinkron I/O-val a kéréskezelésben.
- Külső hívásoknál gondoskodj megfelelő timeoutról és hibakezelésről.

## Függőségek és változtatási kör

- Először a meglévő kódot, függőségeket és platformfunkciókat
  használd.
- Új runtime- vagy fejlesztői függőséget kizárólag indokolt esetben,
  előzetes felhasználói engedéllyel adj hozzá.
- Engedélykéréskor ismertesd a függőség célját, az alternatívát
  és a várható hatását.
- Korábban kifejezetten engedélyezett függőséghez ne kérj
  ismét engedélyt.
- Ne módosíts független csomagverziókat.
  Kövesd a meglévő csomagkezelőt és lockfile-t.
- A feladatot teljesen oldd meg, de kerüld a hozzá nem kapcsolódó
  refaktorálást.
- Őrizd meg a felhasználó meglévő módosításait.
- Titkokat ne írj a forráskódba vagy verziózott konfigurációba.
- Konfigurációváltozásnál szükség esetén frissítsd az
  .env.example fájlt valódi titkok nélkül.
- A kompatibilitást megszakító változtatást előre jelezd,
  és készíts hozzá indokolt migrációt vagy dokumentációt.

## Ellenőrzések és tesztek

- Minden befejezett kódmódosítási egység után, a munka lezárása
  előtt futtasd az elérhető és releváns ellenőrzéseket:
  lint, typecheck, unit/integrációs tesztek, valamint szükség
  esetén build vagy E2E teszt.
- A parancsokat a package.json, a dokumentáció és a CI alapján
  válaszd ki. Ne találj ki nem létező scripteket.
- Először az érintett területet ellenőrizd, majd futtasd
  a projekt által előírt további ellenőrzéseket.
- Frontendet és backendet érintő változtatásnál mindkét
  érintett csomagot ellenőrizd.
- Új vagy módosult üzleti viselkedéshez írj érdemi teszteket
  a meglévő tesztkeretrendszerrel.
- Hibajavításnál lehetőség szerint adj regressziós tesztet.
- A tesztek az elvárt viselkedést vizsgálják.
  Ellenőrizd a releváns hibás bemeneteket és határeseteket.
- Ne törölj tesztet, ne gyengíts assertiont, és ne kapcsold ki
  az ellenőrzést pusztán a sikeres eredmény érdekében.
- Ha egy ellenőrzés nem futtatható, pontosan jelezd az okát
  és azt, mi maradt ellenőrizetlen.
- Új tesztfüggőségre is érvényes az előzetes engedélykérés.

## Sikertelen ellenőrzések és újrapróbálkozás

- Az első sikertelen ellenőrzés után keresd meg a hiba okát.
  Különítsd el a saját változtatásod hibáit a korábban fennálló
  és a környezeti hibáktól.
- Javítsd a saját változtatásaidhoz kapcsolódó hibát,
  majd futtasd újra a sikertelen és a javítással érintett
  ellenőrzéseket.
- Az első sikertelen ellenőrzés után legfeljebb három javítási
  és újrafuttatási kört végezz az adott hibasorozatra.
  Ez összesen legfeljebb négy ellenőrzési kört jelent.
- Ne nullázd az újrapróbálkozások számát ugyanazon probléma
  átnevezésével.
- Ha a harmadik javítási kör után is fennáll a hiba,
  állj meg az adott probléma automatikus javításával,
  és jelezd a felhasználónak.
- Add meg a sikertelen parancsot, a lényeges hibaüzenetet,
  a javítási próbálkozásokat és a javasolt következő lépést.
- Hiányzó hozzáférés, konfiguráció, szolgáltatás vagy szükséges
  engedély esetén az akadályt azonnal jelezd.
  Ne ismételj változatlanul biztosan sikertelen parancsot.
- A korábban fennálló, független hibákat jelezd.
  Ne javítsd őket észrevétlenül a feladat keretein kívül.
- Sikertelen ellenőrzés mellett ne állítsd, hogy a munka
  ellenőrzötten kész.

## Befejezés

- Tekintsd át a végső diffet: nincs-e véletlen módosítás,
  debugkód, használatlan import vagy kiszivárgó titok.
- Használat, konfiguráció vagy publikus szerződés változásakor
  frissítsd a releváns dokumentációt.
- A végső válaszban röviden ismertesd:
    - mit változtattál és miért;
    - milyen ellenőrzéseket futtattál és milyen eredménnyel;
    - mi maradt ellenőrizetlen, bizonytalan vagy blokkolt.
- Különböztesd meg a ténylegesen lefuttatott ellenőrzést
  a puszta kódáttekintéstől.
- Soha ne állíts tesztsikert futtatás nélkül.
