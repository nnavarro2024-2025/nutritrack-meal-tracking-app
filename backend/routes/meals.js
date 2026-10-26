import { Router } from "express"
import multer from "multer"
import mongoose from "mongoose"
import { randomUUID } from "node:crypto"
import { createReadStream, mkdirSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { dirname, extname } from "node:path"
import { fileURLToPath } from "node:url"
import { authenticateToken, requireRole } from "../middleware/auth.js"
import { Meal } from "../models/Meal.js"
import { User } from "../models/User.js"

const router = Router()
const uploadsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../uploads")
mkdirSync(uploadsDirectory, { recursive: true })
const allowedMimeTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
])
const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadsDirectory),
    filename: (_request, file, callback) => {
      const extension = allowedMimeTypes.get(file.mimetype)
      callback(null, `${randomUUID()}${extension}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const extension = extname(file.originalname).toLowerCase()
    const expectedExtension = allowedMimeTypes.get(file.mimetype)
    if (!expectedExtension || (extension !== expectedExtension && !(extension === ".jpeg" && expectedExtension === ".jpg"))) {
      callback(new Error("Photo must be a JPG, PNG, or WEBP image."))
      return
    }
    callback(null, true)
  },
})

const mealFields = ["mealType", "foodName", "portionSize", "calories", "protein", "carbs", "fat"]

function parseMealInput(body) {
  const result = { ...body }
  for (const field of ["calories", "protein", "carbs", "fat"]) {
    if (typeof result[field] === "string" && result[field].trim() !== "") {
      result[field] = Number(result[field])
    }
  }
  return result
}

function validateMealInput(input) {
  if (!input.foodName || typeof input.foodName !== "string" || !input.foodName.trim()) {
    return "Food name is required."
  }
  if (!["breakfast", "lunch", "dinner", "snack"].includes(input.mealType)) {
    return "Meal type must be breakfast, lunch, dinner, or snack."
  }
  if (!input.portionSize || typeof input.portionSize !== "string" || !input.portionSize.trim()) {
    return "Portion size is required."
  }
  for (const field of ["calories", "protein", "carbs", "fat"]) {
    if (input[field] === undefined || input[field] === "" || !Number.isFinite(input[field])) {
      return `${field} must be a valid number.`
    }
    if (input[field] < 0) return `${field} cannot be negative.`
  }
  if (input.notes !== undefined && typeof input.notes !== "string") {
    return "Notes must be text."
  }
  return null
}

function serializeMeal(meal) {
  return {
    id: meal._id.toString(),
    userId: meal.user.toString(),
    mealType: meal.mealType,
    foodName: meal.foodName,
    portionSize: meal.portionSize,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    notes: meal.notes || "",
    loggedAt: meal.loggedAt.toISOString(),
    photoUrl: meal.photoPath ? `/api/meals/${meal._id}/photo` : null,
  }
}

async function removeUploadedFile(file) {
  if (!file) return
  try {
    await unlink(file.path)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}

async function canViewPhoto(user, meal) {
  if (user.role === "consumer") return meal.user.equals(user._id)
  if (user.role !== "dietitian") return false
  const consumer = await User.findOne({
    _id: meal.user,
    role: "consumer",
    assignedDietitian: user._id,
  }).select("_id")
  return Boolean(consumer)
}

router.post("/", authenticateToken, requireRole("consumer"), upload.single("photo"), async (request, response) => {
  const input = parseMealInput(request.body || {})
  const validationError = validateMealInput(input)
  if (validationError) {
    await removeUploadedFile(request.file)
    response.status(400).json({ error: validationError, code: "INVALID_MEAL" })
    return
  }

  try {
    const meal = await Meal.create({
      user: request.user._id,
      mealType: input.mealType,
      foodName: input.foodName.trim(),
      portionSize: input.portionSize.trim(),
      calories: input.calories,
      protein: input.protein,
      carbs: input.carbs,
      fat: input.fat,
      notes: input.notes?.trim() || "",
      ...(request.file ? { photoPath: request.file.filename } : {}),
      loggedAt: new Date(),
    })
    response.status(201).json({ meal: serializeMeal(meal) })
  } catch (error) {
    await removeUploadedFile(request.file)
    throw error
  }
})

router.get("/", authenticateToken, requireRole("consumer"), async (request, response) => {
  const meals = await Meal.find({ user: request.user._id }).sort({ loggedAt: -1 })
  response.json({ meals: meals.map(serializeMeal) })
})

router.delete("/:id", authenticateToken, requireRole("consumer"), async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    response.status(404).json({ error: "Meal not found.", code: "MEAL_NOT_FOUND" })
    return
  }
  const meal = await Meal.findOne({ _id: request.params.id, user: request.user._id })
  if (!meal) {
    response.status(404).json({ error: "Meal not found.", code: "MEAL_NOT_FOUND" })
    return
  }
  await Meal.deleteOne({ _id: meal._id })
  if (meal.photoPath) {
    const photoPath = resolve(uploadsDirectory, basename(meal.photoPath))
    await removeUploadedFile({ path: photoPath })
  }
  response.json({ deleted: true, id: meal._id.toString() })
})

router.get("/:id/photo", authenticateToken, async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    response.status(404).json({ error: "Photo not found.", code: "PHOTO_NOT_FOUND" })
    return
  }
  const meal = await Meal.findById(request.params.id)
  if (!meal?.photoPath) {
    response.status(404).json({ error: "Photo not found.", code: "PHOTO_NOT_FOUND" })
    return
  }
  if (!(await canViewPhoto(request.user, meal))) {
    response.status(403).json({ error: "You are not allowed to view this meal photo.", code: "FORBIDDEN" })
    return
  }

  const filename = basename(meal.photoPath)
  if (filename !== meal.photoPath) {
    response.status(404).json({ error: "Photo not found.", code: "PHOTO_NOT_FOUND" })
    return
  }
  const photoPath = resolve(uploadsDirectory, filename)
  response.type(extname(filename))
  const stream = createReadStream(photoPath)
  stream.on("error", (error) => {
    if (error.code === "ENOENT" && !response.headersSent) {
      response.status(404).json({ error: "Photo not found.", code: "PHOTO_NOT_FOUND" })
      return
    }
    if (!response.headersSent) response.status(500).json({ error: "Could not read meal photo." })
  })
  stream.pipe(response)
})

export { router as mealRoutes, upload as mealPhotoUpload, mealFields }
