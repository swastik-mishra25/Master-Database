const BUYING_INTENT_PATTERN =
  /\b(?:evaluat(?:ing|e)|explor(?:ing|e)|implement(?:ing|ed|ation)?|deploy(?:ing|ed)?|adopt(?:ing|ed)?|seeking|piloting|looking\s+for|request(?:ing)?\s+(?:a\s+)?(?:for\s+)?proposal|submit(?:ting)?\s+(?:a\s+)?request\s+for\s+proposal|issue(?:d|s)?\s+an?\s+rfp|rfp|plan(?:ning)?\s+to|trial(?:ing)?)\b.{0,60}\b(?:ai[- ](?:powered\s+)?voice|voice[- ](?:ai|automation|agents?|bots?)|conversational ai|automated (?:customer )?(?:support|service|calls?)|customer[- ]service automation|contact[- ]center automation|call[- ]center automation|ai[- ](?:powered\s+)?(?:customer support|customer service|lead qualification)|lead qualification automation)\b|\b(?:ai[- ](?:powered\s+)?voice|voice[- ](?:ai|automation|agents?|bots?)|conversational ai|automated (?:customer )?(?:support|service|calls?)|customer[- ]service automation|contact[- ]center automation|call[- ]center automation|ai[- ](?:powered\s+)?(?:customer support|customer service|lead qualification)|lead qualification automation)\b.{0,60}\b(?:evaluat(?:ing|e)|explor(?:ing|e)|implement(?:ing|ed|ation)?|deploy(?:ing|ed)?|adopt(?:ing|ed)?|seeking|piloting|looking\s+for|request(?:ing)?\s+(?:a\s+)?(?:for\s+)?proposal|submit(?:ting)?\s+(?:a\s+)?request\s+for\s+proposal|issue(?:d|s)?\s+an?\s+rfp|rfp|plan(?:ning)?\s+to|trial(?:ing)?)\b/i;
const BUYER_SUBJECT_PATTERN =
  /\b(?:we|our company|our organization|our organisation|our team|the company|the organization|the organisation|management|procurement team)\b/i;
const PROCUREMENT_PATTERN =
  /\b(?:rfp|request for proposals?|tender|vendor shortlist|procurement)\b/i;
const NEGATED_INTENT_PATTERN =
  /\b(?:not|never|no longer|isn't|aren't|wasn't|weren't|without|failed to|decided against|stopped|cancelled|canceled)\b.{0,35}$/i;

function findBuyingIntentSignal(text) {
  if (typeof text !== "string") return null;

  const sentencePattern = /[^.!?;\n]+(?:[.!?;\n]+|$)/g;
  for (const sentenceMatch of text.matchAll(sentencePattern)) {
    const sentence = sentenceMatch[0];
    const intentMatch = BUYING_INTENT_PATTERN.exec(sentence);
    if (!intentMatch) continue;

    const actionMatch = [...sentence.matchAll(
      /\b(?:evaluat(?:ing|e)|explor(?:ing|e)|implement(?:ing|ed|ation)?|deploy(?:ing|ed)?|adopt(?:ing|ed)?|seeking|piloting|looking\s+for|request(?:ing)?\s+(?:a\s+)?(?:for\s+)?proposal|submit(?:ting)?\s+(?:a\s+)?request\s+for\s+proposal|issue(?:d|s)?\s+an?\s+rfp|rfp|plan(?:ning)?\s+to|trial(?:ing)?)\b/gi
    )].find(match => Math.abs(match.index - intentMatch.index) <= 60);
    if (!actionMatch) continue;

    const actionContext = sentence.slice(Math.max(0, actionMatch.index - 45), actionMatch.index);
    if (NEGATED_INTENT_PATTERN.test(actionContext)) continue;

    const hasBuyerSubject = BUYER_SUBJECT_PATTERN.test(actionContext);
    const hasProcurementContext = PROCUREMENT_PATTERN.test(sentence);
    if (!hasBuyerSubject && !hasProcurementContext) continue;

    const globalIndex = sentenceMatch.index + intentMatch.index;
    const result = [...intentMatch];
    result.index = globalIndex;
    result.input = text;
    result.groups = undefined;
    return result;
  }
  return null;
}

module.exports = { findBuyingIntentSignal };
