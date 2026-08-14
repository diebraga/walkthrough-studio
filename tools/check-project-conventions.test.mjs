import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkProject } from "./check-project-conventions.mjs";

async function fixture({
  backend = 'import { Hono } from "hono";\nimport { health } from "./routes/health.js";\n',
  routes = '<Route path="/" element={<Home />} /><Route path="/health" element={<Health />} /><Route path="*" element={<NotFound />} />',
  rewrites = [{ source: "/health", destination: "/index.html" }],
  rawVercel,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "walkthrough-conventions-"));
  await mkdir(path.join(root, "server", "routes"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "server", "app.ts"), backend);
  await writeFile(
    path.join(root, "src", "App.tsx"),
    `import { Route } from "react-router-dom";\nexport function App() { return <>{${JSON.stringify(routes)}}</>; }`.replace(
      `{${JSON.stringify(routes)}}`,
      routes,
    ),
  );
  await writeFile(
    path.join(root, "vercel.json"),
    rawVercel ?? JSON.stringify({ rewrites }),
  );
  return root;
}

test("accepts runtime-safe backend imports and matching browser rewrites", async () => {
  const root = await fixture({
    backend:
      'import "./setup.mjs";\nexport { route } from "./route.cjs";\nconst data = await import("./data.json");\nimport { Hono } from "hono";\n',
  });

  assert.deepEqual(await checkProject(root), []);
});

test("ignores generated backend declarations", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "server", "generated"), { recursive: true });
  await writeFile(
    path.join(root, "server", "generated", "client.d.ts"),
    'export * from "./internal";\n',
  );

  assert.deepEqual(await checkProject(root), []);
});

test("rejects extensionless static, export-from, and dynamic backend imports", async () => {
  const root = await fixture({
    backend:
      'import { health } from "./routes/health";\nexport { route } from "../route";\nconst lazy = import("./lazy");\n',
  });

  const violations = await checkProject(root);
  assert.equal(violations.length, 3);
  assert.match(violations[0], /server\/app\.ts:1.*\.\/routes\/health.*\.js/);
  assert.match(violations[1], /server\/app\.ts:2.*\.\.\/route.*\.js/);
  assert.match(violations[2], /server\/app\.ts:3.*\.\/lazy.*\.js/);
});

test("rejects a browser route without an exact SPA rewrite", async () => {
  const root = await fixture({ rewrites: [] });

  assert.deepEqual(await checkProject(root), [
    'src/App.tsx: browser route "/health" requires an exact Vercel rewrite to "/index.html"',
  ]);
});

test("ignores root, wildcard, relative child, and API routes", async () => {
  const root = await fixture({
    routes:
      '<Route path="/" /><Route path="*" /><Route path=":scene" /><Route path="/api/health" />',
    rewrites: [],
  });

  assert.deepEqual(await checkProject(root), []);
});

test("reports malformed Vercel configuration", async () => {
  const root = await fixture({ rawVercel: "{" });

  const violations = await checkProject(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^vercel\.json: invalid JSON:/);
});

test("rejects duplicate exact browser rewrites", async () => {
  const rewrite = { source: "/health", destination: "/index.html" };
  const root = await fixture({ rewrites: [rewrite, rewrite] });

  assert.deepEqual(await checkProject(root), [
    'vercel.json: duplicate exact rewrite for browser route "/health"',
  ]);
});
