# track-storage Specification

## Purpose
Хранилище треков клона для коротких ссылок `nktl=`: принимает сериализованные треки по ключу из их md5 и отдаёт их обратно.

## Requirements

### Requirement: Запись трека

`POST /track/{key}` с телом-строкой SHALL сохранять тело, если `key` равен base64url от md5 тела без `=` (`/`→`_`, `+`→`-`), и отвечать `200`. Повторная запись существующего ключа SHALL отвечать `200` и не менять сохранённое.

#### Scenario: Новый трек

- **WHEN** клиент отправляет `POST /track/{key}` с телом, md5 которого даёт этот `key`
- **THEN** ответ `200`, и `GET /track/{key}` возвращает то же тело

#### Scenario: Повторная запись

- **WHEN** тот же `POST` отправлен второй раз
- **THEN** ответ `200`, сохранённое тело не изменилось

### Requirement: Ключ не совпадает с телом

`POST /track/{key}`, где `key` не равен md5 тела в описанной кодировке, SHALL получать `400` и ничего не сохранять. Ключ не из 22 символов `[A-Za-z0-9_-]` SHALL получать `400`.

#### Scenario: Подмена ключа

- **WHEN** клиент отправляет тело A с ключом от тела B
- **THEN** ответ `400`, по ключу B по-прежнему лежит тело B или ничего

### Requirement: Лимит размера

Тело больше 2 МиБ SHALL получать `413` и не сохраняться.

#### Scenario: Слишком большой трек

- **WHEN** клиент отправляет тело больше 2 МиБ
- **THEN** ответ `413`, клиент показывает «track is too big»

### Requirement: Чтение трека

`GET /track/{key}` SHALL отдавать сохранённое тело со статусом `200` и `Content-Type: text/plain`. Ключ, которого нет в хранилище, SHALL искаться в хранилище nakarte.me (требование «Track from the storage of nakarte.me»). Ключ, которого нет ни там, ни там, SHALL получать `404`.

#### Scenario: Открытие ссылки

- **WHEN** пользователь открывает клон по ссылке с `nktl={key}`
- **THEN** трек загружается из хранилища клона

#### Scenario: Неизвестный ключ

- **WHEN** запрошен ключ, которого нет в хранилище, и `tracks.nakarte.me` отвечает на него `404`
- **THEN** ответ `404`

### Requirement: CORS только для клона

Запросы SHALL обслуживаться только для origin из списка разрешённых (`https://trailroutine.com`, `https://nakarte-routing.pages.dev` и локальные dev-серверы). Ответ SHALL содержать `Access-Control-Allow-Origin` с origin запроса и `Access-Control-Allow-Credentials: true`; на `OPTIONS` — `204`. Запросы с чужим `Origin` SHALL получать `403`.

#### Scenario: Запрос с клона

- **WHEN** страница `https://nakarte-routing.pages.dev` отправляет `POST` с `withCredentials`
- **THEN** ответ содержит `Access-Control-Allow-Origin: https://nakarte-routing.pages.dev` и `Access-Control-Allow-Credentials: true`

#### Scenario: Запрос со своего домена

- **WHEN** страница `https://trailroutine.com` отправляет `GET /track/<ключ>`
- **THEN** ответ содержит `Access-Control-Allow-Origin: https://trailroutine.com` и `Access-Control-Allow-Credentials: true`

#### Scenario: Чужой сайт

- **WHEN** запрос пришёл с `Origin: https://example.com`
- **THEN** ответ `403`

### Requirement: Только тело ссылки

`POST /track/{key}` с телом, в котором есть символы вне `A–Z`, `a–z`, `0–9`, `-`, `_`, `=`, `/` (алфавит base64url строк `nktk` и разделитель треков), SHALL получать `400` и ничего не сохранять.

#### Scenario: Ссылка клиента

- **WHEN** клиент отправляет склеенные через `/` строки `nktk`
- **THEN** трек сохраняется, ответ `200`

#### Scenario: Произвольный файл

- **WHEN** тело содержит пробел, перевод строки или байты вне алфавита
- **THEN** ответ `400`, по ключу ничего не лежит

### Requirement: Время записи

Новый объект SHALL сохраняться с `customMetadata.created` — временем записи в ISO 8601 (UTC), чтобы объекты за окно времени находились листингом без чтения тел.

#### Scenario: Новый трек

- **WHEN** трек сохранён
- **THEN** у объекта `tracks/{key}` есть `customMetadata.created`

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
