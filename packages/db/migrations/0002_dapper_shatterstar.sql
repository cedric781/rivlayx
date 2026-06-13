CREATE TABLE IF NOT EXISTS "financial"."deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_wallet" varchar(64) NOT NULL,
	"tx_signature" varchar(128) NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"slot" bigint,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"rejection_reason" varchar(32),
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"credited_at" timestamp with time zone,
	"ledger_txn_id" uuid,
	"raw_payload" jsonb,
	CONSTRAINT "deposits_tx_signature_unique" UNIQUE("tx_signature"),
	CONSTRAINT "deposits_amount_positive" CHECK ("financial"."deposits"."amount_usdc" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial"."orphan_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_signature" varchar(128) NOT NULL,
	"source_wallet" varchar(64) NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"slot" bigint,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'pending_review' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"claimed_by_user_id" uuid,
	"resolution_notes" text,
	"raw_payload" jsonb,
	CONSTRAINT "orphan_deposits_tx_signature_unique" UNIQUE("tx_signature"),
	CONSTRAINT "orphan_deposits_amount_positive" CHECK ("financial"."orphan_deposits"."amount_usdc" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial"."deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial"."orphan_deposits" ADD CONSTRAINT "orphan_deposits_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial"."orphan_deposits" ADD CONSTRAINT "orphan_deposits_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposits_user_idx" ON "financial"."deposits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposits_status_idx" ON "financial"."deposits" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orphan_deposits_status_idx" ON "financial"."orphan_deposits" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orphan_deposits_source_idx" ON "financial"."orphan_deposits" USING btree ("source_wallet");