import { invokeTauri } from "./tauri";
import type { SessionTreeResponse } from "../types/config";

export const CHAT_STORAGE_KEY = "omninova-chat-sessions-v1";

export interface StoredAvatarSession {
  id: string;
  name: string;
  sessionId: string;
  lastAt: string;
}

export interface StoredChatMessage {
  role: "user" | "assistant" | "error";
  content: string;
  agent?: string;
}

export interface ChatStorageSnapshot {
  avatars: StoredAvatarSession[];
  activeAvatarId: string;
  messagesBySession: Record<string, StoredChatMessage[]>;
}

export interface GatewayChatHistoryMessage {
  role: string;
  content: string;
  agent?: string | null;
}

export interface GatewaySessionHistoryResponse {
  sessionId: string;
  channel: string;
  messages: GatewayChatHistoryMessage[];
  updatedAt?: number | null;
}

const DEFAULT_AVATARS: StoredAvatarSession[] = [
  {
    id: "main",
    name: "Main",
    sessionId: "omninova-chat-session",
    lastAt: formatTime(new Date()),
  },
];

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatTimeFromUnix(ts: number): string {
  if (!ts) return formatTime(new Date());
  return formatTime(new Date(ts * 1000));
}

export function sessionDisplayName(sessionId: string): string {
  if (sessionId === "omninova-chat-session") return "Main";
  const short = sessionId.replace(/^session-/, "").slice(0, 8);
  return short ? `对话 ${short}` : sessionId.slice(0, 12);
}

export function loadChatStorage(): ChatStorageSnapshot {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) {
      return {
        avatars: DEFAULT_AVATARS,
        activeAvatarId: "main",
        messagesBySession: { main: [] },
      };
    }
    const parsed = JSON.parse(raw) as Partial<ChatStorageSnapshot>;
    const avatars =
      parsed.avatars?.length && Array.isArray(parsed.avatars)
        ? parsed.avatars
        : DEFAULT_AVATARS;
    const activeAvatarId =
      parsed.activeAvatarId && avatars.some((a) => a.id === parsed.activeAvatarId)
        ? parsed.activeAvatarId
        : avatars[0]?.id ?? "main";
    return {
      avatars,
      activeAvatarId,
      messagesBySession: parsed.messagesBySession ?? {},
    };
  } catch {
    return {
      avatars: DEFAULT_AVATARS,
      activeAvatarId: "main",
      messagesBySession: { main: [] },
    };
  }
}

export function saveChatStorage(snapshot: ChatStorageSnapshot): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage 满或不可用时忽略
  }
}

export function toUiMessages(
  messages: GatewayChatHistoryMessage[]
): StoredChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      agent: m.agent ?? undefined,
    }));
}

export async function fetchSessionHistory(
  sessionId: string
): Promise<StoredChatMessage[]> {
  const res = await invokeTauri<GatewaySessionHistoryResponse>(
    "get_chat_session_history",
    {
      query: {
        sessionId,
        channel: "web",
      },
    }
  );
  return toUiMessages(res.messages ?? []);
}

export async function fetchWebSessionsFromGateway(): Promise<StoredAvatarSession[]> {
  const tree = await invokeTauri<SessionTreeResponse>("session_tree_snapshot", {
    query: {
      channel: "web",
      sortBy: "updated_at",
      sortOrder: "desc",
      limit: 50,
    },
  });
  const sessions = tree.sessions ?? [];
  const seen = new Set<string>();
  const out: StoredAvatarSession[] = [];

  for (const node of sessions) {
    const sessionId = node.session_id?.trim();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    out.push({
      id: sessionId === "omninova-chat-session" ? "main" : `sess-${sessionId}`,
      name: sessionDisplayName(sessionId),
      sessionId,
      lastAt: formatTimeFromUnix(node.updated_at ?? 0),
    });
  }

  if (!seen.has("omninova-chat-session")) {
    out.push(DEFAULT_AVATARS[0]);
  }

  return out;
}

export function mergeAvatarSessions(
  local: StoredAvatarSession[],
  remote: StoredAvatarSession[]
): StoredAvatarSession[] {
  const map = new Map<string, StoredAvatarSession>();
  for (const a of local) {
    map.set(a.sessionId, a);
  }
  for (const a of remote) {
    const existing = map.get(a.sessionId);
    if (!existing) {
      map.set(a.sessionId, a);
      continue;
    }
    map.set(a.sessionId, {
      ...existing,
      lastAt: a.lastAt || existing.lastAt,
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.sessionId === "omninova-chat-session") return -1;
    if (b.sessionId === "omninova-chat-session") return 1;
    return b.lastAt.localeCompare(a.lastAt);
  });
}
