import fs from 'node:fs';
import path from 'node:path';

import { freeSlug } from './conv.ts';

export type Topic = { agentId: string; slug: string; title: string; createdAt: number };

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

// Topic titles live in topics.json beside the pairing; OpenClaw only knows each topic's session.
export class TopicStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'topics.json');
  }

  list(): Topic[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { topics?: Topic[] };
      return Array.isArray(parsed.topics) ? parsed.topics : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  get(agentId: string, slug: string): Topic | undefined {
    return this.list().find((t) => t.agentId === agentId && t.slug === slug);
  }

  add(agentId: string, title: string, now = Date.now()): Topic {
    const topics = this.list();
    const slug = freeSlug(title, new Set(topics.filter((t) => t.agentId === agentId).map((t) => t.slug)));
    if (slug === null) throw coded('name_taken', 'Too many topics with that title');
    const topic: Topic = { agentId, slug, title, createdAt: now };
    this.write([...topics, topic]);
    return topic;
  }

  rename(agentId: string, slug: string, title: string): Topic {
    const topics = this.list();
    const topic = topics.find((t) => t.agentId === agentId && t.slug === slug);
    if (!topic) throw coded('unknown_conv', 'No such conversation');
    topic.title = title;
    this.write(topics);
    return topic;
  }

  remove(agentId: string, slug: string): void {
    this.write(this.list().filter((t) => !(t.agentId === agentId && t.slug === slug)));
  }

  // Written to a sibling temp file and renamed so a crash never leaves a torn file.
  private write(topics: Topic[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ topics })}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
