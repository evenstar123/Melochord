import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import multer from 'multer';
import { HarmonizePipeline } from '../src/harmonizer/harmonize-pipeline.js';
import { injectChordsToMusicXML } from '../src/converter/ir-to-musicxml.js';
import { scoreToABC } from '../src/converter/ir-to-abc.js';
import { musicxmlToPNG, musicxmlToPDF } from '../src/converter/score-to-render.js';
import { recognizeBuffer } from '../src/omr/audiveris-omr.js';
import { mergeMusicXMLPages } from '../src/parser/musicxml-merge.js';
import type { ChordSymbol } from '../src/core/types.js';

// Load .env.local from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const app = express();

// Server configuration
const PORT = Number(process.env.PORT) || 4000;
const STATIC_DIR = path.resolve(__dirname, '../web');
const PHRASES_PATH = path.resolve(__dirname, '../data/hooktheory_phrases.json');

// Middleware
app.use(express.json({ limit: '50mb' }));

// File upload middleware for OMR (single and multi-page)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const uploadMulti = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 50 } });

// Serve static files from web/ directory
app.use(express.static(STATIC_DIR));

// --- Helpers ---

const VALID_DIFFICULTIES = ['basic', 'intermediate', 'advanced'] as const;

const QUALITY_SUFFIX: Record<string, string> = {
  major: '', minor: 'm', diminished: 'dim', augmented: 'aug',
  dominant7: '7', major7: 'maj7', minor7: 'm7',
  diminished7: 'dim7', 'half-dim7': 'ø7', sus2: 'sus2', sus4: 'sus4',
};

const ACC_SYMBOL: Record<string, string> = {
  sharp: '#', flat: 'b', none: '', natural: '', 'double-sharp': '##', 'double-flat': 'bb',
};

function formatChordName(chord: ChordSymbol): string {
  return `${chord.root}${ACC_SYMBOL[chord.rootAccidental] ?? ''}${QUALITY_SUFFIX[chord.quality] ?? ''}`;
}

// --- API Routes ---

// POST /api/harmonize  (task 4.2)
app.post('/api/harmonize', async (req, res) => {
  const { musicxml, difficulty } = req.body;

  // Parameter validation
  if (!musicxml) {
    return res.status(400).json({ error: '缺少 musicxml 参数' });
  }
  if (!difficulty || !VALID_DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ error: '无效的难度级别' });
  }

  try {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器配置错误：API 密钥未设置' });
    }

    const pipeline = new HarmonizePipeline({
      apiKey,
      phrasesPath: PHRASES_PATH,
      difficulty,
    });

    const result = await pipeline.harmonizeFromXML(musicxml);

    // Inject chords into MusicXML (timed)
    const injectStart = Date.now();
    const enrichedMusicxml = injectChordsToMusicXML(musicxml, result.score);
    const chordInjectionMs = Date.now() - injectStart;

    // Extract chord progression from Score
    const chordProgression: string[] = [];
    for (const measure of result.score.measures) {
      for (const chord of measure.chords) {
        chordProgression.push(formatChordName(chord));
      }
    }

    return res.json({
      score: result.score,
      musicxml: enrichedMusicxml,
      analysis: {
        key: result.keyAnalysis.key,
        confidence: result.keyAnalysis.confidence,
        source: result.keyAnalysis.source,
        chordProgression,
        stats: {
          ...result.stats,
          chordInjectionMs,
        },
      },
    });
  } catch (err: any) {
    console.error('[/api/harmonize] Pipeline error:', err);
    return res.status(500).json({ error: `和声分析失败: ${err.message ?? err}` });
  }
});

// POST /api/export/abc  (task 4.3)
app.post('/api/export/abc', (req, res) => {
  const { score } = req.body;

  if (!score) {
    return res.status(400).json({ error: '缺少 score 参数' });
  }

  try {
    const abc = scoreToABC(score);
    return res.json({ abc });
  } catch (err: any) {
    console.error('[/api/export/abc] Conversion error:', err);
    return res.status(500).json({ error: `ABC 转换失败: ${err.message ?? err}` });
  }
});

