CREATE TABLE IF NOT EXISTS "financial"."balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"available_usdc" numeric(20, 6) DEFAULT '0' NOT NULL,
	"locked_usdc" numeric(20, 6) DEFAULT '0' NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "balances_available_non_negative" CHECK ("financial"."balances"."available_usdc" >= 0),
	CONSTRAINT "balances_locked_non_negative" CHECK ("financial"."balances"."locked_usdc" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial"."freeze_state" (
	"component" varchar(16) PRIMARY KEY NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"frozen_by_user_id" uuid,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial"."ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"txn_id" uuid NOT NULL,
	"entry_index" integer NOT NULL,
	"account_type" varchar(32) NOT NULL,
	"account_ref" varchar(64) NOT NULL,
	"direction" varchar(8) NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"currency" char(4) DEFAULT 'USDC' NOT NULL,
	"bet_id" uuid,
	"related_tx_signature" varchar(128),
	"affects_user_id" uuid,
	"reason" varchar(48) NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	CONSTRAINT "ledger_entries_request_entry_unique" UNIQUE("request_id","entry_index"),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("financial"."ledger_entries"."amount_usdc" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial"."reconciliation_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ledger_total_usdc" numeric(24, 6),
	"on_chain_total_usdc" numeric(24, 6),
	"drift_usdc" numeric(24, 6),
	"status" varchar(16) NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial"."balances" ADD CONSTRAINT "balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial"."freeze_state" ADD CONSTRAINT "freeze_state_frozen_by_user_id_users_id_fk" FOREIGN KEY ("frozen_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_account_idx" ON "financial"."ledger_entries" USING btree ("account_type","account_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_bet_idx" ON "financial"."ledger_entries" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_txn_idx" ON "financial"."ledger_entries" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_affects_user_idx" ON "financial"."ledger_entries" USING btree ("affects_user_id");--> statement-breakpoint
-- Seed freeze_state with one row per component so the kill-switch lookup
-- always finds a row (UPSERT in setFreeze adds new components on demand).
INSERT INTO "financial"."freeze_state" ("component") VALUES
  ('new_bets'),
  ('settlements'),
  ('withdrawals'),
  ('all')
ON CONFLICT ("component") DO NOTHING;