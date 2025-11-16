-- Optimize RLS policies by wrapping auth.uid() in subqueries
-- This prevents re-evaluation for each row and improves query performance

-- Drop and recreate workspaces policies
DROP POLICY IF EXISTS "Users can view own workspaces" ON workspaces;
DROP POLICY IF EXISTS "Users can insert own workspaces" ON workspaces;
DROP POLICY IF EXISTS "Users can update own workspaces" ON workspaces;
DROP POLICY IF EXISTS "Users can delete own workspaces" ON workspaces;

CREATE POLICY "Users can view own workspaces" ON workspaces
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own workspaces" ON workspaces
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own workspaces" ON workspaces
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own workspaces" ON workspaces
  FOR DELETE USING ((select auth.uid()) = user_id);

-- Drop and recreate folders policies
DROP POLICY IF EXISTS "Users can view own folders" ON folders;
DROP POLICY IF EXISTS "Users can insert own folders" ON folders;
DROP POLICY IF EXISTS "Users can update own folders" ON folders;
DROP POLICY IF EXISTS "Users can delete own folders" ON folders;

CREATE POLICY "Users can view own folders" ON folders
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own folders" ON folders
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own folders" ON folders
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own folders" ON folders
  FOR DELETE USING ((select auth.uid()) = user_id);

-- Drop and recreate notes policies
DROP POLICY IF EXISTS "Users can view own notes" ON notes;
DROP POLICY IF EXISTS "Users can insert own notes" ON notes;
DROP POLICY IF EXISTS "Users can update own notes" ON notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON notes;

CREATE POLICY "Users can view own notes" ON notes
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own notes" ON notes
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own notes" ON notes
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own notes" ON notes
  FOR DELETE USING ((select auth.uid()) = user_id);

-- Drop and recreate note_content policies
DROP POLICY IF EXISTS "Users can view own note_content" ON note_content;
DROP POLICY IF EXISTS "Users can insert own note_content" ON note_content;
DROP POLICY IF EXISTS "Users can update own note_content" ON note_content;
DROP POLICY IF EXISTS "Users can delete own note_content" ON note_content;

CREATE POLICY "Users can view own note_content" ON note_content
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own note_content" ON note_content
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own note_content" ON note_content
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own note_content" ON note_content
  FOR DELETE USING ((select auth.uid()) = user_id);

-- Drop and recreate calendar_events policies
DROP POLICY IF EXISTS "Users can view own calendar_events" ON calendar_events;
DROP POLICY IF EXISTS "Users can insert own calendar_events" ON calendar_events;
DROP POLICY IF EXISTS "Users can update own calendar_events" ON calendar_events;
DROP POLICY IF EXISTS "Users can delete own calendar_events" ON calendar_events;

CREATE POLICY "Users can view own calendar_events" ON calendar_events
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own calendar_events" ON calendar_events
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own calendar_events" ON calendar_events
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own calendar_events" ON calendar_events
  FOR DELETE USING ((select auth.uid()) = user_id);

-- Drop and recreate kanban policies
DROP POLICY IF EXISTS "Users can view own kanban" ON kanban;
DROP POLICY IF EXISTS "Users can insert own kanban" ON kanban;
DROP POLICY IF EXISTS "Users can update own kanban" ON kanban;
DROP POLICY IF EXISTS "Users can delete own kanban" ON kanban;

CREATE POLICY "Users can view own kanban" ON kanban
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own kanban" ON kanban
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own kanban" ON kanban
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own kanban" ON kanban
  FOR DELETE USING ((select auth.uid()) = user_id);

-- Drop and recreate settings policies
DROP POLICY IF EXISTS "Users can view own settings" ON settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON settings;
DROP POLICY IF EXISTS "Users can update own settings" ON settings;
DROP POLICY IF EXISTS "Users can delete own settings" ON settings;

CREATE POLICY "Users can view own settings" ON settings
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own settings" ON settings
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own settings" ON settings
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own settings" ON settings
  FOR DELETE USING ((select auth.uid()) = user_id);

