/**
 * Notes as an email: the words a person wrote, in the form a mail program reads.
 *
 * The body is what the editor renders, cleaned of what only this product can read.
 * A marker becomes its word, because a stylesheet does not travel in an email.
 *
 * Pure: no I/O, no React, no host.
 */

export interface FollowUpLine {
  title: string;
  /** A local date already in words, or null. */
  due: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Turn markers into words, and take out the attributes nobody else can read. */
export function cleanBody(html: string): string {
  return html
    .replace(
      /<(p|h[1-3])([^>]*?)\sdata-note-label="([^"]*)"([^>]*)>/g,
      (_all, tag: string, before: string, label: string, after: string) =>
        `<${tag}${before}${after}><strong>${label}:</strong> `,
    )
    .replace(/\s(data-[a-z-]+|class|style|contenteditable|draggable)="[^"]*"/g, '');
}

/** The message, as HTML. */
export function emailHtml(body: string, followUps: readonly FollowUpLine[]): string {
  const list =
    followUps.length === 0
      ? ''
      : `<h3>Follow-ups</h3><ul>${followUps
          .map(
            (line) =>
              `<li>${escapeHtml(line.title)}${line.due === null ? '' : ` (${escapeHtml(line.due)})`}</li>`,
          )
          .join('')}</ul>`;
  return `<!doctype html><html><body style="font-family:'Segoe UI',sans-serif;font-size:11pt"><p>Hi,</p>${cleanBody(body)}${list}</body></html>`;
}

/** The message, as plain text, for a mail program that prefers it. */
export function emailText(lines: readonly string[], followUps: readonly FollowUpLine[]): string {
  const parts = ['Hi,', '', ...lines];
  if (followUps.length > 0) {
    parts.push('', 'Follow-ups:');
    for (const line of followUps) {
      parts.push(`- ${line.title}${line.due === null ? '' : ` (${line.due})`}`);
    }
  }
  return parts.join('\n');
}
