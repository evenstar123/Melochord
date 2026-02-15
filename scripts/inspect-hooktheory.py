import json
import sys

print("Loading Hooktheory.json...")
with open("Hooktheory.json", "r", encoding="utf-8") as f:
    data = json.load(f)

print(f"Total entries: {len(data)}")

# Inspect first entry
item = list(data.values())[0]
key = list(data.keys())[0]
print(f"\nFirst entry ID: {key}")
print(f"Top-level keys: {list(item.keys())}")

ann = item["annotations"]
print(f"Annotations keys: {list(ann.keys())}")
print(f"Num beats: {ann['num_beats']}")
print(f"Keys: {ann['keys']}")
print(f"Meters: {ann['meters']}")
print(f"Melody notes: {len(ann['melody'])}")
print(f"Harmony chords: {len(ann['harmony'])}")

print("\nFirst 3 harmony entries:")
for h in ann["harmony"][:3]:
    print(f"  {h}")

print("\nFirst 3 melody entries:")
for m in ann["melody"][:3]:
    print(f"  {m}")

# Check a few more entries for variety
print("\n--- Sampling 5 random entries ---")
import random
random.seed(42)
sample_keys = random.sample(list(data.keys()), min(5, len(data)))
for sk in sample_keys:
    s = data[sk]
    ann2 = s["annotations"]
    ht = s.get("hooktheory", {})
    print(f"\n  ID: {sk}")
    print(f"  Artist: {ht.get('artist','?')}, Song: {ht.get('song','?')}")
    print(f"  Keys: {ann2['keys']}")
    print(f"  Beats: {ann2['num_beats']}, Harmony chords: {len(ann2['harmony'])}, Melody notes: {len(ann2['melody'])}")
    # Show first harmony
    if ann2["harmony"]:
        print(f"  First chord: {ann2['harmony'][0]}")
