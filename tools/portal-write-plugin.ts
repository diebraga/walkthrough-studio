import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * Dev-only endpoint that lets the portal capture UI save into the scene folder.
 *
 * A browser page cannot write to the project, so the alternative is downloading
 * a file and moving it by hand every time. This writes straight to
 * public/<property>/<scene>/portals.json instead.
 *
 * Dev server only — `configureServer` never runs for a production build, so
 * there is no way to reach this from a deployed site.
 */
export function portalWritePlugin(publicDir = "public"): Plugin {
    const root = resolve(publicDir);

    return {
        name: "walkthrough-portal-write",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use("/__dev/portals", (req, res) => {
                if (req.method !== "POST") {
                    res.statusCode = 405;
                    res.end("POST only");
                    return;
                }

                let body = "";
                req.on("data", (chunk) => {
                    body += chunk;
                    // A portals file is a few KB; anything larger is a mistake.
                    if (body.length > 1_000_000) req.destroy();
                });

                req.on("end", () => {
                    void (async () => {
                        try {
                            const { scenePath, portals } = JSON.parse(body) as {
                                scenePath: string;
                                portals: unknown;
                            };
                            if (typeof scenePath !== "string" || !Array.isArray(portals)) {
                                throw new Error("expected { scenePath: string, portals: array }");
                            }

                            // Contain writes to public/. The request comes from
                            // localhost, but a path from the page should never be
                            // able to address the rest of the disk.
                            const target = resolve(root, normalize(scenePath).replace(/^([/\\])+/, ""), "portals.json");
                            if (target !== root && !target.startsWith(root + sep)) {
                                throw new Error(`refusing to write outside ${publicDir}/`);
                            }

                            await mkdir(dirname(target), { recursive: true });
                            await writeFile(target, `${JSON.stringify({ portals }, null, 2)}\n`, "utf8");

                            res.statusCode = 200;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({ ok: true, path: join(publicDir, scenePath, "portals.json") }));
                        } catch (error) {
                            res.statusCode = 400;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({ ok: false, error: String((error as Error).message ?? error) }));
                        }
                    })();
                });
            });
        },
    };
}
