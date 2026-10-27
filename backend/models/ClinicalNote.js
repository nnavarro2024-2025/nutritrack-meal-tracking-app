import mongoose from "mongoose"

const clinicalNoteSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    dietitian: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
)

clinicalNoteSchema.index({ patient: 1, createdAt: -1 })

export const ClinicalNote = mongoose.model("ClinicalNote", clinicalNoteSchema)
