# Python Rules

## Style
- 4 spaces, no tabs. Max line: 79 (code), 72 (docstrings).
- `snake_case` funcs/vars, `PascalCase` classes, `UPPER_SNAKE_CASE` consts.
- Imports: stdlib → third-party → local, blank line between groups.
- All public classes/functions: Google-style docstring + full type hints.

## Tooling
- `uv` only. No `pip`. Work inside `.venv/`.
- Settings: `pydantic-settings`. Tests: `pytest` + `pytest-mock`.

| Task | Command |
|------|---------|
| Env | `uv venv` |
| Sync | `uv sync` |
| Add dep | `uv add <pkg>` |
| Run | `uv run python <script>` |
| Test | `uv run pytest` |
| Lint | `uv run ruff check .` |
| Types | `uv run mypy src/` |

**Done** = all three pass:
```bash
uv run ruff check .
uv run mypy src/
uv run pytest --tb=short
```

## Architecture
- Contracts: `src/<module>/base.py` — `abc.ABC` + `@abstractmethod`, signatures only.
- Factory: `src/<module>/factory.py` — returns the ABC type.
- Implementations: `src/<module>/<name>.py`.
- DI via constructor only.

## SOLID
- **S** — One concern per class/module.
- **O** — Extend via new subclasses, don't edit existing.
- **L** — Subclasses are valid drop-ins.
- **I** — Narrow ABCs. No god-interfaces.
- **D** — Depend on ABCs, not concretes.

## TDD (Red → Green → Refactor)
1. Failing `pytest` first. Confirm it fails.
2. Minimum code to pass.
3. Refactor; tests still pass.

Mock every external call. Test names: `test_<unit>_<scenario>_<expected>`.

## Project Structure
```text
project-root/
├── .venv/                    # never commit
├── src/
│   ├── config.py             # pydantic-settings
│   ├── schemas/              # shared Pydantic models
│   └── <module>/
│       ├── base.py
│       ├── factory.py
│       └── <impl>.py
├── tests/                    # mirrors src/
├── .env                      # never commit
├── .env.example              # always commit
├── .gitignore                # .venv/, .env, __pycache__/
├── pyproject.toml
└── uv.lock                   # always commit
```

## Hard Rules
- Never instantiate concretes in high-level code — use the factory.
- Never write impl before test.
- Never hardcode secrets/config — extract to `.env` / `config.py`.
- Never silently swallow exceptions — log + re-raise.
- Never omit type hints.
- New impl = file + factory registration + tests, always together.
- If a request conflicts with a rule, surface it and propose a compliant fix.