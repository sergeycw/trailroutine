# routing Specification

## Purpose

Прокладка отрезка трека между двумя опорными точками по дорогам и тропам через BRouter с учётом выбранной активности (пешком, на разных типах велосипеда).

## Requirements

### Requirement: Меню активностей

Список треков SHALL показывать кнопку прокладки, которая открывает меню: «Off: straight lines» и шесть активностей — Hiking, Hiking, prefer trails, Road bike, Gravel bike, Mountain bike, Touring bike. Выбранный пункт отмечен галочкой, при выбранной активности кнопка активна.

#### Scenario: Выбор активности

- **WHEN** пользователь открывает меню прокладки и выбирает «Gravel bike»
- **THEN** пункт «Gravel bike» отмечен галочкой
- **AND** подсказка кнопки — «Routing: Gravel bike»

#### Scenario: Прокладка выключена

- **WHEN** пользователь выбирает «Off: straight lines»
- **THEN** новые отрезки рисуются прямыми
- **AND** подсказка кнопки — «Routing is off: lines are straight»

### Requirement: Выбор активности сохраняется

Выбранная активность SHALL сохраняться в localStorage браузера и восстанавливаться после перезагрузки страницы. Выбор «Off» SHALL удалять сохранённое значение. Новое приложение SHALL хранить выбор под своим ключом и, пока своего выбора нет, SHALL брать активность, сохранённую старым клиентом.

#### Scenario: Перезагрузка страницы

- **WHEN** выбрана активность «Mountain bike» и страница перезагружена
- **THEN** в меню отмечена «Mountain bike»

#### Scenario: Неизвестная сохранённая активность

- **WHEN** в localStorage лежит идентификатор активности, которой нет в списке
- **THEN** прокладка выключена

#### Scenario: Выбор из старого клиента

- **WHEN** новое приложение открыто впервые, а старый клиент сохранил активность «Gravel bike»
- **THEN** в меню отмечена «Gravel bike»

### Requirement: Активность задаёт профиль BRouter

Каждая активность SHALL соответствовать профилю BRouter и, при необходимости, переопределениям переменных профиля: Hiking — `hiking-mountain`; Hiking, prefer trails — `hiking-mountain` с `path_preference=20`; Road bike — `fastbike`; Gravel bike — `gravel`; Mountain bike — `mtb`; Touring bike — `trekking`. Запрос SHALL брать основной маршрут (без альтернатив).

#### Scenario: Пешком по тропам

- **WHEN** отрезок прокладывается с активностью «Hiking, prefer trails»
- **THEN** BRouter получает профиль `hiking-mountain` и переопределение `profile:path_preference=20`

### Requirement: Форма полученного отрезка

Геометрия маршрута SHALL упрощаться с допуском около 2.4 м (как при импорте GPX). Крайние точки маршрута, лежащие ближе 20 м к своим опорным точкам, SHALL отбрасываться, чтобы опорная точка соединялась с маршрутом без хвостика.

#### Scenario: Опорная точка у дороги

- **WHEN** опорная точка стоит в 5 м от дороги
- **THEN** ближайшая к ней точка маршрута отброшена, линия идёт прямо от опорной точки к следующей точке маршрута

#### Scenario: Опорная точка далеко от дороги

- **WHEN** опорная точка стоит в 200 м от ближайшей дороги
- **THEN** от неё до дороги остаётся прямой отрезок

### Requirement: Ошибка прокладки даёт прямой отрезок

Если маршрут не построен (ошибка роутера, пустой маршрут, нет данных района), отрезок SHALL остаться прямым и SHALL быть помечен на карте как непроложенный, а пользователь SHALL увидеть уведомление-тост «Routing failed: <причина>». Если для района нет тайлов, причина SHALL быть «no routing data for this area» вместо имени файла тайла. Непроложенный отрезок SHALL помнить свою активность: перетаскивание его опорной точки прокладывает его заново.

#### Scenario: Нет маршрута

- **WHEN** BRouter возвращает ошибку для пары точек
- **THEN** между опорными точками рисуется прямая, помеченная как непроложенная
- **AND** показывается уведомление с текстом ошибки

