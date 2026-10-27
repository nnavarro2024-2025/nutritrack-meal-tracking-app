import { Router } from "express"
import mongoose from "mongoose"
import { authenticateToken, requireRole } from "../middleware/auth.js"
import { Meal } from "../models/Meal.js"
import { User } from "../models/User.js"

const router = Router()

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

async function findAssignedPatient(patientId, dietitianId) {
  if (!mongoose.isValidObjectId(patientId)) return null
  return User.findOne({
    _id: patientId,
    role: "consumer",
    assignedDietitian: dietitianId,
  }).select("name email")
}

router.use(authenticateToken, requireRole("dietitian"))

router.get("/", async (request, response) => {
  const patients = await User.find({
    role: "consumer",
    assignedDietitian: request.user._id,
  }).select("name email").sort({ name: 1 })
  response.json({
    patients: patients.map((patient) => ({
      id: patient._id.toString(),
      name: patient.name,
      email: patient.email,
    })),
  })
})

router.get("/:id/meals", async (request, response) => {
  const patient = await findAssignedPatient(request.params.id, request.user._id)
  if (!patient) {
    response.status(403).json({ error: "This patient is not assigned to you.", code: "FORBIDDEN" })
    return
  }
  const meals = await Meal.find({ user: patient._id }).sort({ loggedAt: -1 })
  response.json({
    patient: { id: patient._id.toString(), name: patient.name },
    meals: meals.map((meal) => ({
      id: meal._id.toString(),
      userId: meal.user.toString(),
      mealType: meal.mealType,
      foodName: meal.foodName,
      portionSize: meal.portionSize,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      ...(meal.sodiumMg !== undefined ? { sodiumMg: meal.sodiumMg } : {}),
      ...(meal.fiberG !== undefined ? { fiberG: meal.fiberG } : {}),
      ...(meal.addedSugarG !== undefined ? { addedSugarG: meal.addedSugarG } : {}),
      notes: meal.notes || "",
      loggedAt: meal.loggedAt.toISOString(),
      photoUrl: meal.photoPath ? `/api/meals/${meal._id}/photo` : null,
    })),
  })
})

router.get("/:id/summary", async (request, response) => {
  const patient = await findAssignedPatient(request.params.id, request.user._id)
  if (!patient) {
    response.status(403).json({ error: "This patient is not assigned to you.", code: "FORBIDDEN" })
    return
  }

  const todayStart = startOfToday()
  const tomorrow = new Date(todayStart)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const sevenDaysAgo = new Date(todayStart)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  const [todayTotals] = await Meal.aggregate([
    { $match: { user: patient._id, loggedAt: { $gte: todayStart, $lt: tomorrow } } },
    {
      $group: {
        _id: null,
        calories: { $sum: "$calories" },
        protein: { $sum: "$protein" },
        carbs: { $sum: "$carbs" },
        fat: { $sum: "$fat" },
      },
    },
  ])
  const calorieRows = await Meal.aggregate([
    { $match: { user: patient._id, loggedAt: { $gte: sevenDaysAgo, $lt: tomorrow } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$loggedAt",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
        calories: { $sum: "$calories" },
      },
    },
    { $sort: { _id: 1 } },
  ])
  const caloriesByDate = new Map(calorieRows.map((row) => [row._id, row.calories]))
  const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sevenDaysAgo)
    date.setDate(sevenDaysAgo.getDate() + index)
    const key = dateKey(date)
    return { date: key, calories: caloriesByDate.get(key) || 0 }
  })

  response.json({
    patient: { id: patient._id.toString(), name: patient.name },
    today: {
      calories: todayTotals?.calories || 0,
      protein: todayTotals?.protein || 0,
      carbs: todayTotals?.carbs || 0,
      fat: todayTotals?.fat || 0,
    },
    lastSevenDays,
  })
})

export default router
