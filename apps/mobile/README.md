# Openbook mobile (Expo)

Native shell over the Openbook web client. Same Convex API. This package is
**outside** the root pnpm workspace so `pnpm typecheck` does not require Expo.
The shell accepts only same-origin navigation. It sends external HTTP, HTTPS,
email, and telephone links to the operating system.

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_OPENBOOK_URL=http://127.0.0.1:5173 npx expo start
```

On a device, point `EXPO_PUBLIC_OPENBOOK_URL` at a machine-reachable origin
(not localhost). The URL must use HTTP or HTTPS.

Run the supported-SDK and native-bundle checks before a release:

```bash
npx expo-doctor
EXPO_PUBLIC_OPENBOOK_URL=https://openbook.example npx expo export --platform ios
EXPO_PUBLIC_OPENBOOK_URL=https://openbook.example npx expo export --platform android
```

App Store and Play binaries stay operator-gated (KEP-002).

## Dependency safety

The `uuid` 11.1.1 override replaces the vulnerable version used by Expo's
Xcode configuration parser. Expo 57.0.15 still pins an `image-size` release
with two denial-of-service advisories through Metro. No patched `image-size`
release exists. This parser is part of the local bundle toolchain; the shipped
app does not accept runtime input through Metro. The publication audit permits
only those exact advisories and fails when the time-bound exception expires.
