"""FastAPI application for validating meal plans against JSON dietary policies."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator


POLICY_DIRECTORY = Path(__file__).resolve().parent.parent / "policies"


class Food(BaseModel):
    name: str = Field(min_length=1)
    nutrients: dict[str, float]

    @model_validator(mode="after")
    def validate_nutrients(self) -> "Food":
        for nutrient, amount in self.nutrients.items():
            if amount < 0:
                raise ValueError(f"Nutrient '{nutrient}' must be zero or greater.")
        return self


class Meal(BaseModel):
    name: str = Field(min_length=1)
    foods: list[Food] = Field(min_length=1)


class ValidateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    policy_id: str = Field(min_length=1)
    meals: list[Meal] = Field(min_length=1)


class PolicyRule(BaseModel):
    id: str
    nutrient: str
    operator: Literal["<=", ">=", "between"]
    threshold: float | list[float]
    scope: Literal["per_meal", "per_day"]
    severity: Literal["error", "warning"]
    source: str

    @model_validator(mode="after")
    def validate_threshold(self) -> "PolicyRule":
        if self.operator == "between":
            if (
                not isinstance(self.threshold, list)
                or len(self.threshold) != 2
                or self.threshold[0] > self.threshold[1]
            ):
                raise ValueError("A 'between' rule needs two ordered threshold values.")
        elif isinstance(self.threshold, list):
            raise ValueError("A '<=' or '>=' rule needs one numeric threshold.")
        return self


class Policy(BaseModel):
    id: str
    name: str
    description: str
    rules: list[PolicyRule]


class PolicySummary(BaseModel):
    id: str
    name: str
    description: str


class Violation(BaseModel):
    rule_id: str
    actual_value: float
    allowed_value: float | list[float]
    message: str
    source: str
    severity: Literal["error", "warning"]


class ValidationResponse(BaseModel):
    compliant: bool
    violations: list[Violation]
    compliance_score: float


@lru_cache
def load_policies() -> dict[str, Policy]:
    """Read and validate every policy file; malformed policy data is not ignored."""
    policies: dict[str, Policy] = {}
    for path in sorted(POLICY_DIRECTORY.glob("*.json")):
        try:
            policy = Policy.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            raise RuntimeError(f"Could not load dietary policy file '{path.name}': {exc}") from exc
        if policy.id in policies:
            raise RuntimeError(f"Duplicate dietary policy id '{policy.id}'.")
        policies[policy.id] = policy
    return policies


def actual_value(meals: list[Meal], nutrient: str, scope: str, meal: Meal | None) -> float:
    """Sum one nutrient over the meal or whole day selected by a rule."""
    selected_meals = [meal] if scope == "per_meal" else meals
    return sum(
        food.nutrients[nutrient]
        for selected_meal in selected_meals
        for food in selected_meal.foods
    )


def within_threshold(rule: PolicyRule, actual: float) -> bool:
    """Apply inclusive comparisons so values exactly on a limit are allowed."""
    if rule.operator == "between":
        low, high = rule.threshold
        return low <= actual <= high
    if rule.operator == "<=":
        return actual <= rule.threshold
    return actual >= rule.threshold


def format_number(value: float) -> str:
    return f"{value:g}"


app = FastAPI(
    title="Dietary Policy Validator",
    description="Validate meal plans against versioned JSON dietary policies.",
    version="1.0.0",
)


@app.get("/policies", response_model=list[PolicySummary])
def list_policies() -> list[PolicySummary]:
    """List the policies available in the policies directory."""
    return [
        PolicySummary(id=policy.id, name=policy.name, description=policy.description)
        for policy in load_policies().values()
    ]


@app.post("/validate", response_model=ValidationResponse)
def validate_meal_plan(request: ValidateRequest) -> ValidationResponse:
    policies = load_policies()
    policy = policies.get(request.policy_id)
    if policy is None:
        available = ", ".join(policies)
        raise HTTPException(
            status_code=404,
            detail=f"Unknown policy_id '{request.policy_id}'. Available policies: {available}.",
        )

    # Check data completeness first: treating an unreported nutrient as zero could
    # make an unsafe meal plan appear compliant.
    for rule in policy.rules:
        for meal in request.meals:
            for food in meal.foods:
                if rule.nutrient not in food.nutrients:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Meal '{meal.name}', food '{food.name}' is missing required "
                            f"nutrient '{rule.nutrient}' for rule '{rule.id}'."
                        ),
                    )

    violations: list[Violation] = []
    checks = 0
    passed_checks = 0

    for rule in policy.rules:
        # Per-meal limits are checked separately for each meal; daily limits are
        # checked once against the sum of all foods in all meals.
        meal_checks = request.meals if rule.scope == "per_meal" else [None]
        for meal in meal_checks:
            actual = actual_value(request.meals, rule.nutrient, rule.scope, meal)
            checks += 1
            if within_threshold(rule, actual):
                passed_checks += 1
                continue

            allowed = rule.threshold
            if rule.operator == "between":
                low, high = allowed
                expectation = f"between {format_number(low)} and {format_number(high)}"
            else:
                expectation = f"{rule.operator} {format_number(allowed)}"
            scope_label = f" in {meal.name}" if meal is not None else " per day"
            violations.append(
                Violation(
                    rule_id=rule.id,
                    actual_value=actual,
                    allowed_value=allowed,
                    message=(
                        f"{rule.nutrient} was {format_number(actual)}{scope_label}; "
                        f"expected {expectation}."
                    ),
                    source=rule.source,
                    severity=rule.severity,
                )
            )

    score = round(100 * passed_checks / checks, 2)
    return ValidationResponse(
        compliant=not any(item.severity == "error" for item in violations),
        violations=violations,
        compliance_score=score,
    )
