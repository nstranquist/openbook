.PHONY: help install test typecheck build verify verify-mobile verify-desktop verify-production-contract verify-publication publish-ready production-readiness production-probe production-load export-publication desktop clean

# Vite default. Override when 5173 is taken: OPENBOOK_WEB_URL=http://localhost:5174 make desktop-tauri
OPENBOOK_WEB_URL ?= http://localhost:5173

help:
	@echo "openbook local targets:"
	@echo "  make install              # pnpm install --frozen-lockfile"
	@echo "  make test | typecheck | build"
	@echo "  make verify               # typecheck + test + build"
	@echo "  make verify-mobile        # Expo doctor + reviewed production audit"
	@echo "  make verify-desktop       # desktop audit, locked Cargo check, optimized build"
	@echo "  make verify-production-contract # production tools + capacity contract"
	@echo "  make verify-publication   # full publication gate (incl. gitleaks)"
	@echo "  make production-readiness # validate the exported production environment"
	@echo "  make production-probe     # probe configured live origins"
	@echo "  make production-load      # run an authenticated synthetic load smoke"
	@echo "  make desktop              # Chrome/Edge app-mode window"
	@echo "  make desktop-tauri        # cargo check + Tauri window over OPENBOOK_WEB_URL"
	@echo "  make mobile               # Expo start (apps/mobile, optional)"
	@echo "  make export-publication OUT=/path/to/empty-dir"

install:
	pnpm install --frozen-lockfile

test:
	pnpm test

typecheck:
	pnpm typecheck

build:
	pnpm build

verify: typecheck test build

verify-mobile:
	@test -d apps/mobile/node_modules || (echo "run npm ci in apps/mobile first" >&2; exit 2)
	cd apps/mobile && npx expo-doctor
	GO111MODULE=off go test ./tools/mobile-audit
	GO111MODULE=off go run ./tools/mobile-audit --dir apps/mobile

verify-desktop:
	@test -d apps/desktop/node_modules || (echo "run npm ci in apps/desktop first" >&2; exit 2)
	cd apps/desktop && npm audit && npm exec tauri -- --version
	cargo check --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
	@test -f apps/web/dist/index.html || pnpm build
	GO111MODULE=off go run ./tools/openbookctl desktop-config --file apps/desktop/src-tauri/target/openbook-production-config.json --clerk-origin https://clerk.openbook.example.invalid --convex-origin https://api.openbook.example.invalid --convex-site-origin https://site.openbook.example.invalid
	cd apps/desktop && npm exec tauri -- build --ci --no-bundle --config src-tauri/target/openbook-production-config.json

verify-production-contract:
	pnpm verify:production-contract

verify-publication:
	pnpm verify:publication

# Local publication gate alias (no remote push).
publish-ready: verify-publication verify-mobile verify-desktop

production-readiness:
	pnpm production:readiness

production-probe:
	pnpm production:probe

production-load:
	pnpm production:load

desktop:
	OPENBOOK_URL="$(OPENBOOK_WEB_URL)" bash scripts/open-desktop.sh

desktop-tauri:
	@command -v cargo >/dev/null || (echo "cargo not installed; use make desktop" >&2; exit 2)
	cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
	@test -d apps/desktop/node_modules || (cd apps/desktop && npm install)
	cd apps/desktop && npx tauri dev --config '{"build":{"devUrl":"$(OPENBOOK_WEB_URL)"}}'

mobile:
	@test -d apps/mobile/node_modules || (cd apps/mobile && npm install)
	cd apps/mobile && npx expo start

# Human-gated clean tree for public publish (OUT must be empty absolute path).
export-publication:
	@test -n "$(OUT)" || (echo "OUT=/path/to/empty-dir required" >&2; exit 2)
	pnpm export:publication -- --out "$(OUT)"

clean:
	rm -rf node_modules apps/web/dist .turbo
