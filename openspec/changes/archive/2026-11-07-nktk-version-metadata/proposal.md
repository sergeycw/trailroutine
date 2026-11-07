# Proposal

## Why

The objects of `nakarte-tracks` have the write time in `customMetadata.created` (change `limit-track-writes`), but not the version of their `nktk` strings (backlog «Мелочи хранилищ», Things to-do «Store the nktk version in track object metadata»). A future migration of the format would have to read every body to find the old ones.

## What Changes

- A new object gets `customMetadata.nktk`: the `nktk` versions of the strings of its body, sorted and joined with commas (for example `4` or `3,4`). This includes the copies from the storage of nakarte.me.
- The Worker reads the version from the first byte of each string (the first packed number, as `web/src/tracks/nktk.ts` reads it); it does not parse the tracks.
- Objects stored before this change keep their metadata.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `track-storage`: «Время записи» gets the versions.

## Impact

`workers/tracks/src/index.js` and its tests.
