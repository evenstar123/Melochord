/**
 * 将 phrase_embeddings.json 转换为二进制格式
 *
 * 输出:
 *   - data/phrase_meta.json      (phrases 元数据，不含 embedding)
 *   - data/phrase_embeddings.bin  (Float32Array 二进制，每 1024 个 float 一条)
 *
 * 原 phrase_embeddings.json 保留不动。
 *
 * 用法: npx tsx scripts/convert-embeddings-to-bin.ts
 */

import { createReadStream, createWriteStream, writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parser } = require('stream-json');
const { pick } = require('stream-json/filters/Pick');
const { streamArray } = require('stream-json/streamers/StreamArray');
const { chain } = require('stream-chain');

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(__dirname, '../data/phrase_embeddings.json');
const META_OUT = resolve(__dirname, '../data/phrase_meta.json');
const BIN_OUT = resolve(__dirname, '../data/phrase_embeddings.bin');

const EMBEDDING_DIM = 1024;

interface PhraseEntry {
  song_id: string;
  artist: string;
  song: string;
  mode: string;
  chord_sequence: string[];
  melody_intervals: number[];
}

async function extractPhrases() {
  if (existsSync(META_OUT)) {
    const data = JSON.parse(readFileSync(META_OUT, 'utf-8'));
    console.log(`phrase_meta.json already exists (${data.length} phrases), skipping.`);
    return;
  }

  console.log('Phase 1: Extracting phrases...');
  const phrases: PhraseEntry[] = [];

  await new Promise<void>((res, rej) => {
    const pipeline = chain([
      createReadStream(INPUT),
      parser(),
      pick({ filter: 'phrases' }),
      streamArray(),
    ]);

    pipeline.on('data', ({ value }: { value: PhraseEntry }) => {
      phrases.push({
        song_id: value.song_id,
        artist: value.artist,
        song: value.song,
        mode: value.mode,
        chord_sequence: value.chord_sequence,
        melody_intervals: value.melody_intervals,
      });
      if (phrases.length % 10000 === 0) process.stdout.write(`\r  phrases: ${phrases.length}`);
    });

    pipeline.on('end', () => {
      console.log(`\n  Total: ${phrases.length}`);
      res();
    });
    pipeline.on('error', rej);
  });

  writeFileSync(META_OUT, JSON.stringify(phrases));
  console.log(`Saved phrase_meta.json`);
}

async function extractEmbeddings() {
  if (existsSync(BIN_OUT)) {
    const size = readFileSync(BIN_OUT).byteLength;
    const count = size / (EMBEDDING_DIM * 4);
    console.log(`phrase_embeddings.bin already exists (${count} embeddings), skipping.`);
    return;
  }

  console.log('Phase 2: Extracting embeddings to binary...');
  const binStream = createWriteStream(BIN_OUT);
  let count = 0;

  await new Promise<void>((res, rej) => {
    const pipeline = chain([
      createReadStream(INPUT),
      parser(),
      pick({ filter: 'embeddings' }),
      streamArray(),
    ]);

    pipeline.on('data', ({ value }: { value: number[] }) => {
      const buf = Buffer.alloc(value.length * 4);
      for (let i = 0; i < value.length; i++) {
        buf.writeFloatLE(value[i], i * 4);
      }
      binStream.write(buf);
      count++;
      if (count % 10000 === 0) process.stdout.write(`\r  embeddings: ${count}`);
    });

    pipeline.on('end', () => {
      binStream.end(() => {
        console.log(`\n  Total: ${count}`);
        res();
      });
    });
    pipeline.on('error', rej);
  });

  console.log(`Saved phrase_embeddings.bin`);
}

async function main() {
  console.log('=== Convert phrase_embeddings.json to binary format ===\n');
  await extractPhrases();
  await extractEmbeddings();

  // Verify
  const meta = JSON.parse(readFileSync(META_OUT, 'utf-8'));
  const binSize = readFileSync(BIN_OUT).byteLength;
  const embCount = binSize / (EMBEDDING_DIM * 4);
  console.log(`\nVerification:`);
  console.log(`  Phrases: ${meta.length}`);
  console.log(`  Embeddings: ${embCount}`);
  console.log(`  Match: ${meta.length === embCount ? 'YES' : 'NO - MISMATCH!'}`);
  console.log(`  Bin size: ${(binSize / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(console.error);
