CREATE TABLE "game_round_generation" (
	"game_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"category_id" text NOT NULL,
	"content_hash" text NOT NULL,
	CONSTRAINT "game_round_generation_game_id_round_number_pk" PRIMARY KEY("game_id","round_number"),
	CONSTRAINT "generation_round_number" CHECK ("game_round_generation"."round_number" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "question_generation_release" (
	"id" uuid PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"locale" text NOT NULL,
	"language" text NOT NULL,
	"source_version" text NOT NULL,
	"revision" integer NOT NULL,
	"dataset_id" uuid NOT NULL,
	"manifest_id" uuid NOT NULL,
	"generator_version" text NOT NULL,
	"seed_version" text NOT NULL,
	"prng_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"category_count" integer NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_generation_release_content_hash_unique" UNIQUE("content_hash"),
	CONSTRAINT "release_version_revision" UNIQUE("topic_id","locale","language","source_version","revision"),
	CONSTRAINT "release_counts" CHECK ("question_generation_release"."revision" >= 1 AND "question_generation_release"."category_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "question_template_manifest" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schema_version" integer NOT NULL,
	"language" text NOT NULL,
	"content_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_template_manifest_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "generation_release_id" uuid;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "generation_seed" text;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "seed_origin" text;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "elo_exclusion_reason" text;--> statement-breakpoint
ALTER TABLE "question_catalog" ADD COLUMN "default_release_id" uuid;--> statement-breakpoint
ALTER TABLE "game_round_generation" ADD CONSTRAINT "game_round_generation_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_generation_release" ADD CONSTRAINT "question_generation_release_dataset_id_question_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."question_dataset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_generation_release" ADD CONSTRAINT "question_generation_release_manifest_id_question_template_manifest_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."question_template_manifest"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_generation_release_id_question_generation_release_id_fk" FOREIGN KEY ("generation_release_id") REFERENCES "public"."question_generation_release"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_catalog" ADD CONSTRAINT "question_catalog_default_release_id_question_generation_release_id_fk" FOREIGN KEY ("default_release_id") REFERENCES "public"."question_generation_release"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_generation_context" CHECK ((("game"."generation_release_id" IS NULL AND "game"."generation_seed" IS NULL AND "game"."seed_origin" IS NULL AND "game"."elo_exclusion_reason" IS NULL) OR ("game"."generation_release_id" IS NOT NULL AND "game"."generation_seed" IS NOT NULL AND "game"."generation_seed" ~ '^[A-Za-z0-9]{1,10}$' AND "game"."seed_origin" IS NOT NULL AND (("game"."seed_origin" = 'automatic' AND "game"."elo_exclusion_reason" IS NULL) OR ("game"."seed_origin" = 'custom' AND "game"."elo_exclusion_reason" IS NOT NULL AND "game"."elo_exclusion_reason" = 'custom_seed')))));--> statement-breakpoint
-- Published releases/manifests never change. Revised content receives a new row.
CREATE FUNCTION rapidfire_immutable_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published generation content is immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER generation_release_immutable BEFORE UPDATE OR DELETE ON question_generation_release FOR EACH ROW EXECUTE FUNCTION rapidfire_immutable_generation();
--> statement-breakpoint
CREATE TRIGGER template_manifest_immutable BEFORE UPDATE OR DELETE ON question_template_manifest FOR EACH ROW EXECUTE FUNCTION rapidfire_immutable_generation();
--> statement-breakpoint
CREATE FUNCTION rapidfire_protect_release_dataset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; next_target uuid; champion uuid;
BEGIN
  IF TG_TABLE_NAME = 'question_dataset' THEN
    target := OLD.id;
  ELSIF TG_TABLE_NAME IN ('lol_champion', 'lol_source_payload') THEN
    IF TG_OP = 'INSERT' THEN target := NEW.dataset_id; ELSE target := OLD.dataset_id; END IF;
    IF TG_OP = 'UPDATE' THEN next_target := NEW.dataset_id; END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN champion := NEW.champion_id; ELSE champion := OLD.champion_id; END IF;
    SELECT dataset_id INTO target FROM lol_champion WHERE id = champion;
    IF TG_OP = 'UPDATE' THEN SELECT dataset_id INTO next_target FROM lol_champion WHERE id = NEW.champion_id; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM question_generation_release WHERE dataset_id = target OR dataset_id = next_target) THEN
    RAISE EXCEPTION 'Published dataset is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER release_dataset_immutable BEFORE UPDATE OR DELETE ON question_dataset FOR EACH ROW EXECUTE FUNCTION rapidfire_protect_release_dataset();
--> statement-breakpoint
CREATE TRIGGER release_payload_immutable BEFORE INSERT OR UPDATE OR DELETE ON lol_source_payload FOR EACH ROW EXECUTE FUNCTION rapidfire_protect_release_dataset();

--> statement-breakpoint
CREATE TRIGGER release_fact_immutable BEFORE INSERT OR UPDATE OR DELETE ON lol_champion FOR EACH ROW EXECUTE FUNCTION rapidfire_protect_release_dataset();

--> statement-breakpoint
CREATE TRIGGER release_fact_immutable BEFORE INSERT OR UPDATE OR DELETE ON lol_champion_stats FOR EACH ROW EXECUTE FUNCTION rapidfire_protect_release_dataset();

--> statement-breakpoint
CREATE TRIGGER release_fact_immutable BEFORE INSERT OR UPDATE OR DELETE ON lol_champion_tag FOR EACH ROW EXECUTE FUNCTION rapidfire_protect_release_dataset();

--> statement-breakpoint
CREATE TRIGGER release_fact_immutable BEFORE INSERT OR UPDATE OR DELETE ON lol_skin FOR EACH ROW EXECUTE FUNCTION rapidfire_protect_release_dataset();

--> statement-breakpoint
CREATE TRIGGER release_fact_immutable BEFORE INSERT OR UPDATE OR DELETE ON lol_spell FOR EACH ROW EXECUTE FUNCTION rapidfire_protect_release_dataset();

--> statement-breakpoint
CREATE TRIGGER release_fact_immutable BEFORE INSERT OR UPDATE OR DELETE ON lol_passive FOR EACH ROW EXECUTE FUNCTION rapidfire_protect_release_dataset();
