# Third-party notices

Openbook's production dependency tree is checked with
`go run ./tools/license-audit/main.go`. The current production packages report
only MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, and MPL-2.0
(`web-push` / `http_ece` for VAPID web push) licenses. Complete package names, versions,
authors, and upstream homepages can be reproduced from the pinned lockfile with:

```text
pnpm licenses list --prod --json
```

## glob-to-regexp 0.4.1

Copyright (c) 2013, Nick Fitzgerald

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The vendored `apps/web/src/ui/garrid.css` snapshot and the small local theme/
toast adapter are Nico Stranquist's work, copied from Nico-owned `nicos-tools`
design-system sources to keep Openbook independently buildable. They are covered
by this repository's MIT license.

Openbook uses no Facebook or Meta source code, logos, images, or other assets.
It is an independently implemented realtime social-network application.
