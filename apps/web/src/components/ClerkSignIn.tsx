import { SignIn as ClerkSignInForm } from "@clerk/react";
import { BrandMark } from "./BrandMark";

export function ClerkSignIn() {
  return (
    <div className="ob-landing">
      <div className="ob-landing-brand">
        <div className="ob-landing-mark">
          <BrandMark size={64} alt="" />
          <h1>openbook</h1>
        </div>
        <p className="ob-landing-tagline">
          Connect with friends in realtime with a private, server-enforced social graph.
        </p>
      </div>
      <ClerkSignInForm routing="hash" />
    </div>
  );
}
