-- Remove unused index on note_content.user_id
-- This index is not used because queries always filter by note_id (primary key) first,
-- and note_id is unique, so the user_id filter is redundant for query optimization.
-- RLS policies already enforce that users can only access their own data.

DROP INDEX IF EXISTS idx_note_content_user_id;

