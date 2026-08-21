from models.model_matrix import find, MATRIX

qwen35 = find('modelscope.cn/unsloth/Qwen3.5-35B-A3B-GGUF')
print(f'ms_name lookup: {bool(qwen35)}')
for m in MATRIX[:3]:
    print(f"{m['name']} -> {m.get('ms_name', 'N/A')}")
