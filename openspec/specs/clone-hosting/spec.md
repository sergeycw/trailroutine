# clone-hosting Specification

## Purpose

Публичный сайт trailroutine на Cloudflare (`trailroutine.com`; старый адрес `nakarte-routing.pages.dev` переводит туда людей вместе с данными браузера): сборка под клон, раздача тайлов BRouter и файлов движка с того же origin, свои сервисы вместо инфраструктуры автора `*.nakarte.me`.

## Requirements

### Requirement: Тайлы BRouter на том же origin

Клон SHALL отдавать тайлы `.rd5` по `/tiles/<имя>.rd5` из бакета R2 `nakarte-tiles`. Ответ SHALL поддерживать `HEAD` и Range-запросы: `206` с `Content-Range` на корректный диапазон, `416` на некорректный, `404` на отсутствующий тайл. Тайлы SHALL отдаваться с `Cache-Control: no-store` (синхронизация перезаписывает их под теми же ключами). Ключи бакета, которые не являются тайлами, SHALL получать `404`.

#### Scenario: Range-запрос

- **WHEN** клиент запрашивает `/tiles/E40_N40.rd5` с `Range: bytes=0-0`
- **THEN** ответ `206` с `Content-Range: bytes 0-0/<размер>` и `Cache-Control: no-store`

#### Scenario: Тайла нет в бакете

- **WHEN** маршрут прокладывается в районе, тайла которого нет в бакете
- **THEN** запрос тайла получает `404`, отрезок остаётся прямым с уведомлением об ошибке

#### Scenario: Служебный файл синхронизации

- **WHEN** клиент запрашивает `/tiles/manifest.json`
- **THEN** ответ `404`, хотя объект есть в бакете

### Requirement: Пустой storageconfig.txt

По `/tiles/storageconfig.txt` клон SHALL отдавать пустой файл со статусом `200`: движок читает его на каждый маршрут.

#### Scenario: Запрос storageconfig.txt

- **WHEN** движок запрашивает `/tiles/storageconfig.txt`
- **THEN** ответ `200` с пустым телом

### Requirement: Range для файлов движка

Файлы движка (`/brouter-wasm/*`: jar и профили) SHALL отдаваться с поддержкой Range: `206` и `Content-Range` на диапазон, `416` на диапазон за концом файла, полный файл без заголовка `Range`.

#### Scenario: Проверка Range

- **WHEN** выполняется `curl -r 0-0 https://nakarte-routing.pages.dev/brouter-wasm/lib/brouter.jar`
- **THEN** ответ `206` с заголовком `Content-Range`

### Requirement: Покрытие тайлами всего мира

Бакет тайлов клона SHALL содержать все тайлы из индекса `https://brouter.de/brouter/segments4/`, чтобы маршрут строился везде, где его строит brouter.de.

#### Scenario: Маршрут вне Грузии

- **WHEN** на `https://nakarte-routing.pages.dev` с активностью «Hiking» ставятся две точки в Альпах (тайл `E5_N45`)
- **THEN** отрезок прокладывается по тропам, а не остаётся прямым

#### Scenario: Сверка с индексом

- **WHEN** список тайлов индекса brouter.de сравнивается с ключами `*.rd5` в бакете
- **THEN** каждый тайл индекса есть в бакете с тем же размером

### Requirement: Своё хранилище треков

Клон SHALL сохранять и открывать ссылки `nktl=` через своё хранилище треков (capability `track-storage`), а не через `tracks.nakarte.me`.

#### Scenario: Copy link в клоне

- **WHEN** пользователь клона нажимает «Copy link» и открывает ссылку
- **THEN** запросы `POST` и `GET /track/{key}` уходят на Worker клона, а не на `tracks.nakarte.me`

### Requirement: Свой сервис высот

Клон SHALL получать высоты для профиля и экспорта от своего сервиса высот (capability `elevation-api`), а не от `elevation.nakarte.me`.

#### Scenario: Профиль высот в клоне

- **WHEN** пользователь клона открывает профиль высот трека
- **THEN** запрос высот уходит на сервис клона, запросов к `elevation.nakarte.me` нет

### Requirement: Атрибуция данных высот

