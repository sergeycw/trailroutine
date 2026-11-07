# Spec Delta

## ADDED Requirements

### Requirement: Site on trailroutine.com

The Pages project SHALL serve the site on `https://trailroutine.com`. The app, the engine files and the BRouter tiles SHALL come from that origin as they come from `https://nakarte-routing.pages.dev`.

#### Scenario: Open the new domain

- **WHEN** a user opens `https://trailroutine.com/`
- **THEN** the app with the title `trailroutine` opens

#### Scenario: Engine files on the new domain

- **WHEN** `curl -r 0-0 https://trailroutine.com/brouter-wasm/lib/brouter.jar` runs
- **THEN** the response is `206` with `Content-Range`

### Requirement: Move from the old address

The app on `https://nakarte-routing.pages.dev` SHALL send the visitor to `https://trailroutine.com` with the same path, query and fragment. When the old address has saved tracks or settings, the app SHALL first put them into the track storage in encrypted form and add `move=<storage key>.<encryption key>` to the fragment. The server SHALL NOT receive the encryption key. The old address SHALL keep serving the site, without an edge redirect.

#### Scenario: Old address with saved tracks

- **WHEN** a user with saved tracks and layer settings opens `https://nakarte-routing.pages.dev/#m=12/41.7/44.8`
- **THEN** the user lands on `https://trailroutine.com/#m=12/41.7/44.8`, the track list has the same tracks, and the layer settings are the same

#### Scenario: Old address without saved data

- **WHEN** a user without saved tracks or settings opens `https://nakarte-routing.pages.dev/#m=12/41.7/44.8&nktl=KEY`
- **THEN** the user lands on `https://trailroutine.com/#m=12/41.7/44.8&nktl=KEY`, and no data goes to the track storage

#### Scenario: Track storage fails

- **WHEN** the track storage does not accept the moved data
- **THEN** the app opens on the old address as before, and the next visit tries the move again

#### Scenario: Second visit to the old address

- **WHEN** a user whose data was moved opens the old address again
- **THEN** the user lands on the new domain with the same `move` value, and the app does not store the data again

### Requirement: Import of moved data

On `https://trailroutine.com`, a fragment with `move` SHALL add the moved tracks after the saved tracks of the new domain before the app starts, and the app SHALL remove `move` from the address. The app SHALL copy a moved setting only when the page came from the old address and the new domain has no value for that setting. The app SHALL NOT import the same `move` value twice.

#### Scenario: Moved tracks appear once

- **WHEN** the new domain opens the same `move` value two times
- **THEN** the track list has the moved tracks one time

#### Scenario: Link from another site

- **WHEN** a page that is not the old address links to `https://trailroutine.com/#move=…`
- **THEN** the app adds the moved tracks and does not change the settings

#### Scenario: Import fails

- **WHEN** the moved data cannot be loaded or decrypted
- **THEN** the app starts with its own data and shows the toast `Could not move tracks from nakarte-routing.pages.dev`
