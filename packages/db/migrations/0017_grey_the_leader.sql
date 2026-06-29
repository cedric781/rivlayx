ALTER TABLE "auth"."wallets" ADD COLUMN "delegated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."wallets" ADD COLUMN "delegation_granted_at" timestamp with time zone;