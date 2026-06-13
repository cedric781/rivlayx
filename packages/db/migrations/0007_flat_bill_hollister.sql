CREATE TABLE IF NOT EXISTS "app"."settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"winner_user_id" uuid,
	"loser_user_id" uuid,
	"pot_usdc" numeric(20, 6) NOT NULL,
	"gross_winner_usdc" numeric(20, 6) NOT NULL,
	"platform_fee_usdc" numeric(20, 6) NOT NULL,
	"net_winner_usdc" numeric(20, 6) NOT NULL,
	"ledger_txn_id" uuid NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_bet_unique" UNIQUE("bet_id"),
	CONSTRAINT "settlements_fee_non_negative" CHECK ("app"."settlements"."platform_fee_usdc" >= 0),
	CONSTRAINT "settlements_net_non_negative" CHECK ("app"."settlements"."net_winner_usdc" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."bets" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."settlements" ADD CONSTRAINT "settlements_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."settlements" ADD CONSTRAINT "settlements_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."settlements" ADD CONSTRAINT "settlements_loser_user_id_users_id_fk" FOREIGN KEY ("loser_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlements_winner_idx" ON "app"."settlements" USING btree ("winner_user_id");