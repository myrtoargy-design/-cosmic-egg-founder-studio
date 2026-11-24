export const ITERATIONS = 600_000;
export const QUESTIONNAIRE_CONTEXT = 'cosmic-egg:questionnaire:v7:1';
export const PROGRESS_CONTEXT = 'cosmic-egg:progress:v7:1';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value) {
  if (typeof value !== 'string') throw new TypeError('Expected encoded data');
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function deriveKey(password, salt, iterations) {
  if (salt.length !== 16 || iterations !== ITERATIONS) throw new Error('Unsupported key parameters');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealBytes(key, plaintext, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context), tagLength: 128 },
    key,
    plaintext,
  );
  return { iv: base64(iv), ciphertext: base64(new Uint8Array(data)) };
}

export async function openBytes(key, envelope, context) {
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  if (iv.length !== 12 || ciphertext.length < 16) throw new Error('Invalid encrypted data');
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context), tagLength: 128 },
    key,
    ciphertext,
  ));
}

export function seal(key, value, context) {
  return sealBytes(key, encoder.encode(JSON.stringify(value)), context);
}

export async function open(key, envelope, context) {
  return decodeJson(await openBytes(key, envelope, context));
}

export function decodeJson(bytes) {
  return JSON.parse(decoder.decode(bytes));
}

export function validateQuestionnaire(dataset) {
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  if (dataset?.dataset_id !== 'cosmic-egg-v7-canonical-74' || dataset.section_count !== 11 ||
      dataset.question_count !== 74 || !Array.isArray(dataset.sections) || dataset.sections.length !== 11 ||
      !Array.isArray(dataset.questions) || dataset.questions.length !== 74 ||
      !dataset.sections.every(nonempty) || new Set(dataset.sections).size !== 11) {
    throw new Error('Expected canonical v7 with 74 decisions across 11 sections');
  }
  const ids = new Set();
  const sections = new Set();
  for (const question of dataset.questions) {
    if (!question || !['id', 'title', 'why', 'source', 'owner'].every((field) => nonempty(question[field])) ||
        ids.has(question.id) || !dataset.sections.includes(question.section)) {
      throw new Error('Invalid canonical decision');
    }
    ids.add(question.id);
    sections.add(question.section);
    if (question.type === 'text') {
      if (!nonempty(question.placeholder)) throw new Error('Invalid free-text decision');
    } else {
      if (!['single', 'multi'].includes(question.type) || !Array.isArray(question.options) ||
          !question.options.length || !question.options.every(nonempty) ||
          new Set(question.options).size !== question.options.length) {
        throw new Error('Invalid decision options');
      }
      const recommendations = question.type === 'multi' ? question.recommended : [question.recommended];
      if (!Array.isArray(recommendations) || !recommendations.length ||
          !recommendations.every((value) => question.options.includes(value))) {
        throw new Error('Invalid decision recommendations');
      }
    }
  }
  if ([...sections].some((section, index) => section !== dataset.sections[index]) || sections.size !== 11) {
    throw new Error('Invalid decision section order or membership');
  }
  return dataset;
}
