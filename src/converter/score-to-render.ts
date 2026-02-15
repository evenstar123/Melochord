/**
 * Score → PDF / PNG 渲染导出
 *
 * 利用 verovio（MusicXML 渲染引擎）将带和弦的 MusicXML
 * 渲染为 SVG，再通过 sharp 转为 PNG，或通过 pdfkit 输出 PDF。
 *
 * 导出流程：
 *   enrichedXml → verovio → SVG(per page) → sharp → PNG
 *   enrichedXml → verovio → SVG(per page) → sharp(PNG) → pdfkit → PDF
 */

// @ts-ignore — verovio 没有类型定义
import verovio from 'verovio';
import sharp from 'sharp';

/** 渲染选项 */
export interface RenderOptions {
  /** 缩放比例（默认 40） */
  scale?: number;
  /** 页面宽度 mm（默认 210 = A4） */
  pageWidth?: number;
  /** 页面高度 mm（默认 297 = A4） */
  pageHeight?: number;
}

const DEFAULT_OPTS: Required<RenderOptions> = {
  scale: 40,
  pageWidth: 210,
  pageHeight: 297,
};

/** 缓存 verovio toolkit 实例 */
let cachedToolkit: any = null;

async function getToolkit(): Promise<any> {
  if (cachedToolkit) return cachedToolkit;
  return new Promise<any>((resolve, reject) => {
    verovio.module.onRuntimeInitialized = () => {
      try {
        cachedToolkit = new verovio.toolkit();
        resolve(cachedToolkit);
      } catch (err) {
        reject(err);
      }
    };
  });
}

/**
 * MusicXML → 逐页 SVG 字符串数组
 */
export async function musicxmlToSVGPages(
  musicxml: string,
  opts?: RenderOptions,
): Promise<string[]> {
  const o = { ...DEFAULT_OPTS, ...opts };
  const tk = await getToolkit();

  tk.setOptions({
    scale: o.scale,
    pageWidth: o.pageWidth * 10,
    pageHeight: o.pageHeight * 10,
    adjustPageHeight: true,
  });

  tk.loadData(musicxml);

  const pageCount = tk.getPageCount();
  const pages: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    pages.push(tk.renderToSVG(i));
  }
  return pages;
}

/**
 * MusicXML → SVG 字符串（第一页，向后兼容）
 */
export async function musicxmlToSVG(
  musicxml: string,
  opts?: RenderOptions,
): Promise<string> {
  const pages = await musicxmlToSVGPages(musicxml, opts);
  return pages[0] || '';
}

/**
 * 单个 SVG 字符串 → PNG Buffer
 */
async function svgToPNG(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * MusicXML → PNG Buffer
 * 多页时垂直拼接所有页面
 */
export async function musicxmlToPNG(
  musicxml: string,
  opts?: RenderOptions,
): Promise<Buffer> {
  const svgPages = await musicxmlToSVGPages(musicxml, opts);

  if (svgPages.length === 0) {
    throw new Error('Verovio 未生成任何页面');
  }

  // 单页直接转
  if (svgPages.length === 1) {
    return svgToPNG(svgPages[0]);
  }

  // 多页：逐页转 PNG，然后垂直拼接
  const pngBuffers: Buffer[] = [];
  const metas: { width: number; height: number }[] = [];

  for (const svg of svgPages) {
    const buf = await svgToPNG(svg);
    const meta = await sharp(buf).metadata();
    pngBuffers.push(buf);
    metas.push({ width: meta.width || 0, height: meta.height || 0 });
  }

  const totalWidth = Math.max(...metas.map(m => m.width));
  const totalHeight = metas.reduce((sum, m) => sum + m.height, 0);

  // 用 sharp composite 垂直拼接
  const composites: { input: Buffer; top: number; left: number }[] = [];
  let yOffset = 0;
  for (let i = 0; i < pngBuffers.length; i++) {
    composites.push({ input: pngBuffers[i], top: yOffset, left: 0 });
    yOffset += metas[i].height;
  }

  return sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * MusicXML → PDF Buffer
 * 每个 verovio 页面对应 PDF 中的一页
 */
export async function musicxmlToPDF(
  musicxml: string,
  opts?: RenderOptions,
): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit');
  const svgPages = await musicxmlToSVGPages(musicxml, opts);

  if (svgPages.length === 0) {
    throw new Error('Verovio 未生成任何页面');
  }

  // A4 尺寸 (pt): 595.28 x 841.89
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 36;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;

  // 逐页转 PNG
  const pngPages: { buffer: Buffer; width: number; height: number }[] = [];
  for (const svg of svgPages) {
    const buf = await svgToPNG(svg);
    const meta = await sharp(buf).metadata();
    pngPages.push({
      buffer: buf,
      width: meta.width || 595,
      height: meta.height || 842,
    });
  }

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin,
      autoFirstPage: false,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    for (const page of pngPages) {
      doc.addPage({ size: 'A4', margin });

      // 等比缩放到页面可用区域
      const scaleW = availW / page.width;
      const scaleH = availH / page.height;
      const scale = Math.min(1, scaleW, scaleH);
      const drawW = page.width * scale;
      const drawH = page.height * scale;

      doc.image(page.buffer, margin, margin, {
        width: drawW,
        height: drawH,
      });
    }

    doc.end();
  });
}
