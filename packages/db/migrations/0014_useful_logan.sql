CREATE TABLE IF NOT EXISTS "financial"."withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_usdc" numeric(20, 6) NOT NULL,
	"destination_wallet" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending_review' NOT NULL,
	"available_at_request_usdc" numeric(20, 6) NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_requests_amount_positive" CHECK ("financial"."withdrawal_requests"."amount_usdc" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawal_requests_user_idx" ON "financial"."withdrawal_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawal_requests_status_idx" ON "financial"."withdrawal_requests" USING btree ("status","created_at");