// POST /api/export/png  — Score + MusicXML → PNG 图片
app.post('/api/export/png', async (req, res) => {
  const { score, musicxml } = req.body;
  if (!score || !musicxml) {
    return res.status(400).json({ error: '缺少 score 或 musicxml 参数' });
  }
  try {
    const enriched = injectChordsToMusicXML(musicxml, score);
    const pngBuf = await musicxmlToPNG(enriched);
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="score.png"');
    return res.send(pngBuf);
  } catch (err: any) {
    console.error('[/api/export/png] Error:', err);
    return res.status(500).json({ error: `PNG 导出失败: ${err.message ?? err}` });
  }
});

// POST /api/export/pdf  — Score + MusicXML → PDF 文件
app.post('/api/export/pdf', async (req, res) => {
  const { score, musicxml } = req.body;
  if (!score || !musicxml) {
    return res.status(400).json({ error: '缺少 score 或 musicxml 参数' });
  }
  try {
    const enriched = injectChordsToMusicXML(musicxml, score);
    const pdfBuf = await musicxmlToPDF(enriched);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="score.pdf"');
    return res.send(pdfBuf);
  } catch (err: any) {
    console.error('[/api/export/pdf] Error:', err);
    return res.status(500).json({ error: `PDF 导出失败: ${err.message ?? err}` });
  }
});

// --- OMR Routes (Audiveris) ---

const ALLOWED_OMR_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif', 'pdf'];

// POST /api/omr — 乐谱图片/PDF → MusicXML（Audiveris OMR）
app.post('/api/omr', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '缺少 file 字段' });
  }

  const ext = req.file.originalname.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_OMR_EXTS.includes(ext)) {
    return res.status(400).json({ error: `不支持的文件格式: ${ext}` });
  }

  try {
    const result = await recognizeBuffer(
      req.file.buffer,
      req.file.originalname,
      { audiverisPath: process.env.AUDIVERIS_PATH },
    );
    return res.json({ musicxml: result.musicxml });
  } catch (err: any) {
    console.error('[/api/omr] Error:', err);
    return res.status(500).json({ error: `OMR 识别失败: ${err.message ?? err}` });
  }
});

// POST /api/omr/harmonize — 乐谱图片 → OMR → 和声分析（一站式）
app.post('/api/omr/harmonize', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '缺少 file 字段' });
  }

  const ext = req.file.originalname.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_OMR_EXTS.includes(ext)) {
    return res.status(400).json({ error: `不支持的文件格式: ${ext}` });
  }

  const diff = String(req.query.difficulty || req.body?.difficulty || 'basic');
  if (!VALID_DIFFICULTIES.includes(diff as any)) {
    return res.status(400).json({ error: '无效的难度级别' });
  }

  try {
    // 1. OMR 识别
    const omrResult = await recognizeBuffer(
      req.file.buffer,
      req.file.originalname,
      { audiverisPath: process.env.AUDIVERIS_PATH },
    );

    // 2. 和声分析
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器配置错误：API 密钥未设置' });
    }

    const pipeline = new HarmonizePipeline({
      apiKey,
      phrasesPath: PHRASES_PATH,
      difficulty: diff as any,
    });

    const result = await pipeline.harmonizeFromXML(omrResult.musicxml);
    const enrichedMusicxml = injectChordsToMusicXML(omrResult.musicxml, result.score);

    const chordProgression: string[] = [];
    for (const measure of result.score.measures) {
      for (const chord of measure.chords) {
        chordProgression.push(formatChordName(chord));
      }
    }

    return res.json({
      score: result.score,
      musicxml: enrichedMusicxml,
      analysis: {
        key: result.keyAnalysis.key,
        confidence: result.keyAnalysis.confidence,
        source: result.keyAnalysis.source,
        chordProgression,
        stats: result.stats,
      },
    });
  } catch (err: any) {
    console.error('[/api/omr/harmonize] Error:', err);
    return res.status(500).json({ error: `处理失败: ${err.message ?? err}` });
  }
});

// --- Multi-page OMR Routes ---

