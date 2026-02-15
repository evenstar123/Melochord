/**
 * MusicXML 多页合并工具
 *
 * 将多个 MusicXML 文档（来自多页 OMR 识别）合并为一个完整的乐谱。
 * 合并策略：
 * 1. 以第一页的元信息（标题、调性、拍号等）为基准
 * 2. 后续页的小节追加到第一页之后，小节编号自动递增
 * 3. 保留各页的调性/拍号变化
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

/** 确保值为数组 */
function asArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * 合并多个 MusicXML 字符串为一个
 *
 * @param xmlPages - 按页码顺序排列的 MusicXML 字符串数组
 * @returns 合并后的 MusicXML 字符串
 */
export function mergeMusicXMLPages(xmlPages: string[]): string {
  if (xmlPages.length === 0) throw new Error('没有可合并的 MusicXML 页面');
  if (xmlPages.length === 1) return xmlPages[0];

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'measure' || name === 'note' || name === 'part',
  });

  // Parse the first page as the base document
  const baseDoc = parser.parse(xmlPages[0]);
  const baseScore = baseDoc['score-partwise'];
  if (!baseScore) throw new Error('第一页不是有效的 MusicXML (缺少 score-partwise)');

  const baseParts = asArray(baseScore.part);
  if (baseParts.length === 0) throw new Error('第一页没有声部 (part)');

  // Track the max measure number from the base
  const baseMeasures = asArray((baseParts[0] as any).measure);
  let maxMeasureNum = 0;
  for (const m of baseMeasures) {
    const n = Number(m?.['@_number'] ?? 0);
    if (n > maxMeasureNum) maxMeasureNum = n;
  }

  // Merge subsequent pages
  for (let pageIdx = 1; pageIdx < xmlPages.length; pageIdx++) {
    const pageDoc = parser.parse(xmlPages[pageIdx]);
    const pageScore = pageDoc['score-partwise'];
    if (!pageScore) continue;

    const pageParts = asArray(pageScore.part);
    if (pageParts.length === 0) continue;

    const pageMeasures = asArray((pageParts[0] as any).measure);

    for (const measure of pageMeasures) {
      maxMeasureNum++;
      // Renumber the measure
      measure['@_number'] = String(maxMeasureNum);

      // Remove redundant initial attributes from non-first pages
      // (keep key/time changes only if they differ from the base)
      if (pageIdx > 0 && maxMeasureNum > 1 && measure.attributes) {
        // Keep attributes — they might contain legitimate key/time changes
        // But remove divisions if it's just repeating the same value
      }

      baseMeasures.push(measure);
    }
  }

  // Update the base document with merged measures
  (baseParts[0] as any).measure = baseMeasures;

  // Rebuild XML
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: false,
  });

  let built = builder.build(baseDoc) as string;

  // fast-xml-parser preserves the original <?xml?> PI during parse→build,
  // so strip any existing declarations to avoid duplicates.
  built = built.replace(/^\s*<\?xml[^?]*\?>\s*/gi, '');

  const xmlDecl = '<?xml version="1.0" encoding="UTF-8"?>';
  const doctype = '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">';

  return `${xmlDecl}\n${doctype}\n${built}`;
}
