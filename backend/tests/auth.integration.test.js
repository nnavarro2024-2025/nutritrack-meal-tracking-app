import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import jwt from "jsonwebtoken"
import mongoose from "mongoose"
import bcrypt from "bcryptjs"
import { unlink } from "node:fs/promises"
import { User } from "../models/User.js"
import { Meal } from "../models/Meal.js"
import { ClinicalNote } from "../models/ClinicalNote.js"

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
dotenv.config({ path: resolve(backendDirectory, ".env") })
const baseUrl = process.env.API_URL || "http://localhost:3001"
const testEmail = `auth-test-${Date.now()}@example.test`
const testPassword = "TestPass2026!"
let consumerToken
let consumerId
let dietitianToken
let createdConsumerId
let createdConsumerToken
let testMealId
let photoMealId
let seededConsumerToken
let seededOtherConsumerToken
let otherDietitianId
let savedNoteId
let policyTestMealId

before(() => {
  execFileSync(process.execPath, [resolve(backendDirectory, "seed.js")], {
    cwd: backendDirectory,
    env: process.env,
    stdio: "pipe",
  })
})

after(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const photos = await Meal.find({
    $or: [
      ...(createdConsumerId ? [{ user: createdConsumerId }] : []),
      ...(photoMealId ? [{ _id: photoMealId }] : []),
    ],
  }).select("photoPath")
  await Meal.deleteMany({
    $or: [
      ...(createdConsumerId ? [{ user: createdConsumerId }] : []),
      ...(photoMealId ? [{ _id: photoMealId }] : []),
    ],
  })
  for (const meal of photos) {
    if (meal.photoPath) {
      try {
        await unlink(resolve(backendDirectory, "uploads", meal.photoPath))
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
    }
  }
  await User.deleteOne({ email: testEmail })
  if (createdConsumerId) await User.deleteOne({ _id: createdConsumerId })
  if (otherDietitianId) await User.deleteOne({ _id: otherDietitianId })
  if (savedNoteId) await ClinicalNote.deleteMany({ _id: savedNoteId })
  if (policyTestMealId) await Meal.deleteOne({ _id: policyTestMealId })
  await mongoose.disconnect()
})

