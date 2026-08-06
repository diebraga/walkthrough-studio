import { strict as assert } from "node:assert";
import { splatFileTypeUrl } from "./splat-file-type";

assert.equal(splatFileTypeUrl("/scene/index.ply?v=1"), "/scene/index.ply");
assert.equal(splatFileTypeUrl("https://cdn.test/scene/index.ksplat#hash"), "https://cdn.test/scene/index.ksplat");
assert.equal(splatFileTypeUrl("/scene/index.splat"), "/scene/index.splat");
