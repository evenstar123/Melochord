"""
预计算片段 embedding 脚本（Python 版）

使用 DashScope text-embedding-v4 批量生成 embedding，
支持高并发 + 断点续传 + 自动重试。

用法: python scripts/precompute-embeddings.py
续传: python scripts/precompute-embeddings.py --resume

依赖: pip install openai python-dotenv
"""

import json
import os
import sys
import time
import asyncio
import argparse
from pathlib import Path
from dotenv import load_dotenv
from openai import AsyncOpenAI

# 加载 .env.local
env_path = Path(__file__).resolve().parent.parent.parent / ".env.local"
load_dotenv(env_path)

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")
if not DASHSCOPE_API_KEY:
    print("错误: DASHSCOPE_API_KEY 未设置")
    sys.exit(1)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PHRASES_PATH = DATA_DIR / "hooktheory_phrases.json"
OUTPUT_PATH = DATA_DIR / "phrase_embeddings.json"
CHECKPOINT_PATH = DATA_DIR / "embedding_checkpoint.json"

BATCH_SIZE = 10        # DashScope 每批限制 10 条
CONCURRENCY = 15       # 并发请求数（提高到 15）
MODEL = "text-embedding-v4"
MAX_RETRIES = 3        # 单批最大重试次数
CHECKPOINT_INTERVAL = 2000000  # 每完成 N 批保存一次断点


def phrase_to_text(phrase: dict) -> str:
    """将片段转为可嵌入的文本描述（与 TS 版保持一致）"""
    parts = [f"mode:{phrase['mode']}"]
    intervals = phrase.get("melody_intervals", [])
    if intervals:
        contour = ",".join(
            f"+{i}" if i > 0 else str(i) if i < 0 else "0"
            for i in intervals
        )
        parts.append(f"intervals:[{contour}]")
    parts.append(f"chords:[{' '.join(phrase['chord_sequence'])}]")
    return " ".join(parts)


async def embed_batch_with_retry(
    client: AsyncOpenAI,
    texts: list[str],
    batch_idx: int,
    sem: asyncio.Semaphore,
    progress: dict,
) -> tuple[int, list[list[float]]]:
    """带并发控制和重试的单批 embedding 请求，返回 (batch_idx, embeddings)"""
    async with sem:
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.embeddings.create(model=MODEL, input=texts)
                result = [item.embedding for item in resp.data]

                # 更新进度
                progress["done"] += 1
                done = progress["done"]
                total = progress["total"]
                pct = done / total * 100
                bar_len = 30
                filled = int(bar_len * done / total)
                bar = "█" * filled + "░" * (bar_len - filled)
                elapsed = time.time() - progress["start"]
                rate = done / elapsed if elapsed > 0 else 0
                eta = (total - done) / rate if rate > 0 else 0
                print(
                    f"\r  [{bar}] {done}/{total} ({pct:.0f}%) "
                    f"| {elapsed:.0f}s elapsed, ~{eta:.0f}s left "
                    f"| {rate:.1f} batch/s",
                    end="", flush=True,
                )

                return (batch_idx, result)

            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    wait = 2 ** attempt
                    await asyncio.sleep(wait)
                else:
                    print(f"\n⚠ 批次 {batch_idx} 失败 ({e})，填充空向量")
                    return (batch_idx, [[] for _ in texts])


def save_checkpoint(embeddings_map: dict, total_batches: int):
    """保存断点"""
    data = {
        "completed_batches": sorted(embeddings_map.keys()),
        "embeddings": {str(k): v for k, v in embeddings_map.items()},
        "total_batches": total_batches,
    }
    with open(CHECKPOINT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f)


def load_checkpoint() -> dict[int, list[list[float]]]:
    """加载断点"""
    if not CHECKPOINT_PATH.exists():
        return {}
    with open(CHECKPOINT_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {int(k): v for k, v in data["embeddings"].items()}


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true", help="从断点续传")
    parser.add_argument("--concurrency", type=int, default=CONCURRENCY, help="并发数")
    args = parser.parse_args()

    concurrency = args.concurrency

    print(f"加载片段数据: {PHRASES_PATH}")
    with open(PHRASES_PATH, "r", encoding="utf-8") as f:
        all_phrases = json.load(f)

    valid = [
        p for p in all_phrases
        if p.get("chord_sequence") and p.get("melody_intervals")
    ]
    print(f"有效片段: {len(valid)} / {len(all_phrases)}")

    texts = [phrase_to_text(p) for p in valid]
    batches = [texts[i:i + BATCH_SIZE] for i in range(0, len(texts), BATCH_SIZE)]
    total = len(batches)

    # 断点续传
    embeddings_map: dict[int, list[list[float]]] = {}
    if args.resume:
        embeddings_map = load_checkpoint()
        print(f"从断点恢复: 已完成 {len(embeddings_map)}/{total} 批")

    remaining = [i for i in range(total) if i not in embeddings_map]
    print(f"待处理: {len(remaining)} 批，并发数 {concurrency}\n")

    if not remaining:
        print("所有批次已完成，直接生成输出文件")
    else:
        client = AsyncOpenAI(
            api_key=DASHSCOPE_API_KEY,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        sem = asyncio.Semaphore(concurrency)
        progress = {"done": 0, "total": len(remaining), "start": time.time(),
                     "last_checkpoint": 0}

        async def run_and_collect(idx: int):
            batch_idx, embs = await embed_batch_with_retry(
                client, batches[idx], idx, sem, progress
            )
            embeddings_map[batch_idx] = embs
            # 按完成数量定期保存断点
            if progress["done"] - progress["last_checkpoint"] >= CHECKPOINT_INTERVAL:
                progress["last_checkpoint"] = progress["done"]
                save_checkpoint(embeddings_map, total)

        # 一次性提交所有任务，由 semaphore 控制并发
        await asyncio.gather(*(run_and_collect(idx) for idx in remaining))

        # 最终保存一次断点
        save_checkpoint(embeddings_map, total)

        elapsed = time.time() - progress["start"]
        print(f"\n完成! 耗时 {elapsed:.1f}s")

    # 按顺序组装最终 embedding 列表
    all_embeddings: list[list[float]] = []
    for i in range(total):
        all_embeddings.extend(embeddings_map.get(i, [[] for _ in batches[i]]))

    print(f"总 embedding 数: {len(all_embeddings)}")

    output = {"phrases": valid, "embeddings": all_embeddings}
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
    print(f"已保存: {OUTPUT_PATH} ({size_mb:.1f} MB)")

    # 清理断点文件
    if CHECKPOINT_PATH.exists():
        CHECKPOINT_PATH.unlink()
        print("已清理断点文件")


if __name__ == "__main__":
    asyncio.run(main())
