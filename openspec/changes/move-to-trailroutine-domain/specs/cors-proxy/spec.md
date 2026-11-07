# Spec Delta

## MODIFIED Requirements

### Requirement: Свои адреса не проксируются

Запрос к своим адресам клона — `*.nakarte-routing.workers.dev`, `nakarte-routing.pages.dev`, `trailroutine.com` и их поддоменам — SHALL получать `403` без запроса к цели.

#### Scenario: Pages клона через прокси

- **WHEN** запрошен `/https/nakarte-routing.pages.dev/tiles/E40_N40.rd5`
- **THEN** ответ `403`, функция тайлов не вызывается

#### Scenario: Свой домен через прокси

- **WHEN** запрошен `/https/trailroutine.com/tiles/E40_N40.rd5`
- **THEN** ответ `403`, функция тайлов не вызывается

### Requirement: Разрешённые origin клона

Прокси SHALL обслуживать только origin из `ALLOWED_ORIGINS`: по заголовку `Origin`, а без него — по origin из `Referer`. Остальным SHALL отвечать `403`. Разрешены сайт клона `https://trailroutine.com`, старый адрес `https://nakarte-routing.pages.dev`, dev-сервер приложения `http://localhost:8769` и `vite preview` `http://localhost:4173`.

#### Scenario: Чужой сайт

- **WHEN** запрос пришёл с `Origin: https://example.com`
- **THEN** ответ `403`

#### Scenario: Запрос со своего домена

- **WHEN** запрос пришёл с `Origin: https://trailroutine.com`
- **THEN** запрос проксируется, `Access-Control-Allow-Origin` равен `https://trailroutine.com`

#### Scenario: Запрос без Origin, но с Referer

- **WHEN** запрос без `Origin` пришёл с `Referer: https://nakarte-routing.pages.dev/#m=10/41/44`
- **THEN** запрос проксируется, `Access-Control-Allow-Origin` равен `https://nakarte-routing.pages.dev`

#### Scenario: Локальный dev-сервер приложения

- **WHEN** запрос пришёл с `Origin: http://localhost:8769` или `http://localhost:4173`
- **THEN** запрос проксируется, `Access-Control-Allow-Origin` равен origin запроса

#### Scenario: Порт старого клиента

- **WHEN** запрос пришёл с `Origin: http://localhost:9876` или `http://localhost:8765`
- **THEN** ответ `403`
