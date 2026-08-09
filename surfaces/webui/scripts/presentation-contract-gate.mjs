#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(root, 'apps/mfg/source.lock.json'), 'utf8'));
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/presentation/result-shape-v1.schema.json'), 'utf8'));
const generated = readFileSync(resolve(root, 'src/apps/presentation/types.ts'), 'utf8');
const stagedManifest = readFileSync(resolve(root, '.cowd/apps/mfg/Cargo.toml'), 'utf8');
const digest = createHash('sha256').update(JSON.stringify(contract.schema)).digest('hex');
if (contract.contract_id !== lock.presentation_schema || contract.schema_sha256 !== digest) throw new Error('presentation schema snapshot identity or digest is invalid');
if (digest !== lock.presentation_schema_sha256 || !generated.includes(digest)) throw new Error('presentation TypeScript contract drifted from the canonical schema snapshot');
if (!stagedManifest.includes(`revision = "${lock.cowd_revision}"`)) throw new Error('locked MFG source does not consume the reviewed Cowd presentation contract revision');
process.stdout.write(`${JSON.stringify({ status: 'ok', schema: contract.contract_id, digest, cowd_revision: lock.cowd_revision })}\n`);
