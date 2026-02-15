"""
Hooktheory 数据预处理脚本
将原始 pitch_class 数据转为 RNA（罗马数字级数）格式

输入: Hooktheory.json (26,175 条)
输出: hooktheory_rna.json (统一 RNA 格式的旋律-和弦片段)

数据结构说明:
- tonic_pitch_class: 0=C, 1=C#, 2=D, ..., 11=B
- scale_degree_intervals: [2,2,1,2,2,2]=大调, [2,1,2,2,1,2]=自然小调
- root_pitch_class: 和弦根音 (0-11)
- root_position_intervals: 和弦音程结构 [4,3]=大三, [3,4]=小三, [4,3,3]=属七 等
- onset/offset: 拍位置
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

# ============ 常量 ============

PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

# 音程结构 → 和弦质量
INTERVAL_TO_QUALITY = {
    (4, 3): 'maj',
    (3, 4): 'min',
    (3, 3): 'dim',
    (4, 4): 'aug',
    (4, 3, 3): '7',       # 属七
    (4, 3, 4): 'maj7',    # 大七
    (3, 4, 3): 'min7',    # 小七
    (3, 3, 3): 'dim7',    # 减七
    (3, 3, 4): 'hdim7',   # 半减七
    (3, 4, 4): 'minmaj7', # 小大七
    (4, 3, 3, 4): '9',    # 属九（简化）
    (2, 5): 'sus2',
    (5, 2): 'sus4',
    (4,): 'power_maj3',   # 不完整和弦
    (3,): 'power_min3',
    (7,): 'power5',
}

# 半音数 → 级数映射（大调）
# 0=I, 2=II, 4=III, 5=IV, 7=V, 9=VI, 11=VII
SEMITONE_TO_DEGREE_MAJOR = {0: 1, 1: 1, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 5, 8: 6, 9: 6, 10: 7, 11: 7}

# 大调音阶半音位置
MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]

# RNA 符号
DEGREE_SYMBOLS_MAJOR = {1: 'I', 2: 'ii', 3: 'iii', 4: 'IV', 5: 'V', 6: 'vi', 7: 'vii'}
DEGREE_SYMBOLS_MINOR = {1: 'i', 2: 'ii', 3: 'III', 4: 'iv', 5: 'v', 6: 'VI', 7: 'VII'}


def detect_mode(scale_intervals):
    """从音阶音程判断调式"""
    t = tuple(scale_intervals) if scale_intervals else ()
    if t == (2, 2, 1, 2, 2, 2):
        return 'major'
    elif t == (2, 1, 2, 2, 1, 2):
        return 'minor'
    elif t == (2, 1, 2, 2, 2, 2):
        return 'dorian'
    elif t == (1, 2, 2, 2, 1, 2):
        return 'phrygian'
    elif t == (2, 2, 2, 1, 2, 2):
        return 'lydian'
    elif t == (2, 2, 1, 2, 2, 1):
        return 'mixolydian'
    else:
        return 'major'  # 默认大调


def root_to_degree(root_pc, tonic_pc, mode):
    """将根音 pitch_class 转为级数 (1-7)"""
    semitones = (root_pc - tonic_pc) % 12
    scale = MAJOR_SCALE if mode in ('major', 'lydian', 'mixolydian') else MINOR_SCALE

    # 精确匹配音阶音
    if semitones in scale:
        return scale.index(semitones) + 1

    # 最近匹配
    best_deg = 1
    best_dist = 12
    for i, s in enumerate(scale):
        dist = min(abs(semitones - s), 12 - abs(semitones - s))
        if dist < best_dist:
            best_dist = dist
            best_deg = i + 1
    return best_deg


def intervals_to_quality(intervals):
    """音程结构 → 和弦质量字符串"""
    t = tuple(intervals) if intervals else ()
    return INTERVAL_TO_QUALITY.get(t, f'unknown({t})')


def chord_to_rna(root_pc, intervals, inversion, tonic_pc, mode):
    """将一个和弦转为 RNA 字符串"""
    degree = root_to_degree(root_pc, tonic_pc, mode)
    quality = intervals_to_quality(intervals)
    semitones = (root_pc - tonic_pc) % 12
    scale = MAJOR_SCALE if mode in ('major', 'lydian', 'mixolydian') else MINOR_SCALE

    # 判断是否为变化和弦（根音不在音阶上）
    is_chromatic = semitones not in scale
    chromatic_prefix = '#' if is_chromatic and semitones > 0 else ''

    # 基础级数符号
    if mode in ('major', 'lydian', 'mixolydian'):
        base = DEGREE_SYMBOLS_MAJOR.get(degree, str(degree))
    else:
        base = DEGREE_SYMBOLS_MINOR.get(degree, str(degree))

    # 根据和弦质量调整大小写
    if quality in ('maj', 'maj7', 'aug', '7', '9'):
        base = base.upper()
    elif quality in ('min', 'min7', 'dim', 'dim7', 'hdim7', 'minmaj7'):
        base = base.lower()

    # 构建 RNA 字符串
    quality_suffix = ''
    if quality == '7':
        quality_suffix = '7'
    elif quality == 'maj7':
        quality_suffix = 'maj7'
    elif quality == 'min7':
        quality_suffix = '7'  # 小七和弦用小写级数 + 7
    elif quality == 'dim':
        quality_suffix = '°'
    elif quality == 'dim7':
        quality_suffix = '°7'
    elif quality == 'hdim7':
        quality_suffix = 'ø7'
    elif quality == 'aug':
        quality_suffix = '+'
    elif quality == 'sus2':
        quality_suffix = 'sus2'
    elif quality == 'sus4':
        quality_suffix = 'sus4'

    # 转位标记
    inv_suffix = ''
    if inversion == 1:
        inv_suffix = '/3'
    elif inversion == 2:
        inv_suffix = '/5'
    elif inversion == 3:
        inv_suffix = '/7'

    return f"{chromatic_prefix}{base}{quality_suffix}{inv_suffix}"


def melody_to_intervals(melody_notes, tonic_pc):
    """将旋律音符转为相对音程序列（相邻音的半音差）"""
    if len(melody_notes) < 2:
        return []

    intervals = []
    for i in range(1, len(melody_notes)):
        prev_pc = melody_notes[i - 1]['pitch_class']
        curr_pc = melody_notes[i]['pitch_class']
        prev_oct = melody_notes[i - 1].get('octave', 0)
        curr_oct = melody_notes[i].get('octave', 0)

        # 计算带八度的音程
        prev_midi = prev_oct * 12 + prev_pc
        curr_midi = curr_oct * 12 + curr_pc
        interval = curr_midi - prev_midi

        intervals.append(interval)

    return intervals


def extract_rhythm_density(melody_notes, num_beats):
    """计算节奏密度（每拍平均音符数）"""
    if num_beats == 0:
        return 0
    return len(melody_notes) / num_beats


def slice_into_phrases(melody, harmony, meters, num_beats, phrase_beats=8):
    """
    按固定拍数切片（默认 8 拍 = 2 小节 in 4/4）
    返回 [(melody_slice, harmony_slice, start_beat, end_beat), ...]
    """
    beats_per_bar = 4
    if meters and len(meters) > 0:
        beats_per_bar = meters[0].get('beats_per_bar', 4)

    phrases = []
    start = 0
    while start < num_beats:
        end = min(start + phrase_beats, num_beats)

        mel_slice = [n for n in melody if n['onset'] >= start and n['onset'] < end]
        har_slice = [h for h in harmony if h['onset'] >= start and h['onset'] < end]

        if har_slice:  # 只保留有和弦的片段
            phrases.append({
                'melody': mel_slice,
                'harmony': har_slice,
                'start_beat': start,
                'end_beat': end,
            })

        start += phrase_beats

    return phrases


def process_entry(entry_id, entry):
    """处理单条 Hooktheory 数据"""
    ann = entry.get('annotations', {})
    keys = ann.get('keys', [])
    meters = ann.get('meters', [])
    melody = ann.get('melody') or []
    harmony = ann.get('harmony') or []
    num_beats = ann.get('num_beats', 0)
    ht = entry.get('hooktheory', {})

    if not keys or not harmony:
        return None

    tonic_pc = keys[0]['tonic_pitch_class']
    scale_intervals = keys[0].get('scale_degree_intervals', [2, 2, 1, 2, 2, 2])
    mode = detect_mode(scale_intervals)

    # 转换和弦为 RNA
    chord_rna_sequence = []
    for h in harmony:
        rna = chord_to_rna(
            h['root_pitch_class'],
            h.get('root_position_intervals', []),
            h.get('inversion', 0),
            tonic_pc,
            mode
        )
        chord_rna_sequence.append({
            'rna': rna,
            'onset': h['onset'],
            'offset': h['offset'],
            'duration_beats': h['offset'] - h['onset'],
        })

    # 旋律音程序列
    melody_intervals = melody_to_intervals(melody, tonic_pc)
    rhythm_density = extract_rhythm_density(melody, num_beats)

    # 切片
    beats_per_bar = meters[0].get('beats_per_bar', 4) if meters else 4
    phrases = slice_into_phrases(melody, harmony, meters, num_beats, phrase_beats=beats_per_bar * 2)

    # 处理每个片段的 RNA
    phrase_data = []
    for phrase in phrases:
        p_chords = []
        for h in phrase['harmony']:
            rna = chord_to_rna(
                h['root_pitch_class'],
                h.get('root_position_intervals', []),
                h.get('inversion', 0),
                tonic_pc,
                mode
            )
            p_chords.append(rna)

        p_melody_intervals = melody_to_intervals(phrase['melody'], tonic_pc)

        phrase_data.append({
            'chord_sequence': p_chords,
            'melody_intervals': p_melody_intervals,
            'start_beat': phrase['start_beat'],
            'end_beat': phrase['end_beat'],
        })

    return {
        'id': entry_id,
        'artist': ht.get('artist', ''),
        'song': ht.get('song', ''),
        'tonic': PITCH_NAMES[tonic_pc],
        'mode': mode,
        'beats_per_bar': beats_per_bar,
        'num_beats': num_beats,
        'chord_rna_full': [c['rna'] for c in chord_rna_sequence],
        'melody_intervals': melody_intervals,
        'rhythm_density': round(rhythm_density, 3),
        'phrases': phrase_data,
    }


def build_transition_matrix(all_entries):
    """从全量数据构建和弦转移概率矩阵（bigram）"""
    bigram_counts = Counter()
    unigram_counts = Counter()

    for entry in all_entries:
        chords = entry['chord_rna_full']
        for c in chords:
            unigram_counts[c] += 1
        for i in range(len(chords) - 1):
            bigram_counts[(chords[i], chords[i + 1])] += 1

    # 转为概率
    transition_probs = {}
    for (c1, c2), count in bigram_counts.items():
        if c1 not in transition_probs:
            transition_probs[c1] = {}
        transition_probs[c1][c2] = round(count / unigram_counts[c1], 4)

    # 按概率排序
    for c1 in transition_probs:
        transition_probs[c1] = dict(
            sorted(transition_probs[c1].items(), key=lambda x: -x[1])
        )

    return transition_probs, dict(unigram_counts.most_common())


def main():
    input_path = Path(__file__).parent.parent.parent / 'Hooktheory.json'
    output_dir = Path(__file__).parent.parent / 'data'
    output_dir.mkdir(exist_ok=True)

    print(f"Loading {input_path}...")
    with open(input_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)

    print(f"Processing {len(raw_data)} entries...")

    results = []
    skipped = 0
    mode_counts = Counter()
    quality_counts = Counter()

    for entry_id, entry in raw_data.items():
        result = process_entry(entry_id, entry)
        if result:
            results.append(result)
            mode_counts[result['mode']] += 1
            for c in result['chord_rna_full']:
                quality_counts[c] += 1
        else:
            skipped += 1

    print(f"\nProcessed: {len(results)}, Skipped: {skipped}")
    print(f"\nMode distribution:")
    for mode, count in mode_counts.most_common():
        print(f"  {mode}: {count} ({count/len(results)*100:.1f}%)")

    print(f"\nTop 20 most common chords (RNA):")
    for chord, count in quality_counts.most_common(20):
        print(f"  {chord}: {count}")

    # 统计片段总数
    total_phrases = sum(len(r['phrases']) for r in results)
    print(f"\nTotal phrases (2-bar slices): {total_phrases}")

    # 构建转移矩阵
    print("\nBuilding transition matrix...")
    transition_probs, unigram_freq = build_transition_matrix(results)

    # 保存结果
    rna_path = output_dir / 'hooktheory_rna.json'
    print(f"\nSaving RNA data to {rna_path}...")
    with open(rna_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=None)
    print(f"  Size: {rna_path.stat().st_size / 1024 / 1024:.1f} MB")

    # 保存转移矩阵
    matrix_path = output_dir / 'chord_transitions.json'
    print(f"Saving transition matrix to {matrix_path}...")
    with open(matrix_path, 'w', encoding='utf-8') as f:
        json.dump({
            'transition_probs': transition_probs,
            'unigram_freq': unigram_freq,
            'total_songs': len(results),
            'total_chords': sum(unigram_freq.values()),
        }, f, ensure_ascii=False, indent=2)

    # 保存片段索引（用于 RAG）
    phrases_path = output_dir / 'hooktheory_phrases.json'
    print(f"Saving phrase index to {phrases_path}...")
    all_phrases = []
    for r in results:
        for p in r['phrases']:
            all_phrases.append({
                'song_id': r['id'],
                'artist': r['artist'],
                'song': r['song'],
                'mode': r['mode'],
                'chord_sequence': p['chord_sequence'],
                'melody_intervals': p['melody_intervals'],
            })

    with open(phrases_path, 'w', encoding='utf-8') as f:
        json.dump(all_phrases, f, ensure_ascii=False, indent=None)
    print(f"  Total phrases: {len(all_phrases)}")
    print(f"  Size: {phrases_path.stat().st_size / 1024 / 1024:.1f} MB")

    print("\nDone!")


if __name__ == '__main__':
    main()
