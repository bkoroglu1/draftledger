-- Installation settings an administrator can change without a redeploy. Only
-- presentation-level values are ever stored here. Secrets and connection
-- strings stay in the environment, out of reach of a database dump.
--
-- An explicitly set environment variable still wins at read time. This table
-- holds the value used when the operator has not pinned one.
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_people_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
