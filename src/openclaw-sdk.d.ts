// OpenClaw 2026.10.9 ships these two SDK subpaths without type declarations.
// Only what wizzle calls, typed from the OpenClaw source of that release.
declare module 'openclaw/plugin-sdk/session-transcript-runtime' {
  export type SessionTranscriptMessageEntry = {
    entryId: string;
    parentId: string | null;
    seq: number;
    message: Record<string, unknown>;
    role: string;
    createdAt?: string;
    idempotencyKey?: string;
  };
  export type SessionTranscriptTargetParams = { agentId?: string; sessionKey: string; sessionId: string; storePath?: string };
  export function readVisibleSessionTranscriptMessageEntries(params: SessionTranscriptTargetParams): Promise<SessionTranscriptMessageEntry[]>;
  export function readSessionTranscriptEvents(params: SessionTranscriptTargetParams): Promise<Array<Record<string, unknown>>>;
}

declare module 'openclaw/plugin-sdk/outbound-media' {
  export type OutboundMediaLoadOptions = {
    maxBytes?: number;
    mediaLocalRoots?: readonly string[] | 'any';
    workspaceDir?: string;
    optimizeImages?: boolean;
  };
  export function loadOutboundMediaFromUrl(
    mediaUrl: string,
    options?: OutboundMediaLoadOptions,
  ): Promise<{ buffer: Buffer; contentType?: string; kind: string | undefined; fileName?: string }>;
}
