import { Router } from "express"
import mongoose from "mongoose"
import { authenticateToken, requireRole } from "../middleware/auth.js"
import { ClinicalNote } from "../models/ClinicalNote.js"
import { User } from "../models/User.js"
import { getClinicalNoteValidationErrors } from "../services/clinicalNoteValidation.js"

const router = Router()

function serializeNote(note) {
  return {
    id: note._id.toString(),
    patientId: note.patient.toString(),
    dietitianId: note.dietitian.toString(),
    content: note.content,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  }
}

async function findAssignedPatient(patientId, dietitianId) {
  if (!mongoose.isValidObjectId(patientId)) return null
  return User.findOne({
    _id: patientId,
    role: "consumer",
    assignedDietitian: dietitianId,
  }).select("_id")
}

router.post("/patients/:id/notes", authenticateToken, requireRole("dietitian"), async (request, response) => {
  const patient = await findAssignedPatient(request.params.id, request.user._id)
  if (!patient) {
    response.status(403).json({ error: "This patient is not assigned to you.", code: "FORBIDDEN" })
    return
  }

  if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) {
    response.status(400).json({
      valid: false,
      errors: [{ path: "/", message: "must be an object" }],
    })
    return
  }

  const content = {
    ...request.body,
    patientId: patient._id.toString(),
    providerId: request.user._id.toString(),
  }
  const errors = getClinicalNoteValidationErrors(content)
  if (errors.length) {
    response.status(400).json({ valid: false, errors })
    return
  }

  const note = await ClinicalNote.create({
    patient: patient._id,
    dietitian: request.user._id,
    content,
  })
  response.status(201).json({ note: serializeNote(note) })
})

router.get("/patients/:id/notes", authenticateToken, requireRole("dietitian"), async (request, response) => {
  const patient = await findAssignedPatient(request.params.id, request.user._id)
  if (!patient) {
    response.status(403).json({ error: "This patient is not assigned to you.", code: "FORBIDDEN" })
    return
  }

  const notes = await ClinicalNote.find({ patient: patient._id }).sort({ createdAt: -1 })
  response.json({ notes: notes.map(serializeNote) })
})

router.get("/notes/:noteId", authenticateToken, requireRole("dietitian"), async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.noteId)) {
    response.status(404).json({ error: "Clinical note not found.", code: "NOTE_NOT_FOUND" })
    return
  }
  const note = await ClinicalNote.findById(request.params.noteId)
  if (!note) {
    response.status(404).json({ error: "Clinical note not found.", code: "NOTE_NOT_FOUND" })
    return
  }
  if (!note.dietitian.equals(request.user._id)) {
    response.status(403).json({ error: "You are not allowed to view this clinical note.", code: "FORBIDDEN" })
    return
  }
  response.json({ note: serializeNote(note) })
})

router.get("/my/notes", authenticateToken, requireRole("consumer"), async (request, response) => {
  const notes = await ClinicalNote.find({ patient: request.user._id }).sort({ createdAt: -1 })
  response.json({ notes: notes.map(serializeNote) })
})

export default router
