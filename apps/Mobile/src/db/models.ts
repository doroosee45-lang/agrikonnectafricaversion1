export type MessageSyncStatus = 'PENDING' | 'UPLOADING' | 'SENT' | 'FAILED';
export type MessageContentType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT' | 'SYSTEM';
export type OutboxActionType = 'SEND_MESSAGE' | 'MARK_READ' | 'CREATE_GROUP';

export interface LocalRoom {
  id: string;
  subject_type: string;
  subject_id: string | null;
  title: string;
  subtitle: string | null;
  avatar_url: string | null;
  admin_org_id: string | null;
  participant_org_ids: string[];
  unread_count: number;
  last_message_body: string | null;
  last_message_at: number;
  status: string;
  updated_at: number;
}

export interface LocalMessage {
  id: string;
  server_id: string | null;
  local_temp_id: string;
  room_id: string;
  sender_id: string;
  sender_org_id: string | null;
  type: MessageContentType;
  content: string;
  local_media_uri: string | null;
  remote_media_url: string | null;
  attachments: string[];
  read_by: string[];
  sync_status: MessageSyncStatus;
  retry_count: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface OutboxQueueItem {
  id: string;
  local_temp_id: string;
  room_id: string;
  action_type: OutboxActionType;
  payload_json: string;
  status: MessageSyncStatus;
  retry_count: number;
  next_retry_at: number;
  created_at: number;
}

export interface MediaUploadQueueItem {
  id: string;
  local_temp_id: string;
  room_id: string;
  local_uri: string;
  filename: string;
  mime_type: string;
  kind: 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  size_bytes: number;
  remote_url: string | null;
  status: MessageSyncStatus;
  retry_count: number;
  created_at: number;
}
