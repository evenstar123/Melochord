/**
 * Audiveris OMR 集成
 *
 * 调用 Audiveris CLI 将五线谱图片/PDF 转换为 MusicXML
 * 支持 png, jpg, pdf 等格式
 *
 * 自动预处理：低分辨率图片会被放大到 300 DPI 等效尺寸
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

/** Audiveris 要求的最小宽度（像素），对应约 300 DPI 的 A4 纸 */
const MIN_WIDTH = 2400;

/** OMR 识别结果 */
export interface OMRResult {
  /** 生成的 MusicXML 字符串 */
  musicxml: string;
  /** Audiveris 日志输出 */
  log: string;
}

/** OMR 配置 */
export interface OMRConfig {
  /** Audiveris 可执行文件路径 */
  audiverisPath?: string;
  /** 超时时间（毫秒），默认 120 秒 */
  timeout?: number;
  /** 指定处理的页码（PDF 多页时），如 [1, 2] */
  sheets?: number[];
}

/** 默认 Audiveris 路径 */
const DEFAULT_AUDIVERIS_PATHS = [
  'C:\\Program Files\\Audiveris\\Audiveris.exe',
  '/opt/audiveris/bin/Audiveris',
  '/usr/local/bin/audiveris',
];

/**
 * 查找 Audiveris 可执行文件
 */
async function findAudiveris(configPath?: string): Promise<string> {
  if (configPath) {
    try {
      await fs.access(configPath);
      return configPath;
    } catch {
      throw new Error(`Audiveris 未找到: ${configPath}`);
    }
  }

  // 检查环境变量
  const envPath = process.env.AUDIVERIS_PATH;
  if (envPath) {
    try {
      await fs.access(envPath);
      return envPath;
    } catch {
      // 继续查找
    }
  }

  // 检查默认路径
  for (const p of DEFAULT_AUDIVERIS_PATHS) {
    try {
      await fs.access(p);
      return p;
    } catch {
      continue;
    }
  }

  throw new Error(
    'Audiveris 未找到。请安装 Audiveris (https://github.com/Audiveris/audiveris) ' +
    '或设置 AUDIVERIS_PATH 环境变量。Windows 可用: winget install Audiveris'
  );
}

/**
 * 在输出目录中查找 .mxl 文件并解压出 MusicXML
 */
async function extractMusicXML(outputDir: string, inputBaseName: string): Promise<string> {
  const files = await fs.readdir(outputDir);

  // Audiveris 输出 .mxl（压缩的 MusicXML）
  const mxlFile = files.find(f => f.endsWith('.mxl'));
  if (mxlFile) {
    const mxlPath = path.join(outputDir, mxlFile);
    const { unzipMXL } = await import('./mxl-unzip.js');
    return unzipMXL(mxlPath);
  }

  // 也可能直接输出 .xml
  const xmlFile = files.find(f => f.endsWith('.xml') || f.endsWith('.musicxml'));
  if (xmlFile) {
    return fs.readFile(path.join(outputDir, xmlFile), 'utf-8');
  }

  // 没有输出，尝试读取日志获取错误原因
  const logFile = files.find(f => f.endsWith('.log'));
  let reason = '';
  if (logFile) {
    const log = await fs.readFile(path.join(outputDir, logFile), 'utf-8');
    if (log.includes('too low interline')) {
      reason = ' 图片分辨率太低，请使用更高分辨率的扫描件（建议 300 DPI 以上）';
    } else if (log.includes('flagged as invalid')) {
      reason = ' Audiveris 无法识别此乐谱，可能图片质量不佳或不是标准五线谱';
    } else {
      // 提取最后的错误信息
      const warnLines = log.split('\n').filter(l => l.includes('WARN') || l.includes('ERROR'));
      if (warnLines.length > 0) {
        reason = ` 日志: ${warnLines[warnLines.length - 1].trim()}`;
      }
    }
  }

  throw new Error(`Audiveris 未生成 MusicXML 输出。${reason} 输出目录内容: ${files.join(', ')}`);
}

