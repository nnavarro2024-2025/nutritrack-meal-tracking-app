import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import jwt from "jsonwebtoken"
import mongoose from "mongoose"
import bcrypt from "bcryptjs"
import { unlink } from "node:fs/promises"
import { User } from "../models/User.js"
import { Meal } from "../models/Meal.js"

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
  await mongoose.disconnect()
})

async function request(path, { token, ...options } = {}) {
  return fetch(`${baseUrl}${path}`, {
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
  assert.deepEqual(sampleMealCounts, [3, 3])
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
