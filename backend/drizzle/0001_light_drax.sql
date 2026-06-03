CREATE TABLE "sensor_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"config" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source" text DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" text DEFAULT 'system';