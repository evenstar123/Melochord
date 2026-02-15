# Harmony Engine — 任务规划

## 项目定位

自动和声分析引擎：输入旋律（MusicXML），输出带和弦标注的领谱（Lead Sheet）。
核心用户场景：辅助音乐老师即兴伴奏。

## 架构总览

```
MusicXML 输入 → Parser → IR → 调性分析(规则层) → 旋律特征提取 → RAG检索 + LLM生成 → 和弦标注 → MusicXML输出 → OSMD/简谱渲染
                                                        ↑
                                          Hooktheory + ChoCo 统一RNA知识库
```

## 数据资产

- Hooktheory: 26,175 首歌曲，含旋律+和弦+调性标注（pitch class 级别）
- ChoCo: 学术开源数据集（古典、爵士、多风格），JAMS 格式（待获取）

## 任务清单

### 阶段一：基础设施 ✅

- [x] 项目初始化（TypeScript + Vitest）
- [x] 核心数据类型 IR 定义（`core/types.ts`）
- [x] 乐理常量定义（`core/constants.ts`）
- [x] MusicXML 解析器（`parser/musicxml-parser.ts`）— MusicXML → IR
- [x] Web 可视化预览（OSMD 五线谱 + Canvas 简谱，双视图切换）
- [x] 领谱效果预览（MusicXML `<harmony>` 和弦标注渲染验证）

### 阶段二：数据预处理与知识库构建

- [ ] **Hooktheory 数据转 RNA**
  - 将 pitch_class 级别的和弦转为罗马数字级数（RNA）
  - 根据 tonic_pitch_class 计算 scale_degree
  - 根据 root_position_intervals 判断和弦质量（大/小/属七/减等）
  - 输出格式：每首歌 → `{ key, meter, melody_intervals[], chord_rna_sequence[] }`

- [ ] **ChoCo 数据处理**（待获取数据后）
  - 解析 JAMS 格式
  - 提取调性 + 和弦标注
  - 统一转为 RNA 格式

- [ ] **旋律-和弦片段切片**
  - 按 2-4 小节切片
  - 提取旋律特征向量（音程序列 + 节奏密度）
  - 关联对应的 RNA 和弦进行

- [ ] **和弦转移概率矩阵**
  - 从全量数据统计 bigram/trigram 转移概率
  - 按风格分组统计（可选）

### 阶段三：调性分析器（规则层）

- [ ] **调性分析器**（`analyzer/key-analyzer.ts`）
  - 从 MusicXML 调号直接读取（主要路径）
  - Krumhansl-Schmuckler 算法验证/修正
  - 输出：确定的调性 + 置信度

### 阶段四：LLM + RAG 和弦生成

- [ ] **RAG 检索管线**
  - 旋律特征提取（音程序列 → 向量）
  - 向量检索：找到最相似的 N 段旋律片段及其和弦方案
  - 返回候选和弦进行（RNA 格式）

- [ ] **LLM 和弦生成**
  - Qwen (DashScope) 接入
  - Prompt 模板设计：调性 + 旋律描述 + RAG 检索结果 → 和弦方案
  - temperature=0 保证确定性
  - 输出解析：LLM 文本 → ChordSymbol[]

- [ ] **后处理验证**
  - 和弦音是否覆盖旋律强拍音
  - 和弦进行是否符合转移概率（异常检测）
  - 基本乐理约束检查

### 阶段五：输出与端到端打通

- [ ] **IR → MusicXML 和弦注入**（`converter/ir-to-musicxml.ts`）
  - 将生成的和弦写入 MusicXML `<harmony>` 元素
  - OSMD 自动渲染

- [ ] **IR → ABC Notation**（`converter/ir-to-abc.ts`）
  - 轻量文本输出，含和弦标注

- [ ] **Web 界面完整流程**
  - 上传 MusicXML → 调性分析 → RAG+LLM → 领谱渲染
  - 显示分析信息（调性、和弦进行、参考曲目）
  - 难度分级选项（初级：I/IV/V，进阶：含离调/转位）

### 阶段六：优化与扩展（远期）

- [ ] 简谱 DSL 输入支持
- [ ] 风格分流检索（流行/古典/爵士加权）
- [ ] 和弦编辑功能（手动修正）
- [ ] 音乐知识图谱（Neo4j，和弦节点+转移概率边）
- [ ] AI 微调（Hooktheory 正例 + ChoCo 约束）
- [ ] iOS App

## 当前进度

阶段一已完成。下一步进入阶段二：Hooktheory 数据预处理，构建 RNA 统一知识库。
