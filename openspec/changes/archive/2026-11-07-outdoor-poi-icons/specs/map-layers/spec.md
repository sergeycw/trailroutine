## MODIFIED Requirements

### Requirement: Подложка OpenFreeMap Outdoor

Подложка «OpenFreeMap Outdoor» (`Of` в `l=`) SHALL рисовать свой туристический векторный стиль по тайлам OpenFreeMap, запрашивая описание тайлов и тайлы напрямую у `tiles.openfreemap.org`, без шрифтов и значков с других адресов. Тропы и грунтовки SHALL отличаться от дорог, вершины и перевалы SHALL подписываться высотой в метрах. Подпись карты SHALL называть OpenFreeMap, OpenMapTiles и OpenStreetMap. С зума 14 SHALL быть значки хижин, приютов, кемпингов, воды и смотровых.

#### Scenario: Ссылка с OpenFreeMap Outdoor

- **WHEN** приложение открыто по адресу с `l=Of`
- **THEN** включена подложка «OpenFreeMap Outdoor», описание тайлов и тайлы запрошены у `tiles.openfreemap.org`, других внешних запросов ради подложки нет, тайлы Tracestrack Topo не запрашиваются, в адресе `l=Of`

#### Scenario: Атрибуция OpenFreeMap

- **WHEN** включена подложка «OpenFreeMap Outdoor»
- **THEN** в подписи карты — «OpenFreeMap © OpenMapTiles Data from OpenStreetMap» со ссылками на `https://openfreemap.org`, `https://www.openmaptiles.org/` и `https://www.openstreetmap.org/copyright`

#### Scenario: Вершина с высотой

- **WHEN** на карте с «OpenFreeMap Outdoor» видна вершина Казбек
- **THEN** под её названием — высота «5054 m»

#### Scenario: Значки мест для похода

- **WHEN** на подложке `Of` с зума 14 видны горная хижина, приют, кемпинг, питьевая вода и смотровая площадка из тайлов OpenFreeMap
- **THEN** у каждой свой значок, нарисованный приложением (без спрайта и запросов значков), а гостиницы, гостевые дома и магазины значков не получают
