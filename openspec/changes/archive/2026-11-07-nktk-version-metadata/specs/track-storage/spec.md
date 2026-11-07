## MODIFIED Requirements

### Requirement: Время записи

Новый объект SHALL сохраняться с `customMetadata.created` — временем записи в ISO 8601 (UTC) — и `customMetadata.nktk` — версиями строк `nktk` тела через запятую по возрастанию, чтобы объекты за окно времени и старого формата находились листингом без чтения тел.

#### Scenario: Новый трек

- **WHEN** трек сохранён
- **THEN** у объекта `tracks/{key}` есть `customMetadata.created`

#### Scenario: Версии nktk в метаданных

- **WHEN** сохранено тело из строк `nktk` версий 4 и 3
- **THEN** у объекта `customMetadata.nktk` равно `3,4`
