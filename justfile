# Format all code in the dotfiles repo
format: _format-lua _format-shell _format-python _format-data _format-kdl

# Check formatting without making changes (CI-safe)
check: _check-lua _check-shell _check-python _check-data _check-kdl

# Install pre-commit hooks and verify tools are available
setup:
	@echo "Checking required tools..."
	@command -v stylua || echo "MISSING: stylua   (pacman -S stylua)"
	@command -v shfmt || echo "MISSING: shfmt    (pacman -S shfmt)"
	@command -v ruff || echo "MISSING: ruff     (pacman -S ruff)"
	@command -v prettier || echo "MISSING: prettier (pacman -S prettier)"
	@command -v taplo || echo "MISSING: taplo    (yay -S taplo-cli)"
	@command -v kdlfmt || echo "MISSING: kdlfmt   (cargo install kdlfmt)"
	pre-commit install

# ── internal targets ──────────────────────────────────────────────────

_format-lua:
	stylua .

_format-shell:
	find . \( -path ./backup -o -path ./.git -o -path ./.crush -o -path ./.claude \) -prune -o -name "*.sh" -print \
	  | xargs -r shfmt -w -i 2 -ci

_format-python:
	ruff format packages/

_format-data:
	prettier --write "**/*.{json,md,css}" --ignore-path .prettierignore
	find . \( -path ./backup -o -path ./.git \) -prune -o -name "*.toml" -print \
	  | xargs -r taplo format

_format-kdl:
	kdlfmt format packages/zellij/config.kdl

_check-lua:
	stylua --check .

_check-shell:
	find . \( -path ./backup -o -path ./.git -o -path ./.crush -o -path ./.claude \) -prune -o -name "*.sh" -print \
	  | xargs -r shfmt -d -i 2 -ci

_check-python:
	ruff format --check packages/

_check-data:
	prettier --check "**/*.{json,md,css}" --ignore-path .prettierignore
	find . \( -path ./backup -o -path ./.git \) -prune -o -name "*.toml" -print \
	  | xargs -r taplo check

_check-kdl:
	kdlfmt check packages/zellij/config.kdl

