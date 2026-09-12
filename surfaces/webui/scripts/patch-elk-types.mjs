// elkjs 0.10.2 indexes an optional children array in its generic return type.
// Keep strict declaration checking; patch only that invalid index, reproducibly.
import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../node_modules/elkjs/lib/elk-api.d.ts', import.meta.url);
const source = await readFile(path, 'utf8');
const before = "T['children'][number]";
const after = "NonNullable<T['children']>[number]";
if (source.includes(after) && !source.includes(before)) process.exit(0);
if (source.split(before).length !== 2) throw new Error('ELK declaration changed; review the optional children patch');
await writeFile(path, source.replace(before, after));
