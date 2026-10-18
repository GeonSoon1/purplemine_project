import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()  # services/llm/.env (있을 때만)

PROMPT_VERSION = "v1"
MOCK_MODEL = "mock-rule-v1"
DEFAULT_MODELS = {"anthropic": "claude-sonnet-4-5", "openai": "gpt-4.1"}


@dataclass(frozen=True)
class Settings:
    provider: str
    model: str

    @property
    def prompt_version(self) -> str:
        return PROMPT_VERSION


def load_settings() -> Settings:
    provider = os.getenv("LLM_PROVIDER", "mock").strip().lower() or "mock"
    if provider not in ("mock", "anthropic", "openai"):
        raise ValueError(f"unsupported LLM_PROVIDER: {provider}")
    if provider == "mock":
        model = MOCK_MODEL
    else:
        model = os.getenv("LLM_MODEL", "").strip() or DEFAULT_MODELS[provider]
    return Settings(provider=provider, model=model)
