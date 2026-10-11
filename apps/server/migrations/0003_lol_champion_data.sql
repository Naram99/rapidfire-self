CREATE TABLE "app_admin" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lol_champion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dataset_id" uuid NOT NULL,
	"riot_key" integer NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"icon" text NOT NULL,
	"resource_name" text NOT NULL,
	"resource_type" text NOT NULL,
	"skin_count" integer NOT NULL,
	"chroma_count" integer,
	"raw" jsonb NOT NULL,
	CONSTRAINT "lol_champion_riot" UNIQUE("dataset_id","riot_key"),
	CONSTRAINT "lol_champion_source" UNIQUE("dataset_id","source_id"),
	CONSTRAINT "lol_champion_counts" CHECK ("lol_champion"."skin_count" >= 0 AND ("lol_champion"."chroma_count" IS NULL OR "lol_champion"."chroma_count" >= 0))
);
--> statement-breakpoint
CREATE TABLE "lol_champion_stats" (
	"champion_id" uuid PRIMARY KEY NOT NULL,
	"hp" numeric NOT NULL,
	"hp_per_level" numeric NOT NULL,
	"mp" numeric NOT NULL,
	"mp_per_level" numeric NOT NULL,
	"move_speed" numeric NOT NULL,
	"armor" numeric NOT NULL,
	"armor_per_level" numeric NOT NULL,
	"magic_resist" numeric NOT NULL,
	"magic_resist_per_level" numeric NOT NULL,
	"attack_range" numeric NOT NULL,
	"hp_regen" numeric NOT NULL,
	"hp_regen_per_level" numeric NOT NULL,
	"mp_regen" numeric NOT NULL,
	"mp_regen_per_level" numeric NOT NULL,
	"crit" numeric NOT NULL,
	"crit_per_level" numeric NOT NULL,
	"attack_damage" numeric NOT NULL,
	"attack_damage_per_level" numeric NOT NULL,
	"attack_speed" numeric NOT NULL,
	"attack_speed_per_level" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lol_champion_tag" (
	"id" uuid PRIMARY KEY NOT NULL,
	"champion_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "lol_tag_champion" UNIQUE("champion_id","tag")
);
--> statement-breakpoint
CREATE TABLE "lol_import_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requested_by_user_id" uuid,
	"locale" text NOT NULL,
	"mode" text NOT NULL,
	"source_version" text,
	"dataset_id" uuid,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"processed_champions" integer DEFAULT 0 NOT NULL,
	"total_champions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text,
	CONSTRAINT "lol_import_status" CHECK ("lol_import_run"."status" IN ('queued','running','unchanged','succeeded','failed','aborted')),
	CONSTRAINT "lol_import_mode" CHECK ("lol_import_run"."mode" IN ('latest','reimport')),
	CONSTRAINT "lol_import_progress" CHECK ("lol_import_run"."processed_champions" BETWEEN 0 AND "lol_import_run"."total_champions")
);
--> statement-breakpoint
CREATE TABLE "lol_passive" (
	"champion_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lol_skin" (
	"id" uuid PRIMARY KEY NOT NULL,
	"champion_id" uuid NOT NULL,
	"source_skin_id" text NOT NULL,
	"skin_num" integer NOT NULL,
	"name" text NOT NULL,
	"is_chroma" boolean NOT NULL,
	"parent_skin_id" uuid,
	"is_base" boolean NOT NULL,
	"source_has_chromas" boolean,
	"chroma_count" integer,
	CONSTRAINT "lol_skin_source" UNIQUE("champion_id","source_skin_id"),
	CONSTRAINT "lol_skin_num" UNIQUE("champion_id","skin_num"),
	CONSTRAINT "lol_skin_parent_target" UNIQUE("champion_id","id"),
	CONSTRAINT "lol_skin_parent" CHECK (("lol_skin"."is_chroma" = ("lol_skin"."parent_skin_id" IS NOT NULL)) AND ("lol_skin"."parent_skin_id" IS NULL OR "lol_skin"."parent_skin_id" <> "lol_skin"."id")),
	CONSTRAINT "lol_skin_base" CHECK ("lol_skin"."is_base" = (NOT "lol_skin"."is_chroma" AND "lol_skin"."skin_num" = 0) AND (NOT "lol_skin"."is_chroma" OR "lol_skin"."skin_num" > 0)),
	CONSTRAINT "lol_skin_count" CHECK ("lol_skin"."skin_num" >= 0 AND ("lol_skin"."chroma_count" IS NULL OR "lol_skin"."chroma_count" >= 0))
);
--> statement-breakpoint
CREATE TABLE "lol_source_payload" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dataset_id" uuid NOT NULL,
	"resource_key" text NOT NULL,
	"source_path" text NOT NULL,
	"sha256" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "lol_payload_resource" UNIQUE("dataset_id","resource_key")
);
--> statement-breakpoint
CREATE TABLE "lol_spell" (
	"id" uuid PRIMARY KEY NOT NULL,
	"champion_id" uuid NOT NULL,
	"source_spell_id" text NOT NULL,
	"slot" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"max_rank" integer NOT NULL,
	"cooldowns_by_rank" jsonb NOT NULL,
	"cooldown_rank_1" numeric,
	"cooldown_display" text NOT NULL,
	"cost_display" text NOT NULL,
	"range_display" text NOT NULL,
	"damage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_effect" jsonb,
	CONSTRAINT "lol_spell_slot" UNIQUE("champion_id","slot"),
	CONSTRAINT "lol_spell_source" UNIQUE("champion_id","source_spell_id"),
	CONSTRAINT "lol_spell_slot_check" CHECK ("lol_spell"."slot" IN ('Q','W','E','R')),
	CONSTRAINT "lol_spell_rank" CHECK ("lol_spell"."max_rank" > 0 AND jsonb_array_length("lol_spell"."cooldowns_by_rank") = "lol_spell"."max_rank" AND ("lol_spell"."cooldown_rank_1" IS NULL OR "lol_spell"."cooldown_rank_1" > 0))
);
--> statement-breakpoint
CREATE TABLE "question_catalog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"locale" text NOT NULL,
	"active_dataset_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_topic_locale" UNIQUE("topic_id","locale")
);
--> statement-breakpoint
CREATE TABLE "question_dataset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"source" text NOT NULL,
	"source_version" text NOT NULL,
	"locale" text NOT NULL,
	"normalization_version" text NOT NULL,
	"content_hash" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expected_champions" integer NOT NULL,
	"imported_champions" integer DEFAULT 0 NOT NULL,
	"counts" jsonb,
	CONSTRAINT "dataset_content_unique" UNIQUE("topic_id","source","source_version","locale","normalization_version","content_hash"),
	CONSTRAINT "dataset_catalog_target" UNIQUE("id","topic_id","locale"),
	CONSTRAINT "dataset_status" CHECK ("question_dataset"."status" IN ('staging','ready','failed')),
	CONSTRAINT "dataset_counts" CHECK ("question_dataset"."expected_champions" > 0 AND "question_dataset"."imported_champions" BETWEEN 0 AND "question_dataset"."expected_champions"),
	CONSTRAINT "dataset_ready" CHECK ("question_dataset"."status" <> 'ready' OR ("question_dataset"."content_hash" IS NOT NULL AND "question_dataset"."completed_at" IS NOT NULL AND "question_dataset"."counts" IS NOT NULL AND "question_dataset"."imported_champions" = "question_dataset"."expected_champions"))
);
--> statement-breakpoint
ALTER TABLE "app_admin" ADD CONSTRAINT "app_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_champion" ADD CONSTRAINT "lol_champion_dataset_id_question_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."question_dataset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_champion_stats" ADD CONSTRAINT "lol_champion_stats_champion_id_lol_champion_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."lol_champion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_champion_tag" ADD CONSTRAINT "lol_champion_tag_champion_id_lol_champion_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."lol_champion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_import_run" ADD CONSTRAINT "lol_import_run_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_import_run" ADD CONSTRAINT "lol_import_run_dataset_id_question_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."question_dataset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_passive" ADD CONSTRAINT "lol_passive_champion_id_lol_champion_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."lol_champion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_skin" ADD CONSTRAINT "lol_skin_champion_id_lol_champion_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."lol_champion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_skin" ADD CONSTRAINT "lol_skin_parent_skin_id_lol_skin_id_fk" FOREIGN KEY ("parent_skin_id") REFERENCES "public"."lol_skin"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_skin" ADD CONSTRAINT "lol_skin_same_champion_parent" FOREIGN KEY ("champion_id","parent_skin_id") REFERENCES "public"."lol_skin"("champion_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_source_payload" ADD CONSTRAINT "lol_source_payload_dataset_id_question_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."question_dataset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lol_spell" ADD CONSTRAINT "lol_spell_champion_id_lol_champion_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."lol_champion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_catalog" ADD CONSTRAINT "catalog_dataset_fk" FOREIGN KEY ("active_dataset_id","topic_id","locale") REFERENCES "public"."question_dataset"("id","topic_id","locale") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lol_tag_lookup" ON "lol_champion_tag" USING btree ("tag","champion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lol_one_active_import" ON "lol_import_run" USING btree ("locale") WHERE "lol_import_run"."status" IN ('queued','running');--> statement-breakpoint
CREATE INDEX "lol_import_recent" ON "lol_import_run" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lol_skin_children" ON "lol_skin" USING btree ("champion_id","parent_skin_id");