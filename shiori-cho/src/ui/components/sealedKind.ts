// Icons and labels for sealed-extra kinds (public data: SealedItem.kind).
import type { SealedKind } from '../../core/types';

export const SEALED_KIND_ICON: Record<SealedKind, string> = {
  letter: '✉️',
  afterword: '📝',
  story: '📖',
  profile: '👤',
  returnCode: '🔑',
};

export const SEALED_KIND_LABEL: Record<SealedKind, string> = {
  letter: '手紙',
  afterword: 'あとがき',
  story: 'おはなし',
  profile: 'プロフィール',
  returnCode: '返し合言葉',
};
