# Production launch checklist

Create one private copy of this checklist for each environment and release.
Attach a dated receipt to every checked item. A configuration statement without
a test is not evidence.

## Ownership and policy

- [ ] A named service owner and backup operator accepted on-call duties.
- [ ] The launch countries, minimum user age, privacy notice, and terms received
      the needed review.
- [ ] The abuse contact, moderation policy, and data-retention policy received
      the needed review.
- [ ] The incident channel, private evidence store, status communication path,
      and provider escalation contacts exist.
- [ ] The operator selected `launch` or `scale` and recorded the expected
      traffic, data size, and cost ceiling.

## Identity and domains

- [ ] A production Clerk instance uses `pk_live_` and `sk_live_` keys.
- [ ] The Clerk Frontend API custom domain is active and matches
      `CLERK_JWT_ISSUER_DOMAIN` exactly.
- [ ] The Clerk `convex` JWT template, allowed origins, redirect URLs, email
      verification, recovery, and MFA policy are tested.
- [ ] Operator accounts require MFA and recovery codes are held securely.
- [ ] Sign-up, sign-in, token refresh, sign-out, and recovery pass in a new
      browser profile at the production origin.
- [ ] Account erasure passes in a new browser profile at the production origin.
- [ ] Cloudflare custom domain, DNS, TLS, HTTPS redirect, and certificate
      renewal are active.

## Backend and providers

- [ ] The Convex production deployment and plan are named in the receipt.
- [ ] Current provider documentation or support evidence proves the required
      realtime session limit for the selected profile.
- [ ] Resend uses a verified production sender. Delivery, bounce, and complaint
      handling are tested.
- [ ] At least one tested `OPERATOR_USER_IDS` value can review a report.
- [ ] Billing is explicitly `disabled`, or live Stripe checkout, portal, and
      signature verification are tested.
- [ ] If billing is live, duplicate events, out-of-order events, refunds, and
      account cancellation are tested.
- [ ] Web Push is explicitly `disabled`, or VAPID keys, permission flow, and
      delivery are tested.
- [ ] If Web Push is enabled, expired subscription cleanup and account erasure
      are tested.
- [ ] Applicable Clerk, Resend, Stripe, and Web Push calls use the durable
      delivery model.

## Security

- [ ] Production secrets are unique, at least the required length, and held in
      approved secret stores.
- [ ] No test key, local origin, development login, or wildcard origin is in the
      production build.
- [ ] No source map with private source is in the production build.
- [ ] CSP was rendered with the exact Clerk and Convex origins and has no
      wildcard Convex deployment. A real-browser check shows no unexpected CSP
      violation.
- [ ] HSTS, CSP, permissions, referrer, type, and frame headers pass the strict
      probe.
- [ ] Convex, Clerk, Cloudflare, Resend, Stripe, and repository access follow
      least privilege. Former operators have no access.
- [ ] Rate limits and provider abuse controls were tested with rejected traffic.
- [ ] Upload admission rejects the wrong user, kind, byte size, expired grant,
      and more than four active grants. Type, byte, and file-count limits reject
      an over-limit synthetic account. The orphan sweep removes an unregistered
      synthetic file after its safety window. The provider storage limit and
      alert have headroom.
- [ ] A controlled link-preview check accepts a public page and rejects private,
      loopback, credentialed, redirecting-to-private, oversized, and unsupported
      targets. The browser receives only an Openbook media URL.
- [ ] Push subscription checks accept the enabled browser providers and reject
      unreviewed, private, credentialed, and custom-port endpoints.
- [ ] `make publish-ready` passes on the exact clean release revision.

## Reliability and recovery

- [ ] Daily backup is verified for `launch`, or hourly backup is verified for
      `scale`. The latest age is within the profile target.
- [ ] The snapshot and manifest reach encrypted, access-limited storage in a
      different failure domain.
- [ ] A restore drill from the current data shape passes and has a measured
      recovery time.
- [ ] The Convex log stream reaches the private log destination.
- [ ] Readiness, error rate, latency, scheduler, each maintenance loop, delivery,
      and erasure alerts reach the on-call operator.
- [ ] Migration, backup age, provider quota, and cost alerts reach the on-call
      operator.
- [ ] The prior known-good web and compatible backend release can be restored.
- [ ] The error-budget policy and change freeze are accepted.
- [ ] The initial counter and storage-usage migration runs before traffic, or
      application writes are drained for the migration window.

## Capacity

- [ ] `openbookctl targets` passes on the release revision.
- [ ] Hosted `openbookctl load --certify` passes at full synthetic concurrency,
      duration, request rate, latency, and error thresholds.
- [ ] The receipt says `certification_scope: synthetic_http`.
- [ ] A separate realtime session soak reaches the planned concurrent session
      target with provider quota and resource evidence.
- [ ] Client, database, file, log, email, push, billing, and bandwidth growth
      remain inside the approved cost ceiling.
- [ ] A controlled overload test shows bounded errors and recovery without data
      corruption.

## Deployment acceptance

- [ ] `pnpm production:readiness` passes in the operator shell.
- [ ] `scripts/deploy.sh` deploys the exact clean Git commit and the required
      migration reaches `complete`.
- [ ] `/health` reports the expected release and environment.
- [ ] `/ready` reports every dependency ready for at least five minutes.
- [ ] `scripts/deploy-web.sh` publishes the same release and the strict live
      probe passes.
- [ ] Desktop and mobile viewport checks pass against the production origin.
- [ ] The optimized Tauri application uses the generated exact-origin CSP. Its
      signed installer, notarization, and update path pass on each supported
      desktop platform before distribution.
- [ ] Two-user read, write, realtime, message, notification, upload, media, and
      account erasure checks pass with synthetic accounts.
- [ ] The status and support paths are reachable without an authenticated
      application session.
- [ ] The operator records the launch time, release, checks, reviewers, and
      rollback target before registration is opened.

## Launch decision

- [ ] The service owner explicitly authorizes public registration.
- [ ] There is no open SEV-1 or SEV-2 issue and no expired exception.
- [ ] The active error budget is available.
- [ ] The operator opened traffic gradually and watched live indicators.

Completing repository tests does not check this final section. Only the named
service owner can make the launch decision.
