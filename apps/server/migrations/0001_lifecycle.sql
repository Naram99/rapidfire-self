INSERT INTO game_status(code) VALUES ('in_progress'), ('completed'), ('interrupted');
--> statement-breakpoint
CREATE FUNCTION rapidfire_create_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_profile(user_id, nickname) VALUES (NEW.id, NEW.name);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rapidfire_user_profile AFTER INSERT ON "user"
FOR EACH ROW EXECUTE FUNCTION rapidfire_create_profile();
--> statement-breakpoint
CREATE FUNCTION rapidfire_delete_user_data() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM game WHERE mode = 'solo' AND id IN
    (SELECT game_id FROM user_game WHERE user_id = OLD.id);
  UPDATE game_participant SET display_name = NULL, identity_state = 'deleted_user', updated_at = now()
    WHERE id IN (SELECT participant_id FROM user_game WHERE user_id = OLD.id);
  DELETE FROM verification WHERE value = OLD.id::text AND identifier LIKE 'reset-password:%';
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rapidfire_user_delete BEFORE DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION rapidfire_delete_user_data();
