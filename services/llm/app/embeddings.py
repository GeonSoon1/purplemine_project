"""임베딩 계층. 기본은 로컬 sentence-transformers(intfloat/multilingual-e5-small, 외부 전송 없음).

테스트/교체를 위해 `Embedder` 프로토콜로 추상화하고 FastAPI 의존성(`get_embedder`)으로 주입한다.
무거운 import(torch 등)와 모델 로드는 첫 사용 시점(lazy)에만 일어난다.
"""
from __future__ import annotations

import math
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

Kind = Literal["passage", "query"]

LOCAL_DEFAULT_MODEL = "intfloat/multilingual-e5-small"
OPENAI_DEFAULT_MODEL = "text-embedding-3-small"
DEFAULT_DIM = 384
DEFAULT_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "models"


class Embedder(Protocol):
    model: str
    dimension: int

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]: ...


@dataclass(frozen=True)
class EmbeddingSettings:
    provider: str
    model: str
    dim: int
    cache_dir: Path


def load_embedding_settings() -> EmbeddingSettings:
    provider = os.getenv("EMBEDDING_PROVIDER", "local").strip().lower() or "local"
    if provider not in ("local", "openai"):
        raise ValueError(f"unsupported EMBEDDING_PROVIDER: {provider}")
    default_model = LOCAL_DEFAULT_MODEL if provider == "local" else OPENAI_DEFAULT_MODEL
    model = os.getenv("EMBEDDING_MODEL", "").strip() or default_model
    dim = int(os.getenv("EMBEDDING_DIM", "").strip() or DEFAULT_DIM)
    cache = os.getenv("EMBEDDING_CACHE_DIR", "").strip()
    return EmbeddingSettings(provider, model, dim, Path(cache) if cache else DEFAULT_CACHE_DIR)


def _normalize(vec: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / n for x in vec]


class LocalE5Embedder:
    """sentence-transformers 로컬 모델. e5 규칙: 'passage: ' / 'query: ' 접두어 + L2 정규화."""

    def __init__(self, settings: EmbeddingSettings):
        self.model = settings.model
        self.dimension = settings.dim
        self._cache_dir = settings.cache_dir
        self._st = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._st is None:
                self._cache_dir.mkdir(parents=True, exist_ok=True)
                from sentence_transformers import SentenceTransformer  # lazy

                st = SentenceTransformer(self.model, cache_folder=str(self._cache_dir))
                actual = st.get_embedding_dimension()
                if actual != self.dimension:
                    raise ValueError(
                        f"EMBEDDING_DIM={self.dimension} but model {self.model} outputs {actual}"
                    )
                self._st = st
            return self._st

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]:
        st = self._load()
        prefixed = [f"{kind}: {t}" for t in texts]
        arr = st.encode(prefixed, normalize_embeddings=True, convert_to_numpy=True)
        return [[float(x) for x in row] for row in arr]


class OpenAIEmbedder:
    """나중용. langchain-openai 를 lazy import 하고 키는 환경변수(OPENAI_API_KEY, .env)로만 받는다.
    외부 전송이므로 계약 확인 후에만 사용. text-embedding-3 계열은 dimensions 로 차원을 맞춘다."""

    def __init__(self, settings: EmbeddingSettings):
        self.model = settings.model
        self.dimension = settings.dim
        self._client = None

    def embed(self, texts: list[str], kind: Kind) -> list[list[float]]:
        if self._client is None:
            from langchain_openai import OpenAIEmbeddings  # lazy

            self._client = OpenAIEmbeddings(model=self.model, dimensions=self.dimension)
        vecs = self._client.embed_documents(texts)
        return [_normalize(v) for v in vecs]


def build_embedder(settings: EmbeddingSettings) -> Embedder:
    if settings.provider == "openai":
        return OpenAIEmbedder(settings)
    return LocalE5Embedder(settings)


_embedder: Embedder | None = None
_guard = threading.Lock()


def get_embedder() -> Embedder:
    """FastAPI 의존성. 테스트에서는 app.dependency_overrides[get_embedder] 로 페이크 주입."""
    global _embedder
    with _guard:
        if _embedder is None:
            _embedder = build_embedder(load_embedding_settings())
        return _embedder
