CREATE TABLE IF NOT EXISTS "app"."auto_resolve_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bet_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"error_message" text,
	"raw_payload" jsonb,
	"outcome" jsonb,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."auto_resolve_attempts" ADD CONSTRAINT "auto_resolve_attempts_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_resolve_attempts_bet_idx" ON "app"."auto_resolve_attempts" USING btree ("bet_id","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_resolve_attempts_status_idx" ON "app"."auto_resolve_attempts" USING btree ("status","attempted_at");