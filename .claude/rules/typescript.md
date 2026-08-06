# Frontend (TypeScript / JavaScript) Rules

## Style
- TypeScript by default. `tsconfig.json` → `"strict": true`. No untagged `any`.
- 2 spaces, max line 100.
- `camelCase` vars/funcs, `PascalCase` components/types, `UPPER_SNAKE_CASE` consts, `kebab-case` filenames.
- `const` > `let`. Never `var`.
- Named exports by default. Default exports only when the framework requires it (e.g. Next.js pages).
- `async`/`await`. Don't mix with `.then()` in the same function.
- Imports: builtin → third-party → absolute → relative, blank line between groups.
- TSDoc on every exported component, hook, and type.

## File Split
- **One concern per file.** Never inline styles or logic together.
- Component: `Button.tsx` — JSX + props + behavior only.
- Styles: `Button.module.css` — colocated, CSS Modules.
- Logic-heavy hooks: `useButton.ts` — extract when the component grows past UI.
- No inline `style={{...}}` except dynamic values (transforms, computed colors).
- No CSS-in-JS runtime libraries (styled-components, emotion). Plain CSS Modules.

## State Management
- **Zustand for global/shared state.** No Redux, no Context for app state.
- One store per domain: `src/stores/<domain>.ts`. Export the hook as `use<Domain>Store`.
- Keep stores flat. Derive with selectors, not nested computed state.
- Local UI state stays in `useState` / `useReducer`. Don't put everything in Zustand.
- Async actions live inside the store. Components call them, never fetch directly.
- Use selectors with shallow equality to avoid re-renders:
  ```ts
  const { user, loading } = useAuthStore(useShallow((s) => ({
    user: s.user,
    loading: s.loading,
  })));
  ```

## Tooling
- Package manager: **`npm`**.
- Lint: `eslint` (typescript-eslint). Format: `prettier` (on save).
- Types: `tsc --noEmit`. Tests: `vitest` + `@testing-library/react`.
- Env: parse `import.meta.env` (Vite) / `process.env` (Next) with `zod` at startup. Throw on invalid.

| Task | Command |
|------|---------|
| Install | `npm install` |
| Add dep | `npm install <pkg>` |
| Add dev dep | `npm install -D <pkg>` |
| Dev | `npm run dev` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Types | `npm run typecheck` |
| Test | `npm test` |

**Done** = all three pass:
```bash
npm run lint
npm run typecheck
npm test
```

## Architecture
- **No factory pattern.** Import and use directly.
- Components type props against interfaces, never inline shapes.
- Side effects (fetch, storage, analytics) live in stores or dedicated hooks — never inside JSX.
- Shared schemas: `src/schemas/` (zod, export inferred types).

## SOLID (frontend)
- **S** — One component, one responsibility. Split when a component handles both data and presentation.
- **O** — Extend via composition / new components, not by adding props.
- **L** — A swap-in variant must accept the same props.
- **I** — Narrow prop types. Don't pass whole objects when two fields suffice.
- **D** — Components depend on prop types, not on store internals.

## TDD (Red → Green → Refactor)
1. Failing `vitest` first.
2. Minimum code to pass.
3. Refactor; tests still pass.

Mock network with `msw` or `vi.mock`. Test names: `test_<unit>_<scenario>_<expected>`.

## Project Structure
```text
project-root/
├── node_modules/             # never commit
├── src/
│   ├── config.ts             # zod-parsed env
│   ├── schemas/              # shared zod schemas
│   ├── stores/               # Zustand stores
│   │   └── <domain>.ts
│   ├── components/
│   │   └── <Component>/
│   │       ├── <Component>.tsx
│   │       ├── <Component>.module.css
│   │       └── use<Component>.ts   # if needed
│   ├── hooks/                # cross-component hooks
│   └── pages/ or routes/
├── tests/                    # mirrors src/
├── .env                      # never commit
├── .env.example              # always commit
├── .gitignore                # node_modules/, .env, dist/
├── package.json
├── package-lock.json         # always commit
└── tsconfig.json             # strict: true
```

## Hard Rules
- Never use `any` without an inline justification comment.
- Never write impl before test.
- Never put global/shared state outside Zustand.
- Never fetch inside JSX — call a store action or hook.
- Never write inline styles for static values — use CSS Modules.
- Never hardcode secrets/config — extract to `.env` / `config.ts`.
- Never silently swallow errors — log + rethrow, or route to a handler.
- New component = `.tsx` + `.module.css` + tests, always together.
- If a request conflicts with a rule, surface it and propose a compliant fix.