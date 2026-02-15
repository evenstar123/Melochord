# 实现计划：Harmony Engine Web 前端

## 概述

将设计文档转化为可执行的编码任务，按照"转换器 → 后端服务器 → 前端界面"的顺序递进实现，确保每一步都可验证。

## 任务

- [ ] 1. 实现 IR → MusicXML 和弦注入转换器
  - [x] 1.1 创建 `harmony-engine/src/converter/ir-to-musicxml.ts`
    - 实现 `QUALITY_TO_KIND` 映射表（ChordQuality → MusicXML kind 字符串）
    - 实现 `accidentalToAlter` 函数（Accidental → MusicXML alter 数值）
    - 实现 `injectChordsToMusicXML(originalXml, score)` 函数，将 Score 中每个小节的 ChordSymbol 转换为 `<harmony>` XML 元素并插入到对应小节的 `<note>` 元素之前
    - 在 `harmony-engine/src/index.ts` 中导出新函数
    - _Requirements: 9.1, 9.2_
  - [ ]* 1.2 编写 MusicXML 和弦注入的属性测试
    - **Property 1: MusicXML chord injection round-trip**
    - 使用 fast-check 生成随机 Score 对象（随机小节数、随机 ChordSymbol），执行 injectChordsToMusicXML → parseMusicXML 往返，验证和弦数据等价
    - **Validates: Requirements 9.1, 9.2, 9.3**
  - [ ]* 1.3 编写 MusicXML 和弦注入的单元测试
    - 测试各种 ChordQuality 映射（major, minor, dominant7 等）
    - 测试变音记号处理（sharp, flat, none）
    - 测试空和弦小节不注入 harmony 元素
    - _Requirements: 9.2_

- [ ] 2. 实现 IR → ABC Notation 转换器
  - [x] 2.1 创建 `harmony-engine/src/converter/ir-to-abc.ts`
    - 实现 `keyToABCField(key)` 函数（KeySignature → ABC K: 字段值）
    - 实现 `noteToABC(note)` 函数（Note → ABC 音符字符串，处理八度、变音记号、时值）
    - 实现 `chordToABC(chord)` 函数（ChordSymbol → ABC 和弦标注字符串）
    - 实现 `scoreToABC(score)` 主函数，生成完整 ABC 文本（含 T:、M:、K: 头部 + 音符和弦内容）
    - 在 `harmony-engine/src/index.ts` 中导出新函数
    - _Requirements: 10.2, 10.4_
  - [ ]* 2.2 编写 ABC 转换的属性测试
    - **Property 2: ABC notation conversion completeness**
    - 使用 fast-check 生成随机 Score，验证 ABC 输出包含正确的 T:/M:/K: 字段、所有和弦名称和音符表示
    - **Validates: Requirements 10.2, 10.4**
  - [ ]* 2.3 编写 ABC 转换的单元测试
    - 测试各种音符时值的 ABC 表示（whole, half, quarter, eighth, 16th）
    - 测试八度表示（高八度小写、低八度逗号）
    - 测试附点音符、休止符、和弦格式
    - _Requirements: 10.2, 10.4_

