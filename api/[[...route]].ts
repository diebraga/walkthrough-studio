import { handle } from "hono/vercel";
import { app } from "../server/app.js";

// Vercel's catch-all convention routes every /api/* request here.
// All logic lives in the shared app — this file only wires it up.
export default handle(app);
