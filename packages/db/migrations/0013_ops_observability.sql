CREATE TABLE IF NOT EXISTS "app"."cron_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."ops_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(32) NOT NULL,
	"severity" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"dedup_key" varchar(64) DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"runbook_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_runs_job_idx" ON "app"."cron_runs" USING btree ("job","finished_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ops_alerts_queue_idx" ON "app"."ops_alerts" USING btree ("status","severity","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ops_alerts_open_dedup" ON "app"."ops_alerts" USING btree ("type","dedup_key") WHERE "app"."ops_alerts"."status" = 'open';