# Implementation Plan: 和声管线改进

## Overview

基于设计文档，将六项管线改进拆分为增量实施步骤。每个步骤在前一步基础上构建，最终在管线主循环中集成所有改进。实现语言为 TypeScript，测试使用 Vitest + fast-check。

## Tasks

- [x] 1. 扩展数据类型和接口定义
  - [x] 1.1 扩展 `MeasureChords` 接口，新增可选 `beats?: number[]` 字段；新增 `AnnotatedRAGResult` 接口；在 `llm-harmonizer.ts` 中导出这些类型
    - _Requirements: 2.1, 3.1_
  - [x] 1.2 扩展 `PipelineConfig` 接口，新增 `transitionMatrixPath`、`transitionThreshold`、`enableValidation` 字段；扩展 `PipelineResult` 接口，新增 `validation` 和 `difficultyFilter` 统计字段以及 `keyAnalysis.modulations`
    - _Requirements: 4.4, 5.7_

- [x] 2. 实现分块上下文传递
  - [x] 2.1 修改 `buildUserPrompt` 函数签名，新增 `previousChords?: string[]` 参数，当非空时在 prompt 开头插入"前一段结尾和弦"上下文段落
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 2.2 修改 `LLMHarmonizer.harmonize()` 方法签名，新增 `previousChords` 参数并传递给 `buildUserPrompt`
    - _Requirements: 1.1_
  - [x]* 2.3 编写属性测试：前置和弦上下文包含在 prompt 中
    - **Property 1: 前置和弦上下文包含在 prompt 中**
    - **Validates: Requirements 1.1, 1.3**

- [x] 3. 实现 RAG 查询与 LLM 分块对齐
  - [x] 3.1 修改 `buildUserPrompt` 函数，将 `ragResults` 参数类型改为 `AnnotatedRAGResult[]`，按 `measureRange` 分组展示参考和弦进行
    - _Requirements: 2.1, 2.2, 2.3_
  - [x]* 3.2 编写属性测试：RAG 结果按小节范围分组标注
    - **Property 2: RAG 结果按小节范围分组标注**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 4. 实现拍位置智能分配
  - [x] 4.1 修改 `buildSystemPrompt`，在输出格式说明中新增拍位置格式要求（如 `1: I(1) V(3)`）
    - _Requirements: 3.4_
  - [x] 4.2 修改 `parseLLMOutput`，支持解析 `和弦(拍位置)` 格式，提取 `beats` 数组；无拍位置时 `beats` 为 `undefined`
    - _Requirements: 3.1_
  - [x] 4.3 修改 `applyToScore`，优先使用 `beats` 中的拍位置（1-based 转 0-based），无 `beats` 时回退到均匀分配
    - _Requirements: 3.2, 3.3_
  - [x]* 4.4 编写属性测试：拍位置解析正确性
    - **Property 3: 拍位置解析正确性**
    - **Validates: Requirements 3.1**
  - [x]* 4.5 编写属性测试：拍位置应用优先级
    - **Property 4: 拍位置应用优先级**
    - **Validates: Requirements 3.2, 3.3**

- [x] 5. Checkpoint - 确保所有测试通过
  - 运行 `vitest --run`，确保所有测试通过。如有问题请告知。

- [x] 6. 实现后处理验证层
  - [x] 6.1 新建 `harmony-engine/src/harmonizer/chord-validator.ts`，实现 `loadTransitionMatrix`、`checkChordCoverage`、`checkTransitionProbability`、`validateHarmonization` 函数
    - `checkChordCoverage`：使用 `CHORD_TEMPLATES` 计算和弦音集合，检查强拍旋律音是否为和弦音
    - `checkTransitionProbability`：查询转移矩阵，与阈值比较
    - `validateHarmonization`：遍历 Score 执行两项检查，收集异常，计算通过率
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x]* 6.2 编写属性测试：和弦音覆盖检查正确性
    - **Property 5: 和弦音覆盖检查正确性**
    - **Validates: Requirements 4.1**
  - [x]* 6.3 编写属性测试：转换概率查询正确性
    - **Property 6: 转换概率查询正确性**
    - **Validates: Requirements 4.2**
  - [x]* 6.4 编写属性测试：验证不修改和弦数据
    - **Property 7: 验证不修改和弦数据**
    - **Validates: Requirements 4.3**

