## MODIFIED Requirements

### Requirement: Street View без ключа без режима разработки

Если Maps JavaScript API загружается с пустым ключом, окно Street View SHALL показывать панораму в нормальных цветах, без водяного знака «For development purposes only» и без окна «This page can't load Google Maps correctly». С непустым ключом окно SHALL отображаться так, как его рисует Google.

#### Scenario: Панорама без ключа

- **WHEN** пользователь клона без ключа Google открывает панораму Street View
- **THEN** панорама в нормальных цветах, водяного знака и окна Google не видно

#### Scenario: Панорама без ключа при блокировщике

- **WHEN** пользователь клона без ключа Google открывает панораму Street View, а блокировщик рекламы (список EasyPrivacy) отбрасывает запрос `QuotaService.RecordEvent`, и Google не инвертирует цвета панорамы
- **THEN** панорама в нормальных цветах

#### Scenario: Панорама с ключом

- **WHEN** сборка получила ключ из секрета `GOOGLE_MAPS_API_KEY`
- **THEN** правила режима без ключа не применяются
