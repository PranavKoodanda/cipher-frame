export const DIFFERENCE_AMPLIFICATIONS = [1, 10, 50];

export function differenceDisplayIntensity(actualDifference, amplification) {
  return Math.min(255, actualDifference * amplification);
}
