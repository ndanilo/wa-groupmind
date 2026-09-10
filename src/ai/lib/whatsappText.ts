/*
Deterministic WhatsApp formatting for text replies.

The answer prompts already forbid markdown, but a prompt is not a guarantee: a model that
slips in a `**negrito**`, a `## título` or a `- item` has it delivered verbatim, and WhatsApp
renders the punctuation literally instead of styling anything. This pass runs on every text
answer so the wire format never depends on the model behaving.

WhatsApp understands *bold*, _italic_, ~strike~ and ```mono``` — nothing else. Everything
here converts to that vocabulary or drops out.
*/

/** Fence lines carry no content of their own. */
const CODE_FENCE = /^[ \t]*```.*$/gm
const INLINE_CODE = /`([^`\n]+)`/g
const BOLD_MARKDOWN = /\*\*([^*\n]+)\*\*/g
const BOLD_UNDERSCORES = /__([^_\n]+)__/g
const STRIKE_MARKDOWN = /~~([^~\n]+)~~/g
/** `## Título ##` — the trailing hashes are optional in markdown. */
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]*(.+?)[ \t]*#*[ \t]*$/gm
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g
/** A bullet needs the space: `*negrito*` is styling, `* item` is a list. */
const BULLET = /^[ \t]*(?:[-–+•]|\*)[ \t]+/gm
/** `|---|:--:|` and friends: a table rule with no content. */
const TABLE_RULE = /^[ \t]*\|?[\s:|-]*\|[\s:|-]*$\n?/gm
const TABLE_ROW = /^[ \t]*\|(.+)\|[ \t]*$/gm
const ESCAPED_MARKDOWN = /\\([*_~`#[\]()])/g
const TRAILING_SPACES = /[ \t]+$/gm
/**
 * A line broken mid-sentence, which is how copied source text arrives: the address in
 * "Suite 700,\nCampbell, California" is one sentence, and WhatsApp has no reason to wrap it
 * there. Only a comma qualifies, and never before a blank line, a bullet or a list number.
 */
const WRAPPED_LINE = /,\n(?![\s*•]|\d+[.)])/g
const BLANK_LINES = /\n{3,}/g

/** Already-bold lines must not end up as `**título**` after the heading rewrite. */
function boldLine(text: string): string {
  const trimmed = text.trim()
  const bare = trimmed.replace(/^\*+|\*+$/g, '').trim()
  return bare === '' ? '' : `*${bare}*`
}

/** Renders a markdown table row as a plain line, since WhatsApp has no table syntax. */
function tableRow(cells: string): string {
  return cells
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell !== '')
    .join(' — ')
}

/**
 * Rewrites model output into the only formatting WhatsApp actually renders.
 *
 * Conservative by design: it converts syntax and never rewrites wording, so an answer that
 * was already clean comes back untouched.
 */
export function toWhatsAppText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(CODE_FENCE, '')
    .replace(INLINE_CODE, '$1')
    .replace(BOLD_MARKDOWN, '*$1*')
    .replace(BOLD_UNDERSCORES, '*$1*')
    .replace(STRIKE_MARKDOWN, '~$1~')
    .replace(HEADING, (_match, text: string) => boldLine(text))
    .replace(MARKDOWN_LINK, '$1: $2')
    .replace(TABLE_RULE, '')
    .replace(TABLE_ROW, (_match, cells: string) => tableRow(cells))
    .replace(BULLET, '• ')
    .replace(ESCAPED_MARKDOWN, '$1')
    .replace(TRAILING_SPACES, '')
    .replace(WRAPPED_LINE, ', ')
    .replace(BLANK_LINES, '\n\n')
    .trim()
}
