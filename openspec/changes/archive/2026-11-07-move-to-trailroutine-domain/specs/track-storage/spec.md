# Spec Delta

## MODIFIED Requirements

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
