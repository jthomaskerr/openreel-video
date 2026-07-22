# OpenReel Resolve Bridge

The bridge is a per-user macOS URL-handler app. It redeems an opaque one-use OpenReel token from the loopback backend, opens DaVinci Resolve Project Manager, creates one new project, and invokes the installed internal Python importer.

## Build and verify

```sh
./apps/resolve-bridge/scripts/build-app.sh
```

The verified bundle is written to `apps/resolve-bridge/.artifacts/OpenReel Bridge.app`. Build products and app bundles are ignored by Git.

## Install

```sh
./apps/resolve-bridge/scripts/install.sh
```

This installs the app to `~/Applications/OpenReel Bridge.app` and the importer to Resolve's per-user `Fusion/Scripts/Utility/OpenReel Bridge.py`. It never uses `sudo`. Re-running the installer replaces only those two verified destinations.

Grant Accessibility access to OpenReel Bridge when macOS prompts. The app accepts only canonical `openreel-resolve://import/{uuid}` URLs and sends backend requests only to loopback.
