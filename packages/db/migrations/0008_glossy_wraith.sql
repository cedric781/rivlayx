CREATE TABLE IF NOT EXISTS "app"."payout_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payout_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" varchar(24) NOT NULL,
	"tx_signature" varchar(128),
	"error_message" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"destination_wallet" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"tx_signature" varchar(128),
	"ledger_txn_id" uuid,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_settlement_user_unique" UNIQUE("settlement_id","user_id"),
	CONSTRAINT "payouts_amount_positive" CHECK ("app"."payouts"."amount_usdc" > 0),
	CONSTRAINT "payouts_attempts_non_negative" CHECK ("app"."payouts"."attempts" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."payout_attempts" ADD CONSTRAINT "payout_attempts_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "app"."payouts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."payouts" ADD CONSTRAINT "payouts_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."payouts" ADD CONSTRAINT "payouts_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "app"."settlements"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_attempts_payout_idx" ON "app"."payout_attempts" USING btree ("payout_id","attempt_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_attempts_status_idx" ON "app"."payout_attempts" USING btree ("status","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_status_idx" ON "app"."payouts" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_user_idx" ON "app"."payouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_bet_idx" ON "app"."payouts" USING btree ("bet_id");