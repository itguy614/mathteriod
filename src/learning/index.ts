/** Public API of the learning module (curriculum, adaptive questions, mastery). */
export {
  MIN_OPERAND,
  MAX_OPERAND,
  OPERATIONS,
  makeFact,
  additionFact,
  subtractionFact,
  multiplicationFact,
  divisionFact,
  factsFromPairs,
  factsFor,
  allFacts,
  factById,
} from './facts';
export { STAGES, stageIndexById } from './curriculum';
export {
  LearningEngine,
  initialLearningState,
  MASTERY,
  DIFFICULTY,
  RECENT_WINDOW,
  factWeight,
  evaluateMastery,
  progressFromReport,
  constructFactForAnswer,
} from './engine';
export type { MasteryReport } from './engine';