#### Scenario: Район без данных

- **WHEN** точки стоят в районе, для которого нет тайла (BRouter отвечает «datafile E30_N55.rd5 not found»)
- **THEN** между опорными точками рисуется помеченная прямая
- **AND** уведомление — «Routing failed: no routing data for this area»

#### Scenario: Повтор после ошибки

- **WHEN** отрезок A–B не проложен, а пользователь перетащил B
- **THEN** A–B прокладывается заново со своей активностью и при успехе перестаёт быть помеченным

### Requirement: Недоступный роутер

Если роутер недоступен (сервер не отвечает или движок в браузере не запустился), кнопка прокладки SHALL краснеть, отрезки SHALL оставаться прямыми и помеченными как непроложенные, а предупреждение SHALL показываться один раз на каждый переход «работал → упал». Доступность SHALL перепроверяться при открытии меню прокладки.

#### Scenario: Сервер остановлен во время работы

- **WHEN** серверный BRouter остановлен и пользователь ставит две опорные точки подряд
- **THEN** оба отрезка прямые и помечены как непроложенные
- **AND** предупреждение показано один раз, кнопка красная

#### Scenario: Роутер снова доступен

- **WHEN** роутер поднят и следующий отрезок построен успешно
- **THEN** кнопка перестаёт быть красной

### Requirement: Доступность и подсказка по движку

Кнопка прокладки SHALL показываться, если движку есть где считать: движку в браузере сервер не нужен, серверному нужен `routingServer`. Подсказка о недоступном роутере SHALL говорить, что делать, для своего движка: в серверном режиме — запустить BRouter командой `docker compose up -d`, в браузере — перезагрузить страницу.

#### Scenario: Клон без сервера-роутера

- **WHEN** `routingEngine` равен `'browser'`, а `routingServer` пустой
- **THEN** кнопка прокладки показывается

#### Scenario: Движок в браузере не запустился

- **WHEN** `routingEngine` равен `'browser'` и движок не запустился
- **THEN** отрезок прямой, кнопка красная
- **AND** подсказка предлагает перезагрузить страницу и не упоминает `docker compose`

#### Scenario: Серверный BRouter не запущен

- **WHEN** `routingEngine` равен `'server'`, а BRouter не отвечает
- **THEN** подсказка — `BRouter is not running, start it with docker compose up -d`

### Requirement: Движок загружается на кнопке прокладки

Пока движок в браузере запускается после выбора активности, кнопка прокладки SHALL показывать состояние загрузки, а её подсказка SHALL говорить, что движок загружается. Когда движок готов, состояние загрузки SHALL исчезать.

#### Scenario: Движок загружается

- **WHEN** пользователь выбрал «Hiking», а движок ещё не запустился
- **THEN** на кнопке прокладки индикатор загрузки, подсказка — «Routing: Hiking. BRouter engine is loading»

#### Scenario: Движок готов

- **WHEN** движок запустился
- **THEN** индикатора нет, подсказка — «Routing: Hiking»

### Requirement: Hiking options

For an activity with the profile `hiking-mountain`, the routing menu SHALL show a group «Hiking»: «Max difficulty» with SAC T1–T6 (default T3), «Avoid climbs» (default off) and «Allow steps» (default on). A changed option SHALL go into the BRouter query of the next routed legs as `profile:SAC_scale_limit`, `profile:consider_elevation` or `profile:allow_steps`; a default value SHALL NOT be sent. The options SHALL stay after a reload.

#### Scenario: Option applies to the next leg

- **WHEN** the activity is Hiking, the user turns on «Avoid climbs», turns off «Allow steps», chooses T5, and draws a new leg
- **THEN** the request of the leg has `profile:SAC_scale_limit=5`, `profile:consider_elevation=1` and `profile:allow_steps=0`, and the options are in `localStorage`

#### Scenario: Options only for hiking

- **WHEN** the activity is Gravel bike and the user opens the routing menu
- **THEN** the menu has no group «Hiking»
