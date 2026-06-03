ALTER TABLE "events" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_external_id_unique" UNIQUE("external_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_external_id_unique" UNIQUE("external_id");