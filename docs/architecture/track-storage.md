# Track storage: the `nktl=` link

One level up: [overview](README.md#overview), block ⑤.

A short link to tracks: the address has only a key, and the Worker `nakarte-tracks` ([workers/tracks](../../workers/tracks/)) keeps the tracks in R2. The contract repeats the author's `tracks.nakarte.me`: the body is the same `nktk` strings, and the key is the same hash. A key that is not in R2 comes from the author's storage: the Worker asks `tracks.nakarte.me` once, accepts the body only if its md5 is the key, and keeps a copy in R2. So `nktl=` links of nakarte.me open too, and the browser never asks the author ([import-nakarte-storage-links](../../openspec/changes/archive/2026-11-07-import-nakarte-storage-links/design.md)). Behavior: spec [track-storage](../../openspec/specs/track-storage/spec.md). Decisions: archive [add-track-storage](../../openspec/changes/archive/2026-10-07-add-track-storage/design.md); the client part: archive [add-web-tracks](../../openspec/changes/archive/2026-10-08-add-web-tracks/design.md).

## From "Copy link" to the opened link

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant APP as actions.ts, share.ts
    participant W as nakarte-tracks
    participant R2 as R2 nakarte-tracks
    actor V as Link recipient
    participant APP2 as app of the recipient

    U->>APP: Copy link
    APP->>APP: shareBody — nktk strings version 4 joined with «/»
    APP->>APP: key = base64url(md5(body)) without «=», 22 characters
    APP->>U: clipboard write started, the text is a promise of the link
    APP->>W: POST /track/{key}, body — nktk string, no credentials
    W->>W: Origin, rate (writes have a separate counter), key format, ≤ 2 MiB,<br/>link alphabet
    W->>W: trackKey(body) == key?
    W->>R2: head tracks/{key}
    alt no object
        W->>R2: put tracks/{key}, customMetadata.created
    end
    alt 200
        W-->>APP: 200
        APP->>U: address with #nktl=key in the clipboard, «Link copied»<br/>(clipboard not available — a window with the link)
    else 400, 403, 413, 429 or network
        W-->>APP: error
        APP->>U: «Error making link: …», no link
    end
    U-->>V: sends the link
    V->>APP2: opens the address with #nktl=key
    APP2->>APP2: sync.ts reads nktl and removes it from the address → loadTrackParam
    APP2->>W: GET /track/{key}, no credentials
    W->>R2: get tracks/{key}
    R2-->>W: nktk string
    W-->>APP2: 200 text/plain, Cache-Control immutable for one year
    APP2->>APP2: parseNktkSequence → tracks on the map<br/>(any response other than 200 — a track with the error NETWORK)
```

- The link goes to the clipboard only after a `200` from the storage. The app gives the clipboard a promise of the text. If the `POST` fails, the user has no link but gets a notice. Why: archive add-web-tracks, ["The link comes after the storage response"](../../openspec/changes/archive/2026-10-08-add-web-tracks/design.md#ссылка--после-ответа-хранилища).
- The key is a hash of the content, so the object does not change, and a second write is not necessary. The Worker calculates the key with the same `blueimp-md5` as the client ([key.js](../../workers/tracks/src/key.js), `trackKey` in [share.ts](../../web/src/tracks/share.ts)).
- The route markup goes into the link as an optional segment field in the `nktk` string version 4 (schema: [nktk.proto](../../web/src/tracks/nktk.proto), [route-editor.md](route-editor.md)). The Worker does not parse the body. The app reads all `nktk` versions from 1 to 4 ([nktk.ts](../../web/src/tracks/nktk.ts)): the links that users already have and the storage objects depend on them.
- The link address is the current app address without the search (`q`, `r`) and without the track parameters; `nktl` takes their place (`shareLink`).
- The `nktl=` links that users already have depend on this storage. This is important when the Workers get new names: [backlog, "Global direction"](../../openspec/backlog.md#глобальное-направление-полная-автономия).

## Checked against

[web/src/tracks/share.ts](../../web/src/tracks/share.ts) (`shareBody`, `trackKey`, `shareLink`, `storeTracks`), [web/src/tracks/actions.ts](../../web/src/tracks/actions.ts) (`copyLink`), [web/src/tracks/links.ts](../../web/src/tracks/links.ts) (`fromStorage`, `loadTrackParam`), [web/src/tracks/nktk.ts](../../web/src/tracks/nktk.ts) (`saveNktk`, `parseNktkSequence`), [web/src/state/sync.ts](../../web/src/state/sync.ts), [workers/tracks/src/index.js](../../workers/tracks/src/index.js), [workers/tracks/src/key.js](../../workers/tracks/src/key.js), [workers/tracks/wrangler.toml](../../workers/tracks/wrangler.toml).
