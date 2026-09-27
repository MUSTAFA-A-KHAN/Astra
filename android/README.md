# Astra for Android

The game as an installable Android app. The static site `npm run build` writes to
`_site/` is bundled into the APK and played in a full-screen WebView. It's served from
`https://appassets.androidplatform.net/`, so modules, `fetch()` and localStorage
saves behave as they do on the web.

## Build

Needs Node, JDK 17+ and the Android SDK with platform 36 (`ANDROID_HOME` set).

```sh
npm run android          # → dist/astra-<version>.apk
```

This builds the site, then runs `gradlew assembleRelease` here. The first run
downloads Gradle and the Android plugin.

## Install

```sh
adb install -r dist/astra-1.0.0.apk
```

Or copy the APK to the phone and open it, allowing installs from that source when
asked. It needs Android 8 or newer with OpenGL ES 3, and the world takes about a
gigabyte of memory to run.

## Signing key

Release builds are signed with `astra-release.jks`, and its passwords are in
`keystore.properties`. Both are gitignored, so **back them up**: an installed copy
only accepts updates signed with the same key. Without them, builds are signed with
the debug key instead. Those still install, but can't update a release-signed copy.

The version comes from `package.json` (`versionCode` = major·10000 + minor·100 +
patch). Android won't install an update with a lower version over a higher one.

## What the app adds to the web game

- **Back** acts as Escape: it closes a dialog, skips a conversation or pauses. From
  the lobby, it sends the app to the background.
- Immersive full screen that keeps the screen on, with the game kept clear of the
  camera cutout.
- Rotation follows the device without reloading the world.
- If the system reclaims the renderer's memory, the game restarts from its save
  instead of crashing.
- It works offline apart from the two guest heroes, Soldier and Female-Soldier,
  which stream from the web, and the Google Fonts, which fall back to system fonts.
