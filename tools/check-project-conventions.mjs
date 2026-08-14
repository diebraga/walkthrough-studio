import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const BACKEND_DIRS = ["api", "server", "adapters"];
const RUNTIME_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json"]);

export async function checkProject(rootDir) {
  return [
    ...(await checkBackendImports(rootDir)),
    ...(await checkBrowserRouteRewrites(rootDir)),
  ];
}

async function checkBackendImports(rootDir) {
  const violations = [];
  for (const directory of BACKEND_DIRS) {
    const files = await collectTypeScriptFiles(path.join(rootDir, directory));
    for (const file of files) {
      const sourceText = await readFile(file, "utf8");
      const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
      visitModuleSpecifiers(sourceFile, (specifier, start) => {
        if (!specifier.startsWith(".") || RUNTIME_EXTENSIONS.has(path.extname(specifier))) return;
        const { line } = sourceFile.getLineAndCharacterOfPosition(start);
        violations.push(
          `${relativePath(rootDir, file)}:${line + 1}: relative import "${specifier}" needs an explicit runtime extension such as .js`,
        );
      });
    }
  }
  return violations;
}

async function checkBrowserRouteRewrites(rootDir) {
  const appFile = path.join(rootDir, "src", "App.tsx");
  let sourceText;
  try {
    sourceText = await readFile(appFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const sourceFile = ts.createSourceFile(appFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const browserRoutes = collectBrowserRoutes(sourceFile);
  const configFile = path.join(rootDir, "vercel.json");
  let config;
  try {
    config = JSON.parse(await readFile(configFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return browserRoutes.map(
        (route) => `src/App.tsx: browser route "${route}" requires an exact Vercel rewrite to "/index.html"`,
      );
    }
    if (error instanceof SyntaxError) return [`vercel.json: invalid JSON: ${error.message}`];
    throw error;
  }

  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];
  const violations = [];
  for (const route of browserRoutes) {
    const matches = rewrites.filter(
      (rewrite) => rewrite?.source === route && rewrite?.destination === "/index.html",
    );
    if (matches.length === 0) {
      violations.push(
        `src/App.tsx: browser route "${route}" requires an exact Vercel rewrite to "/index.html"`,
      );
    } else if (matches.length > 1) {
      violations.push(`vercel.json: duplicate exact rewrite for browser route "${route}"`);
    }
  }
  return violations;
}

async function collectTypeScriptFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectTypeScriptFiles(item)));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(item);
  }
  return files;
}

function visitModuleSpecifiers(sourceFile, report) {
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      reportWithNode(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      reportWithNode(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      reportWithNode(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  function reportWithNode(node) {
    report(node.text, node.getStart(sourceFile));
  }

  visit(sourceFile);
}

function collectBrowserRoutes(sourceFile) {
  const routes = new Set();
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (node.tagName.getText(sourceFile) === "Route") {
        const pathAttribute = node.attributes.properties.find(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "path",
        );
        const route = literalJsxValue(pathAttribute?.initializer);
        if (isBrowserRoute(route)) routes.add(route);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...routes].sort();
}

function literalJsxValue(initializer) {
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))
  ) {
    return initializer.expression.text;
  }
  return undefined;
}

function isBrowserRoute(route) {
  return Boolean(
    route &&
      route.startsWith("/") &&
      route !== "/" &&
      !route.includes("*") &&
      route !== "/api" &&
      !route.startsWith("/api/"),
  );
}

function relativePath(rootDir, file) {
  return path.relative(rootDir, file).split(path.sep).join("/");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const violations = await checkProject(process.cwd());
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Project conventions passed.");
  }
}
