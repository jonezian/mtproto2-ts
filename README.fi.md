# mtproto2-ts

Telegram MTProto 2.0 -protokollan kokonainen TypeScript-toteutus.

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22-green)

[English](README.md) | **Suomi**

## Ominaisuudet

- **Tyyppiturvallisuus** -- tiukka TypeScript kauttaaltaan, ei `any`-tyyppeja
- **Modulaarinen monorepo** -- 7 itsenaeista pakettia `@mtproto2/`-scopessa
- **Nolla runtime-riippuvuutta** -- vain Node.js:n sisaanrakennetut moduulit (`node:crypto`, `node:net`, `node:events`)
- **Node.js 22+** -- rakennettu moderneille ajoymparistoille, pelkka ESM
- **974+ testia** -- kattava testikattavuus 59 testitiedostossa
- **Automaattiset skeemapaivitykset** -- pipeline hakee, vertaa ja generoi TL-tyypit automaattisesti

## Pikaohje

```bash
npm install @mtproto2/client @mtproto2/crypto
```

```ts
import { TelegramClient, MemorySession } from '@mtproto2/client';

const client = new TelegramClient({
  apiId: 12345,
  apiHash: 'sinun_api_hash',
  session: new MemorySession(),
});

await client.connect();
const me = await client.getMe();
await client.disconnect();
```

## Paketit

| Paketti | Kuvaus | Tila |
|---------|--------|------|
| [`@mtproto2/binary`](packages/binary/) | TL-binaariserialisointi (TLReader / TLWriter) | Vakaa |
| [`@mtproto2/crypto`](packages/crypto/) | Kryptografiset primitiivit (AES-IGE, RSA-PAD, DH, PQ) | Vakaa |
| [`@mtproto2/tl-schema`](packages/tl-schema/) | TL-skeeman parseri ja TypeScript-koodigeneraattori | Vakaa |
| [`@mtproto2/tl-types`](packages/tl-types/) | Autogeneroidut TypeScript-tyypit Telegram API:lle (layer 216) | Generoitu |
| [`@mtproto2/transport`](packages/transport/) | TCP-transporttikerros (Abridged, Intermediate, Padded, Full, Obfuscated) | Vakaa |
| [`@mtproto2/mtproto`](packages/mtproto/) | MTProto 2.0 -moottori (enkryptio, sessiot, RPC, updatet) | Vakaa |
| [`@mtproto2/client`](packages/client/) | Korkean tason Telegram-client API | Vakaa |

## Arkkitehtuuri

```
@mtproto2/client
    |
    v
@mtproto2/mtproto
    |
    +-----> @mtproto2/transport --> @mtproto2/crypto
    |                          --> @mtproto2/binary
    +-----> @mtproto2/crypto
    +-----> @mtproto2/binary
    +-----> @mtproto2/tl-types

@mtproto2/tl-types  <---(generoi)---  @mtproto2/tl-schema
```

- **binary** ja **crypto** ovat lehtipaketit ilman sisaeisiae riippuvuuksia.
- **tl-schema** on kaeannoesaikainen tyoekalu joka generoi **tl-types**-paketin.
- **transport** kaeytt binary- ja crypto-paketteja kehystaeamiseen ja obfuskaatioon.
- **mtproto** on ydinmoottori, joka yhdistaeae transportin, crypton ja tyypit.
- **client** tarjoaa korkean tason API:n mtproto-moottorin paeaellae.

## Tietoturva

Kaikki kryptografiset operaatiot kaeyttaevaet Node.js:n sisaeaenrakennettua `crypto`-moduulia:

- Satunnaislukujen generointi yksinomaan `crypto.randomBytes()`:lla -- `Math.random()`:ia ei kaeytetae koskaan
- Ajoitusturvalliset vertailut `crypto.timingSafeEqual()`:lla msg_key- ja nonce-varmistuksessa
- Taeydellinen DH-parametrien validointi (2048-bittinen safe prime, aliryhmaevalidointi, g_a-aluetarkistus)
- Padding-validointi dekryptauksessa (12--1024 tavua pakotettu)
- Puskurikoon rajoitukset muistin loppumishyoekkaeyksieen estaeamiseksi

## Kehitys

```bash
git clone https://github.com/jonezian/mtproto2-ts.git
cd mtproto2-ts
npm install
npm run build
npx vitest run
```

### Komennot

| Komento | Kuvaus |
|---------|--------|
| `npm install` | Asenna kaikki workspace-riippuvuudet |
| `npm run build` | Kaeannae kaikki paketit |
| `npm run test` | Suorita kaikki testit (vitest) |
| `npm run typecheck` | TypeScript-tyyppitarkistus |
| `npm run lint` | ESLint |
| `npm run generate` | Generoi TL-tyypit skeemasta |
| `npm run fetch-schema` | Lataa uusin TL-skeema Telegramista |

## Skeemapaivitykset

TL-skeema voidaan paeivittaeae Telegramin laehteistae:

```bash
npm run fetch-schema     # Lataa uusin api.tl ja mtproto.tl
npm run diff-schema      # Naeyteae muutokset nykyisen ja uuden skeeman vaelillae
npm run generate         # Generoi TypeScript-tyypit uudelleen
npx vitest run           # Varmista etteae mikaeaen mene rikki
```

Pipeline varmistaa ettae tyyppimaeaeritykset pysyvaet ajan tasalla Telegram API -paeivitysten kanssa.

## Miksi mtproto2-ts?

- **Yksi runtime** -- ei Python-Node HTTP-overheadia, kaikki samassa prosessissa
- **Taeydellinen tyyppiturvallisuus** -- 1 530 konstruktoria ja 742 metodia generoitu TL-skeemasta TypeScript-tyypeiksi
- **Modulaarinen** -- kaeyteae vain tarvitsemasi paketit
- **Ylle pidetty** -- automaattinen skeemapaivityspipeline GitHub Actionsilla
- **Nolla ulkoisia riippuvuuksia** -- vain Node.js:n omat moduulit

## Osallistuminen

Katso [CONTRIBUTING.md](CONTRIBUTING.md) kehitysympaeriston pystytykseen, koodityylin, tietoturvasaeaentojen ja pull request -ohjeiden osalta.

## Lisenssi

[MIT](LICENSE)
