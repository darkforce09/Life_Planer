ALTER TABLE "courses" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "is_completed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_course_code_unique" UNIQUE("course_code");