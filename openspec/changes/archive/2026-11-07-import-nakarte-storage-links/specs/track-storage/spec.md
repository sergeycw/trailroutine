## ADDED Requirements

### Requirement: Track from the storage of nakarte.me

When `GET /track/{key}` asks for a key that is not in R2, the Worker SHALL ask `https://tracks.nakarte.me/track/{key}` once. It SHALL accept only a `200` answer that passes the checks of a write: at most 2 MiB, a link body, and an md5 equal to the key. It SHALL keep the accepted body in R2 with the source `nakarte.me` and return it. A `404` of the author SHALL give `404`; any other failure SHALL give `502` without a write.

#### Scenario: Link of nakarte.me

- **WHEN** a user opens a link of nakarte.me with `nktl={key}`, R2 has no such key, and `tracks.nakarte.me` answers `200` with a body whose md5 is the key
- **THEN** the Worker returns the body with `200`, the track opens, and R2 now has `tracks/{key}` with the source `nakarte.me`

#### Scenario: Second read of a copied track

- **WHEN** the same key is asked again
- **THEN** the Worker returns it from R2 without a request to `tracks.nakarte.me`

#### Scenario: Body does not match the key

- **WHEN** `tracks.nakarte.me` answers `200` with a body whose md5 is not the key
- **THEN** the Worker answers `502` and stores nothing

#### Scenario: Author's storage is down

- **WHEN** `tracks.nakarte.me` answers `500` or does not answer in time
- **THEN** the Worker answers `502` and stores nothing, and a later request asks again

## MODIFIED Requirements

### Requirement: Чтение трека

`GET /track/{key}` SHALL отдавать сохранённое тело со статусом `200` и `Content-Type: text/plain`. Ключ, которого нет в хранилище, SHALL искаться в хранилище nakarte.me (требование «Track from the storage of nakarte.me»). Ключ, которого нет ни там, ни там, SHALL получать `404`.

#### Scenario: Открытие ссылки

- **WHEN** пользователь открывает клон по ссылке с `nktl={key}`
- **THEN** трек загружается из хранилища клона

#### Scenario: Неизвестный ключ

- **WHEN** запрошен ключ, которого нет в хранилище, и `tracks.nakarte.me` отвечает на него `404`
- **THEN** ответ `404`
