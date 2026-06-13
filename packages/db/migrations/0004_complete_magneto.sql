CREATE TABLE IF NOT EXISTS "app"."disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"opener_user_id" uuid NOT NULL,
	"claimed_winner_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"deposit_usdc" numeric(20, 6) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ruled_at" timestamp with time zone,
	"ruled_by_user_id" uuid,
	"ruling_notes" text,
	CONSTRAINT "disputes_deposit_positive" CHECK ("app"."disputes"."deposit_usdc" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."bet_arbiters" ADD COLUMN "decision" jsonb;--> statement-breakpoint
ALTER TABLE "app"."bets" ADD COLUMN "proposed_winner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."bets" ADD COLUMN "proposed_outcome" jsonb;--> statement-breakpoint
ALTER TABLE "app"."bets" ADD COLUMN "proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."bets" ADD COLUMN "dispute_window_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."bets" ADD COLUMN "resolved_winner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."bets" ADD COLUMN "void_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_opener_user_id_users_id_fk" FOREIGN KEY ("opener_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_claimed_winner_user_id_users_id_fk" FOREIGN KEY ("claimed_winner_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_ruled_by_user_id_users_id_fk" FOREIGN KEY ("ruled_by_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_status_idx" ON "app"."disputes" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_opener_idx" ON "app"."disputes" USING btree ("opener_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_bet_idx" ON "app"."disputes" USING btree ("bet_id","status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bets" ADD CONSTRAINT "bets_proposed_winner_user_id_users_id_fk" FOREIGN KEY ("proposed_winner_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bets" ADD CONSTRAINT "bets_resolved_winner_user_id_users_id_fk" FOREIGN KEY ("resolved_winner_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