async function request(path, { token, baseUrl: requestBaseUrl = baseUrl, ...options } = {}) {
  return fetch(`${requestBaseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
}

test("a. register a consumer and verify a stored password hash", async () => {
  const response = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Integration Consumer", email: testEmail, password: testPassword, role: "consumer" }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.user.role, "consumer")
  assert.equal(JSON.stringify(body).includes("passwordHash"), false)
  consumerId = body.user.id
  consumerToken = body.token
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const storedUser = await User.findById(consumerId).select("+passwordHash")
  assert.ok(storedUser.passwordHash.startsWith("$2"))
  assert.notEqual(storedUser.passwordHash, testPassword)
  assert.equal(await bcrypt.compare(testPassword, storedUser.passwordHash), true)
  await mongoose.disconnect()
})

test("b. reject a duplicate email with a clear message", async () => {
  const response = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Duplicate Consumer", email: testEmail, password: testPassword, role: "consumer" }),
  })
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /already exists/i)
})

test("c. correct login returns a one-day JWT and public user fields", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.token)
  assert.equal(body.user.id, consumerId)
  assert.equal(body.user.name, "Integration Consumer")
  assert.equal(body.user.role, "consumer")
  assert.equal(JSON.stringify(body).includes("passwordHash"), false)
  assert.equal(jwt.decode(body.token).exp - jwt.decode(body.token).iat, 86400)
  consumerToken = body.token
})

test("d. wrong password is rejected without returning a token", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: testEmail, password: "WrongPass2026!" }),
  })
  assert.equal(response.status, 401)
  const body = await response.json()
  assert.match(body.error, /incorrect/i)
  assert.equal(body.token, undefined)
})

test("e. /me returns the current user without passwordHash", async () => {
  const response = await request("/api/auth/me", { token: consumerToken })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.user, { id: consumerId, name: "Integration Consumer", role: "consumer" })
  assert.equal(JSON.stringify(body).includes("passwordHash"), false)
})

test("f. /me rejects missing, malformed, and expired tokens with 401", async () => {
  assert.equal((await request("/api/auth/me")).status, 401)
  assert.equal((await request("/api/auth/me", { token: "not.a.valid.jwt" })).status, 401)
  const expiredToken = jwt.sign({ sub: consumerId }, process.env.JWT_SECRET, { expiresIn: "-1s" })
  const response = await request("/api/auth/me", { token: expiredToken })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, "TOKEN_EXPIRED")
})

test("g. consumers cannot validate clinical notes", async () => {
  const response = await request("/api/notes/validate", {
    method: "POST",
    token: consumerToken,
    body: "{}",
  })
  assert.equal(response.status, 403)
})

test("h. dietitians can validate valid and invalid notes", async () => {
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "dietitian@nutritrack.demo", password: "DietitianDemo2026!" }),
  })
  assert.equal(login.status, 200, "run npm run seed before this test")
  dietitianToken = (await login.json()).token
  const validNote = JSON.parse(await readFile(resolve(backendDirectory, "../schemas/examples/valid-note.json"), "utf8"))
  const invalidNote = JSON.parse(await readFile(resolve(backendDirectory, "../schemas/examples/invalid-note.json"), "utf8"))
  assert.equal((await request("/api/notes/validate", { method: "POST", token: dietitianToken, body: JSON.stringify(validNote) })).status, 200)
  assert.equal((await request("/api/notes/validate", { method: "POST", token: dietitianToken, body: JSON.stringify(invalidNote) })).status, 400)
})

test("i. note validation requires a token", async () => {
  assert.equal((await request("/api/notes/validate", { method: "POST", body: "{}" })).status, 401)
})

test("j. wearable and terminology endpoints remain open", async () => {
  const daily = await request("/api/wearable/daily?date=2026-10-26")
  assert.equal(daily.status, 200)
  assert.equal((await daily.json()).date, "2026-10-26")
  const week = await request("/api/wearable/week")
  assert.equal(week.status, 200)
  assert.equal((await week.json()).length, 7)
  assert.equal((await request("/api/terminology")).status, 200)
})

test("k. seed script is idempotent and assigns consumers to the demo dietitian", async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const consumerIds = await User.find({
    email: { $in: ["alex@nutritrack.demo", "jordan@nutritrack.demo"] },
  }).distinct("_id")
  const sampleMealCountsBefore = await Promise.all(
    consumerIds.map((user) => Meal.countDocuments({ user, notes: "Sample meal" })),
  )
  await mongoose.disconnect()

  for (let run = 0; run < 2; run += 1) {
    execFileSync(process.execPath, [resolve(backendDirectory, "seed.js")], {
      cwd: backendDirectory,
      env: process.env,
      stdio: "pipe",
    })
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const accounts = await User.find({
    email: { $in: ["dietitian@nutritrack.demo", "alex@nutritrack.demo", "jordan@nutritrack.demo"] },
  })
  assert.equal(accounts.length, 3)
  const dietitian = accounts.find((user) => user.email === "dietitian@nutritrack.demo")
  const consumers = accounts.filter((user) => user.role === "consumer")
  assert.equal(consumers.length, 2)
  assert.ok(consumers.every((user) => user.assignedDietitian?.toString() === dietitian._id.toString()))
  const sampleMealCounts = await Promise.all(
    consumers.map((consumer) => Meal.countDocuments({ user: consumer._id, notes: "Sample meal" })),
  )
  assert.deepEqual(
    sampleMealCounts.sort((left, right) => left - right),
    sampleMealCountsBefore.sort((left, right) => left - right),
  )
  assert.equal(await ClinicalNote.countDocuments({
    patient: consumers.find((user) => user.email === "alex@nutritrack.demo")._id,
    "content.diagnosis.problem.term": "Inadequate energy intake",
    "content.date": "2026-10-26",
  }), 1)
  await mongoose.disconnect()
})

test("a. consumers can create meals and see them in their own list", async () => {
  const registration = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Meal Test Consumer",
      email: `meal-test-${Date.now()}@example.test`,
      password: testPassword,
      role: "consumer",
    }),
  })
  assert.equal(registration.status, 201)
  const account = await registration.json()
  createdConsumerId = account.user.id
  createdConsumerToken = account.token

  const createResponse = await request("/api/meals", {
    method: "POST",
    token: createdConsumerToken,
    body: JSON.stringify({
      mealType: "lunch",
      foodName: "Integration test lentil bowl",
      portionSize: "1 bowl",
      calories: 420,
      protein: 23,
      carbs: 56,
      fat: 11,
      notes: "created by integration test",
    }),
  })
  assert.equal(createResponse.status, 201)
  const created = (await createResponse.json()).meal
  testMealId = created.id
  assert.equal(created.foodName, "Integration test lentil bowl")
  const listResponse = await request("/api/meals", { token: createdConsumerToken })
  assert.equal(listResponse.status, 200)
  assert.ok((await listResponse.json()).meals.some((meal) => meal.id === testMealId))
})

test("b. consumers cannot see another consumer's meals", async () => {
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "jordan@nutritrack.demo", password: "ConsumerDemo2026!" }),
  })
  assert.equal(login.status, 200)
  seededOtherConsumerToken = (await login.json()).token
  const response = await request("/api/meals", { token: seededOtherConsumerToken })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).meals.some((meal) => meal.id === testMealId), false)
})

test("c. consumers receive 403 when calling dietitian endpoints", async () => {
  const response = await request("/api/patients", { token: createdConsumerToken })
  assert.equal(response.status, 403)
})

test("d. dietitians see only assigned patients and cannot access unassigned consumers", async () => {
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "dietitian@nutritrack.demo", password: "DietitianDemo2026!" }),
  })
  assert.equal(login.status, 200)
  dietitianToken = (await login.json()).token
  const response = await request("/api/patients", { token: dietitianToken })
  assert.equal(response.status, 200)
  const patients = (await response.json()).patients
  assert.equal(patients.some((patient) => patient.id === createdConsumerId), false)
  assert.ok(patients.some((patient) => patient.email === "alex@nutritrack.demo"))
  assert.ok(patients.some((patient) => patient.email === "jordan@nutritrack.demo"))
  const assignedPatient = patients.find((patient) => patient.email === "alex@nutritrack.demo")
  const assignedMeals = await request(`/api/patients/${assignedPatient.id}/meals`, { token: dietitianToken })
  assert.equal(assignedMeals.status, 200)
  assert.equal((await assignedMeals.json()).patient.id, assignedPatient.id)
  const assignedSummary = await request(`/api/patients/${assignedPatient.id}/summary`, { token: dietitianToken })
  assert.equal(assignedSummary.status, 200)
  assert.equal((await assignedSummary.json()).lastSevenDays.length, 7)
  const forbidden = await request(`/api/patients/${createdConsumerId}/meals`, { token: dietitianToken })
  assert.equal(forbidden.status, 403)
  const forbiddenSummary = await request(`/api/patients/${createdConsumerId}/summary`, { token: dietitianToken })
  assert.equal(forbiddenSummary.status, 403)
})

test("e. requests without a token are rejected with 401", async () => {
  assert.equal((await request("/api/meals")).status, 401)
  assert.equal((await request("/api/patients")).status, 401)
  assert.equal((await request("/api/meals/000000000000000000000000/photo")).status, 401)
})

test("f. invalid photo type and oversized photo uploads are rejected clearly", async () => {
  const invalidTypeBody = new FormData()
  invalidTypeBody.set("mealType", "snack")
  invalidTypeBody.set("foodName", "Invalid type photo")
  invalidTypeBody.set("portionSize", "1 item")
  invalidTypeBody.set("calories", "20")
  invalidTypeBody.set("protein", "1")
  invalidTypeBody.set("carbs", "4")
  invalidTypeBody.set("fat", "0")
  invalidTypeBody.append("photo", new Blob(["not an image"], { type: "text/plain" }), "note.txt")
  const invalidTypeResponse = await request("/api/meals", { method: "POST", token: createdConsumerToken, body: invalidTypeBody })
  assert.equal(invalidTypeResponse.status, 400)
  assert.match((await invalidTypeResponse.json()).error, /JPG, PNG, or WEBP/i)

  const oversizedBody = new FormData()
  oversizedBody.set("mealType", "snack")
  oversizedBody.set("foodName", "Oversized photo")
  oversizedBody.set("portionSize", "1 item")
  oversizedBody.set("calories", "20")
  oversizedBody.set("protein", "1")
  oversizedBody.set("carbs", "4")
  oversizedBody.set("fat", "0")
  oversizedBody.append("photo", new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: "image/png" }), "large.png")
  const oversizedResponse = await request("/api/meals", { method: "POST", token: createdConsumerToken, body: oversizedBody })
  assert.equal(oversizedResponse.status, 400)
  assert.match((await oversizedResponse.json()).error, /5 MB or smaller/i)
})

test("g. meal photos are available to the owner and assigned dietitian only", async () => {
  const ownerLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "alex@nutritrack.demo", password: "ConsumerDemo2026!" }),
  })
  assert.equal(ownerLogin.status, 200)
  seededConsumerToken = (await ownerLogin.json()).token
  const form = new FormData()
  form.set("mealType", "snack")
  form.set("foodName", "Private photo test")
  form.set("portionSize", "1 item")
  form.set("calories", "50")
  form.set("protein", "2")
  form.set("carbs", "8")
  form.set("fat", "1")
  form.set("sodiumMg", "10")
  form.set("fiberG", "1")
  form.set("addedSugarG", "0")
  form.append("photo", new Blob(["private image bytes"], { type: "image/png" }), "meal.png")
  const createdResponse = await request("/api/meals", { method: "POST", token: seededConsumerToken, body: form })
  assert.equal(createdResponse.status, 201)
  photoMealId = (await createdResponse.json()).meal.id

  const ownerPhoto = await request(`/api/meals/${photoMealId}/photo`, { token: seededConsumerToken })
  assert.equal(ownerPhoto.status, 200)
  assert.match(ownerPhoto.headers.get("content-type"), /image\/png/)
  assert.equal(await ownerPhoto.text(), "private image bytes")
  const assignedDietitianPhoto = await request(`/api/meals/${photoMealId}/photo`, { token: dietitianToken })
  assert.equal(assignedDietitianPhoto.status, 200)
  assert.equal(await assignedDietitianPhoto.text(), "private image bytes")
  const otherConsumerPhoto = await request(`/api/meals/${photoMealId}/photo`, { token: seededOtherConsumerToken })
  assert.equal(otherConsumerPhoto.status, 403)
  const unassignedDietitianLogin = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Other Dietitian",
      email: `other-dietitian-${Date.now()}@example.test`,
      password: testPassword,
      role: "dietitian",
    }),
  })
  assert.equal(unassignedDietitianLogin.status, 201)
  const otherDietitian = await unassignedDietitianLogin.json()
  otherDietitianId = otherDietitian.user.id
  const otherDietitianToken = otherDietitian.token
  assert.equal((await request(`/api/meals/${photoMealId}/photo`, { token: otherDietitianToken })).status, 403)
})

test("h. negative nutrient values and missing food names return clear errors", async () => {
  const baseMeal = {
    mealType: "dinner",
    foodName: "Validation test meal",
    portionSize: "1 plate",
    calories: 300,
    protein: 20,
    carbs: 30,
    fat: 10,
  }
  const negative = await request("/api/meals", {
    method: "POST",
    token: createdConsumerToken,
    body: JSON.stringify({ ...baseMeal, calories: -1 }),
  })
  assert.equal(negative.status, 400)
  assert.match((await negative.json()).error, /calories cannot be negative/i)
  const missingFood = await request("/api/meals", {
    method: "POST",
    token: createdConsumerToken,
    body: JSON.stringify({ ...baseMeal, foodName: "" }),
  })
  assert.equal(missingFood.status, 400)
  assert.match((await missingFood.json()).error, /food name is required/i)
})

test("meal optional nutrition fields accept numbers and reject invalid values", async () => {
  const valid = await request("/api/meals", {
    method: "POST",
    token: createdConsumerToken,
    body: JSON.stringify({
      mealType: "snack",
      foodName: "Optional nutrient test",
      portionSize: "1 serving",
      calories: 100,
      protein: 2,
      carbs: 10,
      fat: 3,
      sodiumMg: 125,
      fiberG: 4.5,
      addedSugarG: 1,
    }),
  })
  assert.equal(valid.status, 201)
  const meal = (await valid.json()).meal
  assert.equal(meal.sodiumMg, 125)
  assert.equal(meal.fiberG, 4.5)
  assert.equal(meal.addedSugarG, 1)

  const negative = await request("/api/meals", {
    method: "POST",
    token: createdConsumerToken,
    body: JSON.stringify({
      mealType: "snack",
      foodName: "Invalid sodium",
      portionSize: "1 serving",
      calories: 100,
      protein: 2,
      carbs: 10,
      fat: 3,
      sodiumMg: -1,
    }),
  })
  assert.equal(negative.status, 400)
  assert.match((await negative.json()).error, /sodiumMg cannot be negative/i)

  const nonNumeric = await request("/api/meals", {
    method: "POST",
    token: createdConsumerToken,
    body: JSON.stringify({
      mealType: "snack",
      foodName: "Non-numeric fiber",
      portionSize: "1 serving",
      calories: 100,
      protein: 2,
      carbs: 10,
      fat: 3,
      fiberG: "a little",
    }),
  })
  assert.equal(nonNumeric.status, 400)
  assert.match((await nonNumeric.json()).error, /fiberG must be a valid number/i)
})

async function getAvailablePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const port = server.address().port
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose())
  })
  return port
}

test("a. dietitian saves a valid note for an assigned patient and it appears in the list", async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const alex = await User.findOne({ email: "alex@nutritrack.demo" }).select("_id")
  const dietitian = await User.findOne({ email: "dietitian@nutritrack.demo" }).select("_id")
  await mongoose.disconnect()
  const note = JSON.parse(await readFile(resolve(backendDirectory, "../schemas/examples/valid-note.json"), "utf8"))
  note.patientId = "000000000000000000000001"
  note.providerId = "000000000000000000000002"
  const response = await request(`/api/patients/${alex._id}/notes`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify(note),
  })
  assert.equal(response.status, 201)
  const saved = (await response.json()).note
  savedNoteId = saved.id
  assert.equal(saved.patientId, alex._id.toString())
  assert.equal(saved.dietitianId, dietitian._id.toString())
  assert.equal(saved.content.patientId, alex._id.toString())
  assert.equal(saved.content.providerId, saved.dietitianId)
  const listResponse = await request(`/api/patients/${alex._id}/notes`, { token: dietitianToken })
  assert.equal(listResponse.status, 200)
  assert.ok((await listResponse.json()).notes.some((item) => item.id === savedNoteId))
})

test("b. invalid note returns readable validation errors and is not saved", async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const alex = await User.findOne({ email: "alex@nutritrack.demo" }).select("_id")
  const countBefore = await ClinicalNote.countDocuments({ patient: alex._id })
  await mongoose.disconnect()
  const note = JSON.parse(await readFile(resolve(backendDirectory, "../schemas/examples/valid-note.json"), "utf8"))
  note.monitoringEvaluation.status = "unknown"
  const response = await request(`/api/patients/${alex._id}/notes`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify(note),
  })
  assert.equal(response.status, 400)
  const result = await response.json()
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.path === "/monitoringEvaluation/status" && error.message))
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  assert.equal(await ClinicalNote.countDocuments({ patient: alex._id }), countBefore)
  await mongoose.disconnect()
})

test("c. a dietitian cannot save a note for a consumer who is not assigned to them", async () => {
  const response = await request(`/api/patients/${createdConsumerId}/notes`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 403)
})

test("d. consumers receive 403 from dietitian note endpoints", async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const alex = await User.findOne({ email: "alex@nutritrack.demo" }).select("_id")
  await mongoose.disconnect()
  assert.equal((await request(`/api/patients/${alex._id}/notes`, { token: seededConsumerToken })).status, 403)
  assert.equal((await request(`/api/notes/${savedNoteId}`, { token: seededConsumerToken })).status, 403)
})

test("e. consumers see only their own notes", async () => {
  const alexResponse = await request("/api/my/notes", { token: seededConsumerToken })
  assert.equal(alexResponse.status, 200)
  const alexNotes = (await alexResponse.json()).notes
  assert.ok(alexNotes.some((note) => note.id === savedNoteId))
  assert.ok(alexNotes.every((note) => note.patientId === alexNotes[0].patientId))
  const jordanLogin = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "jordan@nutritrack.demo", password: "ConsumerDemo2026!" }),
  })
  const jordanToken = (await jordanLogin.json()).token
  const jordanNotes = await request("/api/my/notes", { token: jordanToken })
  assert.equal(jordanNotes.status, 200)
  assert.equal((await jordanNotes.json()).notes.some((note) => note.id === savedNoteId), false)
})

test("f. saved-note routes reject requests with no token", async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const alex = await User.findOne({ email: "alex@nutritrack.demo" }).select("_id")
  await mongoose.disconnect()
  assert.equal((await request(`/api/patients/${alex._id}/notes`)).status, 401)
  assert.equal((await request(`/api/patients/${alex._id}/notes`, { method: "POST", body: "{}" })).status, 401)
  assert.equal((await request(`/api/notes/${savedNoteId}`)).status, 401)
  assert.equal((await request("/api/my/notes")).status, 401)
})

test("g. a PES sentence that does not match the diagnosis fields is rejected", async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const alex = await User.findOne({ email: "alex@nutritrack.demo" }).select("_id")
  await mongoose.disconnect()
  const note = JSON.parse(await readFile(resolve(backendDirectory, "../schemas/examples/valid-note.json"), "utf8"))
  note.diagnosis.generatedSentence = "A mismatched PES sentence."
  const response = await request(`/api/patients/${alex._id}/notes`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify(note),
  })
  assert.equal(response.status, 400)
  assert.ok((await response.json()).errors.some((error) => error.path === "/diagnosis/generatedSentence"))
})

test("h. client patient and provider ids cannot override server-assigned ids", async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const alex = await User.findOne({ email: "alex@nutritrack.demo" }).select("_id")
  const dietitian = await User.findOne({ email: "dietitian@nutritrack.demo" }).select("_id")
  const saved = await ClinicalNote.findById(savedNoteId)
  assert.equal(saved.patient.toString(), alex._id.toString())
  assert.equal(saved.dietitian.toString(), dietitian._id.toString())
  assert.equal(saved.content.patientId, alex._id.toString())
  assert.equal(saved.content.providerId, dietitian._id.toString())
  await mongoose.disconnect()
})

test("i. saved notes remain available after the backend process restarts", async () => {
  const port = await getAvailablePort()
  const child = spawn(process.execPath, [resolve(backendDirectory, "server.js")], {
    cwd: backendDirectory,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  })
  try {
    let response
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error("Restarted backend exited before becoming ready.")
      try {
        response = await request(
          `/api/notes/${savedNoteId}`,
          { token: dietitianToken, baseUrl: `http://127.0.0.1:${port}` },
        )
        if (response.status === 200) break
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      }
    }
    assert.equal(response?.status, 200)
    assert.equal((await response.json()).note.id, savedNoteId)
  } finally {
    child.kill()
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit()
      else child.once("exit", resolveExit)
    })
  }
})

