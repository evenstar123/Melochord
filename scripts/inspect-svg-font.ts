/**
 * 临时脚本：生成 SVG 并检查字体嵌入方式
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// @ts-ignore
import createVerovioModule from 'verovio/wasm';
// @ts-ignore
import { VerovioToolkit } from 'verovio/esm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const xml = readFileSync(path.resolve(__dirname, '../tests/fixtures/twinkle.xml'), 'utf-8');

  const VerovioModule = await createVerovioModule();
  const tk = new VerovioToolkit(VerovioModule);

  tk.setOptions({
    scale: 40,
    pageWidth: 2100,
    pageHeight: 2970,
    adjustPageHeight: true,
  });

  tk.loadData(xml);
  const svg = tk.renderToSVG(1);

  // 提取 <style> 或 @font-face 部分
  const styleMatch = svg.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    console.log('=== SVG <style> content ===');
    // 只打印前 500 字符（base64 很长）
    const content = styleMatch[1];
    console.log(content.substring(0, 500));
    console.log(`... (total ${content.length} chars)`);
  } else {
    console.log('No <style> found in SVG');
  }

  // 检查 font-family 引用
  const fontFamilyMatches = svg.match(/font-family="([^"]+)"/g);
  if (fontFamilyMatches) {
    const unique = [...new Set(fontFamilyMatches)];
    console.log('\n=== font-family references ===');
    unique.forEach(m => console.log(m));
  }

  // 保存完整 SVG 供检查
  writeFileSync(path.resolve(__dirname, '../test_data/inspect.svg'), svg);
  console.log('\nSVG saved to test_data/inspect.svg');
}

main().catch(console.error);
