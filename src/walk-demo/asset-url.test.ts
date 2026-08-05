import { strict as assert } from "node:assert";
import { splatUrl } from "./asset-url";

assert.equal(splatUrl("/23_nashville_dr_tenessee/hall/"), "/23_nashville_dr_tenessee/hall/index.ply");

assert.equal(
    splatUrl(
        "/23_nashville_dr_tenessee/hall/",
        "https://eibsswswyqie19ci.public.blob.vercel-storage.com",
    ),
    "https://eibsswswyqie19ci.public.blob.vercel-storage.com/23_nashville_dr_tenessee/hall/index.ply",
);
