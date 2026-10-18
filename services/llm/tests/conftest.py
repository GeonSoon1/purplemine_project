import hashlib
import math

import pytest

DIM = 384


class FakeEmbedder:
    """결정적 페이크: 문자 2-gram 해시 bag -> 정규화. 비슷한 문자열이 가깝다."""

    model = "fake-embedder"
    dimension = DIM

    def __init__(self):
        self.calls: list[tuple[list[str], str]] = []

    def embed(self, texts, kind):
        self.calls.append((list(texts), kind))
        out = []
        for t in texts:
            v = [0.0] * DIM
            s = t.replace(" ", "")
            for i in range(len(s) - 1):
                h = int(hashlib.md5(s[i : i + 2].encode()).hexdigest(), 16)
                v[h % DIM] += 1.0
            n = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / n for x in v])
        return out


@pytest.fixture
def fake_embedder():
    return FakeEmbedder()
