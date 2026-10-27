import { Router } from "express"
import mongoose from "mongoose"
import { authenticateToken, requireRole } from "../middleware/auth.js"
import { Meal } from "../models/Meal.js"
import { User } from "../models/User.js"

const router = Router()
const policyServiceUrl = (
  process.env.POLICY_SERVICE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "")

async function fetchPolicyService(path, options = {}) {
  try {
    const response = await fetch(`${policyServiceUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(5000),
    })
    return response
  } catch {
    return null
  }
}

async function readPolicyServiceJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

async function findAssignedPatient(patientId, dietitianId) {
  if (!mongoose.isValidObjectId(patientId)) return null
  return User.findOne({
    _id: patientId,
    role: "consumer",
    assignedDietitian: dietitianId,
  }).select("_id")
}

router.get("/policy/policies", authenticateToken, requireRole("dietitian"), async (_request, response) => {
  const serviceResponse = await fetchPolicyService("/policies")
  if (!serviceResponse) {
    response.status(503).json({ error: "The policy service is not running" })
    return
  }
  const result = await readPolicyServiceJson(serviceResponse)
  if (!serviceResponse.ok || !Array.isArray(result)) {
    response.status(502).json({ error: "The policy service returned an invalid policy list." })
    return
  }
  response.json(result)
})

router.post("/patients/:id/policy-check", authenticateToken, requireRole("dietitian"), async (request, response) => {
  const patient = await findAssignedPatient(request.params.id, request.user._id)
  if (!patient) {
    response.status(403).json({ error: "This patient is not assigned to you.", code: "FORBIDDEN" })
    return
  }

  const { policyId, date } = request.body || {}
  if (typeof policyId !== "string" || !policyId.trim()) {
    response.status(400).json({ error: "A policyId is required." })
    return
  }
  if (!isValidDate(date)) {
    response.status(400).json({ error: "A valid date is required in YYYY-MM-DD format." })
    return
  }

  const policiesResponse = await fetchPolicyService("/policies")
  if (!policiesResponse) {
    response.status(503).json({ error: "The policy service is not running" })
    return
  }
  const policies = await readPolicyServiceJson(policiesResponse)
  if (!policiesResponse.ok || !Array.isArray(policies)) {
    response.status(502).json({ error: "The policy service returned an invalid policy list." })
    return
  }
  if (!policies.some((policy) => policy?.id === policyId)) {
    response.status(404).json({ error: `Unknown policy id "${policyId}".` })
    return
  }

  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const meals = await Meal.find({
    user: patient._id,
    loggedAt: { $gte: start, $lt: end },
  }).sort({ loggedAt: 1 })
  if (!meals.length) {
    response.json({ noMeals: true, message: `No saved meals for ${date}.` })
    return
  }

  const plan = {
    policy_id: policyId,
    meals: meals.map((meal) => {
      const nutrients = {
        carbohydrate_g: meal.carbs,
        ...(meal.sodiumMg !== undefined ? { sodium_mg: meal.sodiumMg } : {}),
        ...(meal.fiberG !== undefined ? { fiber_g: meal.fiberG } : {}),
        ...(meal.addedSugarG !== undefined ? { added_sugar_g: meal.addedSugarG } : {}),
      }
      return {
        name: `${meal.mealType[0].toUpperCase()}${meal.mealType.slice(1)}: ${meal.foodName}`,
        foods: [{ name: meal.foodName, nutrients }],
      }
    }),
  }

  const validationResponse = await fetchPolicyService("/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  })
  if (!validationResponse) {
    response.status(503).json({ error: "The policy service is not running" })
    return
  }
  const result = await readPolicyServiceJson(validationResponse)
  if (validationResponse.status === 422) {
    const detail = typeof result?.detail === "string" ? result.detail : ""
    const missing = detail.match(/Meal '([^']+)'.*missing required nutrient '([^']+)'/)
    if (missing) {
      const [, mealName, nutrient] = missing
      response.status(422).json({
        error: `${mealName} is missing ${nutrient}. Add this value to the saved meal before running the policy check.`,
        missingData: { meal: mealName, nutrient },
      })
      return
    }
    response.status(422).json({ error: detail || "A saved meal is missing a required nutrient." })
    return
  }
  if (validationResponse.status === 404) {
    const detail = typeof result?.detail === "string" ? result.detail : `Unknown policy id "${policyId}".`
    response.status(404).json({ error: detail })
    return
  }
  if (!validationResponse.ok || typeof result !== "object" || result === null) {
    response.status(502).json({ error: "The policy service could not validate this meal plan." })
    return
  }
  response.json(result)
})

export default router
