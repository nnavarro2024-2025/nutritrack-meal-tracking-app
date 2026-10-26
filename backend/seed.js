import bcrypt from "bcryptjs"
import dotenv from "dotenv"
import mongoose from "mongoose"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { User } from "./models/User.js"

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