// POST /api/omr/pages — 多页乐谱图片 → 逐页 OMR → 返回每页 MusicXML + 合并结果
app.post('/api/omr/pages', uploadMulti.array('files', 50), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: '缺少 files 字段' });
  }

  for (const file of files) {
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_OMR_EXTS.includes(ext)) {
      return res.status(400).json({ error: `不支持的文件格式: ${ext} (${file.originalname})` });
    }
  }

  try {
    const pageResults: { pageIndex: number; musicxml: string; filename: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`[/api/omr/pages] Processing page ${i + 1}/${files.length}: ${file.originalname}`);
      const result = await recognizeBuffer(
        file.buffer,
        file.originalname,
        { audiverisPath: process.env.AUDIVERIS_PATH },
      );
      pageResults.push({ pageIndex: i, musicxml: result.musicxml, filename: file.originalname });
    }

    const allXmls = pageResults.map(p => p.musicxml);
    const mergedXml = mergeMusicXMLPages(allXmls);

    return res.json({ pages: pageResults, merged: mergedXml, totalPages: files.length });
  } catch (err: any) {
    console.error('[/api/omr/pages] Error:', err);
    return res.status(500).json({ error: `多页 OMR 识别失败: ${err.message ?? err}` });
  }
});

// POST /api/omr/pages/harmonize — 多页乐谱 → OMR → 合并 → 和声分析（一站式）
app.post('/api/omr/pages/harmonize', uploadMulti.array('files', 50), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: '缺少 files 字段' });
  }

  for (const file of files) {
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_OMR_EXTS.includes(ext)) {
      return res.status(400).json({ error: `不支持的文件格式: ${ext} (${file.originalname})` });
    }
  }

  const diff = String(req.query.difficulty || req.body?.difficulty || 'basic');
  if (!VALID_DIFFICULTIES.includes(diff as any)) {
    return res.status(400).json({ error: '无效的难度级别' });
  }

  try {
    const pageXmls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`[/api/omr/pages/harmonize] OMR page ${i + 1}/${files.length}: ${file.originalname}`);
      const result = await recognizeBuffer(
        file.buffer,
        file.originalname,
        { audiverisPath: process.env.AUDIVERIS_PATH },
      );
      pageXmls.push(result.musicxml);
    }

    const mergedXml = mergeMusicXMLPages(pageXmls);

    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器配置错误：API 密钥未设置' });
    }

    const pipeline = new HarmonizePipeline({
      apiKey,
      phrasesPath: PHRASES_PATH,
      difficulty: diff as any,
    });

    const result = await pipeline.harmonizeFromXML(mergedXml);
    const enrichedMusicxml = injectChordsToMusicXML(mergedXml, result.score);

    const chordProgression: string[] = [];
    for (const measure of result.score.measures) {
      for (const chord of measure.chords) {
        chordProgression.push(formatChordName(chord));
      }
    }

    // 计算每页的小节范围（用于前端分页浏览）
    let measureOffset = 0;
    const pageRanges: { pageIndex: number; startMeasure: number; endMeasure: number }[] = [];
    for (let i = 0; i < pageXmls.length; i++) {
      const measureMatches = pageXmls[i].match(/<measure\b/g);
      const pageMeasureCount = measureMatches ? measureMatches.length : 0;
      pageRanges.push({
        pageIndex: i,
        startMeasure: measureOffset + 1,
        endMeasure: measureOffset + pageMeasureCount,
      });
      measureOffset += pageMeasureCount;
    }

    return res.json({
      score: result.score,
      musicxml: enrichedMusicxml,
      analysis: {
        key: result.keyAnalysis.key,
        confidence: result.keyAnalysis.confidence,
        source: result.keyAnalysis.source,
        chordProgression,
        stats: result.stats,
      },
      pagination: {
        totalPages: files.length,
        pageRanges,
        totalMeasures: measureOffset,
      },
    });
  } catch (err: any) {
    console.error('[/api/omr/pages/harmonize] Error:', err);
    return res.status(500).json({ error: `多页处理失败: ${err.message ?? err}` });
  }
});

app.listen(PORT, () => {
  console.log(`Harmony Engine server listening on http://localhost:${PORT}`);
  console.log(`Serving static files from ${STATIC_DIR}`);
  console.log(`DASHSCOPE_API_KEY configured: ${!!process.env.DASHSCOPE_API_KEY}`);
  console.log(`AUDIVERIS_PATH: ${process.env.AUDIVERIS_PATH || '(auto-detect)'}`);
});

export { app, PORT, STATIC_DIR, PHRASES_PATH };

// --- Multi-page OMR Routes ---

