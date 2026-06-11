import { Password } from "@convex-dev/auth/providers/Password";
import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

// One auth surface for the whole suite. The same identity, sessions, and tokens
// are consumed identically by web, mobile, and desktop via @openbook/shared.
//
// Providers:
//   - Password: email + password (no external dependency).
//   - GitHub / Google: OAuth. Credentials come from the deployment env
//     (AUTH_GITHUB_ID/SECRET, AUTH_GOOGLE_ID/SECRET), set via `convex env set`;
//     @auth/core reads them by convention, so listing the provider is all that's
//     needed. The OAuth callback routes are added by auth.addHttpRoutes (http.ts).
//     A deployment with no OAuth env still works — password sign-in is unaffected.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, GitHub, Google],
});
