# Resend bekötése emailtárhely nélkül

Utolsó frissítés: 2026-10-08.

Az alkalmazás a megerősítő és jelszó-visszaállító leveleket **Resend HTTPS API-val** küldi. A saját domain használatához a domain DNS-beállításaihoz kell hozzáférés. Külön emailtárhelyre és létező feladópostaládára nincs szükség: a `no-reply` feladót a Resend küldi az ellenőrzött domain nevében. Ettől a cím még nem fogad bejövő levelet; a válaszok fogadásához később külön postaláda vagy más fogadási megoldás kell.

## 1. Küldő domain ellenőrzése

1. A Resend **Domains** oldalán add hozzá a saját domainedet vagy egy kifejezetten küldéshez használt aldomaint.
2. A domain DNS-kezelőjében add hozzá a Resend által megjelenített küldési rekordokat. A Resend DKIM- és SPF-ellenőrzést kér; a felületen megadott rekordnevet, típust, értéket és szükség esetén prioritást pontosan másold át. A küldéshez megjelenített MX-rekord nem jelent emailtárhely-vásárlási követelményt.
3. Kérd a domain ellenőrzését Resendben, és várd meg a sikeres küldési ellenőrzést. Meglévő DNS-rekordokat ne cserélj le találomra; a Resend által kijelölt rekordneveket használd.
4. Válassz a jóváhagyott domainhez tartozó feladót, például `Rapidfire <no-reply@your-domain.example>`. A példabeli domaint a saját ellenőrzött domainedre cseréld.

A játék emailküldéséhez a Resend bejövőemail-funkcióját nem kell bekapcsolni. A küldéshez és a fogadáshoz tartozó DNS-rekordokat a szolgáltató külön kezeli.

## 2. API-kulcs és alkalmazáskonfiguráció

A Resend **API Keys** oldalán készíts emailküldési jogosultságú kulcsot, lehetőleg a kiválasztott domainre korlátozva. Helyi fejlesztéskor a Gitből kizárt gyökérszintű `.env` fájlban állítsd be:

| Változó           | Érték                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- |
| `RESEND_API_KEY`  | A Resend API-kulcs titkos értéke.                                                  |
| `EMAIL_FROM`      | Az ellenőrzött domainhez tartozó feladó.                                           |
| `BETTER_AUTH_URL` | A böngészőből elérhető alkalmazás originje, fejlesztéskor `http://localhost:5173`. |

Névvel megadott feladóra a `.env` sor alakja:

```dotenv
EMAIL_FROM="Rapidfire <no-reply@your-domain.example>"
```

A kulcs kizárólag a backend környezetébe kerüljön. Felhőben a környezet titkos változói között add meg, az alkalmazás számára elérhető értékként; a frontendhez `VITE_` előtaggal ne add hozzá. Az alkalmazásnak kimenő HTTPS-elérés szükséges az `api.resend.com` címre, a 443-as porton. Nincs SMTP-host, port, felhasználónév vagy SMTP-jelszó.

A Codex felhőkörnyezet draftjában a `RESEND_API_KEY` proxysecret az `api.resend.com` célhoz kötött; az `EMAIL_FROM` normál környezeti változó. A Node 24 natív `fetch` kérésének a platform `HTTPS_PROXY` beállítását is használnia kell, ezért ebben a környezetben `NODE_USE_ENV_PROXY=1` szükséges. A draftot nézd át, töltsd ki a kulcsot és a feladót, mentsd a beállításokat, majd publikáld a környezetet (**Publish**). A korábbi `SMTP_*` változókat és SMTP2GO-titkokat a környezet beállításaiból eltávolíthatod. A draft elmentése önmagában nem alkalmazza a titkot vagy az új hálózati szabályokat a futó környezetre.

Meglévő helyi `.env` esetén az `npm run env:init` megőrzi a tartalmat, ezért az új változókat kézzel add hozzá. A régi `SMTP_*` sorok már nem használtak, eltávolíthatók. A konfiguráció módosítása után indítsd újra az alkalmazást.

