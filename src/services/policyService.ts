import { fetchWithAuth } from "./authService"

export type DietaryPolicy = {
  id: string
  name: string
  description: string
}

export type PolicyViolation = {
  rule_id: string
  actual_value: number
  allowed_value: number | number[]
  message: string
  source: string
  severity: "error" | "warning"
}

export type PolicyCheckResult = {
  compliant: boolean
  violations: PolicyViolation[]
  compliance_score: number
}

export type PolicyCheckResponse =
  | { noMeals: true; message: string }
  | PolicyCheckResult

export type MissingPolicyData = {
  meal: string
  nutrient: string
}

export class PolicyMissingDataError extends Error {
  missingData: MissingPolicyData

  constructor(message: string, missingData: MissingPolicyData) {
    super(message)
    this.name = "PolicyMissingDataError"
    this.missingData = missingData
  }
}

const apiBaseUrl = (
  import.meta.env.VITE_WEARABLE_API_BASE_URL || "http://localhost:3001"
).replace(/\/+$/, "")

async function readJson(response: Response): Promise<unknown> {
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error("The policy service returned an unreadable response.")
  }
  if (!response.ok) {
    if (
      typeof result === "object" &&
      result !== null &&
      "missingData" in result &&
      typeof result.missingData === "object" &&
      result.missingData !== null &&
      "meal" in result.missingData &&
      typeof result.missingData.meal === "string" &&
      "nutrient" in result.missingData &&
      typeof result.missingData.nutrient === "string" &&
      "error" in result &&
      typeof result.error === "string"
    ) {
      throw new PolicyMissingDataError(result.error, {
        meal: result.missingData.meal,
        nutrient: result.missingData.nutrient,
      })
    }
    if (
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
    ) {
      throw new Error(result.error)
    }
    throw new Error(`Policy request failed (${response.status}).`)
  }
  return result
}

export async function fetchDietaryPolicies(): Promise<DietaryPolicy[]> {
  const response = await fetchWithAuth(`${apiBaseUrl}/api/policy/policies`)
  const result = await readJson(response)
  if (
    !Array.isArray(result) ||
    !result.every((item) =>
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      typeof item.id === "string" &&
      "name" in item &&
      typeof item.name === "string" &&
      "description" in item &&
      typeof item.description === "string"
    )
  ) {
    throw new Error("The policy service returned an invalid policy list.")
  }
  return result as DietaryPolicy[]
}

export async function runPatientPolicyCheck(
  patientId: string,
  policyId: string,
  date: string,
): Promise<PolicyCheckResponse> {
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/patients/${encodeURIComponent(patientId)}/policy-check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policyId, date }),
    },
  )
  const result = await readJson(response)
  if (
    typeof result === "object" &&
    result !== null &&
    "noMeals" in result &&
    result.noMeals === true &&
    "message" in result &&
    typeof result.message === "string"
  ) {
    return { noMeals: true, message: result.message }
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "compliant" in result &&
    typeof result.compliant === "boolean" &&
    "compliance_score" in result &&
    typeof result.compliance_score === "number" &&
    "violations" in result &&
    Array.isArray(result.violations)
  ) {
    return result as PolicyCheckResult
  }
  throw new Error("The policy service returned an invalid check result.")
}
