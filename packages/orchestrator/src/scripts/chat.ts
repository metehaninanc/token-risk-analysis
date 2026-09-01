/**
 * Simple terminal REPL for the conversational layer. Paste an Ethereum address
 * to load its risk profile and see the opening summary, then ask follow-up
 * questions. Works offline against archived profiles (data/{address}/
 * risk_profile.json), so it can be demoed without re-running collectors.
 *
 * Under every answer it prints the grounding profile's address + timestamp, for
 * transparency in the dissertation's example dialogues / screenshots.
 *
 * Usage:
 *   npm run build
 *   node dist/src/scripts/chat.js
 */
import { createInterface } from 'node:readline';
import { type Session, handleMessage, newSession } from '../conversation/index.js';

async function main(): Promise<void> {
  let session: Session = newSession();
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  console.log('Token risk chat — paste an Ethereum address to analyze, then ask questions.');
  console.log('Type "exit" or "quit" to leave.\n');
  process.stdout.write('> ');

  for await (const line of rl) {
    const text = line.trim();
    if (text === 'exit' || text === 'quit') break;
    if (text === '') {
      process.stdout.write('> ');
      continue;
    }

    const result = await handleMessage(text, session);
    session = result.session;

    console.log(`\n${result.reply}\n`);
    if (session.profile) {
      console.log(`  [grounded on ${session.profile.address} @ ${session.profile.timestamp}]\n`);
    }
    process.stdout.write('> ');
  }

  rl.close();
  console.log('\nbye');
}

main().catch((err: unknown) => {
  console.error('chat crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
