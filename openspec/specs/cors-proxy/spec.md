# cors-proxy Specification

## Purpose

Свой CORS-прокси клона вместо авторского `proxy.nakarte.me`, который не пускает чужой домен. Через прокси идут импорт треков по ссылкам, слои Strava heatmap и Tsvetkov, подложка Tracestrack Topo (ключ — секрет прокси), свои слои пользователя с флагом прокси, поиск mapy.cz и короткие ссылки. Протокол — как у авторского прокси (`/<схема>/<хост>/<путь>`).

## Requirements

### Requirement: Формат адреса

Прокси SHALL принимать адреса вида `/<схема>/<хост>/<путь>?<запрос>` и запрашивать `<схема>://<хост>/<путь>?<запрос>`, где схема — `http` или `https`. Прочие адреса, в том числе `/wikimapia/<путь>` старого клиента, SHALL получать `404`.

#### Scenario: Запрос через прокси

- **WHEN** разрешённая страница запрашивает `/https/www.openstreetmap.org/api/0.6/map?bbox=1,2,3,4`
- **THEN** прокси запрашивает `https://www.openstreetmap.org/api/0.6/map?bbox=1,2,3,4` и возвращает ответ

#### Scenario: Неизвестный путь

- **WHEN** запрошен `/ftp/example.com/file` или `/wikimapia/z1/itiles/0/1/2.xy`
- **THEN** ответ `404`

### Requirement: CORS-заголовки

Ответ SHALL содержать `Access-Control-Allow-Origin` с origin вызывающей страницы, `Access-Control-Allow-Credentials: true` и открывать наружу `Content-Disposition`. На `OPTIONS` прокси SHALL отвечать `204` с разрешёнными методами `GET, HEAD, OPTIONS` и запрошенными заголовками.

#### Scenario: Имя файла из Content-Disposition

- **WHEN** сервис отдаёт трек с `Content-Disposition: attachment; filename="run.gpx"`
- **THEN** страница может прочитать этот заголовок

### Requirement: Редиректы остаются в прокси

Прокси SHALL NOT следовать редиректам сам. Заголовок `Location` SHALL переписываться в форму прокси, чтобы браузер шёл по редиректу снова через прокси, а конечный URL ответа был адресом прокси.

#### Scenario: Короткая ссылка

- **WHEN** сервис отвечает `302` с `Location: https://www.strava.com/activities/123`
- **THEN** клиент получает `Location: <прокси>/https/www.strava.com/activities/123`

### Requirement: Фильтрация заголовков

К сервису SHALL уходить только заголовки `Accept`, `Accept-Language`, `Content-Type`, `Range` и `User-Agent`. `Set-Cookie` из ответа сервиса SHALL удаляться.

#### Scenario: Куки сервиса

- **WHEN** сервис ставит куку в ответе
- **THEN** клиент не получает `Set-Cookie`

#### Scenario: User-Agent клиента

- **WHEN** браузер запрашивает через прокси файл трека или короткую ссылку
- **THEN** сервис получает `User-Agent` браузера, а не пустой заголовок

### Requirement: Куки Strava для тайлов heatmap

Прокси SHALL подставлять заголовком `Cookie` куки `CloudFront-Key-Pair-Id`, `CloudFront-Policy`, `CloudFront-Signature` и `_strava_idcf` в запросы к тайлам `content-*.strava.com/identified/globalheat/` и SHALL NOT отправлять их на другие адреса. Источник кук — обновление по сессии из секрета `STRAVA_SESSION`; пока свежих кук нет, — секрет `STRAVA_COOKIES`, если он задан. Без обоих запросы уходят без кук.

#### Scenario: Тайл heatmap

- **WHEN** разрешённая страница запрашивает `/https/content-a.strava.com/identified/globalheat/all/hot/12/2557/1514.png?px=256`
- **THEN** запрос к Strava уходит с куками CloudFront и `_strava_idcf`

#### Scenario: Другой адрес Strava

- **WHEN** запрошен `/https/www.strava.com/activities/1/streams`
- **THEN** куки CloudFront и сессия к запросу не добавляются

#### Scenario: Сессия не задана

- **WHEN** секрета `STRAVA_SESSION` нет, а `STRAVA_COOKIES` задан
- **THEN** тайл heatmap запрашивается с куками из `STRAVA_COOKIES`

### Requirement: HEAD как GET

Запрос `HEAD` прокси SHALL отправлять сервису методом `GET` и SHALL возвращать клиенту статус и заголовки ответа без тела, как авторский прокси на nginx: часть сервисов отвечает на `HEAD` иначе, чем на `GET`.

