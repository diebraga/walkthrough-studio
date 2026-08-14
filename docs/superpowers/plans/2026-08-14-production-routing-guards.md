# Production Routing Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make builds fail when backend relative imports are unsafe for Node ESM or React browser routes lack Vercel SPA rewrites, and document Graphify as an optional contributor tool.

**Architecture:** A focused Node script parses TypeScript/TSX with the project's existing `typescript` dependency and parses `vercel.json` as JSON. Its exported validation functions are exercised by a separate Node test file using temporary fixture projects; the repository check is then wired into every production build.

**Tech Stack:** Node.js ESM, TypeScript compiler API, `node:test`, Vite, Vercel configuration.

## Global Constraints

- Do not change Hono, backend route registration, React routing behavior, or deployment architecture.
- Accept `.js`, `.mjs`, `.cjs`, and `.json` endings for relative backend imports.
- Check TypeScript files recursively under `api/`, `server/`, and `adapters/`.
- Require exact `/index.html` rewrites for literal absolute React Router paths other than `/`, wildcards, and `/api` paths.
- Keep Graphify optional and outside builds and CI.

---

### Task 1: Executable convention checker

**Files:**
- Create: `tools/check-project-conventions.mjs`
- Create: `tools/check-project-conventions.test.mjs`

**Interfaces:**
- Produces: `checkProject(rootDir): Promise<string[]>`, resolving to actionable violation strings.
- Produces: CLI exit status `0` with a success line or `1` with violations on stderr.

- [ ] **Step 1: Write failing fixture tests**

Use `node:test`, `node:assert/strict`, and temporary project directories. Import `checkProject`, then cover valid `.js` and package imports, invalid extensionless static/dynamic/export imports, matching and missing React rewrites, ignored root/wildcard/API routes, malformed JSON, and duplicate exact rewrites.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test tools/check-project-conventions.test.mjs`

Expected: FAIL because `tools/check-project-conventions.mjs` does not exist.

- [ ] **Step 3: Implement the parser and CLI**

Implement these focused functions:

```js
export async function checkProject(rootDir) {
  return [
    ...(await checkBackendImports(rootDir)),
    ...(await checkBrowserRouteRewrites(rootDir)),
  ];
}
```

Use `typescript.createSourceFile` to inspect `ImportDeclaration`, `ExportDeclaration`, `ImportEqualsDeclaration`, and `import()` string literals. Walk JSX nodes named `Route`, read literal `path` attributes, normalize eligible absolute paths, and compare them against exact `vercel.json` rewrite objects. Report file and one-based line for source violations.

When run directly, resolve `process.cwd()`, print all violations, and set `process.exitCode = 1`; otherwise print `Project conventions passed.`

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test tools/check-project-conventions.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Prove each real regression fails**

Temporarily alter fixture inputs only: remove `.js` from a backend fixture import and remove `/health` from a fixture rewrite. Confirm each produces the expected actionable violation, then restore the passing fixture.

- [ ] **Step 6: Commit**

```bash
git add tools/check-project-conventions.mjs tools/check-project-conventions.test.mjs
git commit -m "test: enforce production routing conventions"
```

### Task 2: Build integration and agent rules

**Files:**
- Modify: `package.json`
- Modify: `AGENTS.md`
- Modify: `docs/api.md`

**Interfaces:**
- Consumes: `node tools/check-project-conventions.mjs` and its test file from Task 1.
- Produces: `pnpm check:conventions`, `pnpm test:conventions`, and a `build` script that runs the repository check first.

- [ ] **Step 1: Run the real checker before integration**

Run: `node tools/check-project-conventions.mjs`

Expected: `Project conventions passed.` against the current `.js` imports and `/health` rewrite.

- [ ] **Step 2: Add package scripts**

Set scripts to:

```json
{
  "check:conventions": "node tools/check-project-conventions.mjs",
  "test:conventions": "node --test tools/check-project-conventions.test.mjs",
  "build": "pnpm check:conventions && tsc -b && vite build"
}
```

- [ ] **Step 3: Strengthen repository guidance**

Add strict `AGENTS.md` bullets stating that backend relative imports require runtime extensions, absolute React Router paths require exact `/index.html` rewrites, and `pnpm test:conventions && pnpm build` must pass. Update `docs/api.md` to identify the checker as the executable enforcement mechanism.

- [ ] **Step 4: Verify integration**

Run: `pnpm test:conventions && pnpm check:conventions && pnpm build`

Expected: convention tests pass, repository conventions pass, TypeScript passes, and Vite builds.

- [ ] **Step 5: Commit**

```bash
git add package.json AGENTS.md docs/api.md
git commit -m "build: enforce Vercel routing conventions"
```

### Task 3: Optional Graphify contributor documentation

**Files:**
- Create: `docs/contributor-tools.md`
- Modify: `AGENTS.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: optional installation and usage instructions; no runtime or CI dependency.

- [ ] **Step 1: Add the ignored-output regression assertion**

Run: `git check-ignore graphify-out/graph.json`

Expected: non-zero exit because `graphify-out/` is not ignored yet.

- [ ] **Step 2: Document Graphify and ignore output**

Document `pipx install graphifyy`, `graphify install`, `graphify .`, `graphify . --update`, and `graphify query "..."`. State explicitly that Graphify is optional, requires Claude Code and Python 3.10+, and is never required by builds or CI. Add `graphify-out/` to `.gitignore` and index the document in `AGENTS.md`.

- [ ] **Step 3: Verify ignored output**

Run: `git check-ignore -v graphify-out/graph.json`

Expected: `.gitignore` reports the `graphify-out/` rule.

- [ ] **Step 4: Commit**

```bash
git add docs/contributor-tools.md AGENTS.md .gitignore
git commit -m "docs: add optional Graphify tooling"
```

### Task 4: Final verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: fresh evidence that the enforcement works and the project remains deployable.

- [ ] **Step 1: Run all automated checks**

Run: `pnpm test:conventions && pnpm check:conventions && npx tsc -b && npx vite build`

Expected: all commands exit `0`.

- [ ] **Step 2: Build with Vercel tooling**

Run: `npx vercel build --prod --yes`

Expected: build succeeds and `.vercel/output/config.json` contains `/health` before the API function route.

- [ ] **Step 3: Inspect changes and repository state**

Run: `git diff --check && git status --short && git log -4 --oneline`

Expected: no whitespace errors; only intentionally committed changes; recent commits correspond to the plan tasks.
