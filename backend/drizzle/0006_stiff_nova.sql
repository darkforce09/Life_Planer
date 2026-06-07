ALTER TABLE "events" DROP CONSTRAINT "events_external_id_unique";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_external_id_unique";--> statement-breakpoint
ALTER TABLE "course_modules" ALTER COLUMN "examination_date" SET DATA TYPE timestamp USING NULLIF(NULLIF("examination_date", '-'), '')::timestamp;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "exam_date_time" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "impact_score" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_external_id_unique" ON "events" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_source_external_id_unique" ON "tasks" USING btree ("source","external_id");