// POST /api/omr/pages — 多页乐谱图片 → 逐页 OMR → 返回每页 MusicXML + 合并结果
app.post('/api/omr/pages', uploadMulti.array('files', 50), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: '缺少 files 字段' });
  }

  // Validate all file extensions
  for (const file of files) {
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_OMR_EXTS.includes(ext)) {
      return res.status(400).json({ error: `不支持的文件格式: ${ext} (${file.originalname})` });
    }
  }

  try {
    const pageResults: { pageIndex: number; musicxml: string; filename: string }[] = [];

    // Process each file sequentially (Audiveris is resource-heavy)
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`[/api/omr/pages] Processing page ${i + 1}/${files.length}: ${file.originalname}`);
      const result = await recognizeBuffer(
        file.buffer,
        file.originalname,
        { audiverisPath: process.env.AUDIVERIS_PATH },
      );
      pageResults.push({
        pageIndex: i,
        musicxml: result.musicxml,
        filename: file.originalname,
      });
    }

    // Merge all pages into one MusicXML
    const allXmls = pageResults.map(p => p.musicxml);
    const mergedXml = mergeMusicXMLPages(allXmls);

    return res.json({
      pages: pageResults,
      merged: mergedXml,
      totalPages: files.length,
    });
  } catch (err: any) {
    console.error('[/api/omr/pages] Error:', err);
    return res.status(500).json({ error: `多页 OMR 识别失败: ${err.message ?? err}` });
  }
});

// POST /api/omr/pages/harmonize — 多页乐谱 → OMR → 合并 → 和声分析（一站式）
app.post('/api/omr/pages/harmonize', uploadMulti.array('files', 50), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: '缺少 files 字段' });
  }

  for (const file of files) {
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_OMR_EXTS.includes(ext)) {
      return res.status(400).json({ error: `不支持的文件格式: ${ext} (${file.originalname})` });
    }
  }

  const diff = String(req.query.difficulty || req.body?.difficulty || 'basic');
  if (!VALID_DIFFICULTIES.includes(diff as any)) {
    return res.status(400).json({ error: '无效的难度级别' });
  }

  try {
    // 1. 逐页 OMR 识别
    const pageXmls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`[/api/omr/pages/harmonize] OMR page ${i + 1}/${files.length}: ${file.originalname}`);
      const result = await recognizeBuffer(
        file.buffer,
        file.originalname,
        { audiverisPath: process.env.AUDIVERIS_PATH },
      );
      pageXmls.push(result.musicxml);
    }

    // 2. 合并 MusicXML
    const mergedXml = mergeMusicXMLPages(pageXmls);

    // 3. 和声分析
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: '服务器配置错误：API 密钥未设置' });
    }

    const pipeline = new HarmonizePipeline({
      apiKey,
      phrasesPath: PHRASES_PATH,
      difficulty: diff as any,
    });

    const result = await pipeline.harmonizeFromXML(mergedXml);
    const enrichedMusicxml = injectChordsToMusicXML(mergedXml, result.score);

    const chordProgression: string[] = [];
    for (const measure of result.score.measures) {
      for (const chord of measure.chords) {
        chordProgression.push(formatChordName(chord));
      }
    }

    // 4. 计算每页的小节范围（用于前端分页浏览）
    let measureOffset = 0;
    const pageRanges: { pageIndex: number; startMeasure: number; endMeasure: number }[] = [];
    for (let i = 0; i < pageXmls.length; i++) {
      // Count measures in this page's XML
      const measureMatches = pageXmls[i].match(/<measure\b/g);
      const pageMeasureCount = measureMatches ? measureMatches.length : 0;
      pageRanges.push({
        pageIndex: i,
        startMeasure: measureOffset + 1,
        endMeasure: measureOffset + pageMeasureCount,
      });
      measureOffset += pageMeasureCount;
    }

    return res.json({
      score: result.score,
      musicxml: enrichedMusicxml,
      analysis: {
        key: result.keyAnalysis.key,
        confidence: result.keyAnalysis.confidence,
        source: result.keyAnalysis.source,
        chordProgression,
        stats: result.stats,
      },
      pagination: {
        totalPages: files.length,
        pageRanges,
        totalMeasures: measureOffset,
      },
    });
  } catch (err: any) {
    console.error('[/api/omr/pages/harmonize] Error:', err);
    return res.status(500).json({ error: `多页处理失败: ${err.message ?? err}` });
  }
});