test("wearable a. requests without a source retain the original daily and weekly response shape", async () => {
  const expectedKeys = ["date", "steps", "activeEnergyKcal", "distanceKm", "lastSynced"]
  const dailyResponse = await request("/api/wearable/daily?date=2026-10-26")
  assert.equal(dailyResponse.status, 200)
  const daily = await dailyResponse.json()
  assert.deepEqual(Object.keys(daily).sort(), [...expectedKeys].sort())
  assert.equal(daily.date, "2026-10-26")
  assert.ok(Number.isInteger(daily.steps))
  assert.ok(Number.isInteger(daily.activeEnergyKcal))
  assert.equal(typeof daily.distanceKm, "number")
  assert.equal(typeof daily.lastSynced, "string")

  const weekResponse = await request("/api/wearable/week")
  assert.equal(weekResponse.status, 200)
  const week = await weekResponse.json()
  assert.equal(week.length, 7)
  assert.ok(week.every((day) => {
    assert.deepEqual(Object.keys(day).sort(), [...expectedKeys].sort())
    return true
  }))
})

test("wearable b. source responses use their expected shape and realistic ranges", async () => {
  const googleResponse = await request("/api/wearable/daily?date=2026-10-26&source=googlefit")
  assert.equal(googleResponse.status, 200)
  const google = await googleResponse.json()
  assert.deepEqual(Object.keys(google).sort(), [
    "source", "date", "step_count", "calories_expended", "distance_meters", "synced_at",
  ].sort())
  assert.equal(google.source, "googlefit")
  assert.ok(google.step_count >= 3000 && google.step_count <= 14000)
  assert.ok(google.calories_expended >= 150 && google.calories_expended <= 900)
  assert.ok(google.distance_meters > 0)
  assert.equal(typeof google.synced_at, "string")

  const appleResponse = await request("/api/wearable/daily?date=2026-10-26&source=applehealth")
  assert.equal(appleResponse.status, 200)
  const apple = await appleResponse.json()
  assert.deepEqual(Object.keys(apple).sort(), [
    "source", "date", "stepCount", "activeEnergyBurned", "distanceWalkingRunning", "endDate",
  ].sort())
  assert.equal(apple.source, "applehealth")
  assert.ok(apple.stepCount >= 3000 && apple.stepCount <= 14000)
  assert.ok(apple.activeEnergyBurned.value >= 150 && apple.activeEnergyBurned.value <= 900)
  assert.equal(apple.activeEnergyBurned.unit, "kcal")
  assert.ok(apple.distanceWalkingRunning.value > 0)
  assert.equal(apple.distanceWalkingRunning.unit, "km")
  assert.equal(typeof apple.endDate, "string")
})

