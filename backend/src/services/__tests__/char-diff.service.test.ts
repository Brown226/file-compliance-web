import { CharDiffService } from '../file/char-diff.service';

describe('CharDiffService', () => {
  describe('compare', () => {
    it('should return empty ranges for identical strings', () => {
      const result = CharDiffService.compare('abc', 'abc');
      expect(result.originalRanges).toEqual([]);
      expect(result.correctRanges).toEqual([]);
    });

    it('should return empty ranges for two empty strings', () => {
      const result = CharDiffService.compare('', '');
      expect(result.originalRanges).toEqual([]);
      expect(result.correctRanges).toEqual([]);
    });

    it('should mark entire original as diff when correct is empty', () => {
      const result = CharDiffService.compare('abc', '');
      expect(result.originalRanges).toEqual([{ start: 0, length: 3 }]);
      expect(result.correctRanges).toEqual([]);
    });

    it('should mark entire correct as diff when original is empty', () => {
      const result = CharDiffService.compare('', 'xyz');
      expect(result.originalRanges).toEqual([]);
      expect(result.correctRanges).toEqual([{ start: 0, length: 3 }]);
    });

    it('should detect single char difference in the middle', () => {
      // "abc" vs "axc" → diff at index 1
      const result = CharDiffService.compare('abc', 'axc');
      expect(result.originalRanges).toEqual([{ start: 1, length: 1 }]);
      expect(result.correctRanges).toEqual([{ start: 1, length: 1 }]);
    });

    it('should detect difference at the start', () => {
      const result = CharDiffService.compare('xbc', 'abc');
      expect(result.originalRanges).toEqual([{ start: 0, length: 1 }]);
      expect(result.correctRanges).toEqual([{ start: 0, length: 1 }]);
    });

    it('should detect difference at the end', () => {
      const result = CharDiffService.compare('abx', 'abc');
      expect(result.originalRanges).toEqual([{ start: 2, length: 1 }]);
      expect(result.correctRanges).toEqual([{ start: 2, length: 1 }]);
    });

    it('should detect multiple disjoint differences', () => {
      // "axbyc" vs "abcde" → diff at [1,1] and [3,2]
      const result = CharDiffService.compare('axbyc', 'abcde');
      // At i=1: 'x' vs 'b' → diff starts
      // At i=2: 'b' vs 'c' → diff continues (still different)
      // Actually let me trace: "axbyc" vs "abcde"
      // i=0: a==a ✓
      // i=1: x!=b → errorLen=1, firstNo=1
      // i=2: b!=c → errorLen=2
      // i=3: y!=d → errorLen=3
      // i=4: c!=e → errorLen=4
      // end: errorLen=4 → push {start:1, length:4}
      // standardInfo.length(5) == correctInfo.length(5) → no tail diff
      expect(result.originalRanges).toEqual([{ start: 1, length: 4 }]);
      expect(result.correctRanges).toEqual([{ start: 1, length: 4 }]);
    });

    it('should handle original longer than correct', () => {
      // "abcd" vs "ab" → diff at [2,2]
      const result = CharDiffService.compare('abcd', 'ab');
      expect(result.originalRanges).toEqual([{ start: 2, length: 2 }]);
      expect(result.correctRanges).toEqual([]);
    });

    it('should handle correct longer than original', () => {
      // "ab" vs "abcd" → diff at [2,2]
      const result = CharDiffService.compare('ab', 'abcd');
      expect(result.originalRanges).toEqual([]);
      expect(result.correctRanges).toEqual([{ start: 2, length: 2 }]);
    });

    it('should handle completely different strings of same length', () => {
      const result = CharDiffService.compare('abc', 'xyz');
      expect(result.originalRanges).toEqual([{ start: 0, length: 3 }]);
      expect(result.correctRanges).toEqual([{ start: 0, length: 3 }]);
    });

    it('should handle null/undefined as empty', () => {
      const result1 = CharDiffService.compare(null as any, 'abc');
      expect(result1.originalRanges).toEqual([]);
      expect(result1.correctRanges).toEqual([{ start: 0, length: 3 }]);

      const result2 = CharDiffService.compare('abc', undefined as any);
      expect(result2.originalRanges).toEqual([{ start: 0, length: 3 }]);
      expect(result2.correctRanges).toEqual([]);
    });
  });

  describe('hasDifference', () => {
    it('should return false for identical strings', () => {
      expect(CharDiffService.hasDifference('abc', 'abc')).toBe(false);
    });

    it('should return true for different strings', () => {
      expect(CharDiffService.hasDifference('abc', 'axc')).toBe(true);
    });

    it('should return false for two empty strings', () => {
      expect(CharDiffService.hasDifference('', '')).toBe(false);
    });

    it('should return true when one is empty', () => {
      expect(CharDiffService.hasDifference('abc', '')).toBe(true);
      expect(CharDiffService.hasDifference('', 'abc')).toBe(true);
    });
  });
});
