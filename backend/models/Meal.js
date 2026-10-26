import mongoose from "mongoose"

const mealSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    mealType: {
      type: String,
      required: true,
      enum: ["breakfast", "lunch", "dinner", "snack"],
    },
    foodName: { type: String, required: true, trim: true, minlength: 1 },
    portionSize: { type: String, required: true, trim: true, minlength: 1 },
    calories: { type: Number, required: true, min: 0 },
    protein: { type: Number, required: true, min: 0 },
    carbs: { type: Number, required: true, min: 0 },
    fat: { type: Number, required: true, min: 0 },
    notes: { type: String, default: "", trim: true },
    photoPath: { type: String },
    loggedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true },
)

mealSchema.index({ user: 1, loggedAt: -1 })

export const Meal = mongoose.model("Meal", mealSchema)
