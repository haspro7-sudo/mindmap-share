import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types';
import type { DiscreetSettings, WorkRecord } from '../core/types';
import { createMemoryRepo, createMemoryStudioRepo } from './memoryRepo';
import {
  makeDataset,
  makeManifestRecord,
  makeProject,
  makeRedemption,
  makeWork,
  runRepoContract,
  runStudioRepoContract,
} from './repoContract';

runRepoContract('memory', () => createMemoryRepo());
runStudioRepoContract('memory', () => createMemoryStudioRepo());

describe('createMemoryRepo seed', () => {
  it('seeds every store from partial backup data', async () => {
    const data = makeDataset();
    const repo = createMemoryRepo(data);
    const out = await repo.exportAll();
    expect(out.works).toEqual(data.works);
    expect(out.manifests).toHaveLength(data.manifests.length);
    expect(out.progress).toHaveLength(data.progress.length);
    expect(out.redemptions).toHaveLength(data.redemptions.length);
    expect(out.hints).toHaveLength(data.hints.length);
    expect(out.sessions).toHaveLength(data.sessions.length);
    expect(out.notes).toHaveLength(data.notes.length);
    expect(out.pending).toHaveLength(data.pending.length);
    expect(out.sealedOpens).toHaveLength(data.sealedOpens.length);
    expect(await repo.findWorkByManifestWorkId('demo-two')).toEqual(data.works[1]);
  });

  it('accepts a partial seed (only some stores)', async () => {
    const repo = createMemoryRepo({ works: [makeWork('w1')], manifests: [makeManifestRecord('m1', 'w1')] });
    expect((await repo.listWorks()).map((w) => w.id)).toEqual(['w1']);
    expect(await repo.getManifest('m1')).toEqual(makeManifestRecord('m1', 'w1'));
    expect(await repo.listSessions()).toEqual([]);
  });

  it('seeding counts as no change and notifies nobody', async () => {
    const repo = createMemoryRepo(makeDataset());
    const listener = vi.fn();
    repo.subscribe(listener);
    expect((await repo.getSettings()).changesSinceBackup).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('without settings in the seed, getSettings returns the defaults', async () => {
    expect(await createMemoryRepo().getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await createMemoryRepo({ works: [makeWork('w1')] }).getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('seed.settings sets the backup subset', async () => {
    const repo = createMemoryRepo({
      settings: {
        discreet: { aliasOnly: false, blurOnHide: true, hideStoreLinks: false, blurExtras: true },
        autoLockSec: 300,
        camouflageText: 'メモ',
      },
    });
    expect(await repo.getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      discreet: { aliasOnly: false, blurOnHide: true, hideStoreLinks: false, blurExtras: true },
      autoLockSec: 300,
      camouflageText: 'メモ',
    });
  });

  it('fullSettings sets any setting, deep-merges discreet and wins over seed.settings', async () => {
    const repo = createMemoryRepo({
      settings: { discreet: DEFAULT_SETTINGS.discreet, autoLockSec: 300, camouflageText: 'a' },
      fullSettings: {
        ageConfirmedAt: 1,
        onboardedAt: 2,
        autoLockSec: 0,
        discreet: { blurExtras: true } as DiscreetSettings,
      },
    });
    expect(await repo.getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      ageConfirmedAt: 1,
      onboardedAt: 2,
      autoLockSec: 0,
      camouflageText: 'a',
      discreet: { ...DEFAULT_SETTINGS.discreet, blurExtras: true },
    });
  });

  it('copies the seed: later changes to the seed objects do not leak in', async () => {
    const data = makeDataset();
    const fullSettings = { completionPromptedWorkIds: ['w1'] };
    const repo = createMemoryRepo({ ...data, fullSettings });
    data.works[0]!.title = '改ざん';
    data.sessions.length = 0;
    fullSettings.completionPromptedWorkIds.push('w2');
    expect((await repo.getWork('w1'))?.title).toBe(makeDataset().works[0]!.title);
    expect(await repo.listSessions()).toHaveLength(3);
    expect((await repo.getSettings()).completionPromptedWorkIds).toEqual(['w1']);
  });

  it('keeps seeded masters locally but strips them on export', async () => {
    const repo = createMemoryRepo({ redemptions: [makeRedemption('w1', 'end-1')] });
    expect((await repo.listRedemptions())[0]?.master).toBeDefined();
    expect((await repo.exportAll()).redemptions[0]).not.toHaveProperty('master');
  });

  it('throws on a seed record without a key', () => {
    expect(() => createMemoryRepo({ works: [{ ...makeWork('w1'), id: undefined } as unknown as WorkRecord] })).toThrow(
      TypeError,
    );
  });

  it('separate repos never share data', async () => {
    const a = createMemoryRepo();
    const b = createMemoryRepo();
    await a.putWork(makeWork('w1'));
    await a.updateSettings({ camouflageText: 'a' });
    expect(await b.listWorks()).toEqual([]);
    expect((await b.getSettings()).camouflageText).toBe('');
  });
});

describe('createMemoryStudioRepo', () => {
  it('separate studio repos never share data', async () => {
    const a = createMemoryStudioRepo();
    const b = createMemoryStudioRepo();
    await a.put(makeProject('p1'));
    expect(await b.list()).toEqual([]);
  });
});
