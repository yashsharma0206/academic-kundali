/**
 * Academic Kundali scoring & prediction — matches Streamlit logic.
 * When rules do not apply, uses score-based fallback (replaces sklearn model + predict_proba).
 */

export const STREAM_LABELS = ['Science & Engineering', 'Science (Biology)', 'Commerce', 'Arts'];

/**
 * @param {object} p
 * @param {number} p.math
 * @param {number} p.physics
 * @param {number} p.chemistry
 * @param {number} p.biology
 * @param {number} p.economics
 * @param {number} p.business_interest
 * @param {number} p.history
 * @param {number} p.numerical
 * @param {boolean} p.doctor
 * @param {boolean} p.engineer
 */
export function computeScores(p) {
  const doctor_val = p.doctor ? 1 : 0;
  const engineer_val = p.engineer ? 1 : 0;

  const stem_score = p.math + p.physics + p.chemistry + p.numerical;
  const bio_score = p.biology * 2 + doctor_val * 3;
  const commerce_score = p.economics * 2 + p.business_interest;
  const arts_score = p.history;

  return {
    stem_score,
    bio_score,
    commerce_score,
    arts_score,
    doctor_val,
    engineer_val,
  };
}

/**
 * Normalized strengths for radar (0–1).
 */
export function normalizedRadarValues(scores) {
  const { stem_score, bio_score, commerce_score, arts_score } = scores;
  return {
    STEM: Math.min(1, stem_score / 20),
    Biology: Math.min(1, bio_score / 13),
    Commerce: Math.min(1, commerce_score / 15),
    Arts: Math.min(1, arts_score / 5),
  };
}

/**
 * Fallback when no rule matches: pick stream by highest normalized domain score.
 * Confidence approximates separation between winner and runner-up.
 */
function fallbackFromScores(scores) {
  const norms = [
    { stream: 'Science & Engineering', v: scores.stem_score / 20 },
    { stream: 'Science (Biology)', v: scores.bio_score / 13 },
    { stream: 'Commerce', v: scores.commerce_score / 15 },
    { stream: 'Arts', v: scores.arts_score / 5 },
  ];
  norms.sort((a, b) => b.v - a.v);
  const winner = norms[0];
  const second = norms[1];
  const margin = Math.max(0, winner.v - second.v);
  const confidence = Math.min(95, Math.max(52, 55 + margin * 80));
  return { stream: winner.stream, confidence, method: 'score' };
}

/**
 * @returns {{ stream: string, confidence: number, method: 'rule'|'score', rule?: string }}
 */
export function predictStream(p) {
  const scores = computeScores(p);
  const { math, physics, biology, economics, business_interest, history, numerical } = p;
  const { doctor_val } = scores;

  if (math >= 4 && physics >= 4 && numerical >= 4) {
    return { stream: 'Science & Engineering', confidence: 95, method: 'rule', rule: 'strong_stem' };
  }
  if (biology >= 4 && doctor_val === 1) {
    return { stream: 'Science (Biology)', confidence: 95, method: 'rule', rule: 'bio_doctor' };
  }
  if (economics >= 4 && business_interest >= 4) {
    return { stream: 'Commerce', confidence: 90, method: 'rule', rule: 'commerce' };
  }
  if (history >= 4) {
    return { stream: 'Arts', confidence: 85, method: 'rule', rule: 'history' };
  }

  return fallbackFromScores(scores);
}
