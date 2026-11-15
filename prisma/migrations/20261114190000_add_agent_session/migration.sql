-- CreateTable
CREATE TABLE "AgentSession" (
    "token" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "agent" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "AgentSession_updatedAt_idx" ON "AgentSession"("updatedAt");
