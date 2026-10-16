-- asset table: stores media assets (files, links, videos)
-- Required for media-management capability
CREATE TABLE IF NOT EXISTS asset (
    id UUID PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK (type IN ('file', 'link', 'video')),
    name TEXT NOT NULL,
    url TEXT,
    size INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for listing sorted by creation time
CREATE INDEX IF NOT EXISTS idx_asset_created_at ON asset(created_at DESC);

-- Index for reference resolution
CREATE INDEX IF NOT EXISTS idx_asset_id ON asset(id);