test("wearable c. source data is deterministic by date and differs between sources", async () => {
  const paths = [
    "/api/wearable/daily?date=2026-10-26&source=googlefit",
    "/api/wearable/daily?date=2026-10-26&source=applehealth",
  ]
  const [googleFirstResponse, googleAgainResponse, appleFirstResponse, appleAgainResponse] = await Promise.all(
    paths.flatMap((path) => [request(path), request(path)]),
  )
  const [googleFirst, googleAgain, appleFirst, appleAgain] = await Promise.all([
    googleFirstResponse.json(),
    googleAgainResponse.json(),
    appleFirstResponse.json(),
    appleAgainResponse.json(),
  ])
  assert.deepEqual(
    [googleFirst.step_count, googleFirst.calories_expended, googleFirst.distance_meters],
    [googleAgain.step_count, googleAgain.calories_expended, googleAgain.distance_meters],
  )
  assert.deepEqual(
    [appleFirst.stepCount, appleFirst.activeEnergyBurned.value, appleFirst.distanceWalkingRunning.value],
    [appleAgain.stepCount, appleAgain.activeEnergyBurned.value, appleAgain.distanceWalkingRunning.value],
  )
  assert.notDeepEqual(
    [googleFirst.step_count, googleFirst.calories_expended, googleFirst.distance_meters],
    [appleFirst.stepCount, appleFirst.activeEnergyBurned.value, appleFirst.distanceWalkingRunning.value],
  )
})

