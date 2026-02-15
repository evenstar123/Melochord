# 需求文档：和声管线改进

## 简介

本需求文档描述对 `HarmonizePipeline` 和弦生成管线的六项改进。当前管线存在分块上下文断裂、RAG 查询与 LLM 分块粒度不对齐、拍位置机械分配、缺少后处理验证、不支持转调检测、以及难度控制仅靠 prompt 约束等问题。本次改进旨在全面提升和弦生成的音乐合理性与连贯性。

## 术语表

- **Pipeline（管线）**: `HarmonizePipeline` 类，端到端和声分析管线，负责从 MusicXML 解析到和弦生成的完整流程
- **Chunk（分块）**: 管线将旋律按固定小节数分组处理的单元，当前为 4 小节一组
- **RNA**: Roman Numeral Analysis，罗马数字级数标记法，如 I、IV、V7、vi
- **RAG_Retriever（RAG 检索器）**: `RAGRetriever` 类，使用向量嵌入从 Hooktheory 片段库中检索相似和弦进行
- **LLM_Harmonizer（LLM 和弦生成器）**: `LLMHarmonizer` 类，使用大语言模型根据旋律特征和参考片段生成和弦
- **Score（乐谱）**: 核心数据结构，包含所有小节、音符、和弦标注等信息
- **Measure（小节）**: 乐谱中的一个小节，包含音乐事件和和弦标注
- **ChordSymbol（和弦符号）**: 标注在乐谱上的和弦信息，包含根音、质量和拍位置
- **KeySignature（调性）**: 调性信息，包含主音、调式和五度圈值
- **KS_Algorithm（KS 算法）**: Krumhansl-Schmuckler 算法，通过统计音符频率推断调性
- **Transition_Matrix（转移矩阵）**: `chord_transitions.json` 中的和弦二元组转移概率矩阵，来源于 Hooktheory 数据
- **Beat_Position（拍位置）**: 和弦在小节内的起始拍位置，以四分音符为单位
- **Difficulty_Level（难度级别）**: 和弦生成的复杂度等级，分为 basic、intermediate、advanced 三级
- **Whitelist（白名单）**: 每个难度级别允许使用的和弦集合
- **Modulation（转调）**: 乐曲中调性发生变化的现象

## 需求

### 需求 1：分块上下文传递

**用户故事：** 作为使用者，我希望相邻分块之间的和弦进行保持连贯，以避免分块边界处出现不自然的和声断裂。

#### 验收标准

1. WHEN Pipeline 处理第二个及后续 Chunk 时，THE LLM_Harmonizer SHALL 在用户 prompt 中包含前一个 Chunk 最后 1-2 个和弦作为上下文信息
2. WHEN Pipeline 处理第一个 Chunk 时，THE LLM_Harmonizer SHALL 在不包含前置和弦上下文的情况下正常生成和弦
3. WHEN 前一个 Chunk 的和弦上下文被传入时，THE LLM_Harmonizer SHALL 在 prompt 中以明确格式呈现上下文（例如"前一段结尾和弦: V7 → I"）

### 需求 2：RAG 查询与 LLM 分块对齐

**用户故事：** 作为使用者，我希望 RAG 检索结果与 LLM 处理的小节范围正确关联，以确保参考和弦进行与当前旋律片段相关。

#### 验收标准

1. WHEN RAG_Retriever 为一个 4 小节 Chunk 检索参考片段时，THE Pipeline SHALL 在 LLM prompt 中明确标注每条参考结果对应的小节范围
2. WHEN 多个 RAG 查询结果被合并时，THE Pipeline SHALL 保留每条结果的来源小节范围信息，而非简单去重合并
3. WHEN LLM_Harmonizer 构建用户 prompt 时，THE LLM_Harmonizer SHALL 将参考和弦进行按对应小节范围分组展示

### 需求 3：基于旋律节奏的拍位置分配

**用户故事：** 作为使用者，我希望和弦变换位置与旋律的节奏重音对齐，以产生更自然的和声效果。

#### 验收标准

