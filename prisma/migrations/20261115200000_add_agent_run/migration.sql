-- AlterTable
ALTER TABLE "AgentSession" ADD COLUMN "working" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "waiting" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "waitedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AgentRun" (
    "token" TEXT NOT NULL,
    "run" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "agent" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("token","run")
);
