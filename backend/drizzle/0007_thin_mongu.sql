CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"source" text,
	"message" text NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"current_stage" text,
	"stages" text DEFAULT '[]' NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp
);
