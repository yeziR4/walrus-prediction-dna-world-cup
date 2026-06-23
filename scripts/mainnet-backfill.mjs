import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBlobId } from '../lib.mjs';

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const dnaApprovedDir = path.join(dataDir, 'dna-approved');
const approvedDir = path.join(dataDir, 'approved');
const aggregator = process.env.WALRUS_AGGREGATOR || 'https://aggregator.walrus-mainnet.walrus.space';

if (!process.argv.includes('--yes')) {
  console.error('Refusing to run without --yes. This script writes approved local demo data to Walrus Mainnet.');
  process.exit(1);
}

if (process.env.MAINNET_PUBLISH_ENABLED !== 'true') {
  console.error('Set MAINNET_PUBLISH_ENABLED=true before running the mainnet backfill.');
  process.exit(1);
}

if (!process.env.WALRUS_WRITE_COMMAND || !process.env.WALRUS_DNA_INDEX_WRITE_COMMAND || !process.env.WALRUS_HEAD_WRITE_COMMAND) {
  console.error('Missing WALRUS_WRITE_COMMAND, WALRUS_DNA_INDEX_WRITE_COMMAND, or WALRUS_HEAD_WRITE_COMMAND.');
  process.exit(1);
}

await fs.mkdir(dnaApprovedDir, { recursive: true });
await fs.mkdir(approvedDir, { recursive: true });

const dnaRecords = await readDnaRecords();
console.log(`Publishing ${dnaRecords.length} Prediction DNA profiles to Walrus Mainnet...`);

const publishedDna = [];
for (const record of dnaRecords) {
  const profilePath = path.join(dnaApprovedDir, `${record.id}.profile.json`);
  const profilePayload = {
    type: 'prediction_dna_profile',
    id: record.id,
    ...record.profile,
    approvedAt: record.reviewedAt || record.updatedAt || record.submittedAt || new Date().toISOString()
  };
  await writeJson(profilePath, profilePayload);
  const profileWrite = record.walrus?.live && !process.env.FORCE_MAINNET_BACKFILL
    ? record.walrus
    : await walrusWrite(profilePath, process.env.WALRUS_WRITE_COMMAND);
  const updated = {
    ...record,
    status: 'published',
    reviewedAt: record.reviewedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    walrus: profileWrite
  };
  await writeJson(path.join(dnaApprovedDir, `${record.id}.json`), updated);
  publishedDna.push(updated);
  console.log(`✓ ${record.profile.displayName} → ${profileWrite.blobId}`);
}

const dnaIndex = buildDnaIndex(publishedDna);
const dnaIndexPath = path.join(dataDir, 'dna-index.json');
await writeJson(dnaIndexPath, dnaIndex);
const dnaIndexWrite = await walrusWrite(dnaIndexPath, process.env.WALRUS_DNA_INDEX_WRITE_COMMAND);
const finalDnaIndex = { ...dnaIndex, blobId: dnaIndexWrite.blobId, readUrl: `${aggregator}/v1/blobs/${dnaIndexWrite.blobId}` };
await writeJson(dnaIndexPath, finalDnaIndex);
console.log(`✓ DNA index → ${dnaIndexWrite.blobId}`);

const roomRecords = await readRoomRecords();
console.log(`Publishing ${roomRecords.length} Memory Room contributions to Walrus Mainnet...`);

const publishedRoom = [];
for (const record of roomRecords) {
  const contributionPath = path.join(approvedDir, `${record.id}.contribution.json`);
  await writeJson(contributionPath, record.contribution);
  const write = record.walrus?.live && !process.env.FORCE_MAINNET_BACKFILL
    ? record.walrus
    : await walrusWrite(contributionPath, process.env.WALRUS_WRITE_COMMAND);
  const updated = { ...record, status: 'published', reviewedAt: record.reviewedAt || new Date().toISOString(), walrus: write };
  await writeJson(path.join(approvedDir, `${record.id}.json`), updated);
  publishedRoom.push(updated);
  console.log(`✓ ${record.contribution.agent} / ${record.contribution.type} → ${write.blobId}`);
}

