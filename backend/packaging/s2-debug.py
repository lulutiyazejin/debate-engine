import os; from pathlib import Path
os.environ['KB_PATH'] = 'Z:\\DebateEngine\\knowledge_base'
import sys; sys.path.insert(0, r'c:\Users\Administrator\Documents\Qoder\2026-08-17\chat-3')
from backend import config
print('MODELS_DIR:', config.MODELS_DIR)
bge = config.BGE_M3_PATH
print('BGE exists:', bge.exists())
if bge.exists():
    print('files:', [(f, (bge/f).exists()) for f in ['pytorch_model.bin', 'tokenizer.json']])
from backend.api.components import _bge_lib_ok
print('_bge_lib_ok:', _bge_lib_ok())
