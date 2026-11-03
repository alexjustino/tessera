import { describe, expect, it } from 'vitest';

import { cleanBody, emailHtml, emailText } from './emailDraft';

describe('the body', () => {
  it('turns a marker into its word', () => {
    expect(
      cleanBody('<p data-note-marker="question" data-note-label="Question">Which licence?</p>'),
    ).toBe('<p><strong>Question:</strong> Which licence?</p>');
  });

  it('keeps what a mail program can show', () => {
    const html =
      '<h2>Topics</h2><ul><li><p><strong>Bold</strong> and <mark>marked</mark></p></li></ul>';
    expect(cleanBody(html)).toBe(html);
  });

  it('keeps a link', () => {
    const html = '<p><a href="https://example.com">site</a></p>';
    expect(cleanBody(html)).toBe(html);
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('takes out what only this product reads', () => {
    expect(cleanBody('<p class="x" data-block="1" style="color:red">Hi</p>')).toBe('<p>Hi</p>');
  });
});

describe('the message', () => {
  it('greets, and lists the follow-ups with their dates', () => {
    const html = emailHtml('<p>Topic</p>', [
      { title: 'Send the quote', due: 'Nov 5' },
      { title: 'Call back', due: null },
    ]);
    expect(html).toContain('<p>Hi,</p><p>Topic</p>');
    expect(html).toContain('<li>Send the quote (Nov 5)</li>');
    expect(html).toContain('<li>Call back</li>');
  });

  it('has no follow-up heading when there are none', () => {
    expect(emailHtml('<p>Topic</p>', [])).not.toContain('Follow-ups');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('escapes a task title, which is typed text and not markup', () => {
    expect(emailHtml('', [{ title: '<script>x</script>', due: null }])).not.toContain('<script>');
  });

  it('says the same in plain text', () => {
    expect(emailText(['Topic'], [{ title: 'Send', due: 'Nov 5' }])).toBe(
      'Hi,\n\nTopic\n\nFollow-ups:\n- Send (Nov 5)',
    );
  });
});
