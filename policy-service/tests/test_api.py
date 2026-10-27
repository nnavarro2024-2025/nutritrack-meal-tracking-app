import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)
EXAMPLES = Path(__file__).resolve().parent.parent / "examples"


def example_request(name: str) -> dict:
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def test_lists_json_policies():
    response = client.get("/policies")

    assert response.status_code == 200
    assert {policy["id"] for policy in response.json()} == {
        "low_sodium_hospital",
        "diabetic_hospital",
        "national_dietary_guidelines",
    }


def test_compliant_sample_meal_plan():
    response = client.post("/validate", json=example_request("compliant"))

    assert response.status_code == 200
    assert response.json()["compliant"] is True
    assert response.json()["violations"] == []
    assert response.json()["compliance_score"] == 100


def test_borderline_sample_reports_warning_but_is_compliant():
    response = client.post("/validate", json=example_request("borderline"))

    assert response.status_code == 200
    result = response.json()
    assert result["compliant"] is True
    assert [violation["rule_id"] for violation in result["violations"]] == [
        "daily-added-sugar-limit"
    ]
    assert result["violations"][0]["severity"] == "warning"
    assert result["compliance_score"] < 100


def test_non_compliant_sample_reports_error():
    response = client.post("/validate", json=example_request("non_compliant"))

    assert response.status_code == 200
    result = response.json()
    assert result["compliant"] is False
    assert {violation["rule_id"] for violation in result["violations"]} == {
        "meal-carbohydrate-range",
        "daily-fiber-minimum",
    }
    assert all("actual_value" in violation and "allowed_value" in violation for violation in result["violations"])


def test_daily_sodium_limit_sums_all_foods():
    request = {
        "policy_id": "low_sodium_hospital",
        "meals": [
            {"name": "Breakfast", "foods": [{"name": "Soup", "nutrients": {"sodium_mg": 1100}}]},
            {"name": "Lunch", "foods": [{"name": "Sandwich", "nutrients": {"sodium_mg": 1000}}]},
        ],
    }

    result = client.post("/validate", json=request).json()

    assert result["compliant"] is False
    assert result["violations"][0]["actual_value"] == 2100


def test_exact_threshold_is_allowed_for_national_policy():
    request = {
        "policy_id": "national_dietary_guidelines",
        "meals": [
            {"name": "Breakfast", "foods": [{"name": "Food", "nutrients": {"sodium_mg": 1000}}]},
            {"name": "Lunch", "foods": [{"name": "Food", "nutrients": {"sodium_mg": 1300}}]},
        ],
    }

    result = client.post("/validate", json=request).json()

    assert result["compliant"] is True
    assert result["violations"] == []


def test_missing_policy_nutrient_is_a_clear_validation_error():
    request = {
        "policy_id": "low_sodium_hospital",
        "meals": [
            {"name": "Breakfast", "foods": [{"name": "Food", "nutrients": {}}]},
        ],
    }

    response = client.post("/validate", json=request)

    assert response.status_code == 422
    assert "missing required nutrient 'sodium_mg'" in response.json()["detail"]


def test_unknown_policy_returns_available_ids():
    response = client.post(
        "/validate",
        json={"policy_id": "unknown", "meals": [{"name": "Meal", "foods": [{"name": "Food", "nutrients": {}}]}]},
    )

    assert response.status_code == 404
    assert "low_sodium_hospital" in response.json()["detail"]


def test_negative_nutrient_value_is_rejected():
    response = client.post(
        "/validate",
        json={
            "policy_id": "low_sodium_hospital",
            "meals": [
                {
                    "name": "Meal",
                    "foods": [{"name": "Food", "nutrients": {"sodium_mg": -1}}],
                }
            ],
        },
    )

    assert response.status_code == 422