Hiányzó API-kulcs vagy feladó mellett a szerver `RESEND_NOT_CONFIGURED` jelzéssel elindul. A vendégjáték használható, de a kötelező email-megerősítéshez és a jelszó-visszaállításhoz működő emailkonfiguráció kell.

## 3. Tesztelés és éles feladó

A Resend alapértelmezett `onboarding@resend.dev` feladója tesztelésre való: azzal a saját Resend-fiókodhoz tartozó emailcímre küldhetsz tesztlevelet. Tetszőleges játékoscímre történő verification/reset küldéshez ellenőrzött saját domain szükséges. Az MVP előtt a kiválasztott csomag aktuális napi/havi kereteit és fiókkorlátait a Resend dashboardján ellenőrizd.

A bekötés után saját tesztfiókkal ellenőrizd a regisztrációt, az email-megerősítést és a jelszó-visszaállítást. A Resend által elfogadott API-kérés még nem bizonyítja a postaládába kézbesítést: nézd meg a szolgáltatói küldési állapotot, a beérkezett levelet és a link célját is. A levélben szereplő alkalmazásoriginnek a böngészőből elérhető `BETTER_AUTH_URL` értékkel kell egyeznie.

## 4. Adapter és ellenőrzési határok

Az `EmailPort` határa szolgáltatófüggetlen; az authcallbackek és az angol sablonok nem ismerik a Resendet. A szerver a Node beépített `fetch` API-jával küld, külön Resend SDK nélkül. A memóriabeli sor legfeljebb száz feladatot tart, egy aktív küldéssel; a timeout öt másodperc, átmeneti hibánál legfeljebb három próbálkozás, 2/8 másodperces szünetekkel. Az újrapróbálás ugyanazt a linket, tartalmat és `Idempotency-Key` értéket használja. A szolgáltatói idempotencia nem azonos a postaládába történő pontosan egyszeri kézbesítés garanciájával.

HTTP 408, 429 és 5xx válasz átmeneti hiba; 409 esetén csak a `concurrent_idempotent_requests` hibakód ismételhető. Hibás API-kulcs, feladó, paraméter vagy ütköző idempotenciakulcs végleges hiba. Sikeresnek csak a megfelelő emailazonosítót tartalmazó API-választ tekintjük.

2026-10-08-án a teljes típusellenőrzés és build, a formázásellenőrzés, 186 Vitest-teszt és 9 fejlesztői + 9 production böngészős teszt sikeres. Ebből 35 célzott teszt a Resend API-kérést, konfigurációt, megszakítást, hibaválaszokat és az idempotenciakulcs megőrzését ellenőrzi, helyettesített hálózati kérésekkel. A függőségi fa hibamentes, az npm audit 0 sérülékenységet jelzett.

A korábbi M0–M4 teszteredmények teszt-emailporttal igazolják az authfolyamatot, a valódi szolgáltatói kézbesítést nem. A Resend publikus OpenAPI-leírása és hivatalos Node SDK-forrása hozzáférhető volt; a Resend webes dokumentációját és az `api.resend.com` hitelesítés nélküli HTTPS-elérési próbáját 2026-10-08-án a környezet hálózati proxyja 403-mal blokkolta. Az új célengedély a mentett draftban szerepel; a beállítások alkalmazása után az elérést újra ellenőrizni kell. Az aktuális díjcsomagkvóták és a fiók/domain bekötése nem ellenőrzöttek. Valódi API-kulcs és ellenőrzött feladó nélkül szolgáltatói küldési próba nem történt.

Hivatalos források:

- [Domain DNS-ellenőrzés](https://resend.com/docs/dashboard/domains/introduction)
- [Emailküldés API](https://resend.com/docs/api-reference/emails/send-email)
- [Idempotenciakulcsok](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend Node SDK: API-kulcs és saját domain ellenőrzése](https://github.com/resend/resend-node#setup)
- [Resend OpenAPI: küldési végpont és DNS-rekordok](https://github.com/resend/resend-openapi/blob/main/resend.yaml)
