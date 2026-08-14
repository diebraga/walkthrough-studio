# Optional contributor tools

Index: [../AGENTS.md](../AGENTS.md).

These tools can help local development, but the application, tests, CI, and
deployments must not depend on them.

## Graphify

[Graphify](https://github.com/Graphify-Labs/graphify) builds a local knowledge
graph from a repository for exploration in Claude Code. It requires Python
3.10 or newer, Claude Code, and the contributor's own configured credentials.

On macOS, install it in an isolated environment with `pipx`:

```sh
pipx install graphifyy
graphify install
```

From this repository, generate or refresh the graph with:

```sh
graphify .
graphify . --update
```

Query the generated graph later without rebuilding it:

```sh
graphify query "how do browser routes reach Vercel and Hono?"
```

Graphify writes its generated graph, reports, wiki, and cache under
`graphify-out/`. That directory is gitignored because the output is local and
reproducible. Do not add Graphify to `package.json`, production builds, or CI.