test("wearable d. invalid source returns a clear 400 error", async () => {
  const dailyResponse = await request("/api/wearable/daily?date=2026-10-26&source=unknown")
  assert.equal(dailyResponse.status, 400)
  assert.match((await dailyResponse.json()).error, /googlefit.*applehealth/i)
  const weekResponse = await request("/api/wearable/week?source=unknown")
  assert.equal(weekResponse.status, 400)
  assert.match((await weekResponse.json()).error, /googlefit.*applehealth/i)
})

test("wearable e. each source week endpoint returns seven source-shaped days", async () => {
  const [googleResponse, appleResponse] = await Promise.all([
    request("/api/wearable/week?source=googlefit"),
    request("/api/wearable/week?source=applehealth"),
  ])
  assert.equal(googleResponse.status, 200)
  assert.equal(appleResponse.status, 200)
  const [googleWeek, appleWeek] = await Promise.all([googleResponse.json(), appleResponse.json()])
  assert.equal(googleWeek.length, 7)
  assert.equal(appleWeek.length, 7)
  assert.ok(googleWeek.every((day) => day.source === "googlefit" && day.step_count >= 3000 && day.step_count <= 14000))
  assert.ok(appleWeek.every((day) => day.source === "applehealth" && day.stepCount >= 3000 && day.stepCount <= 14000))
})

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

