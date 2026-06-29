CREATE TABLE IF NOT EXISTS "financial"."onchain_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(24) NOT NULL,
	"user_id" uuid NOT NULL,
	"bet_id" uuid,
	"source_wallet" varchar(64) NOT NULL,
	"destination_wallet" varchar(64) NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"mint" varchar(64) NOT NULL,
	"caip2" varchar(48),
	"tx_signature" varchar(128),
	"idempotency_key" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"ledger_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "onchain_transfers_tx_signature_unique" UNIQUE("tx_signature"),
	CONSTRAINT "onchain_transfers_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "onchain_transfers_amount_positive" CHECK ("financial"."onchain_transfers"."amount_usdc" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial"."onchain_transfers" ADD CONSTRAINT "onchain_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_transfers_status_idx" ON "financial"."onchain_transfers" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_transfers_bet_idx" ON "financial"."onchain_transfers" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onchain_transfers_user_idx" ON "financial"."onchain_transfers" USING btree ("user_id","created_at");