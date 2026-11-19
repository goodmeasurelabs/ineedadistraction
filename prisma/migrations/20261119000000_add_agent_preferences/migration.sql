CREATE TABLE "AgentPreferences" (
    "token" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "appliedRevision" INTEGER NOT NULL DEFAULT 1,
    "pluginSeenAt" TIMESTAMP(3),
    "pluginVersion" TEXT,
    "lastMutationId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPreferences_pkey" PRIMARY KEY ("token")
);
