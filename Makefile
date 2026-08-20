.PHONY: help install test typecheck build verify verify-publication publish-ready export-publication desktop clean

help:
	@echo "openbook local targets:"
	@echo "  make install              # pnpm install --frozen-lockfile"
	@echo "  make test | typecheck | build"
	@echo "  make verify               # typecheck + test + build"
	@echo "  make verify-publication   # full publication gate (incl. gitleaks)"
	@echo "  make desktop              # Chrome/Edge app-mode window"
	@echo "  make desktop-tauri        # cargo check the Tauri shell (optional)"
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
	bash scripts/open-desktop.sh

desktop-tauri:
	@command -v cargo >/dev/null || (echo "cargo not installed; use make desktop" >&2; exit 2)
	cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

mobile:
	@test -d apps/mobile/node_modules || (echo "cd apps/mobile && npm install" >&2; exit 2)
	cd apps/mobile && npx expo start

# Human-gated clean tree for public publish (OUT must be empty absolute path).
export-publication:
	@test -n "$(OUT)" || (echo "OUT=/path/to/empty-dir required" >&2; exit 2)
	pnpm export:publication -- --out "$(OUT)"

clean:
	rm -rf node_modules apps/web/dist .turbo
