/**
 * .mxl 文件解压工具
 *
 * .mxl 是压缩的 MusicXML 格式（ZIP 容器）
 * 使用 Central Directory 解析，正确处理 data descriptor
 */

import fs from 'fs/promises';
import { inflateRawSync } from 'zlib';

/**
 * 从 .mxl 文件中提取 MusicXML 内容
 */
export async function unzipMXL(mxlPath: string): Promise<string> {
  const buf = await fs.readFile(mxlPath);
  const entries = parseCentralDirectory(buf);

  // 优先查找 container.xml 指定的根文件
  const containerEntry = entries.find(e => e.name === 'META-INF/container.xml');
  if (containerEntry) {
    const containerXml = extractEntry(buf, containerEntry);
    const match = containerXml.match(/full-path="([^"]+)"/);
    if (match) {
      const rootEntry = entries.find(e => e.name === match[1]);
      if (rootEntry) return extractEntry(buf, rootEntry);
    }
  }

  // 回退：找第一个 .xml 文件（排除 META-INF）
  const xmlEntry = entries.find(
    e => e.name.endsWith('.xml') && !e.name.includes('META-INF')
  );
  if (xmlEntry) return extractEntry(buf, xmlEntry);

  throw new Error('.mxl 文件中未找到 MusicXML 内容');
}

// ============ ZIP Central Directory 解析 ============

interface CdEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * 从 ZIP 文件末尾的 Central Directory 解析条目
 * Central Directory 包含正确的大小信息（即使 local header 中为 0）
 */
function parseCentralDirectory(buf: Buffer): CdEntry[] {
  // 找到 End of Central Directory Record (EOCD)
  // 签名: 0x06054b50
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('无效的 ZIP 文件：未找到 EOCD');
  }

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdEntries = buf.readUInt16LE(eocdOffset + 10);

  const entries: CdEntry[] = [];
  let offset = cdOffset;

  for (let i = 0; i < cdEntries; i++) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x02014b50) break; // Central Directory header signature

    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf-8', offset + 46, offset + 46 + nameLen);

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * 从 ZIP 文件中提取单个条目的内容
 */
function extractEntry(buf: Buffer, entry: CdEntry): string {
  // 读取 local file header 获取数据偏移
  const lhOffset = entry.localHeaderOffset;
  const nameLen = buf.readUInt16LE(lhOffset + 26);
  const extraLen = buf.readUInt16LE(lhOffset + 28);
  const dataOffset = lhOffset + 30 + nameLen + extraLen;

  const data = buf.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.method === 0) {
    // Stored (no compression)
    return data.toString('utf-8');
  }

  if (entry.method === 8) {
    // Deflate
    return inflateRawSync(data).toString('utf-8');
  }

  throw new Error(`不支持的压缩方式: ${entry.method}`);
}
