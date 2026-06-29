DROP INDEX IF EXISTS "withdrawal_requests_status_idx";--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "tx_signature" varchar(128);--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "ledger_txn_id" uuid;--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "processing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial"."withdrawal_requests" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawal_requests_status_idx" ON "financial"."withdrawal_requests" USING btree ("status","next_attempt_at");