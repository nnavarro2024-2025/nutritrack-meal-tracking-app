# Clinical note schemas

These draft-07 JSON Schemas model the four Nutrition Care Process steps. The terminology catalog contains a limited subset of terms provided by the Academy of Nutrition and Dietetics Freely Available NCP Terms page; it is not the full eNCPT, which is available by subscription.

Terms from the Academy of Nutrition and Dietetics Freely Available NCP Terms (ncpro.org). This is a limited subset, not the full eNCPT, which is available by subscription. Intervention categories from the CDR Definition of Terms List, November 2024.

The assessment-domain groupings and the intervention-term-to-category assignments in `terminology.json` are assumptions and should be verified against the official terminology. Assessment term codes are not available in the public term list; diagnosis codes are included only where supplied by course material.

The diagnosis `generatedSentence` must be assembled as:

`[Problem] related to [Etiology] as evidenced by [Signs/Symptoms]`

When a diagnosis has multiple signs or symptoms, join them with `; `. The API checks that this sentence matches the diagnosis fields.
