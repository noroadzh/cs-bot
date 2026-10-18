-- licensed_chat table: tracks chats where the bot has been activated.
-- License maxChats caps the number of distinct chats; a new chat beyond
-- the cap is refused by LicenseGateService (M9 群数上限).
CREATE TABLE IF NOT EXISTS licensed_chat (
    chat_id TEXT PRIMARY KEY,
    chat_name TEXT NOT NULL DEFAULT '',
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licensed_chat_added_at ON licensed_chat(added_at);
