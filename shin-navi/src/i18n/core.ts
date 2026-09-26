// Strings raised by core logic itself (toasts from store actions).
import { defineStrings } from './index'

export const coreStrings = defineStrings('core', {
  ja: {
    queuedEnd: '列の最後に入れました',
    excuse: '今のはナビの読み違い。次で取り返します',
    notReservable: 'この店舗では配信準備中（デモ表示）',
    orderClosed: '注文は締め切りました',
    undone: '元に戻しました',
    inserted: '次に挟みました',
    finaleFixed: '締めの1曲が決まりました',
  },
  en: {
    queuedEnd: 'Added to the end of the queue',
    excuse: 'The navi misread that one. It will make up for it next.',
    notReservable: 'Not yet available at this venue (demo)',
    orderClosed: 'Ordering is closed',
    undone: 'Undone',
    inserted: 'Slotted in next',
    finaleFixed: 'The closing song is set',
  },
  zhHant: {
    queuedEnd: '已排到最後',
    excuse: '剛才是導航判斷失誤，下一首扳回來',
    notReservable: '本店尚未提供（示意）',
    orderClosed: '點餐已截止',
    undone: '已復原',
    inserted: '已插到下一首',
    finaleFixed: '壓軸曲決定了',
  },
  zhHans: {
    queuedEnd: '已排到最后',
    excuse: '刚才是导航判断失误，下一首扳回来',
    notReservable: '本店尚未提供（示意）',
    orderClosed: '点餐已截止',
    undone: '已撤销',
    inserted: '已插到下一首',
    finaleFixed: '压轴曲决定了',
  },
  ko: {
    queuedEnd: '대기열 맨 뒤에 넣었어요',
    excuse: '방금은 내비가 잘못 읽었어요. 다음 곡으로 만회할게요',
    notReservable: '이 매장에서는 준비 중이에요 (데모)',
    orderClosed: '주문이 마감되었어요',
    undone: '되돌렸어요',
    inserted: '다음 곡으로 넣었어요',
    finaleFixed: '마지막 곡이 정해졌어요',
  },
})
