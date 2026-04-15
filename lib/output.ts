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
import type { Config } from './config.js'

interface ToolResult {
    content: { type: 'text'; text: string }[]
    details: object
}

// Builds the filesystem access description for the tool description. Includes the project directory
// (always read/write) plus any extra paths from config so the agent knows what's available.
export function isolatePathAdvice(config: Config): string {
    const rwPaths = ['the project directory', ...config.extraWritePaths]
    const roPaths = config.extraReadPaths

    let advice = `Filesystem read/write: ${rwPaths.join(', ')}.`
    if (roPaths.length > 0) {
        advice += ` Read-only: ${roPaths.join(', ')}.`
    }
    return advice
}

// Truncates output to fit the context window (10000 lines / 50KB), saves the full output to a temp
// file if truncated, and throws on non-zero exit codes. Returns a tool result like:
//
// { content: [{ type: 'text', text: '42' }], details: {} }
export function buildResult(output: string, exitCode: number): ToolResult {
    const truncation = truncateTail(output.trimEnd(), {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
    })

    let text = truncation.content

    if (truncation.truncated) {
        text += saveTruncatedOutput(output, truncation)
    }

    if (exitCode !== 0) {
        throw new Error(text || `exit code ${exitCode}`)
    }

    return { content: [{ type: 'text' as const, text }], details: {} }
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
