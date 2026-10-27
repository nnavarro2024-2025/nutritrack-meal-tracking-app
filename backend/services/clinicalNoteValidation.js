import Ajv from "ajv"
import addFormats from "ajv-formats"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDirectory = resolve(backendDirectory, "../schemas")
const loadSchema = (filename) => JSON.parse(readFileSync(resolve(schemaDirectory, filename), "utf8"))
const validator = new Ajv({ allErrors: true })
addFormats(validator)
validator.addSchema(loadSchema("terminology.json"))
validator.addSchema(loadSchema("assessment.schema.json"))
validator.addSchema(loadSchema("diagnosis.schema.json"))
validator.addSchema(loadSchema("intervention.schema.json"))
validator.addSchema(loadSchema("monitoring-evaluation.schema.json"))
const validateClinicalNoteSchema = validator.compile(loadSchema("clinical-note.schema.json"))

function formatValidationErrors(errors = []) {
  return errors.map((error) => {
    const property = error.params?.missingProperty || error.params?.additionalProperty
    const path = `${error.instancePath || ""}${property ? `/${property}` : ""}` || "/"
    return { path, message: error.message || "is invalid" }
  })
}

export function getClinicalNoteValidationErrors(note) {
  if (!validateClinicalNoteSchema(note)) {
    return formatValidationErrors(validateClinicalNoteSchema.errors)
  }

  const { diagnosis } = note
  const expectedSentence = `${diagnosis.problem.term} related to ${diagnosis.etiology} as evidenced by ${diagnosis.signsSymptoms.join("; ")}`
  if (diagnosis.generatedSentence !== expectedSentence) {
    return [{
      path: "/diagnosis/generatedSentence",
      message: `must match the generated PES sentence: "${expectedSentence}"`,
    }]
  }

  return []
}
