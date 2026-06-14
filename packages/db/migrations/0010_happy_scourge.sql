CREATE TABLE IF NOT EXISTS "app"."reputation_recompute_queue" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"reason" varchar(32) NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."user_reputation" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"tier" varchar(16) DEFAULT 'new' NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_reputation_score_range" CHECK ("app"."user_reputation"."score" >= 0 AND "app"."user_reputation"."score" <= 100)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."reputation_recompute_queue" ADD CONSTRAINT "reputation_recompute_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."user_reputation" ADD CONSTRAINT "user_reputation_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reputation_queue_enqueued_idx" ON "app"."reputation_recompute_queue" USING btree ("enqueued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_reputation_score_idx" ON "app"."user_reputation" USING btree ("score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_reputation_tier_idx" ON "app"."user_reputation" USING btree ("tier");