// Strings for shell-level states added during integration (after the night closes).
import { defineStrings } from './index'

export const shellStrings = defineStrings('shell', {
  ja: {
    closedTitle: '今夜はおしまい',
    closedBody: 'ボールは記録に残っています。次に来たときは、続きから。',
    closedRecord: '記録を見る',
    closedNext: '次の来店をはじめる（デモ）',
  },
  en: {
    closedTitle: "That's a wrap for tonight",
    closedBody: 'Your ball is saved in your collection. Next time, pick up where you left off.',
    closedRecord: 'See your collection',
    closedNext: 'Start the next visit (demo)',
  },
  zhHant: {
    closedTitle: '今晚到此為止',
    closedBody: '你的球已留在紀錄裡。下次來，從這裡接著唱。',
    closedRecord: '查看紀錄',
    closedNext: '開始下一次來店（示意）',
  },
  zhHans: {
    closedTitle: '今晚到此为止',
    closedBody: '你的球已留在记录里。下次来，从这里接着唱。',
    closedRecord: '查看记录',
    closedNext: '开始下一次来店（示意）',
  },
  ko: {
    closedTitle: '오늘 밤은 여기까지',
    closedBody: '미러볼은 기록에 남아 있어요. 다음에 오면 이어서 시작해요.',
    closedRecord: '기록 보기',
    closedNext: '다음 방문 시작하기 (데모)',
  },
})