async function getSeededAlex() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const alex = await User.findOne({ email: "alex@nutritrack.demo" }).select("_id")
  await mongoose.disconnect()
  assert.ok(alex)
  return alex
}

test("policy a. assigned dietitian gets a scored policy result from saved meals", async () => {
  const alex = await getSeededAlex()
  const response = await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify({ policyId: "national_dietary_guidelines", date: localDateKey(new Date()) }),
  })
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json()
  assert.equal(typeof result.compliant, "boolean")
  assert.equal(typeof result.compliance_score, "number")
  assert.ok(result.compliance_score >= 0 && result.compliance_score <= 100)
})

test("policy b. national guideline day passes and low-sodium day reports the exact violation", async () => {
  const alex = await getSeededAlex()
  const today = new Date()
  const todayKey = localDateKey(today)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = localDateKey(yesterday)
  const passResponse = await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify({ policyId: "national_dietary_guidelines", date: todayKey }),
  })
  assert.equal(passResponse.status, 200, await passResponse.clone().text())
  assert.equal((await passResponse.json()).compliant, true)

  const violationResponse = await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify({ policyId: "low_sodium_hospital", date: yesterdayKey }),
  })
  assert.equal(violationResponse.status, 200)
  const result = await violationResponse.json()
  assert.equal(result.compliant, false)
  const violation = result.violations.find((item) => item.rule_id === "daily-sodium-limit")
  assert.ok(violation)
  assert.equal(violation.actual_value, 2200)
  assert.equal(violation.allowed_value, 2000)
})

