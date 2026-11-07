# Tasks

## 1. Worker

- [x] 1.1 In `workers/tracks/src/index.js`, read a key that is not in R2 from `https://tracks.nakarte.me/track/{key}` with a timeout of 5 s, check the body (status `200`, size, `LINK_BODY`, `trackKey`), store it in R2 with `created` and `source: 'nakarte.me'`, and return it; answer `404` to the author's `404` and `502` to other failures.

## 2. Tests

- [x] 2.1 Add a stub of `tracks.nakarte.me` to `workers/tracks/vitest.config.js` (`outboundService`): a valid track, a body of another key, `404`, `500`, and a request counter.
- [x] 2.2 Add tests in `workers/tracks/test/tracks.test.js` for the scenarios of «Track from the storage of nakarte.me» and the modified «Неизвестный ключ». The workflow `check-tracks.yml` already runs them on each PR that changes `workers/tracks/`.

## 3. Docs

- [x] 3.1 Update `README.md`, `docs/architecture/track-storage.md`, `docs/architecture/protection.md` and `docs/architecture/decisions.md`: `nktl=` links of nakarte.me open, and the Worker is the one place that reads the author's storage.
- [x] 3.2 Remove the nakarte.me sub-item from the item «Импорт по ссылкам» in `openspec/backlog.md`.
