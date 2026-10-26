import cors from "cors"
import express from "express"
import Ajv from "ajv"
import addFormats from "ajv-formats"
import mongoose from "mongoose"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import authRoutes from "./routes/auth.js"
import { mealRoutes } from "./routes/meals.js"
import patientsRoutes from "./routes/patients.js"
import { authenticateToken, requireRole } from "./middleware/auth.js"

const backendDirectory = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(backendDirectory, ".env") })
const app = express()
const port = Number(process.env.PORT || 3001)
const schemaDirectory = resolve(backendDirectory, "../schemas")
const loadSchema = (filename) => JSON.parse(readFileSync(resolve(schemaDirectory, filename), "utf8"))
const terminologySchema = loadSchema("terminology.json")
const terminology = terminologySchema.definitions
const validator = new Ajv({ allErrors: true })
addFormats(validator)
validator.addSchema(terminologySchema)
validator.addSchema(loadSchema("assessment.schema.json"))
validator.addSchema(loadSchema("diagnosis.schema.json"))
validator.addSchema(loadSchema("intervention.schema.json"))
validator.addSchema(loadSchema("monitoring-evaluation.schema.json"))
const validateClinicalNote = validator.compile(loadSchema("clinical-note.schema.json"))

function isAllowedOrigin(origin) {
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== "http:" || !["5173", "8443"].includes(url.port)) return false

  const hostname = url.hostname.toLowerCase()
  if (hostname === "localhost" || hostname === "::1") return true

  const octets = hostname.split(".").map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }
  const [first, second] = octets
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true)
      return
    }
    callback(new Error("Origin is not allowed by CORS"))
  },
}))
app.use(express.json())
app.use("/api/auth", authRoutes)
app.use("/api/meals", mealRoutes)
app.use("/api/patients", patientsRoutes)

function formatValidationErrors(errors = []) {
  return errors.map((error) => {
    const property = error.params?.missingProperty || error.params?.additionalProperty
    const path = `${error.instancePath || ""}${property ? `/${property}` : ""}` || "/"
    return { path, message: error.message || "is invalid" }
  })
}

app.get("/api/terminology", (_request, response) => {
  const termLists = Object.fromEntries(
    Object.entries(terminology)
      .filter(([, definition]) => Array.isArray(definition.enum))
      .map(([name, definition]) => [name, definition.enum]),
  )
  const resolveConstants = (name) => Object.fromEntries(
    Object.entries(terminology[name].properties).map(([term, definition]) => [term, definition.const]),
  )
  response.json({
    ...termLists,
    assessmentDomainByTerm: resolveConstants("assessmentDomainByTerm"),
    diagnosisCodeByTerm: resolveConstants("diagnosisCodeByTerm"),
    interventionCategoryByTerm: resolveConstants("interventionCategoryByTerm"),
  })
})

app.post("/api/notes/validate", authenticateToken, requireRole("dietitian"), (request, response) => {
  if (!validateClinicalNote(request.body)) {
    response.status(400).json({
      valid: false,
      errors: formatValidationErrors(validateClinicalNote.errors),
    })
    return
  }

  const { diagnosis } = request.body
  const expectedSentence = `${diagnosis.problem.term} related to ${diagnosis.etiology} as evidenced by ${diagnosis.signsSymptoms.join("; ")}`
  if (diagnosis.generatedSentence !== expectedSentence) {
    response.status(400).json({
      valid: false,
      errors: [{
        path: "/diagnosis/generatedSentence",
        message: `must match the generated PES sentence: "${expectedSentence}"`,
      }],
    })
    return
  }

  response.json({ valid: true })
})

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function createRandom(seed) {
  let value = 2166136261
  for (const character of seed) {
    value = Math.imul(value ^ character.charCodeAt(0), 16777619)
  }
  return () => {
    value += 0x6d2b79f5
    let number = value
    number = Math.imul(number ^ (number >>> 15), number | 1)
    number ^= number + Math.imul(number ^ (number >>> 7), number | 61)
    return ((number ^ (number >>> 14)) >>> 0) / 4294967296
  }
}

function getDailyData(date) {
  const random = createRandom(date)
  const steps = 3000 + Math.floor(random() * 11001)
  const activeEnergyKcal = 150 + Math.floor(random() * 751)
  const distanceKm = Number((steps * (0.00065 + random() * 0.00015)).toFixed(2))

  return {
    date,
    steps,
    activeEnergyKcal,
    distanceKm,
    lastSynced: new Date().toISOString(),
  }
}

app.get("/api/wearable/daily", (request, response) => {
  const date = request.query.date
  if (typeof date !== "string" || !isValidDate(date)) {
    response.status(400).json({
      error: "A valid date query parameter is required in YYYY-MM-DD format.",
    })
    return
  }

  response.json(getDailyData(date))
})

app.get("/api/wearable/week", (_request, response) => {
  const today = new Date()
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (6 - index))
    return getDailyData(formatDate(date))
  })

  response.json(week)
})

app.use((error, _request, response, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    response.status(400).json({ error: "Photo must be 5 MB or smaller.", code: "PHOTO_TOO_LARGE" })
    return
  }
  if (error?.name === "MulterError") {
    response.status(400).json({ error: error.message, code: "INVALID_PHOTO_UPLOAD" })
    return
  }
  if (error?.message === "Photo must be a JPG, PNG, or WEBP image.") {
    response.status(400).json({ error: error.message, code: "INVALID_PHOTO_TYPE" })
    return
  }
  if (error.message === "Origin is not allowed by CORS") {
    response.status(403).json({ error: error.message })
    return
  }
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    response.status(400).json({
      valid: false,
      errors: [{ path: "/", message: "Request body must be valid JSON." }],
    })
    return
  }
  response.status(500).json({ error: "Internal server error." })
})

async function startServer() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing. Set it in backend/.env (see backend/.env.example).")
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET is missing or too short. Set a secret with at least 32 characters in backend/.env.")
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  } catch (error) {
    throw new Error(`Could not connect to MongoDB configured by MONGODB_URI: ${error.message}`)
  }

  app.listen(port, () => {
    console.log(`NutriTrack API listening on http://localhost:${port}`)
  })
}

startServer().catch((error) => {
  console.error(`Backend startup failed: ${error.message}`)
  process.exitCode = 1
})