- [x] 3. 检查点 — 确保转换器测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 4. 实现 Express 后端服务器
  - [x] 4.1 初始化服务器项目结构
    - 在 `harmony-engine/server/` 下创建 `index.ts` 服务器入口
    - 安装 express 依赖（`npm install express @types/express`）
    - 配置 dotenv 加载 `.env.local` 中的 DASHSCOPE_API_KEY
    - 配置静态文件服务指向 `web/` 目录
    - 服务器默认监听端口 4000
    - _Requirements: 2.4, 2.5_
  - [x] 4.2 实现 `/api/harmonize` 路由
    - 接收 POST 请求，解析 `{ musicxml, difficulty }` 请求体
    - 参数校验：缺少 musicxml 返回 400，无效 difficulty 返回 400
    - 调用 `HarmonizePipeline.harmonizeFromXML()` 执行分析
    - 调用 `injectChordsToMusicXML()` 生成带和弦的 MusicXML
    - 从 Score 提取和弦进行序列（chordProgression）
    - 返回 `{ score, musicxml, analysis }` JSON 响应
    - 捕获管线异常返回 500 错误
    - _Requirements: 2.1, 2.2, 2.3, 9.1_
  - [x] 4.3 实现 `/api/export/abc` 路由
    - 接收 POST 请求，解析 `{ score }` 请求体
    - 调用 `scoreToABC(score)` 生成 ABC 文本
    - 返回 `{ abc }` JSON 响应
    - _Requirements: 10.1_
  - [ ]* 4.4 编写后端 API 单元测试
    - 测试缺少 musicxml 参数返回 400
    - 测试无效 difficulty 返回 400
    - 测试正常请求返回正确的响应结构
    - **Property 4: API response structure completeness**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 5. 检查点 — 确保后端服务器可运行
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 6. 实现前端界面 — 复古典雅设计
  - [x] 6.1 重新设计 `harmony-engine/web/index.html` 页面结构与样式
    - 替换现有页面为复古典雅风格设计
    - 使用 Noto Serif SC / 思源宋体衬线字体
    - 暖色调配色：米白/羊皮纸背景（#f5f0e8）、深棕文字（#3e2723）、金色点缀（#8d6e63）
    - 乐谱区域卡片式容器：细线边框、微妙阴影、纸质质感
    - 装饰性音乐符号分隔线
    - 页面结构：标题区 → 控制栏（上传/示例/难度/视图切换/导出ABC） → 乐谱区 → 分析信息面板 → 状态栏
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 6.2 实现文件上传与示例加载功能
    - 文件上传按钮：接受 .xml/.musicxml 文件，读取内容
    - MusicXML 格式验证：检查是否包含 `<score-partwise>` 或 `<score-timewise>` 根元素
    - 加载示例按钮：使用内置的小星星 MusicXML 数据
    - 文件加载后自动触发后端分析请求
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 6.3 实现难度级别选择与分析请求
    - 三个难度按钮：基础/中级/高级，默认选中"中级"
    - 选择难度后，如已有 MusicXML 数据则自动重新分析
    - 发送 POST /api/harmonize 请求，传递 musicxml 和 difficulty 参数
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 6.4 实现乐谱渲染与视图切换
    - 五线谱视图：使用 OSMD 加载后端返回的 MusicXML（含 harmony 元素）
    - 简谱视图：复用并改进现有 Canvas 简谱渲染器，使用后端返回的 Score 数据
    - 视图切换按钮：五线谱/简谱切换，保留已加载数据
    - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_
  - [x] 6.5 实现分析信息面板
    - 显示检测到的调性和置信度百分比
    - 显示和弦进行序列
    - 显示统计信息：小节数、API 调用次数、处理耗时
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 6.6 实现加载状态与错误处理
    - 分析进行中：显示加载动画 + "正在分析中..." 提示
    - 分析进行中：禁用上传/分析按钮
    - 分析完成：隐藏加载状态，渲染结果
    - 错误处理：显示用户可理解的错误信息，恢复按钮状态
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x] 6.7 实现 ABC 导出功能
    - "导出 ABC" 按钮：调用 POST /api/export/abc
    - 弹出文本框展示 ABC 内容
    - 提供"复制到剪贴板"按钮
    - _Requirements: 10.1, 10.3_

- [x] 7. 检查点 — 端到端流程验证
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 8. 集成测试与收尾
  - [ ]* 8.1 编写前端验证函数的属性测试
    - **Property 3: Invalid MusicXML rejection**
    - 使用 fast-check 生成随机非 MusicXML 字符串，验证验证函数正确拒绝
    - **Validates: Requirements 1.3**
  - [x] 8.2 在 `harmony-engine/package.json` 中添加服务器启动脚本
    - 添加 `"start:server": "tsx server/index.ts"` 脚本
    - 确保 fast-check 已添加到 devDependencies
    - _Requirements: 2.5_

- [x] 9. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加快 MVP 进度
- 每个任务引用了具体的需求编号以确保可追溯性
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 前端使用原生 JS，无需构建工具，后端使用 tsx 直接运行 TypeScript
