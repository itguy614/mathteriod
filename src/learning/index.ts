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
  factMastered,
  PRACTICE,
  practiceName,
} from './engine';
export type { MasteryReport, PracticeLevelOptions } from './engine';
export {
  SKILLS,
  SKILL_SYMBOL,
  SKILL_FAST_SHARE,
  NEEDS_PRACTICE,
  isSkillId,
  skillById,
  skillsFor,
  skillLabel,
  factsForSkills,
  skillMastery,
  weakestFacts,
} from './skills';
export type { SkillId, SkillDef, SkillLevel, SkillMastery } from './skills';