1. WHEN LLM_Harmonizer 生成和弦时，THE LLM_Harmonizer SHALL 在输出中为每个和弦指定拍位置（例如 `1: I(1) V(3.5)`）
2. WHEN LLM_Harmonizer 的输出包含拍位置信息时，THE Pipeline SHALL 使用 LLM 指定的拍位置而非均匀分配
3. IF LLM_Harmonizer 的输出未包含拍位置信息，THEN THE Pipeline SHALL 回退到当前的均匀分配策略
4. WHEN LLM_Harmonizer 构建 prompt 时，THE LLM_Harmonizer SHALL 在系统 prompt 中说明拍位置输出格式要求

### 需求 4：后处理验证层

**用户故事：** 作为使用者，我希望生成的和弦经过音乐合理性验证，以过滤掉明显不合理的和弦选择。

#### 验收标准

1. WHEN Pipeline 接收到 LLM 生成的和弦后，THE Pipeline SHALL 对每个强拍上的和弦执行和弦音覆盖检查，验证和弦音是否包含该强拍上的旋律音
2. WHEN Pipeline 验证相邻和弦转换时，THE Pipeline SHALL 使用 Transition_Matrix 计算转换概率，并标记概率低于阈值的异常转换
3. IF 和弦音覆盖检查或转换概率检查发现异常，THEN THE Pipeline SHALL 记录警告日志，但保留原始和弦（不自动替换）
4. THE Pipeline SHALL 在 PipelineResult 中包含验证统计信息，报告通过率和异常数量

### 需求 5：分段调性分析与转调检测

**用户故事：** 作为使用者，我希望系统能检测乐曲中的转调并为每个段落使用正确的调性生成和弦，以正确处理包含转调的流行歌曲。

#### 验收标准

1. WHEN KS_Algorithm 执行调性分析时，THE KS_Algorithm SHALL 使用滑动窗口对乐曲进行分段调性分析，窗口大小为 8 小节，步长为 2 小节，以提高转调点定位精度
2. WHEN 相邻窗口的 KS 最佳候选调性发生变化时，THE KS_Algorithm SHALL 在变化区域内逐小节计算累积音高分布的 KS 相关系数，定位相关系数发生显著跳变的具体小节作为转调点
3. WHEN 候选转调点被识别后，THE KS_Algorithm SHALL 验证转调前后各至少 4 小节的调性分析置信度均超过阈值（默认 0.65），以过滤因局部旋律色彩音导致的误报
4. WHEN 转调点被确认时，THE KS_Algorithm SHALL 将新调性写入对应 Measure 的 keyChange 字段
5. WHEN Pipeline 为某个 Chunk 生成和弦时，THE Pipeline SHALL 使用该 Chunk 所在段落的局部调性而非全局调性
6. WHEN LLM_Harmonizer 将 RNA 转换为 ChordSymbol 时，THE LLM_Harmonizer SHALL 使用当前小节的有效调性（考虑 keyChange）进行转换
7. THE Pipeline SHALL 在 PipelineResult 的 keyAnalysis 中包含所有检测到的转调信息，包括转调位置（小节号）、新调性和置信度
8. WHEN 乐曲总小节数不足 12 小节时，THE KS_Algorithm SHALL 跳过分段分析，仅执行全局调性分析

### 需求 6：难度级别和弦白名单过滤

**用户故事：** 作为使用者，我希望生成的和弦严格遵守所选难度级别的限制，以确保初学者不会遇到超出能力范围的和弦。

#### 验收标准

1. THE Pipeline SHALL 为每个 Difficulty_Level 维护一个允许的 RNA 和弦 Whitelist：basic 级别仅允许 `[I, IV, V, vi]`
2. WHEN Pipeline 完成和弦生成后，THE Pipeline SHALL 检查每个和弦是否在当前难度级别的 Whitelist 中
3. WHEN 一个和弦不在 Whitelist 中时，THE Pipeline SHALL 将该和弦替换为功能最接近的允许和弦（例如 `ii` → `IV`，`iii` → `I`，`vii°` → `V`）
4. WHEN 和弦被替换时，THE Pipeline SHALL 记录替换操作的日志（原始和弦 → 替换和弦）
5. WHILE Difficulty_Level 为 advanced 时，THE Pipeline SHALL 跳过白名单过滤步骤
