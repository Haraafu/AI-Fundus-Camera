// Prototype screening categories; kept independent of model inference.
export const RISK_RULE_VERSION = 'dr-grade-risk-v1';
const levels = { No_DR: 'LOW', Mild: 'LOW', Moderate: 'MEDIUM', Severe: 'HIGH', Proliferative_DR: 'HIGH' };
export function scoreRisk(predictedClass, binary = false) {
  if (binary && ['No_DR', 'DR'].includes(predictedClass)) {
    return { riskLevel: 'NOT_ASSESSED', riskRuleVersion: 'dr-binary-no-severity-v1' };
  }
  if (!Object.hasOwn(levels, predictedClass)) throw new Error('Unknown DR class');
  return { riskLevel: levels[predictedClass], riskRuleVersion: RISK_RULE_VERSION };
}
