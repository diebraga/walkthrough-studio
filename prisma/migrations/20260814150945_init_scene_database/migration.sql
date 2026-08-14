-- CreateEnum
CREATE TYPE "SceneAssetType" AS ENUM ('GAUSSIAN_SPLAT', 'COLLISION_REPORT', 'MANUAL_COLLISION', 'OTHER');

-- CreateTable
CREATE TABLE "Place" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneNode" (
    "id" UUID NOT NULL,
    "placeId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collisionData" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneAsset" (
    "id" UUID NOT NULL,
    "sceneNodeId" UUID NOT NULL,
    "type" "SceneAssetType" NOT NULL,
    "objectKey" TEXT,
    "originalPath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portal" (
    "id" UUID NOT NULL,
    "fromNodeId" UUID NOT NULL,
    "toNodeId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "positionX" DOUBLE PRECISION NOT NULL,
    "positionY" DOUBLE PRECISION NOT NULL,
    "positionZ" DOUBLE PRECISION NOT NULL,
    "yaw" DOUBLE PRECISION NOT NULL,
    "radius" DOUBLE PRECISION NOT NULL,
    "spawnX" DOUBLE PRECISION NOT NULL,
    "spawnY" DOUBLE PRECISION NOT NULL,
    "spawnZ" DOUBLE PRECISION NOT NULL,
    "spawnYaw" DOUBLE PRECISION NOT NULL,
    "spawnPitch" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Place_slug_key" ON "Place"("slug");

-- CreateIndex
CREATE INDEX "SceneNode_placeId_idx" ON "SceneNode"("placeId");

-- CreateIndex
CREATE UNIQUE INDEX "SceneNode_placeId_slug_key" ON "SceneNode"("placeId", "slug");

-- CreateIndex
CREATE INDEX "SceneAsset_sceneNodeId_idx" ON "SceneAsset"("sceneNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "SceneAsset_sceneNodeId_originalPath_key" ON "SceneAsset"("sceneNodeId", "originalPath");

-- CreateIndex
CREATE INDEX "Portal_fromNodeId_idx" ON "Portal"("fromNodeId");

-- CreateIndex
CREATE INDEX "Portal_toNodeId_idx" ON "Portal"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Portal_fromNodeId_sourceKey_key" ON "Portal"("fromNodeId", "sourceKey");

-- AddForeignKey
ALTER TABLE "SceneNode" ADD CONSTRAINT "SceneNode_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneAsset" ADD CONSTRAINT "SceneAsset_sceneNodeId_fkey" FOREIGN KEY ("sceneNodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portal" ADD CONSTRAINT "Portal_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portal" ADD CONSTRAINT "Portal_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
