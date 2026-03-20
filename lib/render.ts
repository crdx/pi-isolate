import type { Theme } from '@mariozechner/pi-coding-agent'
import { highlightCode, keyHint } from '@mariozechner/pi-coding-agent'

export const DEFAULT_TIMEOUT = 60
const COLLAPSED_LINES = 10

// Builds the styled header line for a script tool call.
//
//   → "script"
//   → "script with timeout 30s"
//   → "script calculate fibonacci sequence"
//   → "script with timeout 30s calculate fibonacci sequence"
export function buildCallHeader(args: Record<string, unknown>, theme: Theme): string {
    let header = theme.fg('toolTitle', theme.bold('script'))

    const timeout = args.timeout as number | undefined
    if (timeout && timeout !== DEFAULT_TIMEOUT) {
        header += ' ' + theme.fg('muted', `with timeout ${timeout}s`)
    }

    const intent = (args.intent as string | undefined) ?? ''
    if (intent) {
        header += ' ' + theme.fg('accent', intent)
    }

    return header
}

// Syntax-highlights TypeScript source for the TUI. Falls back to plain text if the highlighter
// throws (e.g. on malformed input mid-stream).
export function highlightScript(script: string, theme: Theme): string {
    try {
        return highlightCode(script.trim(), 'typescript', theme).join('\n')
    } catch {
        return script.trim()
    }
}

// Joins all text blocks from a tool result into a single string.
//
//   { content: [{ text: 'hello' }, { text: ' world' }] } → "hello world"
export function extractResultText(result: { content: object[] }): string {
    return result.content
        .filter((block): block is { text: string } => 'text' in block)
        .map(block => block.text)
        .join('')
}

// Returns the full text when expanded, or the last 10 lines when collapsed with a truncation notice
// matching pi's built-in format:
//
//   ... (90 more lines, 100 total, ctrl+o to expand)
//   line 91
//   ...
//   line 100
export function formatResultPreview(text: string, expanded: boolean, theme: Theme): string {
    if (expanded) {
        return text
    }

    const lines = text.split('\n')
    const displayLines = lines.slice(-COLLAPSED_LINES)
    const remaining = lines.length - displayLines.length

    let preview = ''

    if (remaining > 0) {
        preview += theme.fg('muted', `... (${remaining} more lines, ${lines.length} total, `)
        preview += keyHint('app.tools.expand', 'to expand')
        preview += theme.fg('muted', ')\n')
    }

    return preview + displayLines.join('\n')
}
