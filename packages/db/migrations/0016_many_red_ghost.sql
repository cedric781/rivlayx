ALTER TABLE "auth"."users" ADD COLUMN "mfa_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "mfa_enrolled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "mfa_last_verified_step" bigint;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "mfa_failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "mfa_locked_until" timestamp with time zone;