#### Scenario: Короткая ссылка mapy.com

- **WHEN** клиент делает `HEAD /https/mapy.com/s/favepemeko`
- **THEN** сервис получает `GET` и отвечает редиректом `301`, клиент получает переписанный `Location` без тела

### Requirement: Обновление кук Strava по сессии

Если задан `STRAVA_SESSION`, прокси SHALL получать куки heatmap сам: запросом `GET https://www.strava.com/maps/global-heatmap` с этой сессией, следуя редиректам только внутри `https://www.strava.com`. Полученные куки SHALL использоваться до срока из `CloudFront-Policy` за вычетом запаса; параллельные запросы тайлов SHALL ждать одно обновление.

#### Scenario: Первое обращение к тайлу

- **WHEN** задан `STRAVA_SESSION`, а свежих кук у прокси нет
- **THEN** прокси запрашивает страницу heatmap с сессией и отправляет тайл с полученными куками

#### Scenario: Куки ещё свежие

- **WHEN** куки получены, а до срока политики больше запаса
- **THEN** следующий тайл уходит с ними же, без нового запроса страницы

#### Scenario: Срок подходит

- **WHEN** до срока политики осталось меньше запаса
- **THEN** прокси получает куки заново

#### Scenario: Параллельные тайлы

- **WHEN** несколько тайлов запрошены одновременно, а свежих кук нет
- **THEN** страница heatmap запрашивается один раз

### Requirement: Пауза после неудачного обновления

Если обновление не дало все четыре куки (сессия отклонена, редирект за пределы `www.strava.com`, ошибка сети), прокси SHALL использовать `STRAVA_COOKIES` или запрашивать тайл без кук и SHALL NOT повторять обновление в течение паузы около 10 минут. В журнал SHALL попадать причина с именами кук и статусом, без значений.

#### Scenario: Сессия отклонена

- **WHEN** страница heatmap отвечает редиректом на `/login`
- **THEN** тайл уходит с `STRAVA_COOKIES`, а следующий тайл в течение паузы не вызывает запроса страницы

#### Scenario: Пауза прошла

- **WHEN** после неудачи прошло больше паузы
- **THEN** следующий тайл снова запускает обновление

### Requirement: Сессия Strava не покидает прокси

Сессия из `STRAVA_SESSION` SHALL уходить только в запросы обновления к `https://www.strava.com`. Ни сессия, ни куки, полученные при обновлении, SHALL NOT попадать в ответ клиенту, в том числе в `Set-Cookie`.

#### Scenario: Тайл не получает сессию

- **WHEN** прокси запрашивает тайл heatmap
- **THEN** в заголовке `Cookie` тайла нет `_strava4_session`

#### Scenario: Ответ клиенту

- **WHEN** клиент получает тайл heatmap после обновления
- **THEN** в ответе нет `Set-Cookie` и значений кук

### Requirement: Источник кук Strava в ответе тайла

Ответ на запрос тайла heatmap SHALL содержать заголовок `X-Strava-Cookies` со значением `session` (куки получены по сессии), `fallback` (из `STRAVA_COOKIES`), `anonymous` (тайл взят с анонимного адреса без кук) или `none` (без кук) и SHALL NOT содержать самих кук. На другие адреса заголовок не ставится. По нему владелец проверяет, что сессия работает, пока `STRAVA_COOKIES` ещё жив.

#### Scenario: Куки по сессии

- **WHEN** тайл запрошен после успешного обновления
- **THEN** в ответе `X-Strava-Cookies: session`

#### Scenario: Не тайл heatmap

- **WHEN** запрошен `/https/www.strava.com/activities/1/streams`
- **THEN** заголовка `X-Strava-Cookies` в ответе нет

### Requirement: Анонимные тайлы heatmap без кук

Если для тайла heatmap у прокси нет кук или CloudFront ответил на него `401` или `403`, прокси SHALL запросить тот же тайл без кук с `https://heatmap-external-{a,b,c}.strava.com/tiles/<активность>/<цвет>/<z>/<x>/<y>.png` с тем же `px`, если зум не выше 12 для `px=256` и не выше 11 для `px=512`, и вернуть этот ответ с `X-Strava-Cookies: anonymous`. Выше этих зумов прокси SHALL вернуть исходный ответ.

#### Scenario: Сессии нет, обзорный зум