Клон SHALL показывать атрибуцию данных высот, которой требуют условия viewfinderpanoramas.org: упоминание «Elevation data: viewfinderpanoramas.org (Jonathan de Ferranti)» со ссылкой на страницу источника `https://viewfinderpanoramas.org/dem3.html`.

#### Scenario: Атрибуция в интерфейсе

- **WHEN** пользователь клона открывает профиль высот
- **THEN** атрибуция viewfinderpanoramas со ссылкой видна

### Requirement: Street View без ключа без режима разработки

Если Maps JavaScript API загружается с пустым ключом, окно Street View SHALL показывать панораму в нормальных цветах, без водяного знака «For development purposes only» и без окна «This page can't load Google Maps correctly». С непустым ключом окно SHALL отображаться так, как его рисует Google.

#### Scenario: Панорама без ключа

- **WHEN** пользователь клона без ключа Google открывает панораму Street View
- **THEN** панорама в нормальных цветах, водяного знака и окна Google не видно

#### Scenario: Панорама с ключом

- **WHEN** сборка получила ключ из секрета `GOOGLE_MAPS_API_KEY`
- **THEN** правила режима без ключа не применяются

### Requirement: Без слоёв на данных автора

Приложение SHALL не содержать слоёв, данные которых лежат только у автора: 17 слоёв сканов карт на тайлах `tiles.nakarte.me` (коды T, D, N, A, J, C, F, B, K, U, R, E25m, NT1, NT5, T25, MN25, Pur), «Mountain passes (Westra)» (`Wp`) и «geocaching.su» (`Gc`). Их нет ни в одной сборке и ни в выборе слоёв.

#### Scenario: Выбор слоёв

- **WHEN** пользователь открывает выбор слоёв
- **THEN** в нём нет «Soviet topo maps (AtloMaps)», «Topo 10km», «GGC 500m», «Mountain passes (Westra)», «geocaching.su» и остальных слоёв из списка, запросов к `tiles.nakarte.me`, `nakarte.me/westraPasses/` и `nakarte.me/geocachingSu/` нет

### Requirement: Старые коды удалённых слоёв

Код удалённого слоя в адресе (`l=`) или в сохранённых настройках слоёв (`leafletLayersSettings` в `localStorage`) SHALL не ломать загрузку карты и ничего не включать.

#### Scenario: Ссылка с удалённым слоем

- **WHEN** приложение открыто по адресу с `l=O/F` или `l=O/Wp`
- **THEN** карта открывается со слоем OpenStreetMap без ошибок, удалённый слой не включён

#### Scenario: Ссылка только с удалённым слоем

- **WHEN** приложение открыто по адресу с `l=F`
- **THEN** карта открывается без ошибок со слоем по умолчанию

#### Scenario: Сохранённые настройки со старыми кодами

- **WHEN** в `leafletLayersSettings` записаны настройки слоёв `T`, `F` и `Wp`
- **THEN** карта загружается без ошибок, остальные настройки применяются, записи удалённых слоёв при следующем сохранении пропадают

### Requirement: Без слоёв mapy.cz

Приложение SHALL не содержать слоёв «mapy.cz tourist (Out of order)» (`Czt`) и «mapy.cz winter (Out of order)» (`Czw`): они шли через `proxy.nakarte.me/mapy/`, своего ключа mapy.cz нет. Поиск mapy.cz SHALL оставаться.

#### Scenario: Выбор слоёв

- **WHEN** пользователь открывает выбор слоёв
- **THEN** слоёв mapy.cz в нём нет, запросов к `proxy.nakarte.me/mapy/` нет

### Requirement: Без запросов к инфраструктуре автора

Приложение SHALL не делать сетевых запросов к `nakarte.me` и его поддоменам при работе всех функций: слои, панорамы, поиск, треки, ссылки, высоты. Адреса `nakarte.me` в разборе ссылок (импорт и поиск по ссылкам nakarte.me) запросами не являются и допустимы.

#### Scenario: Сквозная проверка

- **WHEN** по очереди включаются все слои, открывается панорама Street View, строится трек с профилем высот, делается «Copy link» и открывается ссылка nakarte.me
- **THEN** в журнале сетевых запросов нет ни одного адреса `*.nakarte.me`
