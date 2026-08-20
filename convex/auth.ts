import { Password } from "@convex-dev/auth/providers/Password";
import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

// Password sign-in is the product surface. GitHub and Google stay in the
// provider list so an operator can set AUTH_GITHUB_* / AUTH_GOOGLE_* without a
// code change; they are not shown in the web UI until that work is done.
//
// A deployment with no OAuth env still works — password sign-in is unaffected.
// OAuth callback routes are added by auth.addHttpRoutes (http.ts).
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, GitHub, Google],
});
