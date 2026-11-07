# clone-monitoring Specification

## Purpose
Видеть поломку своих сервисов клона раньше пользователя и находить причину ошибки Worker'а после того, как она случилась: синтетическая проверка прода и журналы Worker'ов.

## Requirements

### Requirement: Синтетическая проверка прода

Workflow `prod check` SHALL раз в день, после каждого деплоя хотя бы одного сервиса и вручную проверять каждый свой сервис клона только чтением, без запросов к чужим сайтам. Прогон SHALL падать, если хотя бы одна проверка не прошла, и печатать, какая. В других репозиториях проверка SHALL пропускаться.

#### Scenario: Что проверяется

- **WHEN** запускается `scripts/prod-check.sh`
- **THEN** проверены приложение на `/` по обоим адресам — `https://trailroutine.com` и старому `https://nakarte-routing.pages.dev` (заголовок `trailroutine`), редирект `/next/` на `/`, Range у `brouter.jar`, `lookups.dat` и тайла BRouter, высота точки через API высот, `404 Track not found` на отсутствующий трек и preflight CORS-прокси

#### Scenario: Сервис сломан

- **WHEN** API высот отвечает `500`
- **THEN** прогон `prod check` красный, в логе строка `FAIL  elevation api: status 500`, GitHub шлёт письмо

#### Scenario: После деплоя

- **WHEN** `deploy pages` выкатил хотя бы один сервис
- **THEN** в том же прогоне job `smoke` запускает ту же проверку

#### Scenario: Чужой форк

- **WHEN** расписание срабатывает не в `sergeycw/trailroutine`
- **THEN** проверка пропускается

### Requirement: Журналы Worker'ов

У Worker'ов `nakarte-cors-proxy`, `nakarte-tracks` и `nakarte-elevation` SHALL быть включены Workers Logs, чтобы запросы, ошибки и `console.log` можно было найти после того, как они случились.

#### Scenario: Ошибка вчера

- **WHEN** прокси вчера не обновил куки Strava
- **THEN** строка `strava heatmap cookies not refreshed: <причина>` находится в Workers Logs `nakarte-cors-proxy` в дашборде Cloudflare

### Requirement: Ошибки в браузере пользователей

Сборка приложения с адресом проекта Sentry (DSN) SHALL отправлять в Sentry необработанные исключения и отклонённые промисы страницы, ошибки рендера React и отказ запуска движка прокладки — в Web Worker и на главном потоке, каждый отдельным отчётом. Отказ прокладки одного маршрута — обычный ответ роутера — SHALL NOT отправляться.

#### Scenario: Ошибка на странице

- **WHEN** в сборке с DSN страница бросила необработанное исключение
- **THEN** в Sentry уходит один отчёт со стеком

#### Scenario: Движок не запустился

- **WHEN** в сборке с DSN CheerpJ не запустился в Web Worker, а потом и на главном потоке
- **THEN** в Sentry уходят два отчёта с текстом ошибки движка, а пользователь видит то же, что без трекера

#### Scenario: Маршрута нет

- **WHEN** в сборке с DSN роутер ответил, что маршрута между точками нет
- **THEN** запросов к Sentry нет

### Requirement: Отчёт без места и треков пользователя

Отчёт об ошибке SHALL NOT содержать фрагмент и параметры адреса страницы, адреса сетевых запросов, сообщения консоли, подписи элементов интерфейса (названия треков и меток), часовой пояс и IP пользователя.

#### Scenario: Ошибка на ссылке с треком

- **WHEN** в сборке с DSN пользователь открыл `/#m=13/43.27/42.49&nktk=…`, через меню трека открыл профиль высот, и страница бросила необработанное исключение
- **THEN** адрес страницы в отчёте — без `#…` и `?…`, в отчёте нет координат, названия трека, адресов запросов к API высот и тайлам и сообщений консоли

### Requirement: Запросы к Sentry только с ошибкой

Заход без ошибок SHALL NOT давать запросов к Sentry. Сборка без DSN — dev-сервер, тесты, сборка без секрета, чужой форк — SHALL NOT обращаться к Sentry.

#### Scenario: Заход без ошибок

- **WHEN** в сборке с DSN пользователь открыл приложение и проложил маршрут без ошибок
- **THEN** запросов к Sentry нет

#### Scenario: Сборка без DSN

- **WHEN** приложение собрано без DSN, и страница бросила необработанное исключение
- **THEN** запросов к Sentry нет

### Requirement: No reports after the page leaves

The error tracker SHALL NOT send a report after the page starts to leave: after `beforeunload`, after `pagehide`, and after the start of the move from the old address to the new domain. Errors of aborted loads during a navigation are not errors of the app.

#### Scenario: No reports after the page leaves

- **WHEN** the page starts to leave, and then an aborted load or an engine start fails with an error
- **THEN** the tracker sends no report
