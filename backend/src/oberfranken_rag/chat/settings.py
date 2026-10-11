"""Settings. The model comes from OPENROUTER_MODEL. The provider endpoint has NO default and must be named explicitly
(OPENROUTER_PROVIDER_ENDPOINT). A model/endpoint pair is only usable if it is listed in APPROVED below, because the listed prices
(bound to that exact model) are what bound the cost of a call. Anything else is refused. There is never a fallback."""
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from .. import config as c

class ConfigError(ValueError):
    """Invalid configuration. Raised at startup so a bad budget can never silently turn into a default."""

@dataclass(frozen=True)
class Endpoint:
    provider_name: str   # as OpenRouter reports it in the reply, checked against the reply
    price_in: float      # USD per input token
    price_out: float     # USD per output token

DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash"
# Approved (model -> endpoint tag -> Endpoint). Checked on 2026-10-09 against OpenRouter's public endpoint list: ZDR-listed, 100% uptime,
# supporting reasoning control, response_format, structured_outputs, seed, max_tokens and temperature. Prices are OpenRouter list prices
# and change: recheck before paid use. Other models (for example a Pro variant) have different prices and are NOT approved here.
APPROVED = {
    "deepseek/deepseek-v4.1-flash": {
        "deepinfra/fp8": Endpoint("DeepInfra", 0.14e-6, 0.42e-6),
        "decart/fp4": Endpoint("Decart", 0.09e-6, 0.18e-6),
        "inference-net/fp8": Endpoint("InferenceNet", 0.07e-6, 0.60e-6),
        "sail-research/fp4": Endpoint("Sail Research", 0.08e-6, 0.40e-6),
        "open-inference/fp4": Endpoint("OpenInference", 0.02e-6, 1.00e-6),
    },
}
def endpoint_for(model, tag):
    return APPROVED.get(model, {}).get(tag) if isinstance(model, str) and isinstance(tag, str) else None

HARD_BUDGET_USD = 1.0
MAX_BODY_BYTES = 8192

def positive_finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ConfigError(f"{name} must be a finite number greater than zero")
    return float(value)

@dataclass(frozen=True)
class Settings:
    api_key: str | None = field(default=None, repr=False)
    model: str = DEFAULT_MODEL
    endpoint_tag: str | None = None
    allow_paid: bool = False
    budget_usd: float = HARD_BUDGET_USD
    ledger_path: Path = c.STORAGE / "openrouter_budget.json"
    rate_limit_per_min: int = 20
    request_deadline_s: float = 25.0   # one monotonic deadline for queueing + retrieval + generation; the UI gives up at 30 s
    provider_timeout_s: float = 20.0   # upper limit for a single provider call (also capped by what is left of the deadline)
    min_paid_call_s: float = 5.0       # a paid call is not started with less time than this left
    max_output_tokens: int = 400
    max_message_chars: int = 500
    evidence_k: int = 5
    # Weak-evidence cut-offs. CALIBRATION, not held-out validation: chosen by looking at the same 26 gold queries (best hit <= 0.182)
    # and 10 hand-written off-topic queries (best hit >= 0.201). Small samples; a safeguard, not a guarantee.
    top_distance: float = 0.20
    item_distance: float = 0.22
    def __post_init__(self):
        for name in ("budget_usd", "request_deadline_s", "provider_timeout_s", "min_paid_call_s"):
            positive_finite(getattr(self, name), name)
        if self.budget_usd > HARD_BUDGET_USD: object.__setattr__(self, "budget_usd", HARD_BUDGET_USD)

def read_dotenv(path):
    values = {}
    path = Path(path)
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip("'\"")
    return values

def load_settings(environ=None, dotenv=c.ROOT / ".env") -> Settings:
    env = {**read_dotenv(dotenv), **(os.environ if environ is None else environ)}
    key = (env.get("OPENROUTER_API_KEY") or "").strip()
    raw = (env.get("OPENROUTER_BUDGET_USD") or "").strip()
    try: budget = float(raw) if raw else HARD_BUDGET_USD
    except ValueError: raise ConfigError("OPENROUTER_BUDGET_USD must be a finite number greater than zero") from None
    return Settings(api_key=key or None,
                    model=(env.get("OPENROUTER_MODEL") or "").strip() or DEFAULT_MODEL,
                    endpoint_tag=(env.get("OPENROUTER_PROVIDER_ENDPOINT") or "").strip() or None,
                    allow_paid=(env.get("OPENROUTER_ALLOW_PAID_CALLS") or "").strip().lower() in ("1", "true", "yes"),
                    budget_usd=budget)
