/**
 * 端到端管线测试
 * 用小星星验证: MusicXML → 调性分析 → LLM和弦生成 → 输出
 *
 * 运行: npx tsx scripts/test-pipeline.ts
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { HarmonizePipeline } from '../src/harmonizer/harmonize-pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
config({ path: resolve(__dirname, '../.env.local') });

const apiKey = process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
  console.error('Missing DASHSCOPE_API_KEY in .env.local');
  process.exit(1);
}

async function main() {
  // 加载小星星 MusicXML
  const xml = readFileSync(
    resolve(__dirname, '../tests/fixtures/twinkle.xml'),
    'utf-8'
  );

  console.log('=== Harmony Engine 端到端测试 ===\n');

  // 先不启用 RAG，只用 LLM 测试基本流程
  const pipeline = new HarmonizePipeline({
    apiKey,
    phrasesPath: resolve(__dirname, '../data/hooktheory_phrases.json'),
    model: 'qwen-plus',
    difficulty: 'basic',
    enableRAG: false, // 先关闭 RAG 节省 API 调用
  });

  const result = await pipeline.harmonizeFromXML(xml);

  console.log('\n=== 结果 ===');
  console.log(`调性: ${result.keyAnalysis.key} (置信度: ${(result.keyAnalysis.confidence * 100).toFixed(0)}%)`);
  console.log(`小节数: ${result.stats.totalMeasures}`);
  console.log(`API 调用: ${result.stats.apiCalls} 次`);
  console.log(`耗时: ${(result.stats.durationMs / 1000).toFixed(1)}s`);

  console.log('\n=== 和弦标注 ===');
  for (const measure of result.score.measures) {
    const chordStr = measure.chords.length > 0
      ? measure.chords.map(c => {
          const acc = c.rootAccidental === 'sharp' ? '#' :
                     c.rootAccidental === 'flat' ? 'b' : '';
          const qualityMap: Record<string, string> = {
            major: '', minor: 'm', dominant7: '7', major7: 'maj7',
            minor7: 'm7', diminished: 'dim', augmented: 'aug',
            'half-dim7': 'ø7', diminished7: 'dim7', sus2: 'sus2', sus4: 'sus4',
          };
          return `${acc}${c.root}${qualityMap[c.quality] ?? ''}`;
        }).join(' → ')
      : '(无)';
    console.log(`  小节 ${measure.number}: ${chordStr}`);
  }
}

main().catch(console.error);
