ALTER TABLE "AgentRun"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "eventId" TEXT,
ADD COLUMN "eventAt" TIMESTAMP(3),
ADD COLUMN "promptAt" TIMESTAMP(3),
ADD COLUMN "acknowledged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dismissed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "returnTarget" TEXT;

UPDATE "AgentRun"
SET "state" = 'idle', "acknowledged" = true
WHERE "state" = 'waiting' AND "reason" = 'done';

UPDATE "AgentRun"
SET "promptAt" = "updatedAt"
WHERE "state" = 'working';
