import { describe, expect, it } from 'vitest';
import { gradesForTarget } from '../server/academic.js';
import { nextTermAfter } from '../server/advising.js';
import { STUDENTS, studyPlanSourceFor } from '../database/dataset.js';
import { datasetIntegrityErrors } from '../database/integrity.js';

describe('academic calculations', () => {
  it('chooses grades using credit-weighted GPA math', () => {
    const credits = [4, 3, 1, 3];
    const grades = gradesForTarget(credits, 3.5);
    const weighted = grades.reduce((sum, grade, index) => sum + grade.points * credits[index], 0);
    const gpa = weighted / credits.reduce((sum, credit) => sum + credit, 0);
    expect(gpa).toBeCloseTo(3.5, 1);
    expect(grades).toHaveLength(credits.length);
  });

  it('reproduces every seeded GPA using canonical transcript grades', () => {
    for (const student of STUDENTS) {
      const courseCount = Math.max(1, Math.floor((student.completedCredits ?? 30) / 3));
      const credits = Array.from({ length: courseCount }, () => 3);
      const grades = gradesForTarget(credits, student.gpa);
      const weighted = grades.reduce((sum, grade, index) => sum + grade.points * credits[index], 0);
      expect(weighted / credits.reduce((sum, credit) => sum + credit, 0)).toBeCloseTo(student.gpa, 2);
    }
  });

  it('uses a fixed, varied demo GPA distribution when no official GPA source exists', () => {
    expect(STUDENTS.map((student) => student.gpa)).toEqual([3.7, 3.2, 2.8, 1.8, 3.5, 2.6, 1.9, 3.0]);
    expect(STUDENTS.filter((student) => student.gpa < 2)).toHaveLength(2);
    expect(STUDENTS.filter((student) => student.gpa >= 3.5)).toHaveLength(2);
    expect(STUDENTS.every((student) => (student.completedCredits ?? 0) > 0)).toBe(true);
  });

  it('rejects invalid GPA and course-credit inputs', () => {
    expect(() => gradesForTarget([3], -0.01)).toThrow(/GPA/);
    expect(() => gradesForTarget([3], 4.01)).toThrow(/GPA/);
    expect(() => gradesForTarget([0, 3], 3)).toThrow(/credits/);
    expect(() => gradesForTarget([1.5, 3], 3)).toThrow(/credits/);
    expect(() => gradesForTarget([3], 0.5, { minimumPoints: 1 })).toThrow(/grade range/);
  });

  it('can generate earned-credit history without introducing failing grades', () => {
    const grades = gradesForTarget(Array.from({ length: 20 }, () => 3), 3.5, { minimumPoints: 1 });
    expect(grades.every((grade) => grade.points >= 1)).toBe(true);
    expect(grades.reduce((sum, grade) => sum + grade.points, 0) / grades.length).toBeCloseTo(3.5, 2);
  });

  it('advances academic terms predictably', () => {
    expect(nextTermAfter('Fall 2025')).toBe('Spring 2026');
    expect(nextTermAfter('Spring 2026')).toBe('Fall 2026');
    expect(nextTermAfter('Summer 2026')).toBe('Summer 2026');
    expect(nextTermAfter('not-a-term')).toBe('not-a-term');
  });

  it('leaves unsupported curriculum gaps unavailable instead of substituting another major', () => {
    expect(studyPlanSourceFor('Cyber and Information Security', 'Diploma First Year')).toBe('Common');
    expect(studyPlanSourceFor('Cyber and Information Security', 'Diploma Second Year')).toBeUndefined();
    expect(studyPlanSourceFor('Data Science and Artificial Intelligence', 'Diploma Second Year')).toBeUndefined();
    expect(studyPlanSourceFor('Software Engineering', 'Diploma Second Year')).toBe('Software Engineering');
  });

  it('keeps the complete authoritative dataset internally consistent', () => {
    expect(datasetIntegrityErrors()).toEqual([]);
  });
});