/**
 * 预处理图片：如果分辨率太低，放大并设置 300 DPI
 * 返回处理后的文件路径（可能是原文件或临时文件）
 */
async function preprocessImage(inputPath: string, tmpDir: string): Promise<string> {
  const ext = path.extname(inputPath).toLowerCase();

  // PDF 不需要预处理，Audiveris 自己处理
  if (ext === '.pdf') return inputPath;

  // 非图片格式跳过
  if (!['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif'].includes(ext)) return inputPath;

  try {
    const metadata = await sharp(inputPath).metadata();
    const width = metadata.width ?? 0;

    if (width >= MIN_WIDTH) {
      // 分辨率足够，但确保有 DPI 信息
      const outPath = path.join(tmpDir, `preprocessed${ext}`);
      await sharp(inputPath)
        .withMetadata({ density: 300 })
        .toFile(outPath);
      return outPath;
    }

    // 需要放大
    const scale = Math.ceil(MIN_WIDTH / width);
    console.log(`[OMR] 图片分辨率不足 (${width}px)，放大 ${scale}x 到 ${width * scale}px`);

    const outPath = path.join(tmpDir, `preprocessed.png`);
    await sharp(inputPath)
      .resize(width * scale, undefined, { kernel: 'lanczos3' })
      .withMetadata({ density: 300 })
      .png()
      .toFile(outPath);

    return outPath;
  } catch (err) {
    // 预处理失败，用原文件试试
    console.warn(`[OMR] 图片预处理失败，使用原文件:`, err);
    return inputPath;
  }
}

/**
 * 使用 Audiveris 识别乐谱图片/PDF
 *
 * @param inputPath - 输入文件路径（png/jpg/pdf）
 * @param config - 可选配置
 * @returns OMR 识别结果，包含 MusicXML
 */
export async function recognizeScore(
  inputPath: string,
  config: OMRConfig = {},
): Promise<OMRResult> {
  const { timeout = 120_000, sheets } = config;

  // 确认输入文件存在
  try {
    await fs.access(inputPath);
  } catch {
    throw new Error(`输入文件不存在: ${inputPath}`);
  }

  // 查找 Audiveris
  const audiverisExe = await findAudiveris(config.audiverisPath);

  // 创建临时输出目录
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audiveris-'));

  try {
    // 预处理图片（放大低分辨率图片）
    const processedPath = await preprocessImage(inputPath, tmpDir);

    // 确认预处理文件存在
    await fs.access(processedPath);

    // 构建命令行参数
    const args: string[] = [
      '-batch',
      '-export',
      '-output', tmpDir,
    ];

    if (sheets && sheets.length > 0) {
      args.push('-sheets', ...sheets.map(String));
    }

    args.push('--', path.resolve(processedPath));

    // 执行 Audiveris
    const { stdout, stderr } = await execFileAsync(audiverisExe, args, {
      timeout,
      windowsHide: true,
    });

    const log = [stdout, stderr].filter(Boolean).join('\n');

    // 提取 MusicXML
    const inputBaseName = path.basename(inputPath, path.extname(inputPath));
    const musicxml = await extractMusicXML(tmpDir, inputBaseName);

    return { musicxml, log };
  } finally {
    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 使用 Audiveris 识别内存中的文件（Buffer）
 * 适用于 HTTP 上传场景
 */
export async function recognizeBuffer(
  buffer: Buffer,
  filename: string,
  config: OMRConfig = {},
): Promise<OMRResult> {
  // 清理文件名：只保留扩展名，避免中文/特殊字符路径问题
  const ext = path.extname(filename).toLowerCase() || '.png';
  const safeFilename = `input${ext}`;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omr-input-'));
  const tmpFile = path.join(tmpDir, safeFilename);

  try {
    await fs.writeFile(tmpFile, buffer);
    return await recognizeScore(tmpFile, config);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
