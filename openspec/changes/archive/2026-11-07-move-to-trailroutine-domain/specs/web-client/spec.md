# Spec Delta

## MODIFIED Requirements

### Requirement: Приложение на основном адресе

Приложение SHALL открываться по `https://trailroutine.com/`: страница, скрипты и стили — от корня сайта. Старый адрес `https://nakarte-routing.pages.dev/` SHALL переводить людей туда (требование «Move from the old address» спеки `clone-hosting`). Стенд замеров движка SHALL открываться по `/engine-bench.html`. Pages Functions (`/tiles/`, `/brouter-wasm/`) и Worker'ы от переключения SHALL NOT меняться.

#### Scenario: Открыть приложение

- **WHEN** пользователь открывает `https://trailroutine.com/`
- **THEN** загружается приложение с заголовком `trailroutine`, его скрипты и стили берутся от корня сайта, а не из `/next/`

#### Scenario: Стенд движка

- **WHEN** открыт `/engine-bench.html`
- **THEN** загружается стенд замеров движка
