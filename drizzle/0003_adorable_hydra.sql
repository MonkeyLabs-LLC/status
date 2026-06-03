CREATE TABLE "components" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"tag" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"uptime_90d" jsonb DEFAULT '[]' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"brand" text,
	"domain" text,
	"launched" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "components_parent_idx" ON "components" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "components_kind_idx" ON "components" USING btree ("kind");