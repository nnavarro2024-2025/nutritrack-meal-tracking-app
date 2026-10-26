import mongoose from "mongoose"

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ["consumer", "dietitian"] },
    assignedDietitian: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      validate: {
        validator(value) {
          const role = this instanceof mongoose.Document ? this.role : this.get("role")
          return role === "consumer" || value == null
        },
        message: "Only consumers can have an assigned dietitian.",
      },
    },
  },
  { timestamps: true },
)

export const User = mongoose.model("User", userSchema)
