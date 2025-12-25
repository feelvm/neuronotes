-- Enable Realtime for all tables used in the application
-- This allows the app to receive instant updates via Supabase Realtime subscriptions

-- Enable replication for all tables
-- REPLICA IDENTITY FULL ensures all changes (including updates and deletes) are replicated
ALTER TABLE workspaces REPLICA IDENTITY FULL;
ALTER TABLE folders REPLICA IDENTITY FULL;
ALTER TABLE notes REPLICA IDENTITY FULL;
ALTER TABLE note_content REPLICA IDENTITY FULL;
ALTER TABLE calendar_events REPLICA IDENTITY FULL;
ALTER TABLE kanban REPLICA IDENTITY FULL;
ALTER TABLE settings REPLICA IDENTITY FULL;

-- Add tables to the supabase_realtime publication
-- This publication is automatically created by Supabase and is used for Realtime subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE workspaces;
ALTER PUBLICATION supabase_realtime ADD TABLE folders;
ALTER PUBLICATION supabase_realtime ADD TABLE notes;
ALTER PUBLICATION supabase_realtime ADD TABLE note_content;
ALTER PUBLICATION supabase_realtime ADD TABLE calendar_events;
ALTER PUBLICATION supabase_realtime ADD TABLE kanban;
ALTER PUBLICATION supabase_realtime ADD TABLE settings;

