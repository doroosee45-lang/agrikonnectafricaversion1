export const DB_NAME = 'agrikonnect_comms_v1.db';
export const DB_SCHEMA_VERSION = 1;

export const CREATE_TABLES_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY NOT NULL,
    subject_type TEXT NOT NULL DEFAULT 'DIRECT',
    subject_id TEXT,
    title TEXT NOT NULL,
    subtitle TEXT,
    avatar_url TEXT,
    admin_org_id TEXT,
    participant_org_ids TEXT NOT NULL DEFAULT '[]',
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_body TEXT,
    last_message_at INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    updated_at INTEGER NOT NULL DEFAULT 0
  );`,
  `CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms (updated_at DESC);`,

  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    server_id TEXT UNIQUE,
    local_temp_id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_org_id TEXT,
    type TEXT NOT NULL DEFAULT 'TEXT',
    content TEXT NOT NULL,
    local_media_uri TEXT,
    remote_media_url TEXT,
    attachments TEXT NOT NULL DEFAULT '[]',
    read_by TEXT NOT NULL DEFAULT '[]',
    sync_status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );`,
  `CREATE INDEX IF NOT EXISTS idx_messages_local_temp_id ON messages (local_temp_id);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages (room_id, created_at ASC);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_sync_status ON messages (sync_status, created_at ASC);`,

  `CREATE TABLE IF NOT EXISTS outbox_queue (
    id TEXT PRIMARY KEY NOT NULL,
    local_temp_id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    action_type TEXT NOT NULL DEFAULT 'SEND_MESSAGE',
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_status_next ON outbox_queue (status, next_retry_at ASC, created_at ASC);`,

  `CREATE TABLE IF NOT EXISTS media_upload_queue (
    id TEXT PRIMARY KEY NOT NULL,
    local_temp_id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    local_uri TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'AUDIO',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    remote_url TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_media_queue_status ON media_upload_queue (status, created_at ASC);`,

  `CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );`,
];
