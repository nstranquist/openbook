.PHONY: help install test typecheck build verify verify-publication publish-ready export-publication clean

help:
	@echo "openbook local targets:"
	@echo "  make install              # pnpm install --frozen-lockfile"
	@echo "  make test | typecheck | build"
	@echo "  make verify               # typecheck + test + build"
	@echo "  make verify-publication   # full publication gate (incl. gitleaks)"
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

# Human-gated clean tree for public publish (OUT must be empty absolute path).
export-publication:
	@test -n "$(OUT)" || (echo "OUT=/path/to/empty-dir required" >&2; exit 2)
	pnpm export:publication -- --out "$(OUT)"

clean:
	rm -rf node_modules apps/web/dist .turbo
