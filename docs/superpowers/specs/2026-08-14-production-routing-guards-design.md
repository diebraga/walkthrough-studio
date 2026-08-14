# Production routing guards design

## Goal

Prevent two development-versus-Vercel production failures from recurring:

1. Native Node ESM failing to resolve extensionless relative imports in backend code.
2. Direct navigation to a React Router page returning Vercel's edge 404 because the page has no SPA rewrite.

Also document Graphify as an optional local contributor tool without making builds or CI depend on Claude Code, Python, or external credentials.

## Convention checker

Add `tools/check-project-conventions.mjs`, a Node script that uses the TypeScript package already installed by the project. It parses source files rather than matching source text with regular expressions.

The checker has two independent rules.

### Backend ESM imports

Recursively inspect TypeScript files under `api/`, `server/`, and `adapters/`. Every relative module specifier in a static import, export-from declaration, or dynamic import must have an explicit runtime-resolvable extension.

Accepted endings are `.js`, `.mjs`, `.cjs`, and `.json`. Package imports and aliases are outside this rule. A violation reports the file, line, module specifier, and the required convention.

This preserves the TypeScript `.js`-for-`.ts` convention required by unbundled Node ESM on Vercel.

### Browser-route rewrite parity

Parse `src/App.tsx` and collect literal `path` values from React Router `Route` JSX elements. Ignore `/`, wildcard routes, pathless routes, parameter-only child routes, and non-literal expressions. Every remaining absolute browser route must have an exact rewrite in `vercel.json` whose destination is `/index.html`.

The checker must not require rewrites for `/api/*`; API paths belong to Vercel's file-based functions rather than React Router.

A violation reports the missing browser route and the expected rewrite. Duplicate rewrites and malformed `vercel.json` also fail with actionable messages.

## Execution and tests

Add a `check:conventions` package script and run it before TypeScript and Vite in `build`. A bad import or missing browser rewrite therefore fails local builds and Vercel builds before deployment.

The checker supports a self-test mode with temporary fixtures. Its tests prove:

- valid backend `.js` imports pass;
- extensionless backend imports fail;
- package imports are ignored;
- a React route with a matching rewrite passes;
- a React route without a rewrite fails;
- `/`, wildcard, and API behavior are not incorrectly classified as browser-route violations.

The self-test is exposed through `test:conventions`. The normal verification sequence runs the self-test, convention check, TypeScript check, and production build.

## Repository guidance

Strengthen `AGENTS.md` so agents must:

- use explicit runtime extensions for relative imports in `api/`, `server/`, and `adapters/`;
- add an `/index.html` Vercel rewrite whenever adding an absolute React Router browser path;
- run the convention checker and production build before committing.

Update `docs/api.md` to point to the executable guard rather than relying only on prose.

## Optional Graphify contributor tool

Add a short contributor-tooling document indexed from `AGENTS.md`. It documents:

```sh
pipx install graphifyy
graphify install
graphify .
```

Graphify remains optional because it requires Python, Claude Code, and user credentials. It is not installed by the JavaScript package manager and is not run by builds or CI. Add `graphify-out/` to `.gitignore` so local generated graphs and caches cannot be committed accidentally.

## Scope

This change does not alter Hono, backend route registration, React routing behavior, or deployment architecture. It only validates existing conventions, integrates the validation into builds, documents the rules, and adds the already-approved optional contributor-tool instructions.
