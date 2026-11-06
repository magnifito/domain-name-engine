import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RegistrarRuntime } from '../registrars/runtime-part.js';
import { errorMessage } from '../util/errors.js';
import { toolError, toolJson } from './result.js';

export const KEYS_SETUP_NEXT_STEPS =
  'Tell the user to open the file at "path" in any text editor, paste each key after its = sign, and save. The server picks up the change on the next tool call, with no restart. Then run registrar_status to confirm. Never ask the user to paste a key into the chat, and never read or print the file contents.';

export function registerKeysSetup(
  server: McpServer,
  rt: Pick<RegistrarRuntime, 'keysSetup'>,
): void {
  server.registerTool(
    'keys_setup',
    {
      title: 'Create the API key file',
      description:
        'Creates the optional API key file (keys.env in the engine folder) from a template with every key name and an empty value, readable only by the current user. Never overwrites an existing file; makes an existing file private when other users can read it. Returns the file path and which names have a value, never the values. Use it when the user wants to add registrar or research API keys and is not using the Claude Code plugin settings form.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return toolJson({ ...rt.keysSetup(), nextSteps: KEYS_SETUP_NEXT_STEPS });
      } catch (error) {
        return toolError(`Could not create the key file: ${errorMessage(error)}`);
      }
    },
  );
}
