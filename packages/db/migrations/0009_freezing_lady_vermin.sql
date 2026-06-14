-- Sprint 14 — add public username to auth.users.
-- Added nullable first, backfilled for existing rows, then locked to NOT NULL
-- + UNIQUE + format CHECK so the migration is safe on populated databases.
ALTER TABLE "auth"."users" ADD COLUMN "username" varchar(20);--> statement-breakpoint
UPDATE "auth"."users" SET "username" = 'u_' || substr(replace("id"::text, '-', ''), 1, 18) WHERE "username" IS NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "auth"."users" ADD CONSTRAINT "users_username_format" CHECK ("auth"."users"."username" ~ '^[a-z0-9_]{3,20}$');
