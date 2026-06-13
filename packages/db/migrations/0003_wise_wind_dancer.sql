CREATE TABLE IF NOT EXISTS "app"."bet_arbiters" (
	"bet_id" uuid PRIMARY KEY NOT NULL,
	"arbiter_user_id" uuid NOT NULL,
	"selected_by" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."bet_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bet_id" uuid NOT NULL,
	"from_status" varchar(24),
	"to_status" varchar(24) NOT NULL,
	"actor_user_id" uuid,
	"actor_type" varchar(16) NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."bet_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bet_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."bet_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"uploader_user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content_type" varchar(64),
	"metadata" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."bet_participants" (
	"bet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"side" varchar(96) NOT NULL,
	"stake_locked_usdc" numeric(20, 6) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bet_participants_bet_id_user_id_pk" PRIMARY KEY("bet_id","user_id"),
	CONSTRAINT "bet_participants_stake_positive" CHECK ("app"."bet_participants"."stake_locked_usdc" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."bet_rules" (
	"bet_id" uuid NOT NULL,
	"rule_index" integer NOT NULL,
	"predicate" jsonb NOT NULL,
	"display" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bet_rules_bet_id_rule_index_pk" PRIMARY KEY("bet_id","rule_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."bet_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"slug" varchar(32) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bet_share_links_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."bet_templates" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"category" varchar(32) NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"predicate_kind" varchar(32) NOT NULL,
	"sides_schema" jsonb,
	"default_settlement_fee_bps" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app"."bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short_code" varchar(16) NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"acceptor_user_id" uuid,
	"bet_type" varchar(24) NOT NULL,
	"template_id" varchar(64),
	"title" text NOT NULL,
	"description" text,
	"resolve_type" varchar(16) NOT NULL,
	"resolve_source" jsonb NOT NULL,
	"arbiter_type" varchar(24) DEFAULT 'none' NOT NULL,
	"stake_per_side_usdc" numeric(20, 6) NOT NULL,
	"creation_fee_usdc" numeric(20, 6) DEFAULT '0' NOT NULL,
	"settlement_fee_bps" integer NOT NULL,
	"creator_side" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'OPEN' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"event_at" timestamp with time zone,
	"evidence_deadline" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bets_short_code_unique" UNIQUE("short_code"),
	CONSTRAINT "bets_stake_positive" CHECK ("app"."bets"."stake_per_side_usdc" > 0),
	CONSTRAINT "bets_creation_fee_non_negative" CHECK ("app"."bets"."creation_fee_usdc" >= 0),
	CONSTRAINT "bets_settlement_fee_non_negative" CHECK ("app"."bets"."settlement_fee_bps" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_arbiters" ADD CONSTRAINT "bet_arbiters_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_arbiters" ADD CONSTRAINT "bet_arbiters_arbiter_user_id_users_id_fk" FOREIGN KEY ("arbiter_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_audit_log" ADD CONSTRAINT "bet_audit_log_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_audit_log" ADD CONSTRAINT "bet_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_events" ADD CONSTRAINT "bet_events_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_events" ADD CONSTRAINT "bet_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_evidence" ADD CONSTRAINT "bet_evidence_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_evidence" ADD CONSTRAINT "bet_evidence_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_participants" ADD CONSTRAINT "bet_participants_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_participants" ADD CONSTRAINT "bet_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_rules" ADD CONSTRAINT "bet_rules_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_share_links" ADD CONSTRAINT "bet_share_links_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "app"."bets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bet_share_links" ADD CONSTRAINT "bet_share_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bets" ADD CONSTRAINT "bets_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bets" ADD CONSTRAINT "bets_acceptor_user_id_users_id_fk" FOREIGN KEY ("acceptor_user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app"."bets" ADD CONSTRAINT "bets_template_id_bet_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."bet_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_arbiters_arbiter_idx" ON "app"."bet_arbiters" USING btree ("arbiter_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_audit_log_bet_idx" ON "app"."bet_audit_log" USING btree ("bet_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_events_bet_idx" ON "app"."bet_events" USING btree ("bet_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_events_type_idx" ON "app"."bet_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_evidence_bet_idx" ON "app"."bet_evidence" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_evidence_uploader_idx" ON "app"."bet_evidence" USING btree ("uploader_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_participants_user_idx" ON "app"."bet_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bet_share_links_bet_idx" ON "app"."bet_share_links" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bets_status_expires_idx" ON "app"."bets" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bets_creator_idx" ON "app"."bets" USING btree ("creator_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bets_acceptor_idx" ON "app"."bets" USING btree ("acceptor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bets_template_idx" ON "app"."bets" USING btree ("template_id");--> statement-breakpoint
-- Seed bet_templates with the Sprint 6 starter catalog. ON CONFLICT keeps
-- migrations idempotent on re-runs.
INSERT INTO "app"."bet_templates"
  ("id", "category", "display_name", "description", "predicate_kind", "sides_schema", "default_settlement_fee_bps", "active")
VALUES
  ('football.match_winner',   'football',  'Football match winner',   'Pick which team wins a football match.', 'team_wins',        '["home","away","draw"]'::jsonb, 250, true),
  ('basketball.match_winner', 'basketball','Basketball match winner', 'Pick which team wins a basketball match.', 'team_wins',      '["home","away"]'::jsonb,        250, true),
  ('hockey.match_winner',     'hockey',    'Hockey match winner',     'Pick which team wins a hockey match.',   'team_wins',        '["home","away","draw"]'::jsonb, 250, true),
  ('tennis.match_winner',     'tennis',    'Tennis match winner',     'Pick which player wins.',                'team_wins',        '["player_a","player_b"]'::jsonb,250, true),
  ('mma.match_winner',        'mma',       'MMA fight winner',        'Pick which fighter wins.',               'team_wins',        '["fighter_a","fighter_b"]'::jsonb,250, true),
  ('crypto.price_above',      'crypto',    'Crypto price above',      'Will the asset close above a target?',   'price_above',      NULL,                            250, true),
  ('crypto.price_below',      'crypto',    'Crypto price below',      'Will the asset close below a target?',   'price_below',      NULL,                            250, true)
ON CONFLICT ("id") DO NOTHING;