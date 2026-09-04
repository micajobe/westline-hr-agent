import type { FastifyReply } from 'fastify';

/** Minimal Server-Sent Events writer over Fastify's raw response. */
export class SseWriter {
  private closed = false;
  constructor(private readonly reply: FastifyReply) {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': westline\n\n');
    reply.raw.on('close', () => {
      this.closed = true;
    });
  }
  send(event: string, data: unknown): void {
    if (this.closed) return;
    this.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.reply.raw.end();
  }
}
