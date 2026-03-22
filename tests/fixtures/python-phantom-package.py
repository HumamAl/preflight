# Expected findings: 2 PHANTOM_PACKAGE (critical)
#
# Phantom packages in this file:
#   1. 'flask-restful-v2'  -- does not exist on PyPI; the real package is 'flask-restful'
#   2. 'python-dotenv-v2'  -- does not exist on PyPI; the real package is 'python-dotenv'
#
# NOT a phantom package:
#   - 'sklearn' is imported but installed via 'scikit-learn'. The import name
#     IS 'sklearn', so this is a correct import of a real package with a
#     different install name. Do not flag it.
#
# NOTE: These bugs are INTENTIONAL test fixtures for the preflight plugin.

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from flask import Flask, jsonify, request
from flask_restful_v2 import Api, Resource  # PHANTOM: real package is 'flask-restful'
from python_dotenv_v2 import load_dotenv    # PHANTOM: real package is 'python-dotenv'
from sklearn.ensemble import RandomForestClassifier  # OK: installed as 'scikit-learn', import is 'sklearn'
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
api = Api(app)

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class PredictionRequest:
    """Incoming payload for the /predict endpoint."""

    features: list[float]
    model_version: str = "latest"


@dataclass
class PredictionResponse:
    """Response payload from the /predict endpoint."""

    prediction: int
    confidence: float
    model_version: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ---------------------------------------------------------------------------
# ML model management
# ---------------------------------------------------------------------------


class ModelRegistry:
    """Simple in-memory registry that holds trained sklearn models."""

    def __init__(self) -> None:
        self._models: dict[str, RandomForestClassifier] = {}
        self._active_version: str | None = None

    def register(self, version: str, model: RandomForestClassifier) -> None:
        self._models[version] = model
        self._active_version = version
        logger.info("Registered model version %s", version)

    def get(self, version: str = "latest") -> RandomForestClassifier:
        if version == "latest":
            if self._active_version is None:
                raise RuntimeError("No model has been registered yet")
            return self._models[self._active_version]

        if version not in self._models:
            raise KeyError(f"Model version '{version}' not found in registry")
        return self._models[version]

    @property
    def versions(self) -> list[str]:
        return list(self._models.keys())


registry = ModelRegistry()

# ---------------------------------------------------------------------------
# Train a default model at startup (demo purposes)
# ---------------------------------------------------------------------------


def _train_default_model() -> None:
    """Train a small RandomForest on synthetic data so the API has a model to serve."""
    from sklearn.datasets import make_classification

    X, y = make_classification(
        n_samples=500,
        n_features=10,
        n_informative=6,
        random_state=42,
    )
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42,
    )

    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    clf.fit(X_train, y_train)

    score = accuracy_score(y_test, clf.predict(X_test))
    logger.info("Default model accuracy: %.4f", score)

    registry.register("v1.0.0", clf)


# ---------------------------------------------------------------------------
# API resources (uses phantom 'flask-restful-v2')
# ---------------------------------------------------------------------------


class PredictResource(Resource):
    """POST /predict -- run inference against the active model."""

    def post(self) -> tuple[dict[str, Any], int]:
        payload = request.get_json(silent=True)
        if payload is None:
            return {"error": "Request body must be valid JSON"}, 400

        try:
            req = PredictionRequest(
                features=payload["features"],
                model_version=payload.get("model_version", "latest"),
            )
        except (KeyError, TypeError) as exc:
            return {"error": f"Invalid payload: {exc}"}, 422

        try:
            model = registry.get(req.model_version)
        except (KeyError, RuntimeError) as exc:
            return {"error": str(exc)}, 404

        probabilities = model.predict_proba([req.features])[0]
        prediction = int(model.predict([req.features])[0])
        confidence = float(max(probabilities))

        resp = PredictionResponse(
            prediction=prediction,
            confidence=round(confidence, 4),
            model_version=req.model_version,
        )

        logger.info(
            "Prediction: class=%d confidence=%.4f version=%s",
            resp.prediction,
            resp.confidence,
            resp.model_version,
        )

        return {
            "prediction": resp.prediction,
            "confidence": resp.confidence,
            "model_version": resp.model_version,
            "timestamp": resp.timestamp,
        }, 200


class ModelVersionsResource(Resource):
    """GET /models -- list all registered model versions."""

    def get(self) -> tuple[dict[str, Any], int]:
        return {"versions": registry.versions}, 200


api.add_resource(PredictResource, "/predict")
api.add_resource(ModelVersionsResource, "/models")

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    _train_default_model()
    app.run(host="0.0.0.0", port=5000, debug=False)
