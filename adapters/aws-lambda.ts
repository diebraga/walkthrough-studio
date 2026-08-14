import { handle } from "hono/aws-lambda";
import { app } from "../server/app.js";

// Thin wrapper: API Gateway / Lambda Function URL events in, the same
// shared app handles them. No routes or business logic live here.
export const handler = handle(app);
