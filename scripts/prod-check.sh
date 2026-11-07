#!/bin/sh
# Синтетическая проверка своих сервисов клона на проде: приложение на /, редирект /next/, файлы движка, тайл BRouter,
# API высот, хранилище треков, CORS-прокси. Только чтение, без сети к чужим сайтам:
# прокси проверяется preflight'ом, хранилище треков — чтением несуществующего ключа (404 из R2).
# Запускают workflow «prod check» (раз в день и после деплоя) и человек: sh scripts/prod-check.sh
set -u

SITE=${SITE:-https://trailroutine.com}
# the old address serves the same build until the Bulk Redirect (change move-to-trailroutine-domain): the move of
# user data to SITE runs in the page, so the server still answers the app here
OLD_SITE=${OLD_SITE:-https://nakarte-routing.pages.dev}
ELEVATION=${ELEVATION:-https://nakarte-elevation.nakarte-routing.workers.dev}
TRACKS=${TRACKS:-https://nakarte-tracks.nakarte-routing.workers.dev}
PROXY=${PROXY:-https://nakarte-cors-proxy.nakarte-routing.workers.dev}
# Тбилиси: тестовый район из AGENTS.md
POINT='41.687 44.776'

failed=0
headers=$(mktemp)
body=$(mktemp)
trap 'rm -f "$headers" "$body"' EXIT

# fetch <curl args...>: статус в stdout, заголовки и тело — во временные файлы
fetch() {
    curl -sS --retry 2 --retry-all-errors --max-time 30 -D "$headers" -o "$body" -w '%{http_code}' "$@"
}

header() {
    grep -i "^$1:" "$headers" | head -1 | cut -d' ' -f2- | tr -d '\r'
}

report() {
    if [ "$2" = ok ]; then
        echo "ok    $1"
    else
        echo "FAIL  $1: $2"
        failed=1
    fi
}

check_range() {
    status=$(fetch -r 0-0 "$2")
    if [ "$status" = 206 ] && [ -n "$(header content-range)" ]; then report "$1" ok; else report "$1" "status $status"; fi
}

# приложение web/ (openspec/specs/web-client): заголовок из web/index.html. Одного статуса мало — Pages отвечают 200 и
# на пути без файла (корневым index.html)
check_site() {
    status=$(fetch "$2/")
    if [ "$status" = 200 ] && grep -q '<title>trailroutine</title>' "$body"; then
        report "$1" ok
    else
        report "$1" "status $status, title $(grep -o '<title>[^<]*' "$body" | head -1 | cut -c8-)"
    fi
}
check_site 'site' "$SITE"
check_site 'old site' "$OLD_SITE"

# старый адрес приложения: /next/ — редирект на / (web/public/_redirects); curl без -L смотрит сам ответ
status=$(fetch "$SITE/next/")
location=$(header location)
if [ "${status#3}" != "$status" ] && { [ "$location" = / ] || [ "$location" = "$SITE/" ]; }; then
    report 'site next redirect' ok
else
    report 'site next redirect' "status $status, location ${location:-none}"
fi

check_range 'engine jar' "$SITE/brouter-wasm/lib/brouter.jar"
check_range 'engine lookups.dat' "$SITE/brouter-wasm/profiles/lookups.dat"
check_range 'brouter tile' "$SITE/tiles/E40_N40.rd5"

status=$(fetch -H "Origin: $SITE" --data-binary "$POINT
" "$ELEVATION/")
if [ "$status" = 200 ] && grep -qE '^-?[0-9]+\.[0-9]{2}$' "$body"; then
    report 'elevation api' ok
else
    report 'elevation api' "status $status, body $(head -c 80 "$body")"
fi

status=$(fetch -H "Origin: $SITE" "$TRACKS/track/AAAAAAAAAAAAAAAAAAAAAA")
if [ "$status" = 404 ] && grep -q 'Track not found' "$body"; then report 'tracks' ok; else report 'tracks' "status $status"; fi

status=$(fetch -X OPTIONS -H "Origin: $SITE" -H 'Access-Control-Request-Method: GET' "$PROXY/https/example.com/")
if [ "$status" = 204 ] && [ "$(header access-control-allow-origin)" = "$SITE" ]; then
    report 'cors proxy' ok
else
    report 'cors proxy' "status $status"
fi

exit "$failed"
