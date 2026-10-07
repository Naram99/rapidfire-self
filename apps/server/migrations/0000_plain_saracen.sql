CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status_code" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"interruption_reason" text,
	"round_count" integer NOT NULL,
	"questions_per_round" integer NOT NULL,
	"answer_time_ms" integer NOT NULL,
	"start_countdown_ms" integer NOT NULL,
	"category_selection_ms" integer NOT NULL,
	"question_countdown_ms" integer NOT NULL,
	"evaluation_ms" integer NOT NULL,
	"final_results_ms" integer NOT NULL,
	"rules_version" text NOT NULL,
	"scoring_version" text NOT NULL,
	"checkpoint_question_number" integer NOT NULL,
	"persistence_revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_mode" CHECK ("game"."mode" IN ('solo', 'multiplayer')),
	CONSTRAINT "game_round_count" CHECK ("game"."round_count" BETWEEN 1 AND 10),
	CONSTRAINT "game_question_count" CHECK ("game"."questions_per_round" = 5),
	CONSTRAINT "game_answer_time" CHECK ("game"."answer_time_ms" BETWEEN 5000 AND 60000 AND "game"."answer_time_ms" % 1000 = 0),
	CONSTRAINT "game_revision" CHECK ("game"."persistence_revision" >= 1),
	CONSTRAINT "game_checkpoint" CHECK ("game"."checkpoint_question_number" BETWEEN 0 AND "game"."round_count" * "game"."questions_per_round"),
	CONSTRAINT "game_times" CHECK ("game"."start_countdown_ms" > 0 AND "game"."category_selection_ms" > 0 AND "game"."question_countdown_ms" > 0 AND "game"."evaluation_ms" > 0 AND "game"."final_results_ms" > 0),
	CONSTRAINT "game_status_consistent" CHECK ((
    ("game"."status_code" = 'in_progress' AND "game"."ended_at" IS NULL AND "game"."interruption_reason" IS NULL) OR
    ("game"."status_code" = 'completed' AND "game"."ended_at" IS NOT NULL AND "game"."interruption_reason" IS NULL) OR
    ("game"."status_code" = 'interrupted' AND "game"."ended_at" IS NOT NULL AND "game"."interruption_reason" IS NOT NULL)
  ) AND ("game"."ended_at" IS NULL OR "game"."ended_at" >= "game"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "game_participant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"display_name" text,
	"identity_state" text NOT NULL,
	"participant_order" integer NOT NULL,
	"participation_status" text NOT NULL,
	"left_at" timestamp with time zone,
	"total_score" integer NOT NULL,
	"final_rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_game_order" UNIQUE("game_id","participant_order"),
	CONSTRAINT "participant_game_id" UNIQUE("game_id","id"),
	CONSTRAINT "participant_order_positive" CHECK ("game_participant"."participant_order" > 0),
	CONSTRAINT "participant_score_rank" CHECK ("game_participant"."total_score" >= 0 AND ("game_participant"."final_rank" IS NULL OR "game_participant"."final_rank" > 0)),
	CONSTRAINT "participant_identity" CHECK (("game_participant"."identity_state" = 'registered' AND "game_participant"."display_name" IS NOT NULL) OR ("game_participant"."identity_state" = 'deleted_user' AND "game_participant"."display_name" IS NULL)),
	CONSTRAINT "participant_status" CHECK (("game_participant"."participation_status" = 'participating' AND "game_participant"."left_at" IS NULL) OR ("game_participant"."participation_status" = 'left' AND "game_participant"."left_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "game_question_result" (
	"participant_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"question_number" integer NOT NULL,
	"question_type" text NOT NULL,
	"option_count" integer NOT NULL,
	"outcome" text NOT NULL,
	"correct_option_count" integer NOT NULL,
	"selected_correct_count" integer NOT NULL,
	"selected_incorrect_count" integer NOT NULL,
	"points_awarded" integer NOT NULL,
	CONSTRAINT "game_question_result_participant_id_round_number_question_number_pk" PRIMARY KEY("participant_id","round_number","question_number"),
	CONSTRAINT "result_numbers" CHECK ("game_question_result"."round_number" BETWEEN 1 AND 10 AND "game_question_result"."question_number" BETWEEN 1 AND 5),
	CONSTRAINT "result_counts" CHECK ("game_question_result"."option_count" IN (2,4,6) AND "game_question_result"."correct_option_count" BETWEEN 1 AND "game_question_result"."option_count" AND "game_question_result"."selected_correct_count" BETWEEN 0 AND "game_question_result"."correct_option_count" AND "game_question_result"."selected_incorrect_count" BETWEEN 0 AND ("game_question_result"."option_count" - "game_question_result"."correct_option_count") AND "game_question_result"."points_awarded" >= 0),
	CONSTRAINT "result_type" CHECK (("game_question_result"."question_type" = 'single' AND "game_question_result"."correct_option_count" = 1 AND "game_question_result"."selected_correct_count" + "game_question_result"."selected_incorrect_count" <= 1) OR ("game_question_result"."question_type" = 'multiple' AND "game_question_result"."correct_option_count" < "game_question_result"."option_count")),
	CONSTRAINT "result_outcome" CHECK ("game_question_result"."outcome" IN ('correct','partial','incorrect','unanswered') AND ("game_question_result"."outcome" <> 'unanswered' OR ("game_question_result"."selected_correct_count" = 0 AND "game_question_result"."selected_incorrect_count" = 0 AND "game_question_result"."points_awarded" = 0)))
);
--> statement-breakpoint
CREATE TABLE "game_status" (
	"code" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_game" (
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_game_user_id_game_id_pk" PRIMARY KEY("user_id","game_id"),
	CONSTRAINT "user_game_participant_id_unique" UNIQUE("participant_id")
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"elo" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_nickname_length" CHECK (char_length("user_profile"."nickname") BETWEEN 1 AND 40),
	CONSTRAINT "profile_elo" CHECK ("user_profile"."elo" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_status_code_game_status_code_fk" FOREIGN KEY ("status_code") REFERENCES "public"."game_status"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_participant" ADD CONSTRAINT "game_participant_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_question_result" ADD CONSTRAINT "game_question_result_participant_id_game_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."game_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game" ADD CONSTRAINT "user_game_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_game" ADD CONSTRAINT "user_game_game_id_participant_id_game_participant_game_id_id_fk" FOREIGN KEY ("game_id","participant_id") REFERENCES "public"."game_participant"("game_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "game_status_idx" ON "game" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "participant_game_idx" ON "game_participant" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "user_game_game_idx" ON "user_game" USING btree ("game_id");