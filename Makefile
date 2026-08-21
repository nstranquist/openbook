.PHONY: help install test typecheck build verify verify-publication publish-ready export-publication desktop clean

# Vite default. Override when 5173 is taken: OPENBOOK_WEB_URL=http://localhost:5174 make desktop-tauri
OPENBOOK_WEB_URL ?= http://localhost:5173

help:
	@echo "openbook local targets:"
	@echo "  make install              # pnpm install --frozen-lockfile"
	@echo "  make test | typecheck | build"
	@echo "  make verify               # typecheck + test + build"
	@echo "  make verify-publication   # full publication gate (incl. gitleaks)"
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

verify-publication:
	pnpm verify:publication

# Local publication gate alias (no remote push).
publish-ready: verify-publication

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