test("policy c. an unassigned patient is forbidden", async () => {
  const response = await request(`/api/patients/${createdConsumerId}/policy-check`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify({ policyId: "national_dietary_guidelines", date: localDateKey(new Date()) }),
  })
  assert.equal(response.status, 403)
})

test("policy d. consumers get 403 and missing tokens get 401", async () => {
  const alex = await getSeededAlex()
  assert.equal((await request("/api/policy/policies", { token: seededConsumerToken })).status, 403)
  assert.equal((await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    token: seededConsumerToken,
    body: JSON.stringify({ policyId: "national_dietary_guidelines", date: localDateKey(new Date()) }),
  })).status, 403)
  assert.equal((await request("/api/policy/policies")).status, 401)
  assert.equal((await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    body: JSON.stringify({ policyId: "national_dietary_guidelines", date: localDateKey(new Date()) }),
  })).status, 401)
})

test("policy e. a date without saved meals returns a clear message", async () => {
  const alex = await getSeededAlex()
  const response = await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify({ policyId: "national_dietary_guidelines", date: "1900-01-01" }),
  })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.noMeals, true)
  assert.match(result.message, /no saved meals/i)
})

test("policy f. a missing required nutrient names the saved meal and nutrient", async () => {
  const alex = await getSeededAlex()
  const loggedAt = new Date("2001-02-03T08:00:00")
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const missingMeal = await Meal.create({
    user: alex._id,
    mealType: "breakfast",
    foodName: "Policy missing sodium test",
    portionSize: "1 serving",
    calories: 100,
    protein: 3,
    carbs: 12,
    fat: 2,
    loggedAt,
  })
  policyTestMealId = missingMeal._id
  await mongoose.disconnect()

  const response = await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify({ policyId: "low_sodium_hospital", date: "2001-02-03" }),
  })
  assert.equal(response.status, 422)
  const result = await response.json()
  assert.match(result.error, /breakfast: Policy missing sodium test/i)
  assert.match(result.error, /sodium_mg/)
  assert.deepEqual(result.missingData, {
    meal: "Breakfast: Policy missing sodium test",
    nutrient: "sodium_mg",
  })
})

