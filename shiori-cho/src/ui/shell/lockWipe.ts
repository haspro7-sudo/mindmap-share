// 「PINを忘れた」 → 全データを消して初期化 (F3 AC4). The PIN guards the whole app, studio included, so both
// databases are deleted: keeping 'shiori-studio' would let anyone read the creator's codes and sealed texts
// after wiping past the PIN. Then the app restarts at '#/' (never on the stale route of a deleted work).
// A failure is thrown to the lock screen, which shows it instead of reloading into the same PIN pad.
import { wipeAllData } from '../../app/wipe';
import { restartApp } from '../screens/settings/restart';

export async function wipeFromLockScreen(): Promise<void> {
  await wipeAllData({ studio: true });
  restartApp();
}
