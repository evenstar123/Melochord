/**
 * Audiveris OMR 测试脚本
 *
 * 用法：
 *   npx tsx scripts/test-omr.ts <乐谱图片或PDF路径>
 *   npx tsx scripts/test-omr.ts tests/fixtures/twinkle.xml  # 不行，要图片
 *   npx tsx scripts/test-omr.ts path/to/score.png
 *   npx tsx scripts/test-omr.ts path/to/score.pdf
 */

import { recognizeScore } from '../src/omr/audiveris-omr.js';
import { parseMusicXML } from '../src/parser/musicxml-parser.js';
import { formatKey } from '../src/analyzer/key-analyzer.js';
import fs from 'fs/promises';

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('用法: npx tsx scripts/test-omr.ts <乐谱图片或PDF路径>');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Audiveris OMR 测试');
  console.log(`输入: ${inputPath}`);
  console.log('='.repeat(60));

  console.log('\n[1] 调用 Audiveris 识别...');
  const startTime = Date.now();

  try {
    const result = await recognizeScore(inputPath);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`    识别完成 (${elapsed}s)`);
    console.log(`    MusicXML 长度: ${result.musicxml.length} 字符`);

    // 保存 MusicXML
    const outputPath = inputPath.replace(/\.[^.]+$/, '_omr.musicxml');
    await fs.writeFile(outputPath, result.musicxml, 'utf-8');
    console.log(`    已保存: ${outputPath}`);

    // 解析 MusicXML 为 Score
    console.log('\n[2] 解析 MusicXML...');
    const score = parseMusicXML(result.musicxml);
    console.log(`    标题: ${score.title}`);
    console.log(`    作曲: ${score.composer}`);
    console.log(`    调性: ${formatKey(score.key)}`);
    console.log(`    拍号: ${score.time.beats}/${score.time.beatType}`);
    console.log(`    速度: ${score.tempo} BPM`);
    console.log(`    小节数: ${score.measures.length}`);

    // 统计音符
    let noteCount = 0;
    let restCount = 0;
    for (const m of score.measures) {
      for (const e of m.events) {
        if (e.type === 'note') noteCount++;
        else restCount++;
      }
    }
    console.log(`    音符数: ${noteCount}`);
    console.log(`    休止符: ${restCount}`);

    // 打印前几个小节的音符
    console.log('\n[3] 前 4 小节音符:');
    for (const m of score.measures.slice(0, 4)) {
      const notes = m.events
        .filter(e => e.type === 'note')
        .map(e => {
          const n = e as any;
          const acc = n.pitch.accidental !== 'none' ? `(${n.pitch.accidental})` : '';
          return `${n.pitch.step}${acc}${n.pitch.octave}`;
        });
      console.log(`    小节 ${m.number}: ${notes.join(' ')}`);
    }

    console.log('\n[4] Audiveris 日志 (最后 10 行):');
    const logLines = result.log.split('\n').filter(l => l.trim());
    for (const line of logLines.slice(-10)) {
      console.log(`    ${line}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('测试完成');

  } catch (err: any) {
    console.error(`\n识别失败: ${err.message}`);
    if (err.message.includes('Audiveris 未找到')) {
      console.error('\n请安装 Audiveris:');
      console.error('  Windows: winget install Audiveris');
      console.error('  或从 https://github.com/Audiveris/audiveris/releases 下载');
    }
    process.exit(1);
  }
}

main();
