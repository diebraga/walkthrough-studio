-- Portal names are the human-facing identity inside one source scene. Runtime
-- authoring relies on this constraint to reject concurrent duplicate creates.
CREATE UNIQUE INDEX "Portal_runtime_fromNodeId_name_key"
ON "Portal"("fromNodeId", "name")
WHERE "sourceKey" LIKE 'runtime:%';
