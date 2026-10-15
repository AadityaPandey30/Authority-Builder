import type { PublishResult } from '../publisher';

/** Prints a compact operator summary of a publish result to stdout. */
export function notifyViaWhatsApp(result: PublishResult): void {
  const lines = [
    '',
    `Result:    ${result.status}`,
    `Post date: ${result.postDate}`,
    `Recipient: ${result.phone}`,
  ];
  if (result.post) {
    lines.push(`Pillar:    ${result.post.pillarId}`, `Topic:     ${result.post.topic}`, `Image:     ${result.post.imageUrl}`);
  }
  if (result.error) {
    lines.push(`Error:     ${result.error}`);
  }
  process.stdout.write(`${lines.join('\n')}\n\n`);
}
