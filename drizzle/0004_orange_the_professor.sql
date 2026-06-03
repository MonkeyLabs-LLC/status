ALTER TABLE "products" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "services" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "products" CASCADE;--> statement-breakpoint
DROP TABLE "services" CASCADE;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_parent_id_components_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_target_map" ADD CONSTRAINT "source_target_map_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE no action ON UPDATE no action;