CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_path" text NOT NULL,
	"course_folder" text,
	"content" text NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_code" text,
	"title" text NOT NULL,
	"exam_date" text,
	"course_name" text,
	"place" text,
	"sign_up_status" text,
	"sign_up_period" text,
	"exam_type" text,
	"scope" text,
	"module_name" text,
	"external_id" text,
	"scraped_at" timestamp DEFAULT now(),
	CONSTRAINT "exams_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "exams" ADD CONSTRAINT "exams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;