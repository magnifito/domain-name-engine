import { readCredentials, redact, secretValues } from './registrars/credentials.js';
import { errorMessage } from './util/errors.js';

export interface StartupIo {
  stderr: (text: string) => void;
  exit: (code: number) => void;
  env: NodeJS.ProcessEnv;
}

const processIo: StartupIo = {
  stderr: (text) => process.stderr.write(text),
  exit: (code) => process.exit(code),
  env: process.env,
};

/**
 * Runs the server start function. On failure it writes one clean line to stderr
 * (stdout belongs to the MCP protocol) and exits with code 1. Key values are redacted.
 */
export async function runStartup(
  start: () => Promise<void>,
  io: StartupIo = processIo,
): Promise<void> {
  try {
    await start();
  } catch (error) {
    const message = redact(errorMessage(error), secretValues(readCredentials(io.env)));
    io.stderr(`domain-name-engine: failed to start: ${message}\n`);
    io.exit(1);
  }
}
