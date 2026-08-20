# Openbook mobile (Expo)

Native shell over the Openbook web client. Same Convex API. This package is
**outside** the root pnpm workspace so `pnpm typecheck` does not require Expo.

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_OPENBOOK_URL=http://127.0.0.1:5173 npx expo start
```

On a device, point `EXPO_PUBLIC_OPENBOOK_URL` at a machine-reachable origin
(not localhost). App Store / Play binaries stay operator-gated (KEP-002).
