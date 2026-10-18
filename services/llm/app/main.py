import logging

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

from .config import load_settings
from .extractors import ExtractionError, analyze, build_extractor
from .embeddings import Embedder, get_embedder, load_embedding_settings
from .matching import MatchingUnavailable, VehicleRepository, get_vehicle_repo, match, query_text
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    EmbedRequest,
    EmbedResponse,
    HealthResponse,
    MatchRequest,
    MatchResponse,
)

logging.basicConfig(level=logging.INFO)

settings = load_settings()
extractor = build_extractor(settings)
app = FastAPI(title="purplemine LLM server", version="0.1.0")


@app.get("/health")
def health() -> HealthResponse:
    emb = load_embedding_settings()  # 모델을 로드하지 않는다
    return HealthResponse(
        provider=settings.provider,
        model=settings.model,
        prompt_version=settings.prompt_version,
        embedding_provider=emb.provider,
        embedding_model=emb.model,
        embedding_dimension=emb.dim,
    )


@app.post("/analyze")
def analyze_script(req: AnalyzeRequest) -> AnalyzeResponse:
    try:
        return analyze(req, extractor, settings)
    except ExtractionError as e:
        raise HTTPException(status_code=502, detail=f"model error: {e}") from e


EmbedderDep = Annotated[Embedder, Depends(get_embedder)]


def _embed(embedder: Embedder, texts: list[str], kind: str) -> list[list[float]]:
    try:
        return embedder.embed(texts, kind)  # type: ignore[arg-type]
    except Exception as e:  # 모델 로드/다운로드/호출 실패
        logging.getLogger(__name__).error("embedding failed: %s", type(e).__name__)
        raise HTTPException(status_code=503, detail=f"embedding unavailable: {type(e).__name__}") from e


@app.post("/embed")
def embed(req: EmbedRequest, embedder: EmbedderDep) -> EmbedResponse:
    vecs = _embed(embedder, req.texts, req.kind)
    return EmbedResponse(model=embedder.model, dimension=embedder.dimension, embeddings=vecs)


def _repo_dep() -> VehicleRepository:
    try:
        return get_vehicle_repo()
    except MatchingUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/match")
def match_vehicles(
    req: MatchRequest, embedder: EmbedderDep, repo: Annotated[VehicleRepository, Depends(_repo_dep)]
) -> MatchResponse:
    qvec = _embed(embedder, [query_text(req.requirement)], "query")[0]
    try:
        cands = match(req.requirement, req.top_k, qvec, repo)
    except MatchingUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return MatchResponse(model=embedder.model, candidates=cands)
