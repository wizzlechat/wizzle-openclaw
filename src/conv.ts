// wizzle conversation ids on OpenClaw: one default conversation per agent, plus topics.
export const CHANNEL_ID = 'wizzle';
const PREFIX = 'wizzle:agent:';
const TOPIC_SLUG_MAX = 40;
const SLUG_SUFFIX_MAX = 9;
const MAX_CONV_CHARS = 200;

export function convForAgent(agentId: string): string {
  return `${PREFIX}${agentId}`;
}

export function topicConv(agentId: string, slug: string): string {
  return `${PREFIX}${agentId}:${slug}`;
}

// A slug means a topic; no slug means the agent's default conversation.
export function parseConv(conv: string): { agentId: string; slug?: string } | undefined {
  if (!conv.startsWith(PREFIX) || conv.length > MAX_CONV_CHARS) return undefined;
  const rest = conv.slice(PREFIX.length);
  const cut = rest.indexOf(':');
  if (cut < 0) return rest.length > 0 ? { agentId: rest } : undefined;
  const agentId = rest.slice(0, cut);
  const slug = rest.slice(cut + 1);
  if (agentId.length === 0 || slug.length === 0 || slug.includes(':')) return undefined;
  return { agentId, slug };
}

export function slugForTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TOPIC_SLUG_MAX)
    .replace(/-+$/, '');
}

// The title's slug, or the first of -2 to -9 that is free; null when all are taken.
export function freeSlug(title: string, taken: ReadonlySet<string>): string | null {
  const base = slugForTitle(title) || 'topic';
  if (!taken.has(base)) return base;
  for (let n = 2; n <= SLUG_SUFFIX_MAX; n++) {
    const slug = `${base}-${n}`;
    if (!taken.has(slug)) return slug;
  }
  return null;
}
