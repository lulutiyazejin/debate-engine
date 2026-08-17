"""FastAPI 入口：注册全部路由。运行：python main.py 或 uvicorn main:app。"""
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config
from api import diagnostics, import_doc, knowledge, rebuttal, stances
from applog import log_system


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.ensure_dirs()
    log_system("api_startup", host=config.API_HOST, port=config.API_PORT)
    yield


app = FastAPI(title="Debate Engine API", version=config.VERSION,
              lifespan=lifespan)
app.include_router(rebuttal.router)
app.include_router(import_doc.router)
app.include_router(knowledge.router)
app.include_router(stances.router)
app.include_router(diagnostics.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.API_HOST, port=config.API_PORT)
