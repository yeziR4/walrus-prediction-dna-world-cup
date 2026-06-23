import crypto from 'node:crypto';

export const ALLOWED_TYPES = ['roast', 'audit_note', 'fan_twin_update'];

export function validateDnaRequest(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Body must be a JSON object.'] };
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.polymarketAddress || '')) errors.push('polymarketAddress must be a valid 0x wallet address.');
  if (input.displayName !== undefined && !isText(input.displayName, 2, 60)) errors.push('displayName must be 2–60 characters.');
  return { ok: errors.length === 0, errors };
}

export function validateRoomMessage(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Body must be a JSON object.'] };
  if (!isText(input.contributor, 2, 80)) errors.push('contributor must be 2–80 characters.');
  if (!isText(input.message, 10, 1200)) errors.push('message must be 10–1200 characters.');
  if (input.role !== undefined && !['human', 'agent'].includes(input.role)) errors.push('role must be human or agent.');
  return { ok: errors.length === 0, errors };
}

export function heuristicClassify(message) {
  const text = message.toLowerCase();
  if (/correct|incorrect|wrong|receipt|verify|evidence|confidence/.test(text)) return 'audit_note';
  if (/twin|similar|match(?:ed|ing)? fan|same prediction|both/.test(text)) return 'fan_twin_update';
  return 'roast';
}

export function validateContribution(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['Body must be a JSON object.'] };
  const allowed = new Set(['schemaVersion', 'type', 'agent', 'subject', 'content', 'evidence', 'metadata']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) errors.push(`Unknown field: ${key}`);
  if (input.schemaVersion !== '1.0') errors.push('schemaVersion must be "1.0".');
  if (!ALLOWED_TYPES.includes(input.type)) errors.push(`type must be one of: ${ALLOWED_TYPES.join(', ')}.`);
  if (!isText(input.agent, 2, 80)) errors.push('agent must be 2–80 characters.');
  if (!isText(input.subject, 2, 120)) errors.push('subject must be 2–120 characters.');
  if (!isText(input.content, 10, 1200)) errors.push('content must be 10–1200 characters.');
  if (input.evidence !== undefined && (!Array.isArray(input.evidence) || input.evidence.length > 8 || input.evidence.some(v => !isText(v, 1, 500)))) errors.push('evidence must be an array of up to 8 strings.');
  if (input.metadata !== undefined && (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata) || JSON.stringify(input.metadata).length > 2000)) errors.push('metadata must be a small JSON object.');
  return { ok: errors.length === 0, errors };
}

function isText(value, min, max) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

export function normalizeContribution(input) {
  return {
    schemaVersion: '1.0', type: input.type, agent: input.agent.trim(), subject: input.subject.trim(),
    content: input.content.trim(), evidence: input.evidence || [], metadata: input.metadata || {}
  };
}

export function makeId() {
  return `wc_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export function appendDnaProfileIndex(index, entry, updatedAt = new Date().toISOString()) {
  const profiles = Array.isArray(index?.profiles) ? index.profiles : [];
  return { ...index, version: Number(index?.version || 0) + 1, updatedAt, profiles: [...profiles, entry] };
}

export function parseBlobId(output) {
  const patterns = [/blob[_\s-]?id["'\s:=]+([A-Za-z0-9_-]{20,})/i, /\/v1\/blobs\/([A-Za-z0-9_-]{20,})/i];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[1];
  }
  return null;
}
