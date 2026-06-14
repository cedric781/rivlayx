ALTER TABLE "app"."user_reputation" ADD COLUMN "arbiter_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user_reputation" ADD COLUMN "arbiter_tier" varchar(16) DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user_reputation" ADD COLUMN "arbiter_provisional" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user_reputation" ADD COLUMN "arbiter_rulings" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user_reputation" ADD COLUMN "arbiter_overturned_rate" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user_reputation" ADD COLUMN "arbiter_acceptance_rate" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_reputation_arbiter_score_idx" ON "app"."user_reputation" USING btree ("arbiter_score");--> statement-breakpoint
ALTER TABLE "app"."user_reputation" ADD CONSTRAINT "user_reputation_arbiter_score_range" CHECK ("app"."user_reputation"."arbiter_score" >= 0 AND "app"."user_reputation"."arbiter_score" <= 100);