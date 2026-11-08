## MODIFIED Requirements

### Requirement: Строка поиска

Верхняя строка SHALL показывать строку поиска с подсказкой `Search`; подсказка при наведении SHALL перечислять названия, координаты, ссылки на карты и треки. Поиск SHALL начинаться с 3 символов; короче — `Type at least 3 characters`. Alt+L SHALL ставить курсор в строку (пока линия редактируется или ставятся точки трека, строка занята их панелью), Escape — убирать результаты и возвращать фокус карте. Пустая строка в фокусе SHALL показывать источники ссылок.

#### Scenario: Короткий запрос

- **WHEN** пользователь вводит в строку поиска `ab`
- **THEN** запросов к поисковым сервисам нет, видна подсказка про 3 символа

#### Scenario: Горячая клавиша

- **WHEN** фокус на карте, и пользователь нажимает Alt+L
- **THEN** курсор стоит в строке поиска

#### Scenario: Подсказка в пустой строке

- **WHEN** пользователь ставит курсор в пустую строку поиска
- **THEN** под строкой видна подсказка с источниками ссылок на треки; после ввода текста её нет

## ADDED Requirements

### Requirement: Search panel on a narrow screen

The panel under the search bar (the hint, the results, the messages) SHALL end at the right edge of the route zone and SHALL NOT cover the column of the map buttons on the right.

#### Scenario: Hint on a phone

- **WHEN** the screen is 360 px wide, and the user puts the cursor into the empty search bar
- **THEN** the hint panel is to the left of the quick layer buttons, and all buttons of the column are visible
