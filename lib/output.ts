import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    truncateTail,
    formatSize,
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    type TruncationResult,
} from '@mariozechner/pi-coding-agent'

interface ToolResult {
    content: { type: 'text'; text: string }[]
    details: object
}

// Shared wording for the isolate path rule — used in both the tool description and ENOENT hints.
export function isolatePathAdvice(cwd: string): string {
    return 'The sandbox isolate maps "/" to the project root.' +
        ' Use relative paths (e.g. "README.md") instead of host-absolute paths' +
        ` (e.g. "${cwd}/README.md").`
}

// Truncates output to fit the context window (10000 lines / 50KB), saves the full output to a temp
// file if truncated, and throws on non-zero exit codes. Returns a tool result like:
//
// { content: [{ type: 'text', text: '42' }], details: {} }
export function buildResult(output: string, exitCode: number, cwd?: string): ToolResult {
    const truncation = truncateTail(output.trimEnd(), {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
    })

    let text = truncation.content

    if (truncation.truncated) {
        text += saveTruncatedOutput(output, truncation)
    }

    if (exitCode !== 0) {
        text = appendPathHint(text, cwd)
        throw new Error(text || `exit code ${exitCode}`)
    }

    return { content: [{ type: 'text' as const, text }], details: {} }
}

// When an ENOENT error mentions the host cwd path, append a hint explaining that the sandbox
// roots "/" to the project directory, so host-absolute paths don't work.
function appendPathHint(text: string, cwd?: string): string {
    if (!cwd || !text.includes('ENOENT')) {
        return text
    }
    if (text.includes(cwd)) {
        return text + `\n\n[Hint: ${isolatePathAdvice(cwd)}]`
    }
    return text
}

// Saves the full untruncated output to a temp file and returns a truncation notice.
function saveTruncatedOutput(fullOutput: string, truncation: TruncationResult): string {
    const path = writeTruncatedOutput(fullOutput)

    return `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines` +
        ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
        ` Full output: ${path}]`
}

// Persists the full output to /tmp/pi-script-output/<timestamp>.txt so the user or LLM can access
// it after truncation. Returns the file path.
function writeTruncatedOutput(output: string): string {
    const dir = join(tmpdir(), 'pi-script-output')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${Date.now()}.txt`)
    writeFileSync(path, output, 'utf-8')
    return path
}
