# Third-party notices

Openbook's production dependency tree is checked with
`go run ./tools/license-audit/main.go`. The current production packages report
only MIT, ISC, and Apache-2.0 licenses. Complete package names, versions,
authors, and upstream homepages can be reproduced from the pinned lockfile with:

```text
pnpm licenses list --prod --json
```

The vendored `apps/web/src/ui/garrid.css` snapshot and the small local theme/
toast adapter are Nico Stranquist's work, copied from Nico-owned `nicos-tools`
design-system sources to keep Openbook independently buildable. They are covered
by this repository's MIT license.

Openbook uses no Facebook or Meta source code, logos, images, or other assets.
It is an independently implemented realtime social-network application.
