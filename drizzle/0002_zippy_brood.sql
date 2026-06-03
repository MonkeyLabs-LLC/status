CREATE TABLE "observations" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"component_id" text NOT NULL,
	"signal" text NOT NULL,
	"detail" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_target_map" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"raw_label" text NOT NULL,
	"component_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'push' NOT NULL,
	"default_ttl" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "incident_timeline" ADD COLUMN "author" text DEFAULT 'engine' NOT NULL;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_target_map" ADD CONSTRAINT "source_target_map_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observations_component_observed_idx" ON "observations" USING btree ("component_id","observed_at");--> statement-breakpoint
CREATE INDEX "observations_source_component_observed_idx" ON "observations" USING btree ("source_id","component_id","observed_at");--> statement-breakpoint
CREATE INDEX "source_target_map_lookup_idx" ON "source_target_map" USING btree ("source_id","raw_label");--> statement-breakpoint
CREATE INDEX "sources_token_hash_idx" ON "sources" USING btree ("token_hash");