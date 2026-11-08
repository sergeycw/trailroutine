## MODIFIED Requirements

### Requirement: Каталог слоёв

Приложение SHALL предлагать слои старого клиента с теми же кодами, названиями и группами, кроме Яндекса (`Y`, `S`), Wikimapia (`W`), сетки советских топокарт (`Ng`) и Slazav (`Q`, `Z`), и SHALL добавлять оверлеи «Relief shading» (`Hs`) и «Contour lines» (`Ct`), подложку «Tracestrack Topo» (`Tt`, первой в группе `Default layers`), подложки «Sentinel-2 cloudless» (`S2`) и «Satellite by date» (`Hls`) сразу после «ESRI Satellite». Каждый показанный слой SHALL иметь свою атрибуцию в подписи карты.

#### Scenario: Список слоёв

- **WHEN** пользователь открывает настройку списка слоёв
- **THEN** в ней 29 слоёв по группам старого клиента — 34 слоя каталога без пяти кнопок столбца, первые — «Tracestrack Topo», «OpenStreetMap», «Sentinel-2 cloudless»; слоёв Яндекса, Slazav, Wikimapia и сетки советских топокарт нет

#### Scenario: Атрибуция слоя

- **WHEN** включён оверлей «Waymarked Hiking Trails» поверх OpenStreetMap
- **THEN** в подписи карты есть атрибуция обоих слоёв

#### Scenario: Атрибуция Tracestrack

- **WHEN** включена подложка «Tracestrack Topo»
- **THEN** в подписи карты — подпись из условий Tracestrack «Data: © OpenStreetMap contributors, SRTM, GEBCO, SONNY's LiDAR DTM, NASADEM, ESA WorldCover; Maps © Tracestrack», где «Maps © Tracestrack» — ссылка на `https://www.tracestrack.com/`, а «© OpenStreetMap contributors» — на `https://www.openstreetmap.org/copyright`
