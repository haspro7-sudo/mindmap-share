// M7 voice (SPEC L/M7): the voice check sheet (S5) and the voice card body (C-8 ⑤).
// Public API: VoiceSheet, VoiceCardBody, QuizAnswers, quizToFeatures, buildReading.
export { VoiceSheet, requestVoiceEntry, type VoiceEntry } from './VoiceSheet'
export { VoiceCardBody } from './VoiceCardBody'
export { quizToFeatures, buildReading, suggestionsFor, evidenceFor, type QuizAnswers } from './buildReading'
export { V as voiceStrings } from './strings'