const previousHead = await readJson(path.join(dataDir, 'room-head.json')).catch(() => ({}));
const roomHead = {
  room: previousHead.room || 'world-cup-memory-room',
  version: Math.max(Number(previousHead.version || 0), publishedRoom.length),
  previousHead: previousHead.blobId || null,
  updatedAt: new Date().toISOString(),
  contributions: publishedRoom.map(record => ({
    id: record.id,
    type: record.contribution.type,
    blobId: record.walrus.blobId,
    agent: record.contribution.agent
  }))
};
const roomHeadPath = path.join(dataDir, 'room-head.json');
await writeJson(roomHeadPath, roomHead);
const roomHeadWrite = await walrusWrite(roomHeadPath, process.env.WALRUS_HEAD_WRITE_COMMAND);
const finalRoomHead = { ...roomHead, blobId: roomHeadWrite.blobId, readUrl: `${aggregator}/v1/blobs/${roomHeadWrite.blobId}` };
await writeJson(roomHeadPath, finalRoomHead);
console.log(`✓ Room head → ${roomHeadWrite.blobId}`);

console.log('\nMainnet backfill complete.');
console.log(`DNA index: ${finalDnaIndex.readUrl}`);
console.log(`Room head: ${finalRoomHead.readUrl}`);

async function readDnaRecords() {
  const files = (await fs.readdir(dnaApprovedDir)).filter(file => file.endsWith('.json') && !file.endsWith('.profile.json'));
  const records = [];
  for (const file of files) {
    const record = await readJson(path.join(dnaApprovedDir, file));
    if (record?.profile?.address && record?.profile?.summary) records.push(record);
  }
  return records.sort((a, b) => String(a.submittedAt || a.id).localeCompare(String(b.submittedAt || b.id)));
}

async function readRoomRecords() {
  let files = [];
  try { files = await fs.readdir(approvedDir); } catch { return []; }
  const records = [];
  for (const file of files.filter(name => name.endsWith('.json') && !name.endsWith('.contribution.json'))) {
    const record = await readJson(path.join(approvedDir, file));
    if (record?.contribution?.type && record?.contribution?.agent) records.push(record);
  }
  return records.sort((a, b) => String(a.submittedAt || a.id).localeCompare(String(b.submittedAt || b.id)));
}

function buildDnaIndex(records) {
  const previousByAddress = new Map();
  const profiles = records.map(record => {
    const previous = previousByAddress.get(record.polymarketAddress);
    const item = {
      id: record.id,
      address: record.polymarketAddress,
      displayName: record.profile.displayName,
      archetype: record.profile.archetype,
      blobId: record.walrus.blobId,
      supersedes: previous?.blobId || null
    };
    previousByAddress.set(record.polymarketAddress, item);
    return item;
  });
  return {
    type: 'prediction_dna_profile_index',
    version: profiles.length,
    network: 'Walrus Mainnet',
    updatedAt: new Date().toISOString(),
    profiles
  };
}

async function walrusWrite(file, commandTemplate) {
  const command = commandTemplate.replaceAll('{file}', file);
  const { file: executable, args } = splitCommand(command);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { stdout, stderr } = await execFileAsync(executable, args, { cwd: root, timeout: 180000, windowsHide: true, maxBuffer: 1_000_000 });
      const blobId = parseBlobId(`${stdout}\n${stderr}`);
      if (!blobId) throw new Error('Walrus CLI completed but no blob ID could be parsed.');
      const readUrl = `${aggregator}/v1/blobs/${blobId}`;
      await verifyWalrusRead(blobId);
      return { live: true, verified: true, blobId, readUrl, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1500);
    }
  }
  throw new Error(`Walrus publication failed after 3 attempts: ${safeError(lastError)}`);
}

async function verifyWalrusRead(blobId) {
  const url = `${aggregator}/v1/blobs/${blobId}`;
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Aggregator returned HTTP ${response.status}.`);
      await response.arrayBuffer();
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await sleep(attempt * 1000);
    }
  }
  throw new Error(`Walrus read-back verification failed: ${safeError(lastError)}`);
}

function splitCommand(command) {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(p => p.replace(/^"|"$/g, '')) || [];
  if (!parts.length) throw new Error('Empty Walrus command.');
  return { file: parts[0], args: parts.slice(1) };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeError(error) {
  return String(error?.message || error || 'Unknown error').replace(/suiprivkey\S+/gi, '[REDACTED]').slice(0, 500);
}