test("policy g. stopped service returns 503 while other Express API routes remain available", async () => {
  const apiPort = await getAvailablePort()
  const unavailablePolicyPort = await getAvailablePort()
  const child = spawn(process.execPath, [resolve(backendDirectory, "server.js")], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      PORT: String(apiPort),
      POLICY_SERVICE_URL: `http://127.0.0.1:${unavailablePolicyPort}`,
    },
    stdio: "ignore",
  })
  try {
    let response
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error("Policy test backend exited before becoming ready.")
      try {
        response = await request("/api/policy/policies", {
          token: dietitianToken,
          baseUrl: `http://127.0.0.1:${apiPort}`,
        })
        if (response.status === 503) break
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      }
    }
    assert.equal(response?.status, 503)
    assert.equal((await response.json()).error, "The policy service is not running")
    const wearable = await request("/api/wearable/daily?date=2026-10-26", {
      baseUrl: `http://127.0.0.1:${apiPort}`,
    })
    assert.equal(wearable.status, 200)
  } finally {
    child.kill()
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit()
      else child.once("exit", resolveExit)
    })
  }
})

test("policy h. client-supplied meals cannot alter the server's saved-meal result", async () => {
  const alex = await getSeededAlex()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const body = {
    policyId: "low_sodium_hospital",
    date: localDateKey(yesterday),
  }
  const trusted = await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify(body),
  })
  const spoofed = await request(`/api/patients/${alex._id}/policy-check`, {
    method: "POST",
    token: dietitianToken,
    body: JSON.stringify({
      ...body,
      meals: [{ name: "Fake meal", foods: [{ name: "Fake food", nutrients: { sodium_mg: 0 } }] }],
    }),
  })
  assert.equal(trusted.status, 200)
  assert.equal(spoofed.status, 200)
  const trustedResult = await trusted.json()
  const spoofedResult = await spoofed.json()
  assert.equal(spoofedResult.compliant, trustedResult.compliant)
  assert.deepEqual(spoofedResult.violations, trustedResult.violations)
  assert.equal(spoofedResult.violations[0].actual_value, 2200)
})
