import { describe, it, expect } from 'vitest';
import type { StudioProject, ValidationIssue } from '../types';
import { isAllowedAppUrl, lintProject } from './lint';
import { fixtureProject } from './testFixtures';

const JA = /[ぁ-んァ-ヶ一-龯]/;

function codes(issues: ValidationIssue[], severity?: 'error' | 'warning'): string[] {
  return issues.filter((i) => severity === undefined || i.severity === severity).map((i) => i.code);
}

function find(issues: ValidationIssue[], code: string): ValidationIssue[] {
  return issues.filter((i) => i.code === code);
}

function lint(mutate: (p: StudioProject) => void): ValidationIssue[] {
  const p = fixtureProject({ kdfIterations: 200_000 });
  mutate(p);
  return lintProject(p);
}

describe('lintProject', () => {
  it('the fixture has no errors or warnings at 200,000 iterations', () => {
    expect(lintProject(fixtureProject({ kdfIterations: 200_000 }))).toEqual([]);
  });

  it('every issue has a Japanese message, and errors come before warnings', () => {
    const issues = lint((p) => {
      p.goals[0]!.hints = [];
      p.goals[1]!.code = '';
      p.groups.push({ id: 'empty', label: '空' });
    });
    expect(issues.length).toBeGreaterThanOrEqual(3);
    for (const i of issues) expect(i.messageJa).toMatch(JA);
    const firstWarning = issues.findIndex((i) => i.severity === 'warning');
    expect(issues.slice(firstWarning).every((i) => i.severity === 'warning')).toBe(true);
  });

  describe('warnings', () => {
    it('a code goal without hints', () => {
      const issues = lint((p) => {
        p.goals[0]!.hints = [];
        p.goals[1]!.hints = ['', ' '];
        p.goals[3]!.hints = []; // manual goal: no warning
      });
      const w = find(issues, 'noHints');
      expect(w.map((i) => i.path)).toEqual(['goals[0].hints', 'goals[1].hints']);
      expect(w.every((i) => i.severity === 'warning')).toBe(true);
    });

    it('tier 1 equal to the last tier', () => {
      const issues = lint((p) => {
        p.goals[0]!.hints = ['望遠鏡を3回調べる', '天文台へ', '望遠鏡を3回調べる'];
      });
      expect(find(issues, 'hintRevealsAnswer')).toEqual([
        expect.objectContaining({ path: 'goals[0].hints[0]', severity: 'warning' }),
      ]);
    });

    it('tier 1 containing the last tier (also for 2 tiers and manual goals, ignoring width and case)', () => {
      const issues = lint((p) => {
        p.goals[0]!.hints = ['第3章で天文台の望遠鏡を3回調べると良いかも', '屋上へ', '天文台の望遠鏡を3回調べる'];
        p.goals[4]!.hints = ['ＣＨＥＣＫ ＡＬＬ ＳＨＥＬＶＥＳ', 'check all shelves'];
      });
      expect(find(issues, 'hintRevealsAnswer').map((i) => i.path)).toEqual(['goals[0].hints[0]', 'goals[4].hints[0]']);
    });

    it('no tier warning for a single hint or unrelated tiers', () => {
      const issues = lint((p) => {
        p.goals[0]!.hints = ['夜の図書館へ'];
        p.goals[1]!.hints = ['夜', '屋上の天文台', '望遠鏡を3回調べる'];
      });
      expect(find(issues, 'hintRevealsAnswer')).toEqual([]);
    });

    it('a missable before the first checkpoint', () => {
      const issues = lint((p) => {
        p.goals[1]!.missable = { before: 'ch1', warn: '序盤で見逃さないで' };
      });
      expect(find(issues, 'missableBeforeFirst')).toEqual([
        expect.objectContaining({ path: 'goals[1].missable.before', severity: 'warning' }),
      ]);
      expect(codes(issues, 'error')).toEqual([]);
    });

    it('an empty group', () => {
      const issues = lint((p) => {
        p.groups.push({ id: 'cg', label: '回想' });
      });
      expect(find(issues, 'emptyGroup')).toEqual([
        expect.objectContaining({ path: 'groups[2]', severity: 'warning' }),
      ]);
      expect(find(issues, 'emptyGroup')[0]!.messageJa).toContain('回想');
    });

    it('appUrl that is not https (http://localhost is allowed)', () => {
      expect(codes(lint((p) => (p.appUrl = 'http://example.com/')))).toEqual(['appUrlNotHttps']);
      expect(codes(lint((p) => (p.appUrl = 'ftp://example.com/')))).toEqual(['appUrlNotHttps']);
      expect(codes(lint((p) => (p.appUrl = '')))).toEqual(['appUrlMissing']);
      expect(lint((p) => (p.appUrl = 'http://localhost:5173/'))).toEqual([]);
      expect(lint((p) => (p.appUrl = 'https://user.github.io/shiori-cho/'))).toEqual([]);
      expect(find(lint((p) => (p.appUrl = 'http://example.com/')), 'appUrlNotHttps')[0]!.path).toBe('appUrl');
    });

    it('iterations below 150,000', () => {
      const issues = lint((p) => (p.kdfIterations = 120_000));
      expect(issues).toEqual([expect.objectContaining({ path: 'kdfIterations', code: 'kdfIterationsLow', severity: 'warning' })]);
      expect(lint((p) => (p.kdfIterations = 150_000))).toEqual([]);
    });

    it('teaser or label containing the secret title', () => {
      const issues = lint((p) => {
        p.goals[0]!.teaser = '星図の果てにたどり着く';
        p.goals[1]!.label = 'END 2 閉館の鐘';
      });
      expect(find(issues, 'teaserLeaksSecret').map((i) => [i.path, i.severity])).toEqual([['goals[0].teaser', 'warning']]);
      expect(find(issues, 'labelLeaksSecret').map((i) => [i.path, i.severity])).toEqual([['goals[1].label', 'warning']]);
    });

    it('a label identical to the secret title is public by choice (no leak warnings)', () => {
      const issues = lint((p) => {
        p.goals[1]!.label = '閉館の鐘';
        p.goals[1]!.hints = ['閉館の鐘が鳴るまで待つ'];
      });
      expect(issues).toEqual([]);
    });
  });

  describe('errors', () => {
    it('invalid work.id', () => {
      for (const id of ['', 'ab', 'W-UPPER', '-lead', 'a'.repeat(41), 'has space']) {
        const issues = lint((p) => (p.work = { ...p.work, id }));
        expect(issues).toEqual([expect.objectContaining({ path: 'work.id', code: 'workId', severity: 'error' })]);
      }
    });

    it('code goal without a code, with an invalid code, or with a kind mismatch', () => {
      expect(find(lint((p) => delete p.goals[0]!.code), 'codeMissing')[0]!.path).toBe('goals[0].code');
      expect(find(lint((p) => (p.goals[0]!.code = '  ')), 'codeMissing')).toHaveLength(1);

      const bad = find(lint((p) => (p.goals[0]!.code = 'K7Q-M2X-RAQ')), 'codeInvalid');
      expect(bad).toEqual([expect.objectContaining({ path: 'goals[0].code', severity: 'error' })]);
      expect(bad[0]!.messageJa).toContain('入力ミス');
      expect(find(lint((p) => (p.goals[2]!.code = 'ほたる・かえで・ぽぽぽ・こだま・すずめ')), 'codeInvalid')[0]!.messageJa).toContain(
        '3語目',
      );

      const mismatch = find(lint((p) => (p.goals[2]!.codeKind = 'b32')), 'codeKindMismatch');
      expect(mismatch).toEqual([expect.objectContaining({ path: 'goals[2].codeKind', severity: 'error' })]);
      expect(lint((p) => delete p.goals[2]!.codeKind)).toEqual([]);
    });

    it('missing secret title', () => {
      expect(find(lint((p) => delete p.goals[0]!.secret), 'secretTitleMissing')[0]!.path).toBe('goals[0].secret.title');
      expect(find(lint((p) => (p.goals[1]!.secret = { title: ' ' })), 'secretTitleMissing')).toHaveLength(1);
    });

    it('duplicate codes (same canonical form, any spelling)', () => {
      const issues = lint((p) => {
        p.goals[1]!.code = 'k7q m2x rap';
        p.goals[2]!.code = 'K7QM2XRAP';
        p.goals[2]!.codeKind = 'b32';
      });
      const dup = find(issues, 'duplicateCode');
      expect(dup.map((i) => i.path)).toEqual(['goals[1].code', 'goals[2].code']);
      expect(dup.every((i) => i.severity === 'error' && i.messageJa.includes('end-a'))).toBe(true);
    });

    it('duplicate ids in every collection', () => {
      const issues = lint((p) => {
        p.checkpoints.push({ id: 'ch1', label: '重複' });
        p.groups.push({ id: 'ach', label: '重複' });
        p.goals.push({ ...p.goals[3]! });
        p.sealed.push({ ...p.sealed[0]! });
      });
      expect(find(issues, 'duplicateId').map((i) => i.path)).toEqual([
        'checkpoints[3].id',
        'groups[2].id',
        'goals[5].id',
        'sealed[3].id',
      ]);
    });

    it('dangling goal.group and missable.before', () => {
      const issues = lint((p) => {
        p.goals[3]!.group = 'nope';
        p.goals[4]!.group = '';
        p.goals[1]!.missable = { before: 'ch9', warn: '注意' };
        p.goals[0]!.missable = { before: '', warn: '注意' };
      });
      expect(find(issues, 'danglingGroup').map((i) => i.path)).toEqual(['goals[3].group', 'goals[4].group']);
      expect(find(issues, 'danglingCheckpoint').map((i) => i.path)).toEqual(['goals[0].missable.before', 'goals[1].missable.before']);
    });

    it('an unset missable ({ before: "", warn: "" }) is ignored', () => {
      expect(lint((p) => (p.goals[0]!.missable = { before: '', warn: '' }))).toEqual([]);
    });

    it('sealed with no goals, or referencing a manual or unknown goal', () => {
      const issues = lint((p) => {
        p.sealed[0]!.goals = [];
        p.sealed[1]!.goals = ['end-a', 'ach-cat', 'ghost'];
      });
      expect(find(issues, 'sealedNoGoals').map((i) => i.path)).toEqual(['sealed[0].goals']);
      expect(find(issues, 'sealedRefersManual').map((i) => i.path)).toEqual(['sealed[1].goals[1]']);
      expect(find(issues, 'danglingGoal').map((i) => i.path)).toEqual(['sealed[1].goals[2]']);
    });

    it('returnCode kind without payload.returnCode', () => {
      const missing = lint((p) => delete p.sealed[2]!.payload.returnCode);
      expect(missing).toEqual([expect.objectContaining({ path: 'sealed[2].payload.returnCode', code: 'returnCodeMissing' })]);
      const empty = lint((p) => (p.sealed[2]!.payload.returnCode = { code: '', instruction: '入力してください' }));
      expect(codes(empty)).toEqual(['returnCodeMissing']);
      const noInstruction = lint((p) => (p.sealed[2]!.payload.returnCode = { code: 'ほしあかり', instruction: '' }));
      expect(noInstruction[0]!.path).toBe('sealed[2].payload.returnCode.instruction');
      // other kinds do not need it
      expect(lint((p) => (p.sealed[2]!.kind = 'story'))).toEqual([]);
    });

    it('a hint containing the secret title (leak)', () => {
      const issues = lint((p) => {
        p.goals[0]!.hints = ['夜の図書館へ', '「星図の果て」を目指して', '天文台の望遠鏡を3回調べる'];
        p.goals[2]!.hints = ['夜更けの朗読 を聞こう'];
      });
      expect(find(issues, 'hintLeaksSecret')).toEqual([
        expect.objectContaining({ path: 'goals[0].hints[1]', severity: 'error' }),
        expect.objectContaining({ path: 'goals[2].hints[0]', severity: 'error' }),
      ]);
    });

    it('iterations outside 100,000..2,000,000', () => {
      for (const n of [99_999, 2_000_001, 150_000.5, Number.NaN]) {
        const issues = lint((p) => (p.kdfIterations = n));
        expect(issues).toEqual([expect.objectContaining({ path: 'kdfIterations', code: 'kdfIterations', severity: 'error' })]);
      }
      expect(lint((p) => (p.kdfIterations = 100_000)).map((i) => i.code)).toEqual(['kdfIterationsLow']);
      expect(lint((p) => (p.kdfIterations = 2_000_000))).toEqual([]);
    });

    it('an invalid kdfSalt', () => {
      expect(codes(lint((p) => (p.kdfSalt = 'AAAA')))).toEqual(['kdfSalt']);
      expect(codes(lint((p) => (p.kdfSalt = '!!')))).toEqual(['kdfSalt']);
      expect(lint((p) => delete p.kdfSalt)).toEqual([]);
    });
  });
});

describe('isAllowedAppUrl', () => {
  it('accepts https and local http only', () => {
    expect(isAllowedAppUrl('https://a.example/')).toBe(true);
    expect(isAllowedAppUrl('HTTPS://A.EXAMPLE')).toBe(true);
    expect(isAllowedAppUrl('http://localhost')).toBe(true);
    expect(isAllowedAppUrl('http://localhost:4173/shiori/')).toBe(true);
    expect(isAllowedAppUrl('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedAppUrl('http://localhost.evil.example/')).toBe(false);
    expect(isAllowedAppUrl('http://example.com')).toBe(false);
    expect(isAllowedAppUrl('https://')).toBe(false);
    expect(isAllowedAppUrl('javascript:alert(1)')).toBe(false);
  });
});
