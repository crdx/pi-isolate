import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { Box, Text } from '@mariozechner/pi-tui'
import { Compiler } from './lib/compiler.js'
import { Sandbox } from './lib/isolate.js'
import { loadConfig } from './lib/config.js'
import { buildResult, isolatePathAdvice } from './lib/output.js'
import {
    DEFAULT_TIMEOUT, buildCallHeader, highlightScript,
    extractResultText, formatResultPreview,
} from './lib/render.js'

const compiler = new Compiler()
const sandbox = new Sandbox()
const config = loadConfig()

export default function(pi: ExtensionAPI) {
    pi.registerTool({
        name: 'run_script',
        label: 'Run Script',
        description:
            'Run TypeScript or JavaScript in a sandboxed V8 isolate.' +
            ' Network and subprocesses are unavailable.' +
            ` ${isolatePathAdvice(config)}` +
            ' Use console.log() for output.',
        promptSnippet:
            'Run code for calculations, data transformations, and bulk processing',
        parameters: Type.Object({
            intent: Type.String({
                description:
                    'Brief one-line intent note (start lowercase, do not repeat' +
                    ' the command text; shown in tool output after the word "script")',
            }),
            timeout: Type.Optional(Type.Number({
                description: 'Maximum runtime in seconds',
                default: DEFAULT_TIMEOUT,
            })),
            script: Type.String({
                description:
                    'TypeScript or JavaScript to execute as a string. The user' +
                    ' will see this so format it nicely with new lines and spacing,' +
                    ' etc, not as a single-line blob of code.',
            }),
        }),

        async execute(_toolCallId, params, signal, onUpdate, ctx) {
            const { script, timeout = DEFAULT_TIMEOUT, intent } = params

            if (intent.includes('\n')) {
                throw new Error('Intent must be a single line.')
            }

            const compiled = await compiler.run(script)

            const result = await sandbox.run({
                code: compiled.code,
                cwd: ctx.cwd,
                timeout,
                signal,
                onOutput: text => onUpdate?.({
                    content: [{ type: 'text', text: compiled.warnings + text }],
                    details: {},
                }),
            })

            return buildResult(compiled.warnings + result.output, result.exitCode)
        },

        renderCall(args, theme) {
            const box = new Box(0, 0)
            box.addChild(new Text(buildCallHeader(args, theme), 0, 0))

            const script = (args as { script?: string }).script ?? ''
            if (script) {
                box.addChild(new Text('\n' + highlightScript(script, theme) + '\n', 0, 0))
            }

            return box
        },

        renderResult(result, { expanded }, theme) {
            const box = new Box(0, 0)
            box.addChild(new Text(theme.fg('muted', '─'.repeat(40)) + '\n', 0, 0))

            const text = extractResultText(result)
            if (text) {
                box.addChild(new Text(formatResultPreview(text, expanded, theme), 0, 0))
            }

            return box
        },
    })
}
