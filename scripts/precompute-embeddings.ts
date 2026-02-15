/**
 * 预计算片段 embedding 脚本
 *
 * 读取 hooktheory_phrases.json，为每个有效片段调用 text-embedding-v4 生成 embedding，
 * 结果保存到 data/phrase_embeddings.json
 *
 * 用法: npx tsx scripts/precompute-embeddings.ts
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import OpenAI from 'openai';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.local') });

interface PhraseEntry {
  song_id: string;
  artist: string;
  song: string;
  mode: string;
  chord_sequence: string[];
  melody_intervals: number[];
}

function phraseToText(phrase: PhraseEntry): string {
  const parts: string[] = [];
  parts.push(`mode:${phrase.mode}`);
  if (phrase.melody_intervals.length > 0) {
    const contour = phrase.melody_intervals.map(i =>
      i > 0 ? `+${i}` : i < 0 ? `${i}` : '0'
    ).join(',');
    parts.push(`intervals:[${contour}]`);
  }
  parts.push(`chords:[${phrase.chord_sequence.join(' ')}]`);
  return parts.join(' ');
}

async function main() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    console.error('DASHSCOPE_API_KEY not set in .env.local');
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });

  const phrasesPath = resolve(__dirname, '../data/hooktheory_phrases.json');
  const outputPath = resolve(__dirname, '../data/phrase_embeddings.json');

  console.log('Loading phrases...');
  const allPhrases: PhraseEntry[] = JSON.parse(readFileSync(phrasesPath, 'utf-8'));

  // 过滤有效片段（有旋律且有和弦）
  const validPhrases = allPhrases.filter(
    p => p.chord_sequence.length > 0 && p.melody_intervals.length > 0
  );
  console.log(`Valid phrases: ${validPhrases.length} / ${allPhrases.length}`);

  // 生成文本描述
  const texts = validPhrases.map(phraseToText);

  // 分批调用 embedding API（DashScope 限制每批 10 条）
  const BATCH_SIZE = 10;
  const embeddings: number[][] = [];
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = texts.slice(i, i + BATCH_SIZE);

    process.stdout.write(`\rEmbedding batch ${batchNum}/${totalBatches}...`);

    try {
      const response = await client.embeddings.create({
        model: 'text-embedding-v4',
        input: batch,
      });
      for (const item of response.data) {
        embeddings.push(item.embedding);
      }
    } catch (err: any) {
      console.error(`\nError at batch ${batchNum}:`, err.message);
      // 如果某批失败，逐条重试
      for (const text of batch) {
        try {
          const response = await client.embeddings.create({
            model: 'text-embedding-v4',
            input: text,
          });
          embeddings.push(response.data[0].embedding);
        } catch (retryErr: any) {
          console.error(`\nFailed to embed: ${text.slice(0, 60)}...`, retryErr.message);
          // 填充零向量作为占位
          embeddings.push([]);
        }
      }
    }

    // 简单限速：每批之间等 200ms
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone. Got ${embeddings.length} embeddings.`);

  // 保存：索引与 validPhrases 一一对应
  // 输出格式：{ phrases: PhraseEntry[], embeddings: number[][] }
  const output = {
    phrases: validPhrases,
    embeddings,
  };

  writeFileSync(outputPath, JSON.stringify(output));
  console.log(`Saved to ${outputPath}`);
}

main().catch(console.error);