- [x] 7. 实现分段调性分析与转调检测
  - [x] 7.1 在 `key-analyzer.ts` 中新增 `ModulationPoint`、`SegmentedKeyResult` 类型，实现 `analyzeKeySegmented` 函数
    - 滑动窗口（8 小节窗口，2 小节步长）提取音高分布并运行 KS
    - 检测相邻窗口调性变化区域，逐小节定位转调点
    - 验证转调前后各 4 小节置信度 > 阈值
    - 短曲（< 12 小节）跳过分段分析
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.8_
  - [x] 7.2 在 `key-analyzer.ts` 中实现 `getEffectiveKey` 函数，根据 `keyChange` 字段返回指定小节的有效调性
    - _Requirements: 5.5, 5.6_
  - [x]* 7.3 编写属性测试：getEffectiveKey 返回正确调性
    - **Property 8: getEffectiveKey 返回正确调性**
    - **Validates: Requirements 5.5, 5.6**
  - [x]* 7.4 编写属性测试：短曲跳过分段分析
    - **Property 9: 短曲跳过分段分析**
    - **Validates: Requirements 5.8**
  - [x]* 7.5 编写单元测试：构造明确转调的 Score 验证检测正确性，构造含色彩音的 Score 验证不误报
    - _Requirements: 5.2, 5.3_

- [x] 8. 实现难度级别和弦白名单过滤
  - [x] 8.1 新建 `harmony-engine/src/harmonizer/difficulty-filter.ts`，定义 `DIFFICULTY_WHITELISTS` 和 `FUNCTIONAL_SUBSTITUTIONS` 常量，实现 `filterChord` 和 `filterMeasureChords` 函数
    - 标准化输入和弦（去掉转位标记），与白名单比对
    - 不在白名单中的和弦查找替换映射，无映射时回退到功能组默认和弦
    - advanced 级别直接跳过
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x]* 8.2 编写属性测试：难度过滤输出始终合规
    - **Property 10: 难度过滤输出始终合规**
    - **Validates: Requirements 6.2, 6.3, 6.5**

- [x] 9. Checkpoint - 确保所有测试通过
  - 运行 `vitest --run`，确保所有测试通过。如有问题请告知。

- [x] 10. 管线集成
  - [x] 10.1 修改 `HarmonizePipeline` 构造函数，加载转移概率矩阵（可选）
    - _Requirements: 4.2_
  - [x] 10.2 修改 `harmonizeFromXML` 和 `harmonizeScore` 主循环：
    - 将 `analyzeKey` 替换为 `analyzeKeySegmented`，将转调信息写入 Measure.keyChange
    - 在分块循环中追踪 `previousChords`，传递给 `harmonize()`
    - RAG 结果收集时保留小节范围信息，构建 `AnnotatedRAGResult[]`
    - LLM 生成后执行难度白名单过滤（`filterMeasureChords`）
    - `applyToScore` 中使用 `getEffectiveKey` 获取局部调性
    - 写入 Score 后执行后处理验证（`validateHarmonization`）
    - 汇总验证统计和过滤统计到 PipelineResult
    - _Requirements: 1.1, 2.1, 4.4, 5.4, 5.5, 5.7, 6.2_
  - [x]* 10.3 编写集成单元测试：验证 PipelineResult 包含 validation、difficultyFilter、modulations 字段
    - _Requirements: 4.4, 5.7_

- [x] 11. Final checkpoint - 确保所有测试通过
  - 运行 `vitest --run`，确保所有测试通过。如有问题请告知。

## Notes

- 标记 `*` 的子任务为可选测试任务，可跳过以加速 MVP
- 每个任务引用了具体的需求编号以确保可追溯性
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- Checkpoint 任务确保增量验证
