# MeloChord

自动和声分析引擎 — 上传旋律，自动配和弦，生成领谱（Lead Sheet）。

基于 RAG（检索增强生成）+ LLM 的智能和声分析平台，辅助音乐老师即兴伴奏、编曲学习者理解和声进行。

## 功能

- 上传 MusicXML 或乐谱图片/PDF，自动生成和弦标注
- 五线谱（OSMD）和简谱双视图渲染
- 三级难度：基础 / 进阶 / 高级
- ABC Notation 导出
- OMR 光学乐谱识别（Audiveris）

## 快速开始

```bash
npm install
```

在项目根目录创建 `.env.local`：

```
DASHSCOPE_API_KEY=your_api_key_here
```

启动服务器：

```bash
npm run dev
```

访问 http://localhost:4000

## 数据文件

以下大文件不在 git 中，需要单独准备：

- `data/phrase_embeddings.bin` — 预计算的 embedding 向量（二进制）
- `data/phrase_meta.json` — 片段元数据
- `data/phrase_embeddings.json` — 原始 embedding JSON（可选）

运行预计算脚本生成：

```bash
npx tsx scripts/precompute-embeddings.ts
npx tsx scripts/convert-embeddings-to-bin.ts
```

## 技术栈

TypeScript / Node.js / Express / DashScope (Qwen + text-embedding-v4) / Audiveris / OSMD