- **WHEN** секретов Strava нет и запрошен `/https/content-a.strava.com/identified/globalheat/all/hot/12/2557/1514.png?px=256`
- **THEN** прокси без кук запрашивает `heatmap-external-*.strava.com/tiles/all/hot/12/2557/1514.png?px=256` и отвечает с `X-Strava-Cookies: anonymous`

#### Scenario: Куки протухли

- **WHEN** тайл z11 ушёл с `STRAVA_COOKIES`, а CloudFront ответил `403`
- **THEN** клиент получает анонимный тайл с `X-Strava-Cookies: anonymous`

#### Scenario: Крупный зум без кук

- **WHEN** секретов Strava нет и запрошен тайл z13
- **THEN** анонимный адрес не запрашивается, клиент получает ответ CloudFront и `X-Strava-Cookies: none`

#### Scenario: 512 px на z12

- **WHEN** секретов Strava нет и запрошен тайл z12 с `px=512`
- **THEN** анонимный адрес не запрашивается

### Requirement: Только чтение

Прокси SHALL обслуживать только `GET`, `HEAD` и `OPTIONS` и SHALL NOT пересылать сервису тело запроса. Другие методы SHALL получать `405` с CORS-заголовками.

#### Scenario: POST через прокси

- **WHEN** разрешённая страница отправляет `POST /https/example.com/login` с телом
- **THEN** ответ `405`, к `example.com` запрос не уходит

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

### Requirement: Ключ Tracestrack

Для растровых тайлов Tracestrack Topo (`/https/tile.tracestrack.com/topo_<язык>/<z>/<x>/<y>.webp` и `…@2x.webp`, где `<язык>` — язык из списка Tracestrack или `_`, только https на стандартный порт) прокси SHALL отбрасывать запрос клиента после пути и запрашивать тайл с единственным параметром `key` из секрета `TRACESTRACK_KEY`. Без секрета прокси SHALL отвечать `503` с CORS-заголовками, не обращаясь к Tracestrack. На другие адреса ключ SHALL NOT уходить.

#### Scenario: Тайл Tracestrack

- **WHEN** разрешённая страница запрашивает `/https/tile.tracestrack.com/topo_en/10/618/377.webp`, `…/topo_ru/…` или `…/topo__/…`
- **THEN** прокси запрашивает тот же тайл у `https://tile.tracestrack.com/` с `?key=<секрет>` и возвращает его

#### Scenario: Ключ клиента не проходит

- **WHEN** запрошен `/https/tile.tracestrack.com/topo_en/10/618/377.webp?key=other&x=1`
- **THEN** к Tracestrack уходит только `key` из секрета

#### Scenario: Ключ не задан

- **WHEN** секрета `TRACESTRACK_KEY` нет и запрошен тайл Tracestrack Topo
- **THEN** ответ `503` с `Access-Control-Allow-Origin` разрешённой страницы, запроса к Tracestrack нет

#### Scenario: Другой адрес Tracestrack

- **WHEN** запрошен `/https/tile.tracestrack.com/topo_ru/10/618/377.png`, `…/topo_ka/10/618/377.webp` (языка нет у Tracestrack), `/https/api.tracestrack.com/…`, `/http/tile.tracestrack.com/topo__/…` или адрес с другим портом
- **THEN** запрос уходит без ключа из секрета

### Requirement: Ключ Tracestrack не уходит клиенту

Ответ на тайл Tracestrack Topo SHALL NOT содержать ключ: заголовки ответа SHALL проходить по белому списку (`Content-Type`, `Cache-Control`, `ETag`, `Last-Modified`, `Expires`), `Location` — без параметра `key`, а тело ответа не `2xx` SHALL заменяться на `Tracestrack error <статус>`.

#### Scenario: Редирект Tracestrack

- **WHEN** Tracestrack отвечает на тайл редиректом, в `Location` которого есть ключ
- **THEN** клиент получает `Location` через прокси без параметра `key`

#### Scenario: Отказ Tracestrack

- **WHEN** Tracestrack отвечает на тайл `403` с ключом в теле или заголовках
- **THEN** клиент получает `403` с телом `Tracestrack error 403` и без ключа в заголовках

### Requirement: Кеш тайлов Tracestrack

Если Tracestrack отдал тайл `200` без `Cache-Control`, прокси SHALL ставить `Cache-Control: public, max-age=86400`, чтобы повторный заход браузера не тратил квоту. Свой `Cache-Control` Tracestrack SHALL проходить как есть.

#### Scenario: Кеш тайла

- **WHEN** Tracestrack отдаёт тайл `200` без `Cache-Control`
- **THEN** клиент получает `Cache-Control: public, max-age=86400`
