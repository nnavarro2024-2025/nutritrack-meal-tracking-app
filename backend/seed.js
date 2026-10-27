import bcrypt from "bcryptjs"
import dotenv from "dotenv"
import mongoose from "mongoose"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { User } from "./models/User.js"
import { Meal } from "./models/Meal.js"
import { ClinicalNote } from "./models/ClinicalNote.js"

const backendDirectory = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(backendDirectory, ".env") })

const demoAccounts = [
  { name: "Ava Dietitian", email: "dietitian@nutritrack.demo", password: "DietitianDemo2026!", role: "dietitian" },
  { name: "Alex Morgan", email: "alex@nutritrack.demo", password: "ConsumerDemo2026!", role: "consumer" },
  { name: "Jordan Lee", email: "jordan@nutritrack.demo", password: "ConsumerDemo2026!", role: "consumer" },
]

async function seed() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing. Set it in backend/.env (see backend/.env.example).")
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })

  const dietitian = demoAccounts[0]
  const dietitianHash = await bcrypt.hash(dietitian.password, 12)
  const savedDietitian = await User.findOneAndUpdate(
    { email: dietitian.email },
    { $set: { name: dietitian.name, email: dietitian.email, passwordHash: dietitianHash, role: dietitian.role }, $unset: { assignedDietitian: 1 } },
    { upsert: true, new: true, runValidators: true },
  )

  for (const consumer of demoAccounts.slice(1)) {
    const passwordHash = await bcrypt.hash(consumer.password, 12)
    await User.findOneAndUpdate(
      { email: consumer.email },
      {
        $set: {
          name: consumer.name,
          email: consumer.email,
          passwordHash,
          role: consumer.role,
          assignedDietitian: savedDietitian._id,
        },
      },
      { upsert: true, new: true, runValidators: true },
    )
  }

  const sampleMeals = [
    { mealType: "breakfast", foodName: "Oatmeal with berries", portionSize: "1 bowl", calories: 340, protein: 12, carbs: 58, fat: 8, sodiumMg: 600, fiberG: 8, addedSugarG: 5, notes: "Sample meal" },
    { mealType: "lunch", foodName: "Grilled chicken salad", portionSize: "1 plate", calories: 520, protein: 42, carbs: 34, fat: 22, sodiumMg: 700, fiberG: 8, addedSugarG: 3, notes: "Sample meal" },
    { mealType: "dinner", foodName: "Salmon with brown rice", portionSize: "1 plate", calories: 610, protein: 38, carbs: 62, fat: 24, sodiumMg: 2200, fiberG: 10, addedSugarG: 2, notes: "Sample meal" },
  ]
  const consumers = await User.find({ email: { $in: demoAccounts.slice(1).map((account) => account.email) } })
  for (const consumer of consumers) {
    for (const [index, details] of sampleMeals.entries()) {
      const loggedAt = new Date()
      loggedAt.setDate(loggedAt.getDate() - Math.floor(index / 1.5))
      loggedAt.setHours([8, 12, 18][index], 0, 0, 0)
      const { sodiumMg, fiberG, addedSugarG, ...mealDetails } = details
      await Meal.findOneAndUpdate(
        { user: consumer._id, foodName: details.foodName, loggedAt },
        {
          $set: { sodiumMg, fiberG, addedSugarG },
          $setOnInsert: { ...mealDetails, user: consumer._id, loggedAt },
        },
        { upsert: true, new: true, runValidators: true },
      )
    }
  }

  const alex = consumers.find((consumer) => consumer.email === "alex@nutritrack.demo")
  const sampleNote = JSON.parse(readFileSync(resolve(backendDirectory, "../schemas/examples/valid-note.json"), "utf8"))
  sampleNote.patientId = alex._id.toString()
  sampleNote.providerId = savedDietitian._id.toString()
  await ClinicalNote.findOneAndUpdate(
    {
      patient: alex._id,
      dietitian: savedDietitian._id,
      "content.date": sampleNote.date,
      "content.diagnosis.problem.term": sampleNote.diagnosis.problem.term,
    },
    {
      $setOnInsert: {
        patient: alex._id,
        dietitian: savedDietitian._id,
        content: sampleNote,
      },
    },
    { upsert: true, new: true, runValidators: true },
  )

  console.log("NutriTrack demo accounts are ready:")
  for (const account of demoAccounts) console.log(`${account.role}: ${account.email} / ${account.password}`)
}

seed()
  .catch((error) => {
    console.error(`Demo seed failed: ${error.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
  })
