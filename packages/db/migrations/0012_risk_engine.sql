CREATE TABLE IF NOT EXISTS "app"."risk_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" varchar(16) NOT NULL,
	"subject_id" text NOT NULL,
	"type" varchar(32) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	CONSTRAINT "risk_alerts_score_range" CHECK ("app"."risk_alerts"."score" >= 0 AND "app"."risk_alerts"."score" <= 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."risk_edges" (
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"shared_bets" integer DEFAULT 0 NOT NULL,
	"shared_volume_usdc" numeric(20, 6) DEFAULT '0' NOT NULL,
	"shared_arbiter_bets" integer DEFAULT 0 NOT NULL,
	"last_bet_at" timestamp with time zone,
	"cluster_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_edges_user_a_user_b_pk" PRIMARY KEY("user_a","user_b")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."risk_recompute_queue" (
	"subject_type" varchar(16) NOT NULL,
	"subject_id" text NOT NULL,
	"reason" varchar(32) NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_recompute_queue_subject_type_subject_id_pk" PRIMARY KEY("subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."risk_scores" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"risk_band" varchar(16) DEFAULT 'none' NOT NULL,
	"ring_score" integer DEFAULT 0 NOT NULL,
	"arbiter_concentration_score" integer DEFAULT 0 NOT NULL,
	"concentration_score" integer DEFAULT 0 NOT NULL,
	"wash_score" integer DEFAULT 0 NOT NULL,
	"abuse_score" integer DEFAULT 0 NOT NULL,
	"velocity_score" integer DEFAULT 0 NOT NULL,
	"funding_overlap_score" integer DEFAULT 0 NOT NULL,
	"ring_cluster_id" uuid,
	"sybil_cluster_id" uuid,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_scores_score_range" CHECK ("app"."risk_scores"."risk_score" >= 0 AND "app"."risk_scores"."risk_score" <= 100)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."risk_alerts" ADD CONSTRAINT "risk_alerts_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."risk_edges" ADD CONSTRAINT "risk_edges_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."risk_edges" ADD CONSTRAINT "risk_edges_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."risk_scores" ADD CONSTRAINT "risk_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_alerts_queue_idx" ON "app"."risk_alerts" USING btree ("status","severity","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_alerts_subject_idx" ON "app"."risk_alerts" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "risk_alerts_open_dedup" ON "app"."risk_alerts" USING btree ("subject_type","subject_id","type") WHERE "app"."risk_alerts"."status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_edges_user_a_idx" ON "app"."risk_edges" USING btree ("user_a");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_edges_user_b_idx" ON "app"."risk_edges" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_edges_cluster_idx" ON "app"."risk_edges" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_queue_enqueued_idx" ON "app"."risk_recompute_queue" USING btree ("enqueued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_scores_score_idx" ON "app"."risk_scores" USING btree ("risk_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_scores_band_idx" ON "app"."risk_scores" USING btree ("risk_band");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_scores_ring_cluster_idx" ON "app"."risk_scores" USING btree ("ring_cluster_id");