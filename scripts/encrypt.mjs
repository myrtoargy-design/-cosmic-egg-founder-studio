import { readFile, writeFile } from 'node:fs/promises';
import { base64, decodeJson, deriveKey, ITERATIONS, openBytes, QUESTIONNAIRE_CONTEXT, sealBytes, validateQuestionnaire } from '../site/crypto.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4 || input === output) {
  console.error('Usage: node scripts/encrypt.mjs /private/canonical.json site/questionnaire.enc.json (password on stdin)');
  process.exit(1);
}

try {
  const original = await readFile(input);
  validateQuestionnaire(decodeJson(original));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (password.length < 20) throw new Error('Use a randomly generated password or a strong passphrase of at least 20 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITERATIONS);
  const encrypted = await sealBytes(key, original, QUESTIONNAIRE_CONTEXT);
  const recovered = await openBytes(key, encrypted, QUESTIONNAIRE_CONTEXT);
  if (!original.equals(recovered)) throw new Error('Encryption verification failed');
  const envelope = { format: 1, iterations: ITERATIONS, salt: base64(salt), ...encrypted };
  await writeFile(output, JSON.stringify(envelope) + '\n', { flag: 'wx' });
  console.log('Encrypted and verified 74 decisions across 11 sections.');
} catch (error) {
  console.error(error instanceof SyntaxError ? 'The questionnaire must be valid JSON.' : error.message);
  process.exitCode = 1;
}
