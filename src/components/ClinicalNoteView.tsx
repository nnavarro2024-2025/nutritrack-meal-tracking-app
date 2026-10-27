import { ClinicalNote, SavedClinicalNote } from "../services/notesService"

export default function ClinicalNoteView({
  savedNote,
  patientName,
  providerName,
  onBack,
}: {
  savedNote: SavedClinicalNote
  patientName: string
  providerName?: string
  onBack: () => void
}) {
  const note: ClinicalNote = savedNote.content

  return (
    <section className="card clinical-note-review saved-note-review">
      <div className="section-heading review-heading">
        <div><span className="section-kicker">SAVED NUTRITION CARE NOTE</span><h2>{note.date}</h2></div>
        <button type="button" className="secondary-button print-button" onClick={() => window.print()}>Print / Export</button>
      </div>
      <header className="clinical-note-header">
        <div className="brand-mark">N</div>
        <div><span className="section-kicker">NUTRITION CARE NOTE</span><h3>{patientName}</h3><p>{providerName || `Provider ${savedNote.dietitianId}`} · {note.date}</p></div>
      </header>
      <div className="clinical-note-section">
        <span className="section-kicker">01 · ASSESSMENT</span>
        {note.assessment.domains.map((group) => (
          <div className="clinical-note-domain" key={group.domain}>
            <h3>{group.domain}</h3>
            {group.items.map((item, index) => (
              <p key={`${item.term}-${index}`}><strong>{item.term}</strong>{item.code && <span> ({item.code})</span>}: {item.value} {item.unit}</p>
            ))}
          </div>
        ))}
      </div>
      <div className="clinical-note-section">
        <span className="section-kicker">02 · DIAGNOSIS</span>
        <p className="clinical-pes">{note.diagnosis.generatedSentence}</p>
      </div>
      <div className="clinical-note-section">
        <span className="section-kicker">03 · INTERVENTION</span>
        <p><strong>{note.intervention.category}</strong> · {note.intervention.term}</p>
        <p>{note.intervention.goal}</p>
        <p className="clinical-note-muted">{note.intervention.schedule.frequency} · Starts {note.intervention.schedule.startDate}</p>
      </div>
      <div className="clinical-note-section">
        <span className="section-kicker">04 · MONITORING &amp; EVALUATION</span>
        <p><strong>{note.monitoringEvaluation.indicator}</strong></p>
        <p>Target: {note.monitoringEvaluation.target}</p>
        <p>Measured result: {note.monitoringEvaluation.measuredResult}</p>
        <span className="fresh-pill">{note.monitoringEvaluation.status}</span>
      </div>
      <p className="clinical-note-muted">Saved {new Date(savedNote.createdAt).toLocaleString()}</p>
      <button type="button" className="secondary-button saved-note-back" onClick={onBack}>Back to notes</button>
    </section>
  )
}
